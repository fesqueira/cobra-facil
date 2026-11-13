import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Sql } from "../../db/client.js";
import { errors } from "../../http/schemas.js";
import { verifyPsp } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { handlePixReceived } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * Notifications from the payment provider (PSP). The HMAC is computed over the
 * exact bytes received, so this plugin keeps the raw body. Content-type parsers
 * are encapsulated: the rest of the API keeps Fastify's default JSON parser.
 */
export const pspRoutes: FastifyPluginAsyncZod<{ sql: Sql; secret: string }> = async (app, { sql, secret }) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError(400, "INVALID_JSON", "Corpo JSON inválido."), undefined);
    }
  });

  // Signature first, before the body is even validated.
  app.addHook("preValidation", async (req) => {
    const header = req.headers["x-psp-signature"];
    if (!verifyPsp(secret, typeof header === "string" ? header : undefined, req.rawBody ?? "")) {
      throw new AppError(401, "INVALID_SIGNATURE", "Assinatura do PSP inválida.");
    }
  });

  app.post(
    "/v1/psp/webhooks",
    {
      schema: {
        tags: ["Pagamentos (PSP)"],
        summary: "Recebe a confirmação de um Pix pago",
        description:
          "Assinado com `x-psp-signature: sha256=<HMAC-SHA256 do corpo bruto>`. Eventos repetidos (mesmo `eventId`) " +
          "são ignorados; o PSP pode reenviar quantas vezes quiser.",
        security: [{ pspSignature: [] }],
        body: z.object({
          eventId: z.string().min(1).max(100),
          type: z.literal("pix.received"),
          txid: z.string().regex(/^[A-Za-z0-9]{1,25}$/),
          amountCents: z.int().positive(),
          paidAt: z.iso.datetime({ offset: true }),
        }),
        response: {
          200: z.object({
            result: z.enum(["paid", "duplicate", "ignored"]),
            reason: z.string().optional(),
          }),
          ...errors(400, 401, 422),
        },
      },
    },
    async (req) => {
      const outcome = await handlePixReceived(sql, req.body);
      if (outcome.result === "ignored") req.log.warn({ txid: req.body.txid, reason: outcome.reason }, "pagamento ignorado");
      return outcome;
    },
  );
};

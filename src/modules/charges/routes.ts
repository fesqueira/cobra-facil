import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Sql } from "../../db/client.js";
import { currentMerchant, merchantAuth } from "../../http/auth.js";
import { errors } from "../../http/schemas.js";
import { CHARGE_STATUSES, chargeSchema } from "./charge.js";
import { cancelCharge, createChargeIdempotent, getCharge, listCharges } from "./service.js";

const idParams = z.object({ id: z.uuid() });

export const chargeRoutes: FastifyPluginAsyncZod<{ sql: Sql }> = async (app, { sql }) => {
  app.addHook("onRequest", merchantAuth(sql));

  app.post(
    "/v1/charges",
    {
      schema: {
        tags: ["Cobranças"],
        summary: "Cria uma cobrança Pix",
        description:
          "Exige o cabeçalho `Idempotency-Key`. Repetir a requisição com a mesma chave e o mesmo corpo devolve a " +
          "mesma cobrança (com `Idempotent-Replayed: true`), sem criar outra. A mesma chave com outro corpo dá 422.",
        security: [{ apiKey: [] }],
        headers: z.looseObject({
          "idempotency-key": z.string().min(1).max(255).meta({ example: "pedido-1234" }),
        }),
        body: z.object({
          amountCents: z.int().positive().max(100_000_000).meta({ example: 2590 }),
          description: z.string().trim().min(1).max(50).optional().meta({ example: "Pedido #1234" }),
          expiresInSeconds: z.int().min(60).max(7 * 24 * 3600).default(3600),
        }),
        response: { 201: chargeSchema, ...errors(400, 401, 422, 429) },
      },
    },
    async (req, reply) => {
      const result = await createChargeIdempotent(sql, currentMerchant(req), req.headers["idempotency-key"], req.body);
      if (result.replayed) reply.header("idempotent-replayed", "true");
      // A replay answers exactly like the original request did.
      return reply.code(201).send(result.body);
    },
  );

  app.get(
    "/v1/charges",
    {
      schema: {
        tags: ["Cobranças"],
        summary: "Lista cobranças (paginação por cursor)",
        security: [{ apiKey: [] }],
        querystring: z.object({
          status: z.enum(CHARGE_STATUSES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().max(100).optional(),
        }),
        response: {
          200: z.object({ data: z.array(chargeSchema), nextCursor: z.string().nullable() }),
          ...errors(400, 401),
        },
      },
    },
    async (req) => listCharges(sql, currentMerchant(req).id, req.query),
  );

  app.get(
    "/v1/charges/:id",
    {
      schema: {
        tags: ["Cobranças"],
        summary: "Consulta uma cobrança",
        security: [{ apiKey: [] }],
        params: idParams,
        response: { 200: chargeSchema, ...errors(400, 401, 404) },
      },
    },
    async (req) => getCharge(sql, currentMerchant(req).id, req.params.id),
  );

  app.post(
    "/v1/charges/:id/cancel",
    {
      schema: {
        tags: ["Cobranças"],
        summary: "Cancela uma cobrança pendente",
        security: [{ apiKey: [] }],
        params: idParams,
        response: { 200: chargeSchema, ...errors(400, 401, 404, 409) },
      },
    },
    async (req) => cancelCharge(sql, currentMerchant(req).id, req.params.id),
  );
};

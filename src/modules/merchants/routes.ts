import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Sql } from "../../db/client.js";
import { adminAuth, currentMerchant, merchantAuth } from "../../http/auth.js";
import { errors } from "../../http/schemas.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { normalizeKey, PIX_KEY_TYPES, PixKeyError } from "../../lib/pix/keys.js";
import { toPixText } from "../../lib/pix/brcode.js";
import { insertMerchant, updateWebhookUrl, type Merchant } from "./repository.js";

const webhookUrl = z.url({ protocol: /^https?$/ }).nullable();

const merchantSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    city: z.string(),
    pixKeyType: z.enum(PIX_KEY_TYPES),
    pixKey: z.string(),
    webhookUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: "Merchant" });

const toDto = (m: Merchant): z.infer<typeof merchantSchema> => ({
  id: m.id,
  name: m.name,
  city: m.city,
  pixKeyType: m.pixKeyType,
  pixKey: m.pixKey,
  webhookUrl: m.webhookUrl,
  createdAt: m.createdAt.toISOString(),
});

const pixText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => toPixText(v).length > 0, "Precisa ter letras ou números.");

export const merchantRoutes: FastifyPluginAsyncZod<{ sql: Sql; adminToken: string }> = async (app, { sql, adminToken }) => {
  const auth = merchantAuth(sql);

  app.post(
    "/v1/merchants",
    {
      onRequest: adminAuth(adminToken),
      schema: {
        tags: ["Lojistas"],
        summary: "Cria um lojista (admin)",
        description: "Devolve a chave de API e o segredo de webhook **uma única vez**. Só o hash da chave é guardado.",
        security: [{ adminToken: [] }],
        body: z.object({
          name: pixText(100).meta({ example: "Padaria Pão Quente" }),
          city: pixText(60).meta({ example: "Marília" }),
          pixKeyType: z.enum(PIX_KEY_TYPES),
          pixKey: z.string().min(1).max(77).meta({ example: "padaria@exemplo.com" }),
          webhookUrl: webhookUrl.optional(),
        }),
        response: {
          201: z.object({ merchant: merchantSchema, apiKey: z.string(), webhookSecret: z.string() }),
          ...errors(400, 401, 422),
        },
      },
    },
    async (req, reply) => {
      let pixKey: string;
      try {
        pixKey = normalizeKey(req.body.pixKeyType, req.body.pixKey);
      } catch (e) {
        if (e instanceof PixKeyError) throw new AppError(422, "INVALID_PIX_KEY", e.message);
        throw e;
      }
      const apiKey = randomToken("cf_live_");
      const webhookSecret = randomToken("whsec_");
      const merchant = await insertMerchant(sql, {
        name: req.body.name,
        city: req.body.city,
        pixKeyType: req.body.pixKeyType,
        pixKey,
        webhookUrl: req.body.webhookUrl ?? null,
        apiKeyHash: sha256(apiKey),
        webhookSecret,
      });
      return reply.code(201).send({ merchant: toDto(merchant), apiKey, webhookSecret });
    },
  );

  app.get(
    "/v1/merchants/me",
    {
      onRequest: auth,
      schema: {
        tags: ["Lojistas"],
        summary: "Dados do lojista autenticado",
        security: [{ apiKey: [] }],
        response: { 200: merchantSchema, ...errors(401) },
      },
    },
    async (req) => toDto(currentMerchant(req)),
  );

  app.patch(
    "/v1/merchants/me",
    {
      onRequest: auth,
      schema: {
        tags: ["Lojistas"],
        summary: "Altera a URL que recebe os webhooks",
        security: [{ apiKey: [] }],
        body: z.object({ webhookUrl }),
        response: { 200: merchantSchema, ...errors(400, 401) },
      },
    },
    async (req) => toDto(await updateWebhookUrl(sql, currentMerchant(req).id, req.body.webhookUrl)),
  );
};

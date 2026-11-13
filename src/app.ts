import { randomUUID } from "node:crypto";
import Fastify, { type FastifyServerOptions } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { Sql } from "./db/client.js";
import { DOCS_CSP, docsHtml } from "./http/docs.js";
import { errors } from "./http/schemas.js";
import { sha256 } from "./lib/crypto.js";
import { AppError } from "./lib/errors.js";
import { chargeRoutes } from "./modules/charges/routes.js";
import { merchantRoutes } from "./modules/merchants/routes.js";
import { pspRoutes } from "./modules/payments/routes.js";

export interface AppOptions {
  sql: Sql;
  adminToken: string;
  pspWebhookSecret: string;
  logger?: FastifyServerOptions["logger"];
  /** Requests per minute per API key (or per IP when anonymous). false disables it. */
  rateLimitPerMinute?: number | false;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("merchant", null);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  await app.register(helmet);

  if (opts.rateLimitPerMinute !== false) {
    await app.register(rateLimit, {
      max: opts.rateLimitPerMinute ?? 120,
      timeWindow: "1 minute",
      // One bucket per API key (hashed, never the key itself), otherwise per IP.
      keyGenerator: (req) => (req.headers.authorization ? sha256(req.headers.authorization) : req.ip),
      errorResponseBuilder: (_req, ctx) =>
        new AppError(429, "RATE_LIMITED", `Limite de ${ctx.max} requisições por minuto atingido. Tente em ${ctx.after}.`),
    });
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Cobra Fácil API",
        version: "1.0.0",
        description:
          "API de cobranças Pix para pequenos negócios: cria cobranças com Pix Copia e Cola, confirma pagamentos " +
          "enviados pelo PSP e avisa o lojista por webhooks assinados, com novas tentativas.",
      },
      tags: [
        { name: "Lojistas" },
        { name: "Cobranças" },
        { name: "Pagamentos (PSP)", description: "Notificações enviadas pelo provedor de pagamento." },
        { name: "Operação" },
      ],
      components: {
        securitySchemes: {
          apiKey: { type: "http", scheme: "bearer", description: "Chave de API do lojista (cf_live_...)." },
          adminToken: { type: "apiKey", in: "header", name: "x-admin-token" },
          pspSignature: { type: "apiKey", in: "header", name: "x-psp-signature" },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Requisição inválida.",
          details: err.validation.map((v) => ({ path: `${err.validationContext ?? ""}${v.instancePath}`, message: v.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err instanceof Error ? err.message : "Requisição inválida." } });
    }
    req.log.error({ err }, "erro não tratado");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Erro interno." } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: "ROUTE_NOT_FOUND", message: `Rota ${req.method} ${req.url} não existe.` } }),
  );

  app.get(
    "/health",
    {
      logLevel: "warn", // probed every few seconds by Docker; keep it out of the logs
      schema: {
        tags: ["Operação"],
        summary: "Saúde da API e do banco",
        response: { 200: z.object({ status: z.literal("ok"), db: z.literal("ok") }), ...errors(503) },
      },
    },
    async () => {
      try {
        await opts.sql`SELECT 1`;
      } catch {
        throw new AppError(503, "DB_UNAVAILABLE", "Banco de dados indisponível.");
      }
      return { status: "ok" as const, db: "ok" as const };
    },
  );

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  app.get("/docs", { schema: { hide: true } }, async (_req, reply) =>
    reply.header("content-security-policy", DOCS_CSP).type("text/html").send(docsHtml("/openapi.json")),
  );

  await app.register(merchantRoutes, { sql: opts.sql, adminToken: opts.adminToken });
  await app.register(chargeRoutes, { sql: opts.sql });
  await app.register(pspRoutes, { sql: opts.sql, secret: opts.pspWebhookSecret });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

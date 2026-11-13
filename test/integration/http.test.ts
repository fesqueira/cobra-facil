import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { ADMIN_TOKEN, PSP_SECRET, useTestApp } from "./helpers.js";

const t = useTestApp();

describe("HTTP", () => {
  it("/health confere o banco", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("devolve o x-request-id recebido e cabeçalhos de segurança", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "abc-123" } });
    expect(res.headers["x-request-id"]).toBe("abc-123");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rota inexistente responde no formato de erro padrão", async () => {
    const res = await t.app.inject({ method: "GET", url: "/nada" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("publica o OpenAPI com todas as rotas", async () => {
    const spec = (await t.app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/v1/merchants", "/v1/charges", "/v1/charges/{id}", "/v1/charges/{id}/cancel", "/v1/psp/webhooks"]),
    );
  });

  it("limita requisições por chave", async () => {
    const app = await buildApp({ sql: t.sql, adminToken: ADMIN_TOKEN, pspWebhookSecret: PSP_SECRET, rateLimitPerMinute: 2 });
    const hit = () => app.inject({ method: "GET", url: "/health" });
    await hit();
    await hit();
    const third = await hit();
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });
});

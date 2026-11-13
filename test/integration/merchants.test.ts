import { describe, expect, it } from "vitest";
import { sha256 } from "../../src/lib/crypto.js";
import { ADMIN_TOKEN, createMerchant, useTestApp } from "./helpers.js";

const t = useTestApp();

describe("lojistas", () => {
  it("só o admin cria lojistas", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/merchants", headers: { "x-admin-token": "errado" }, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("valida a chave Pix", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/merchants",
      headers: { "x-admin-token": ADMIN_TOKEN },
      payload: { name: "Loja", city: "Marília", pixKeyType: "cpf", pixKey: "123.456.789-00" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_PIX_KEY");
  });

  it("guarda só o hash da chave de API e autentica com ela", async () => {
    const { apiKey, auth, merchant } = await createMerchant(t.app);
    expect(apiKey).toMatch(/^cf_live_/);

    const [row] = await t.sql`SELECT api_key_hash FROM merchants WHERE id = ${merchant.id}`;
    expect(row?.apiKeyHash).toBe(sha256(apiKey));
    expect(JSON.stringify(row)).not.toContain(apiKey);

    const me = await t.app.inject({ method: "GET", url: "/v1/merchants/me", headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: merchant.id, pixKey: "padaria@exemplo.com" });

    const bad = await t.app.inject({ method: "GET", url: "/v1/merchants/me", headers: { authorization: "Bearer cf_live_x" } });
    expect(bad.statusCode).toBe(401);
  });

  it("altera a URL de webhook e só aceita http(s)", async () => {
    const { auth } = await createMerchant(t.app);
    const ok = await t.app.inject({ method: "PATCH", url: "/v1/merchants/me", headers: auth, payload: { webhookUrl: "https://loja.exemplo/webhook" } });
    expect(ok.json().webhookUrl).toBe("https://loja.exemplo/webhook");
    const bad = await t.app.inject({ method: "PATCH", url: "/v1/merchants/me", headers: auth, payload: { webhookUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
  });
});

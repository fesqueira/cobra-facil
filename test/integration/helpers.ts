import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import { createDb, type Sql } from "../../src/db/client.js";
import { signPsp } from "../../src/lib/crypto.js";

export const ADMIN_TOKEN = "test-admin-token-123456";
export const PSP_SECRET = "test-psp-secret-1234567";

/** A fresh app and database connection per test file, with empty tables before each test. */
export function useTestApp() {
  const ctx = {} as { app: App; sql: Sql };

  beforeAll(async () => {
    ctx.sql = createDb(inject("databaseUrl"));
    ctx.app = await buildApp({ sql: ctx.sql, adminToken: ADMIN_TOKEN, pspWebhookSecret: PSP_SECRET, rateLimitPerMinute: false, logger: process.env.TEST_LOG ? { level: "error" } : false });
  });
  beforeEach(async () => {
    await ctx.sql`TRUNCATE merchants, charges, idempotency_keys, psp_events, webhook_events CASCADE`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  return ctx;
}

export async function createMerchant(app: App, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    headers: { "x-admin-token": ADMIN_TOKEN },
    payload: { name: "Padaria Pão Quente", city: "Marília", pixKeyType: "email", pixKey: "padaria@exemplo.com", ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(`createMerchant: ${res.statusCode} ${res.body}`);
  const body = res.json<{ apiKey: string; webhookSecret: string; merchant: { id: string } }>();
  return { ...body, auth: { authorization: `Bearer ${body.apiKey}` } };
}

let seq = 0;
export async function createCharge(app: App, auth: Record<string, string>, payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/charges",
    headers: { ...auth, "idempotency-key": `k-${++seq}-${Date.now()}` },
    payload: { amountCents: 2590, description: "Pedido 1", ...payload },
  });
  if (res.statusCode !== 201) throw new Error(`createCharge: ${res.statusCode} ${res.body}`);
  return res.json<{ id: string; txid: string; status: string; amountCents: number; pixCopyPaste: string }>();
}

/** Sends a PSP notification signed (or not) with the shared secret. */
export function pspNotify(app: App, event: Record<string, unknown>, secret = PSP_SECRET) {
  const body = JSON.stringify({ type: "pix.received", paidAt: new Date().toISOString(), ...event });
  return app.inject({
    method: "POST",
    url: "/v1/psp/webhooks",
    headers: { "content-type": "application/json", "x-psp-signature": signPsp(secret, body) },
    payload: body,
  });
}

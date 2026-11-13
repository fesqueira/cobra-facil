import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyWebhook } from "../../src/lib/crypto.js";
import { dispatchDueWebhooks, MAX_ATTEMPTS } from "../../src/modules/webhooks/dispatcher.js";
import { createCharge, createMerchant, pspNotify, useTestApp } from "./helpers.js";

const t = useTestApp();

/** A fake merchant endpoint that records what it receives and answers with `nextStatus`. */
let server: Server;
let url = "";
let received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let nextStatus = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(nextStatus).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  received = [];
  nextStatus = 200;
});

async function paidCharge() {
  const m = await createMerchant(t.app, { webhookUrl: url });
  const charge = await createCharge(t.app, m.auth);
  await pspNotify(t.app, { eventId: `e-${charge.id}`, txid: charge.txid, amountCents: 2590 });
  return { ...m, charge };
}

const eventRow = async () => (await t.sql`SELECT status, attempts, last_error, next_attempt_at FROM webhook_events`)[0]!;

describe("entrega de webhooks", () => {
  it("entrega o evento assinado e marca como entregue", async () => {
    const { webhookSecret, charge } = await paidCharge();
    expect(await dispatchDueWebhooks({ sql: t.sql })).toEqual({ delivered: 1, failed: 0 });

    const [hit] = received;
    expect(hit).toBeDefined();
    expect(verifyWebhook(webhookSecret, String(hit!.headers["cobra-signature"]), hit!.body)).toBe(true);
    expect(JSON.parse(hit!.body)).toMatchObject({ type: "charge.paid", data: { charge: { id: charge.id, status: "paid" } } });
    expect(hit!.headers["cobra-event-type"]).toBe("charge.paid");
    expect(await eventRow()).toMatchObject({ status: "delivered", attempts: 1 });

    expect(await dispatchDueWebhooks({ sql: t.sql })).toEqual({ delivered: 0, failed: 0 });
  });

  it("em caso de falha agenda nova tentativa com espera crescente", async () => {
    await paidCharge();
    nextStatus = 500;
    expect(await dispatchDueWebhooks({ sql: t.sql })).toEqual({ delivered: 0, failed: 1 });
    const row = await eventRow();
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 500" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5_000);

    // Not due yet: nothing is sent.
    expect(await dispatchDueWebhooks({ sql: t.sql })).toEqual({ delivered: 0, failed: 0 });

    nextStatus = 200;
    await t.sql`UPDATE webhook_events SET next_attempt_at = now()`;
    expect(await dispatchDueWebhooks({ sql: t.sql })).toEqual({ delivered: 1, failed: 0 });
    expect(await eventRow()).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it(`desiste depois de ${MAX_ATTEMPTS} tentativas`, async () => {
    await paidCharge();
    nextStatus = 503;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await t.sql`UPDATE webhook_events SET next_attempt_at = now()`;
      await dispatchDueWebhooks({ sql: t.sql });
    }
    expect(await eventRow()).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(received).toHaveLength(MAX_ATTEMPTS);
  });

  it("vários workers ao mesmo tempo entregam cada evento uma vez só", async () => {
    const m = await createMerchant(t.app, { webhookUrl: url });
    for (let i = 0; i < 10; i++) {
      const c = await createCharge(t.app, m.auth);
      await pspNotify(t.app, { eventId: `e${i}`, txid: c.txid, amountCents: 2590 });
    }
    const runs = await Promise.all(Array.from({ length: 4 }, () => dispatchDueWebhooks({ sql: t.sql, batchSize: 3 })));
    const more = await dispatchDueWebhooks({ sql: t.sql, batchSize: 20 });
    const total = runs.reduce((n, r) => n + r.delivered, 0) + more.delivered;

    expect(total).toBe(10);
    const ids = received.map((r) => r.headers["cobra-event-id"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lojista sem URL de webhook: o evento falha sem tentar de novo", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    await pspNotify(t.app, { eventId: "sem-url", txid: charge.txid, amountCents: 2590 });
    await dispatchDueWebhooks({ sql: t.sql });
    expect(await eventRow()).toMatchObject({ status: "failed", lastError: "lojista sem webhookUrl" });
  });
});

import { describe, expect, it } from "vitest";
import { expireCharges } from "../../src/jobs/expire-charges.js";
import { createCharge, createMerchant, pspNotify, useTestApp } from "./helpers.js";

const t = useTestApp();

const status = async (id: string) => (await t.sql`SELECT status FROM charges WHERE id = ${id}`)[0]?.status;
const events = async () => (await t.sql`SELECT type, payload FROM webhook_events ORDER BY created_at`) as unknown as { type: string; payload: { charge: { id: string; status: string } } }[];

describe("confirmação de pagamento (PSP)", () => {
  it("recusa notificação sem assinatura válida", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    const res = await pspNotify(t.app, { eventId: "e1", txid: charge.txid, amountCents: 2590 }, "segredo-errado-123456");
    expect(res.statusCode).toBe(401);
    expect(await status(charge.id)).toBe("pending");
  });

  it("marca como paga e enfileira o webhook na mesma transação", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    const res = await pspNotify(t.app, { eventId: "e1", txid: charge.txid, amountCents: 2590 });
    expect(res.json()).toEqual({ result: "paid" });

    const got = await t.app.inject({ method: "GET", url: `/v1/charges/${charge.id}`, headers: auth });
    expect(got.json()).toMatchObject({ status: "paid" });
    expect(got.json().paidAt).not.toBeNull();
    const [event] = await events();
    expect(event).toMatchObject({ type: "charge.paid", payload: { charge: { id: charge.id, status: "paid" } } });
  });

  it("evento repetido do PSP não paga duas vezes", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    const event = { eventId: "e-dup", txid: charge.txid, amountCents: 2590 };
    const results = await Promise.all([pspNotify(t.app, event), pspNotify(t.app, event), pspNotify(t.app, event)]);
    expect(results.map((r) => r.json().result).sort()).toEqual(["duplicate", "duplicate", "paid"]);
    expect(await events()).toHaveLength(1);
  });

  it("valor diferente dá 422 e não deixa rastro (o PSP pode reenviar corrigido)", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    const wrong = await pspNotify(t.app, { eventId: "e2", txid: charge.txid, amountCents: 100 });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error).toMatchObject({ code: "AMOUNT_MISMATCH", details: { expected: 2590, received: 100 } });
    expect(await status(charge.id)).toBe("pending");

    const right = await pspNotify(t.app, { eventId: "e2", txid: charge.txid, amountCents: 2590 });
    expect(right.json().result).toBe("paid");
  });

  it("ignora pagamento de cobrança cancelada ou inexistente", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth);
    await t.app.inject({ method: "POST", url: `/v1/charges/${charge.id}/cancel`, headers: auth });
    const res = await pspNotify(t.app, { eventId: "e3", txid: charge.txid, amountCents: 2590 });
    expect(res.json()).toEqual({ result: "ignored", reason: "charge_canceled" });
    const unknown = await pspNotify(t.app, { eventId: "e4", txid: "NaoExiste", amountCents: 2590 });
    expect(unknown.json()).toEqual({ result: "ignored", reason: "charge_not_found" });
  });
});

describe("expiração", () => {
  it("expira cobranças vencidas, avisa o lojista e depois ignora o pagamento atrasado", async () => {
    const { auth } = await createMerchant(t.app);
    const overdue = await createCharge(t.app, auth);
    const fresh = await createCharge(t.app, auth);
    await t.sql`UPDATE charges SET expires_at = now() - interval '1 second' WHERE id = ${overdue.id}`;

    expect(await expireCharges(t.sql)).toBe(1);
    expect(await status(overdue.id)).toBe("expired");
    expect(await status(fresh.id)).toBe("pending");
    expect((await events()).map((e) => e.type)).toEqual(["charge.expired"]);
    expect(await expireCharges(t.sql)).toBe(0);

    const late = await pspNotify(t.app, { eventId: "late", txid: overdue.txid, amountCents: 2590 });
    expect(late.json()).toEqual({ result: "ignored", reason: "charge_expired" });
  });
});

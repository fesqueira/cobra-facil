import { describe, expect, it } from "vitest";
import { isValidBrCode } from "../../src/lib/pix/brcode.js";
import { createCharge, createMerchant, useTestApp } from "./helpers.js";

const t = useTestApp();
const countCharges = async () => (await t.sql<{ count: number }[]>`SELECT count(*)::int FROM charges`)[0]?.count;

describe("cobranças", () => {
  it("exige chave de API", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/charges" });
    expect(res.statusCode).toBe(401);
  });

  it("cria cobrança com Pix Copia e Cola válido", async () => {
    const { auth } = await createMerchant(t.app);
    const charge = await createCharge(t.app, auth, { amountCents: 1999 });
    expect(charge.status).toBe("pending");
    expect(isValidBrCode(charge.pixCopyPaste)).toBe(true);
    expect(charge.pixCopyPaste).toContain("540519.99"); // field 54: amount
    expect(charge.pixCopyPaste).toContain(`0525${charge.txid}`);
  });

  it("exige Idempotency-Key e valida o corpo", async () => {
    const { auth } = await createMerchant(t.app);
    const noKey = await t.app.inject({ method: "POST", url: "/v1/charges", headers: auth, payload: { amountCents: 100 } });
    expect(noKey.statusCode).toBe(400);
    const badBody = await t.app.inject({
      method: "POST",
      url: "/v1/charges",
      headers: { ...auth, "idempotency-key": "k1" },
      payload: { amountCents: 10.5 },
    });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json().error.code).toBe("VALIDATION_ERROR");
  });

  describe("idempotência", () => {
    const post = (auth: Record<string, string>, key: string, payload: object) =>
      t.app.inject({ method: "POST", url: "/v1/charges", headers: { ...auth, "idempotency-key": key }, payload });

    it("repetir a mesma requisição devolve a mesma cobrança", async () => {
      const { auth } = await createMerchant(t.app);
      const first = await post(auth, "pedido-42", { amountCents: 500, description: "Pedido 42" });
      const again = await post(auth, "pedido-42", { description: "Pedido 42", amountCents: 500 });
      expect(again.statusCode).toBe(201);
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(again.json().id).toBe(first.json().id);
      expect(await countCharges()).toBe(1);
    });

    it("mesma chave com outro corpo dá 422", async () => {
      const { auth } = await createMerchant(t.app);
      await post(auth, "pedido-1", { amountCents: 500 });
      const res = await post(auth, "pedido-1", { amountCents: 501 });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("requisições simultâneas com a mesma chave criam uma cobrança só", async () => {
      const { auth } = await createMerchant(t.app);
      const results = await Promise.all(Array.from({ length: 8 }, () => post(auth, "corrida", { amountCents: 700 })));
      expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
      expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
      expect(await countCharges()).toBe(1);
    });

    it("chaves são separadas por lojista", async () => {
      const a = await createMerchant(t.app);
      const b = await createMerchant(t.app, { name: "Outra Loja" });
      const ra = await post(a.auth, "mesma", { amountCents: 100 });
      const rb = await post(b.auth, "mesma", { amountCents: 100 });
      expect(ra.json().id).not.toBe(rb.json().id);
    });
  });

  it("um lojista não enxerga a cobrança do outro", async () => {
    const a = await createMerchant(t.app);
    const b = await createMerchant(t.app, { name: "Outra Loja" });
    const charge = await createCharge(t.app, a.auth);
    const res = await t.app.inject({ method: "GET", url: `/v1/charges/${charge.id}`, headers: b.auth });
    expect(res.statusCode).toBe(404);
  });

  it("pagina por cursor sem repetir nem pular itens", async () => {
    const { auth } = await createMerchant(t.app);
    const created = [];
    for (let i = 0; i < 7; i++) created.push((await createCharge(t.app, auth, { amountCents: 100 + i })).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/v1/charges?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await t.app.inject({ method: "GET", url, headers: auth })).json();
      seen.push(...page.data.map((c: { id: string }) => c.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...created].reverse());
  });

  it("filtra por status e cancela só cobranças pendentes", async () => {
    const { auth } = await createMerchant(t.app);
    const keep = await createCharge(t.app, auth);
    const cancel = await createCharge(t.app, auth);

    const res = await t.app.inject({ method: "POST", url: `/v1/charges/${cancel.id}/cancel`, headers: auth });
    expect(res.json().status).toBe("canceled");
    const again = await t.app.inject({ method: "POST", url: `/v1/charges/${cancel.id}/cancel`, headers: auth });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("CHARGE_NOT_PENDING");

    const pending = (await t.app.inject({ method: "GET", url: "/v1/charges?status=pending", headers: auth })).json();
    expect(pending.data.map((c: { id: string }) => c.id)).toEqual([keep.id]);

    const [event] = await t.sql`SELECT type FROM webhook_events`;
    expect(event?.type).toBe("charge.canceled");
  });
});

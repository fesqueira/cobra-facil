import { describe, expect, it } from "vitest";
import { newTxid, signPsp, signWebhook, stableStringify, verifyPsp, verifyWebhook } from "../../src/lib/crypto.js";

describe("assinatura dos webhooks enviados ao lojista", () => {
  const secret = "whsec_teste";
  const body = '{"type":"charge.paid"}';
  const now = 1_800_000_000;

  it("aceita a assinatura correta dentro da janela de tempo", () => {
    expect(verifyWebhook(secret, signWebhook(secret, body, now), body, 300, now + 10)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado e assinatura antiga (replay)", () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhook(secret, header, body.replace("paid", "expired"), 300, now)).toBe(false);
    expect(verifyWebhook("outro", header, body, 300, now)).toBe(false);
    expect(verifyWebhook(secret, header, body, 300, now + 301)).toBe(false);
    expect(verifyWebhook(secret, "lixo", body, 300, now)).toBe(false);
  });
});

describe("assinatura do PSP", () => {
  it("valida o HMAC do corpo bruto", () => {
    const raw = '{"eventId":"e1"}';
    expect(verifyPsp("s", signPsp("s", raw), raw)).toBe(true);
    expect(verifyPsp("s", signPsp("s", raw), `${raw} `)).toBe(false);
    expect(verifyPsp("s", undefined, raw)).toBe(false);
  });
});

describe("utilitários", () => {
  it("stableStringify ignora a ordem das chaves", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("gera TXIDs de 25 letras e números", () => {
    const ids = new Set(Array.from({ length: 200 }, newTxid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{25}$/);
  });
});

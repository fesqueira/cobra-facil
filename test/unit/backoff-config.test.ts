import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { backoffSeconds } from "../../src/modules/webhooks/dispatcher.js";

describe("backoffSeconds", () => {
  it("dobra a cada tentativa e para em 1 hora", () => {
    const noJitter = () => 0;
    expect([1, 2, 3, 4].map((a) => backoffSeconds(a, noJitter))).toEqual([10, 20, 40, 80]);
    expect(backoffSeconds(20, noJitter)).toBe(3600);
  });

  it("acrescenta no máximo 20% de jitter", () => {
    expect(backoffSeconds(1, () => 0.999)).toBeLessThanOrEqual(12);
  });
});

describe("loadConfig", () => {
  const valid = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    ADMIN_TOKEN: "a".repeat(16),
    PSP_WEBHOOK_SECRET: "b".repeat(16),
  };

  it("aplica os padrões", () => {
    expect(loadConfig(valid)).toMatchObject({ PORT: 3000, LOG_LEVEL: "info", RUN_WORKERS: true });
    expect(loadConfig({ ...valid, RUN_WORKERS: "false" }).RUN_WORKERS).toBe(false);
  });

  it("recusa subir com segredo curto ou URL faltando", () => {
    expect(() => loadConfig({ ...valid, ADMIN_TOKEN: "curto" })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ADMIN_TOKEN: valid.ADMIN_TOKEN, PSP_WEBHOOK_SECRET: valid.PSP_WEBHOOK_SECRET })).toThrow(/DATABASE_URL/);
  });
});

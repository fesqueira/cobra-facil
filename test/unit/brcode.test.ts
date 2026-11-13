import { describe, expect, it } from "vitest";
import { crc16 } from "../../src/lib/pix/crc16.js";
import { parseTlv } from "../../src/lib/pix/emv.js";
import { BrCodeError, buildBrCode, formatCents, isValidBrCode, toPixText } from "../../src/lib/pix/brcode.js";
import { isValidCnpj, isValidCpf, normalizeKey, PixKeyError } from "../../src/lib/pix/keys.js";

// Example payload published in the Banco Central "Manual de Padrões para Iniciação do Pix".
const BCB_EXAMPLE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

const base = { key: "padaria@exemplo.com", name: "Padaria Pão Quente", city: "Marília", amountCents: 2590, txid: "ABC123" };

describe("CRC16 e TLV", () => {
  it("bate com o exemplo oficial do Banco Central", () => {
    expect(crc16(BCB_EXAMPLE.slice(0, -4))).toBe("1D3D");
    expect(isValidBrCode(BCB_EXAMPLE)).toBe(true);
  });

  it("rejeita código adulterado", () => {
    expect(isValidBrCode(BCB_EXAMPLE.replace("Fulano", "Ciclan"))).toBe(false);
    expect(isValidBrCode("0002XX")).toBe(false);
  });
});

describe("buildBrCode", () => {
  it("gera um BR Code válido com valor, nome, cidade e TXID", () => {
    const code = buildBrCode(base);
    expect(isValidBrCode(code)).toBe(true);
    const fields = Object.fromEntries(parseTlv(code).map((f) => [f.id, f.value]));
    expect(fields["54"]).toBe("25.90");
    expect(fields["59"]).toBe("Padaria Pao Quente");
    expect(fields["60"]).toBe("Marilia");
    expect(fields["62"]).toBe("0506ABC123");
  });

  it("corta nome e cidade nos limites do padrão", () => {
    const code = buildBrCode({ ...base, name: "Mercadinho do Bairro São José Ltda", city: "São José do Rio Preto" });
    const fields = Object.fromEntries(parseTlv(code).map((f) => [f.id, f.value]));
    expect(fields["59"]).toHaveLength(25);
    expect(fields["60"]).toHaveLength(15);
  });

  it("recusa descrição que estoura o campo 26", () => {
    expect(() => buildBrCode({ ...base, description: "x".repeat(70) })).toThrow(BrCodeError);
  });

  it("recusa TXID fora do padrão", () => {
    expect(() => buildBrCode({ ...base, txid: "com-hifen" })).toThrow(BrCodeError);
  });
});

describe("formatCents e toPixText", () => {
  it("formata centavos sem ponto flutuante", () => {
    expect(formatCents(1)).toBe("0.01");
    expect(formatCents(10)).toBe("0.10");
    expect(formatCents(123456789)).toBe("1234567.89");
    expect(() => formatCents(0)).toThrow(BrCodeError);
    expect(() => formatCents(1.5)).toThrow(BrCodeError);
  });

  it("remove acentos e caracteres fora do ASCII", () => {
    expect(toPixText("  Açaí   do João 🍇 ")).toBe("Acai do Joao");
  });
});

describe("chaves Pix", () => {
  it("valida CPF e CNPJ pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
  });

  it("normaliza cada tipo de chave", () => {
    expect(normalizeKey("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizeKey("phone", "(14) 99999-8888")).toBe("+5514999998888");
    expect(normalizeKey("email", " Loja@Exemplo.COM ")).toBe("loja@exemplo.com");
    expect(() => normalizeKey("evp", "nao-e-uuid")).toThrow(PixKeyError);
  });
});

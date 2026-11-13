/**
 * Pix key ("chave Pix") validation and normalisation, in the formats the
 * Banco Central DICT expects inside a BR Code.
 */

export const PIX_KEY_TYPES = ["cpf", "cnpj", "phone", "email", "evp"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export class PixKeyError extends Error {}

const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(cnpj[i]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

/** Normalises a key of a known type, or throws PixKeyError. */
export function normalizeKey(type: PixKeyType, raw: string): string {
  const input = raw.trim();
  switch (type) {
    case "cpf":
      if (!isValidCpf(input)) throw new PixKeyError("CPF inválido.");
      return onlyDigits(input);
    case "cnpj":
      if (!isValidCnpj(input)) throw new PixKeyError("CNPJ inválido.");
      return onlyDigits(input);
    case "phone": {
      let digits = onlyDigits(input);
      if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
      if (digits.length !== 10 && digits.length !== 11) throw new PixKeyError("Celular inválido: use DDD + número.");
      return `+55${digits}`;
    }
    case "email":
      if (!EMAIL.test(input) || input.length > 77) throw new PixKeyError("E-mail inválido.");
      return input.toLowerCase();
    case "evp":
      if (!EVP.test(input)) throw new PixKeyError("Chave aleatória inválida: use o formato UUID (36 caracteres).");
      return input.toLowerCase();
  }
}

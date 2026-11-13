import { crc16 } from "./crc16.js";
import { EmvError, parseTlv, tlv } from "./emv.js";

/**
 * Static Pix payload ("Pix Copia e Cola") following the Banco Central
 * "Manual de Padrões para Iniciação do Pix" (BR Code, EMV MPM).
 */

export const PIX_GUI = "br.gov.bcb.pix";
export const LIMITS = { name: 25, city: 15, txid: 25, merchantAccount: 99 } as const;

export interface BrCodeInput {
  /** Already normalised Pix key. */
  key: string;
  name: string;
  city: string;
  amountCents: number;
  txid: string;
  description?: string;
}

export class BrCodeError extends Error {}

/** Removes accents and anything outside printable ASCII, as the spec recommends. */
export function toPixText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Integer cents to the "123.45" format of field 54, without floating point. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new BrCodeError("O valor precisa ser um inteiro positivo de centavos.");
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function buildBrCode(input: BrCodeInput): string {
  const name = toPixText(input.name).slice(0, LIMITS.name);
  const city = toPixText(input.city).slice(0, LIMITS.city);
  if (!name || !city) throw new BrCodeError("Nome e cidade do recebedor são obrigatórios.");
  if (!/^[A-Za-z0-9]{1,25}$/.test(input.txid)) throw new BrCodeError("TXID aceita só letras e números, até 25.");

  const description = toPixText(input.description ?? "");
  let account = tlv("00", PIX_GUI) + tlv("01", input.key);
  if (description) account += tlv("02", description);
  if (account.length > LIMITS.merchantAccount) {
    throw new BrCodeError("Descrição longa demais para esta chave Pix.");
  }

  const payload =
    tlv("00", "01") +
    tlv("26", account) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", formatCents(input.amountCents)) +
    tlv("58", "BR") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", tlv("05", input.txid)) +
    "6304";
  return payload + crc16(payload);
}

/** Checks the structure and the CRC of a "Pix Copia e Cola" string. */
export function isValidBrCode(code: string): boolean {
  try {
    parseTlv(code);
  } catch (e) {
    if (e instanceof EmvError) return false;
    throw e;
  }
  return code.length > 8 && code.slice(-8, -4) === "6304" && crc16(code.slice(0, -4)) === code.slice(-4);
}

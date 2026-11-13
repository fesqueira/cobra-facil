import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
export const hmacSha256 = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const randomToken = (prefix: string, bytes = 24) => `${prefix}${randomBytes(bytes).toString("base64url")}`;

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** TXID for the BR Code: 25 letters and digits, from a CSPRNG. */
export const newTxid = () => Array.from({ length: 25 }, () => ALPHANUM[randomInt(ALPHANUM.length)]).join("");

/** JSON with sorted keys, so that the same body always hashes the same way. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/* ---------------- Outbound webhooks (Cobra Fácil -> merchant) ---------------- */

/** Header value "t=<unix seconds>,v1=<hex HMAC of `${t}.${body}`>", the same scheme Stripe uses. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

/** What a merchant runs to check that a webhook came from Cobra Fácil and is recent. */
export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(now - t) > toleranceSeconds) return false;
  return safeEqual(parts.v1, hmacSha256(secret, `${t}.${body}`));
}

/* ---------------- Inbound PSP notifications (PSP -> Cobra Fácil) ---------------- */

export const signPsp = (secret: string, rawBody: string) => `sha256=${hmacSha256(secret, rawBody)}`;
export const verifyPsp = (secret: string, header: string | undefined, rawBody: string) =>
  !!header && safeEqual(header, signPsp(secret, rawBody));

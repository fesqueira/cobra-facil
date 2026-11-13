import type { Sql } from "../../db/client.js";
import type { PixKeyType } from "../../lib/pix/keys.js";

export interface Merchant {
  id: string;
  name: string;
  city: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: Date;
}

const COLUMNS = ["id", "name", "city", "pix_key", "pix_key_type", "webhook_url", "webhook_secret", "created_at"];

export async function findMerchantByApiKeyHash(sql: Sql, hash: string): Promise<Merchant | undefined> {
  const [row] = await sql<Merchant[]>`SELECT ${sql(COLUMNS)} FROM merchants WHERE api_key_hash = ${hash}`;
  return row;
}

export interface NewMerchant {
  name: string;
  city: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  webhookUrl: string | null;
  apiKeyHash: string;
  webhookSecret: string;
}

export async function insertMerchant(sql: Sql, m: NewMerchant): Promise<Merchant> {
  const [row] = await sql<Merchant[]>`
    INSERT INTO merchants (name, city, pix_key, pix_key_type, webhook_url, api_key_hash, webhook_secret)
    VALUES (${m.name}, ${m.city}, ${m.pixKey}, ${m.pixKeyType}, ${m.webhookUrl}, ${m.apiKeyHash}, ${m.webhookSecret})
    RETURNING ${sql(COLUMNS)}`;
  return row!;
}

export async function updateWebhookUrl(sql: Sql, id: string, webhookUrl: string | null): Promise<Merchant> {
  const [row] = await sql<Merchant[]>`
    UPDATE merchants SET webhook_url = ${webhookUrl} WHERE id = ${id} RETURNING ${sql(COLUMNS)}`;
  return row!;
}

import type { Db, Sql } from "../../db/client.js";
import { newTxid, sha256, stableStringify } from "../../lib/crypto.js";
import { AppError, notFound } from "../../lib/errors.js";
import { BrCodeError, buildBrCode } from "../../lib/pix/brcode.js";
import type { Merchant } from "../merchants/repository.js";
import { enqueueEvent } from "../webhooks/outbox.js";
import { toChargeDto, type ChargeDto, type ChargeRow, type ChargeStatus } from "./charge.js";

export interface CreateChargeInput {
  amountCents: number;
  description?: string | undefined;
  expiresInSeconds: number;
}

export interface IdempotentResult {
  status: 201;
  body: ChargeDto;
  replayed: boolean;
}

async function insertCharge(tx: Db, merchant: Merchant, input: CreateChargeInput): Promise<ChargeRow> {
  const txid = newTxid();
  let pixCopyPaste: string;
  try {
    pixCopyPaste = buildBrCode({
      key: merchant.pixKey,
      name: merchant.name,
      city: merchant.city,
      amountCents: input.amountCents,
      txid,
      description: input.description,
    });
  } catch (e) {
    if (e instanceof BrCodeError) throw new AppError(422, "INVALID_CHARGE", e.message);
    throw e;
  }

  const [row] = await tx<ChargeRow[]>`
    INSERT INTO charges (merchant_id, txid, amount_cents, description, pix_copy_paste, expires_at)
    VALUES (${merchant.id}, ${txid}, ${input.amountCents}, ${input.description ?? null}, ${pixCopyPaste},
            now() + make_interval(secs => ${input.expiresInSeconds}))
    RETURNING *`;
  return row!;
}

/**
 * Creates a charge under an Idempotency-Key.
 *
 * Everything happens in one transaction: claiming the key, inserting the charge
 * and storing the response. A second request with the same key either
 * - waits on the row lock while the first is still running, then replays its response, or
 * - claims the key itself if the first one rolled back.
 * So there is never a charge without its stored response, nor a key without a charge.
 */
export async function createChargeIdempotent(
  sql: Sql,
  merchant: Merchant,
  key: string,
  input: CreateChargeInput,
): Promise<IdempotentResult> {
  const requestHash = sha256(stableStringify(input));

  return sql.begin(async (tx) => {
    const [claimed] = await tx`
      INSERT INTO idempotency_keys (merchant_id, key, request_hash)
      VALUES (${merchant.id}, ${key}, ${requestHash})
      ON CONFLICT DO NOTHING
      RETURNING key`;

    if (!claimed) {
      const [prev] = await tx<{ requestHash: string; responseStatus: 201; responseBody: ChargeDto }[]>`
        SELECT request_hash, response_status, response_body FROM idempotency_keys
        WHERE merchant_id = ${merchant.id} AND key = ${key}`;
      if (!prev || prev.requestHash !== requestHash) {
        throw new AppError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "Esta Idempotency-Key já foi usada com outro corpo de requisição.",
        );
      }
      return { status: prev.responseStatus, body: prev.responseBody, replayed: true };
    }

    const body = toChargeDto(await insertCharge(tx, merchant, input));
    await tx`
      UPDATE idempotency_keys SET response_status = 201, response_body = ${tx.json(body)}
      WHERE merchant_id = ${merchant.id} AND key = ${key}`;
    return { status: 201, body, replayed: false };
  });
}

export async function getCharge(sql: Db, merchantId: string, id: string): Promise<ChargeDto> {
  const [row] = await sql<ChargeRow[]>`SELECT * FROM charges WHERE id = ${id} AND merchant_id = ${merchantId}`;
  if (!row) throw notFound("Cobrança");
  return toChargeDto(row);
}

export interface ListInput {
  status?: ChargeStatus | undefined;
  limit: number;
  cursor?: string | undefined;
}

const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
const decodeCursor = (cursor: string) => {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, "INVALID_CURSOR", "Cursor inválido.");
  return id;
};

/**
 * Keyset pagination (newest first). The cursor points at the last item seen, and the
 * next page continues strictly after its (created_at, id), so inserts between pages
 * never cause duplicates or gaps, unlike OFFSET.
 */
export async function listCharges(sql: Sql, merchantId: string, input: ListInput) {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await sql<ChargeRow[]>`
    SELECT * FROM charges
    WHERE merchant_id = ${merchantId}
      ${input.status ? sql`AND status = ${input.status}` : sql``}
      ${
        after
          ? sql`AND (created_at, id) < (SELECT created_at, id FROM charges WHERE id = ${after} AND merchant_id = ${merchantId})`
          : sql``
      }
    ORDER BY created_at DESC, id DESC
    LIMIT ${input.limit + 1}`;

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    data: page.map(toChargeDto),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.id) : null,
  };
}

export async function cancelCharge(sql: Sql, merchantId: string, id: string): Promise<ChargeDto> {
  return sql.begin(async (tx) => {
    // Conditional update: only one of "cancel", "pay" and "expire" can win for a pending charge.
    const [row] = await tx<ChargeRow[]>`
      UPDATE charges SET status = 'canceled', updated_at = now()
      WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'pending'
      RETURNING *`;
    if (!row) {
      const [current] = await tx<{ status: ChargeStatus }[]>`
        SELECT status FROM charges WHERE id = ${id} AND merchant_id = ${merchantId}`;
      if (!current) throw notFound("Cobrança");
      throw new AppError(409, "CHARGE_NOT_PENDING", `Só cobranças pendentes podem ser canceladas (status: ${current.status}).`);
    }
    const dto = toChargeDto(row);
    await enqueueEvent(tx, merchantId, "charge.canceled", { charge: dto });
    return dto;
  });
}

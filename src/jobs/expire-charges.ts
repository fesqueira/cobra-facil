import type { Sql } from "../db/client.js";
import { toChargeDto, type ChargeRow } from "../modules/charges/charge.js";
import { enqueueEvent } from "../modules/webhooks/outbox.js";

/**
 * Marks overdue pending charges as expired and queues "charge.expired" for each,
 * in one transaction. SKIP LOCKED leaves alone any charge that a payment or a
 * cancel is touching right now; it is picked up on the next run if still pending.
 */
export async function expireCharges(sql: Sql, batchSize = 500): Promise<number> {
  return sql.begin(async (tx) => {
    const expired = await tx<ChargeRow[]>`
      UPDATE charges SET status = 'expired', updated_at = now()
      WHERE id IN (
        SELECT id FROM charges
        WHERE status = 'pending' AND expires_at <= now()
        ORDER BY expires_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    for (const charge of expired) {
      await enqueueEvent(tx, charge.merchantId, "charge.expired", { charge: toChargeDto(charge) });
    }
    return expired.length;
  });
}

/** Idempotency keys are kept for 24 hours, like most payment APIs. */
export async function purgeIdempotencyKeys(sql: Sql): Promise<number> {
  const rows = await sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours' RETURNING key`;
  return rows.length;
}

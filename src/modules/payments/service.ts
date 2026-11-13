import type { Sql } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import { toChargeDto, type ChargeRow } from "../charges/charge.js";
import { enqueueEvent } from "../webhooks/outbox.js";

export interface PixReceived {
  eventId: string;
  txid: string;
  amountCents: number;
  paidAt: string;
}

export type PixOutcome = { result: "paid" | "duplicate" } | { result: "ignored"; reason: string };

/**
 * Applies a "Pix received" notification exactly once:
 * 1. the event id goes into psp_events (a repeated id stops here, as "duplicate");
 * 2. the charge row is locked, so a concurrent cancel or expiration cannot interleave;
 * 3. status pending -> paid and the "charge.paid" outbox event commit together.
 * Any error rolls back all three, so the PSP can safely retry.
 */
export async function handlePixReceived(sql: Sql, event: PixReceived): Promise<PixOutcome> {
  return sql.begin(async (tx): Promise<PixOutcome> => {
    const [fresh] = await tx`
      INSERT INTO psp_events (event_id, txid) VALUES (${event.eventId}, ${event.txid})
      ON CONFLICT DO NOTHING RETURNING event_id`;
    if (!fresh) return { result: "duplicate" };

    const [charge] = await tx<ChargeRow[]>`SELECT * FROM charges WHERE txid = ${event.txid} FOR UPDATE`;
    if (!charge) return { result: "ignored", reason: "charge_not_found" };
    if (charge.status !== "pending") return { result: "ignored", reason: `charge_${charge.status}` };
    if (charge.amountCents !== event.amountCents) {
      throw new AppError(422, "AMOUNT_MISMATCH", "Valor pago diferente do valor da cobrança.", {
        expected: charge.amountCents,
        received: event.amountCents,
      });
    }

    const [paid] = await tx<ChargeRow[]>`
      UPDATE charges SET status = 'paid', paid_at = ${event.paidAt}, updated_at = now()
      WHERE id = ${charge.id} RETURNING *`;
    await enqueueEvent(tx, charge.merchantId, "charge.paid", { charge: toChargeDto(paid!) });
    return { result: "paid" };
  });
}

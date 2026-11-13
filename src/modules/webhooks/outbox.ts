import type { Db } from "../../db/client.js";

export type EventType = "charge.paid" | "charge.expired" | "charge.canceled";

/**
 * Transactional outbox: the event row is written in the same transaction as the
 * state change, so a charge can never be paid without its webhook being queued
 * (and a webhook is never sent for a change that rolled back).
 */
export async function enqueueEvent(tx: Db, merchantId: string, type: EventType, data: object): Promise<void> {
  await tx`INSERT INTO webhook_events (merchant_id, type, payload) VALUES (${merchantId}, ${type}, ${tx.json(data as never)})`;
}

import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../../db/client.js";
import { signWebhook } from "../../lib/crypto.js";

export const MAX_ATTEMPTS = 8;
/** How long a claimed event stays invisible to other workers while it is being delivered. */
export const LEASE_SECONDS = 60;

/**
 * Delay before the next attempt: 10s, 20s, 40s ... capped at 1h, with up to 20% jitter
 * so that many failed events do not all retry in the same second.
 */
export function backoffSeconds(attempt: number, random = Math.random): number {
  const base = Math.min(10 * 2 ** (attempt - 1), 3600);
  return Math.round(base * (1 + random() * 0.2));
}

interface DueEvent {
  id: string;
  type: string;
  payload: object;
  attempts: number;
  createdAt: Date;
  webhookUrl: string | null;
  webhookSecret: string;
}

export interface DispatchDeps {
  sql: Sql;
  fetch?: typeof fetch;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
  batchSize?: number;
  timeoutMs?: number;
}

/**
 * One pass of the delivery worker.
 *
 * Claiming uses FOR UPDATE SKIP LOCKED plus a lease (next_attempt_at pushed forward),
 * so several API instances can run this at once without sending the same event twice,
 * and an event claimed by a worker that crashed becomes due again after the lease.
 * The HTTP call happens outside any transaction: no row lock is held while waiting on the network.
 */
export async function dispatchDueWebhooks(deps: DispatchDeps): Promise<{ delivered: number; failed: number }> {
  const { sql, fetch: doFetch = fetch, log, batchSize = 20, timeoutMs = 5000 } = deps;

  const due = await sql<DueEvent[]>`
    WITH claimed AS (
      SELECT id FROM webhook_events
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE webhook_events e
    SET attempts = e.attempts + 1, next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
    FROM claimed, merchants m
    WHERE e.id = claimed.id AND m.id = e.merchant_id
    RETURNING e.id, e.type, e.payload, e.attempts, e.created_at, m.webhook_url, m.webhook_secret`;

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    due.map(async (event) => {
      const error = await deliver(event, doFetch, timeoutMs);
      if (!error) {
        delivered++;
        await sql`UPDATE webhook_events SET status = 'delivered', delivered_at = now(), last_error = NULL WHERE id = ${event.id}`;
        log?.info({ eventId: event.id, type: event.type, attempt: event.attempts }, "webhook entregue");
        return;
      }
      failed++;
      const giveUp = event.attempts >= MAX_ATTEMPTS || !event.webhookUrl;
      await sql`
        UPDATE webhook_events
        SET status = ${giveUp ? "failed" : "pending"},
            last_error = ${error},
            next_attempt_at = now() + make_interval(secs => ${backoffSeconds(event.attempts)})
        WHERE id = ${event.id}`;
      log?.warn({ eventId: event.id, attempt: event.attempts, error, giveUp }, "falha ao entregar webhook");
    }),
  );

  return { delivered, failed };
}

/** Returns null on success, or a short description of the failure. */
async function deliver(event: DueEvent, doFetch: typeof fetch, timeoutMs: number): Promise<string | null> {
  if (!event.webhookUrl) return "lojista sem webhookUrl";
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
    data: event.payload,
  });
  try {
    const res = await doFetch(event.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "CobraFacil-Webhooks/1.0",
        "cobra-event-id": event.id,
        "cobra-event-type": event.type,
        "cobra-signature": signWebhook(event.webhookSecret, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : "erro desconhecido";
  }
}

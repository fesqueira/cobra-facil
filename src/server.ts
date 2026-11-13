import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { expireCharges, purgeIdempotencyKeys } from "./jobs/expire-charges.js";
import { startJob, type Job } from "./jobs/runner.js";
import { dispatchDueWebhooks } from "./modules/webhooks/dispatcher.js";

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
const pretty = process.stdout.isTTY && process.env.NODE_ENV !== "production";

const app = await buildApp({
  sql,
  adminToken: config.ADMIN_TOKEN,
  pspWebhookSecret: config.PSP_WEBHOOK_SECRET,
  logger: {
    level: config.LOG_LEVEL,
    redact: ["req.headers.authorization", 'req.headers["x-admin-token"]'],
    ...(pretty ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } } : {}),
  },
});

const jobs: Job[] = [];
if (config.RUN_WORKERS) {
  jobs.push(
    startJob("webhooks", 1000, () => dispatchDueWebhooks({ sql, log: app.log }), app.log),
    startJob("expiração", 15_000, () => expireCharges(sql), app.log),
    startJob("limpeza-idempotência", 3_600_000, () => purgeIdempotencyKeys(sql), app.log),
  );
}

// Graceful shutdown: stop taking requests, let jobs finish their current pass, then close the pool.
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "encerrando");
    await app.close();
    await Promise.all(jobs.map((j) => j.stop()));
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });

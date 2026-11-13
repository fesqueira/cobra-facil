/**
 * Writes the OpenAPI spec and a static API reference page to public/,
 * which the Pages workflow publishes. No database connection is opened.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { docsHtml } from "../src/http/docs.js";

const sql = createDb("postgres://docs@localhost:1/docs", { max: 1 });
const app = await buildApp({ sql, adminToken: "x".repeat(16), pspWebhookSecret: "x".repeat(16), rateLimitPerMinute: false });
await app.ready();

const spec = app.swagger() as { servers?: unknown[] };
spec.servers = [{ url: "http://localhost:3000", description: "Local (docker compose up)" }];

await mkdir("public", { recursive: true });
await writeFile("public/openapi.json", `${JSON.stringify(spec, null, 2)}\n`);
await writeFile("public/index.html", docsHtml("openapi.json"));
await app.close();
await sql.end();
console.log("public/openapi.json e public/index.html gerados.");

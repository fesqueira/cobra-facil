/**
 * End-to-end demo against a running API (docker compose up, or npm run dev):
 * creates a merchant, opens a local webhook receiver, creates a charge, repeats the
 * request to show idempotency, simulates the PSP confirming the Pix, and waits for
 * the signed "charge.paid" webhook. Exits with an error if any step fails.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { signPsp, verifyWebhook } from "../src/lib/crypto.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "troque-este-token-admin";
const PSP_SECRET = process.env.PSP_WEBHOOK_SECRET ?? "troque-este-segredo-do-psp";
// Inside docker compose the API reaches the host as host.docker.internal.
const WEBHOOK_HOST = process.env.WEBHOOK_HOST ?? "host.docker.internal";

const step = (n: number, text: string) => console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);
const show = (label: string, value: unknown) => console.log(`   ${label}:`, typeof value === "string" ? value : JSON.stringify(value));

async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, headers: res.headers, json };
}

let webhookSecret = "";
let resolveWebhook: (event: unknown) => void;
const webhookReceived = new Promise((r) => (resolveWebhook = r));

const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const valid = verifyWebhook(webhookSecret, String(req.headers["cobra-signature"] ?? ""), body);
    res.writeHead(valid ? 200 : 400).end();
    if (valid) resolveWebhook(JSON.parse(body));
    else console.error("   webhook com assinatura inválida recusado");
  });
});
await new Promise<void>((r) => receiver.listen(0, "0.0.0.0", r));
const port = (receiver.address() as AddressInfo).port;

try {
  step(1, "Saúde da API");
  show("GET /health", (await call("GET", "/health")).json);

  step(2, "Admin cria o lojista (a chave de API aparece só agora)");
  const created = await call("POST", "/v1/merchants", { "x-admin-token": ADMIN_TOKEN }, {
    name: "Padaria Pão Quente",
    city: "Marília",
    pixKeyType: "email",
    pixKey: "padaria@exemplo.com",
    webhookUrl: `http://${WEBHOOK_HOST}:${port}/webhook`,
  });
  webhookSecret = created.json.webhookSecret;
  const auth = { authorization: `Bearer ${created.json.apiKey}` };
  show("lojista", created.json.merchant.id);
  show("apiKey", `${String(created.json.apiKey).slice(0, 14)}…`);

  step(3, "Lojista cria uma cobrança de R$ 25,90");
  const key = `pedido-${Date.now()}`;
  const order = { amountCents: 2590, description: "Pedido 1234" };
  const charge = (await call("POST", "/v1/charges", { ...auth, "idempotency-key": key }, order)).json;
  show("status", charge.status);
  show("Pix Copia e Cola", charge.pixCopyPaste);

  step(4, "A mesma requisição de novo (queda de rede, retry): nada é duplicado");
  const replay = await call("POST", "/v1/charges", { ...auth, "idempotency-key": key }, order);
  show("mesma cobrança", replay.json.id === charge.id);
  show("Idempotent-Replayed", replay.headers.get("idempotent-replayed"));

  step(5, "O PSP avisa que o Pix foi pago (corpo assinado com HMAC)");
  const event = JSON.stringify({
    eventId: `evt-${Date.now()}`,
    type: "pix.received",
    txid: charge.txid,
    amountCents: 2590,
    paidAt: new Date().toISOString(),
  });
  show("resposta", (await call("POST", "/v1/psp/webhooks", { "x-psp-signature": signPsp(PSP_SECRET, event) }, event)).json);
  show("mesmo evento de novo", (await call("POST", "/v1/psp/webhooks", { "x-psp-signature": signPsp(PSP_SECRET, event) }, event)).json);

  step(6, "O sistema do lojista recebe o webhook assinado");
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("webhook não chegou em 15 s")), 15_000));
  const webhook = (await Promise.race([webhookReceived, timeout])) as { type: string; data: { charge: { status: string } } };
  show("evento", webhook.type);
  show("status da cobrança", webhook.data.charge.status);

  console.log("\n\x1b[32mTudo certo: cobrança criada, retry sem duplicar, pagamento confirmado e lojista avisado.\x1b[0m");
} catch (e) {
  console.error(`\n\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
  process.exitCode = 1;
} finally {
  receiver.close();
}

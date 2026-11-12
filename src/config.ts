import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN precisa ter pelo menos 16 caracteres"),
  PSP_WEBHOOK_SECRET: z.string().min(16, "PSP_WEBHOOK_SECRET precisa ter pelo menos 16 caracteres"),
  RUN_WORKERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema>;

/** Reads and validates the environment once; the app refuses to start with a bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}

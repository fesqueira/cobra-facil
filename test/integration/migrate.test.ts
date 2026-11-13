import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { useTestApp } from "./helpers.js";

const t = useTestApp();

describe("migrações", () => {
  it("rodar de novo não aplica nada", async () => {
    expect(await migrate(t.sql)).toEqual([]);
    const rows = await t.sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
    expect(rows.map((r) => r.name)).toContain("001_init.sql");
  });

  it("o banco recusa valor zero e TXID fora do padrão", async () => {
    const [m] = await t.sql<{ id: string }[]>`
      INSERT INTO merchants (name, city, pix_key, pix_key_type, api_key_hash, webhook_secret)
      VALUES ('L', 'C', 'k@x.com', 'email', 'h', 's') RETURNING id`;
    const insert = (txid: string, cents: number) =>
      t.sql`INSERT INTO charges (merchant_id, txid, amount_cents, pix_copy_paste, expires_at)
            VALUES (${m!.id}, ${txid}, ${cents}, 'x', now())`;
    await expect(insert("ABC", 0)).rejects.toThrow(/check constraint/);
    await expect(insert("com-hifen", 100)).rejects.toThrow(/check constraint/);
  });
});

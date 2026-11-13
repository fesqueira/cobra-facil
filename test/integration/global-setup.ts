import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { createDb } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  // CI can point at a service container instead of starting one.
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    url = container.getConnectionUri();
  }
  const sql = createDb(url, { max: 1 });
  await migrate(sql);
  await sql.end();
  project.provide("databaseUrl", url);
}

export async function teardown() {
  await container?.stop();
}

import postgres from "postgres";

export type Sql = postgres.Sql;

export function createDb(url: string): Sql {
  return postgres(url, {
    max: 10,
    // Map snake_case columns to camelCase fields.
    transform: postgres.camel,
    onnotice: () => {},
  });
}

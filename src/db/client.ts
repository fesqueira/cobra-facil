import postgres from "postgres";

export type Sql = postgres.Sql;
/** A connection or an open transaction: repository functions accept either. */
export type Db = postgres.Sql | postgres.TransactionSql;

export function createDb(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    // Map snake_case columns to camelCase fields.
    transform: postgres.camel,
    onnotice: () => {},
  });
}

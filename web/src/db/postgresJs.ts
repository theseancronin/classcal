/**
 * Production Postgres adapter, over a real connection.
 *
 * The same port as `pglite.ts`, so the SQL exercised by the test suite is the
 * SQL that runs in deployment. Works against any Postgres — Neon, Supabase,
 * RDS, or a plain server.
 */
import postgres from 'postgres';

import { toPostgresPlaceholders } from './placeholders';
import type { SqlDatabase, SqlValue } from './port';

export type PostgresDatabase = SqlDatabase & { close(): Promise<void> };

export function createPostgresDatabase(
  connectionString: string,
  options: { max?: number } = {},
): PostgresDatabase {
  const sql = postgres(connectionString, {
    max: options.max ?? 5,
    // Serverless platforms reuse connections across invocations; a modest idle
    // timeout keeps a pooled connection from being held open indefinitely.
    idle_timeout: 20,
    prepare: false,
  });

  let depth = 0;

  return {
    async execute(statement) {
      await sql.unsafe(statement);
    },
    async run(statement, params: readonly SqlValue[] = []) {
      await sql.unsafe(toPostgresPlaceholders(statement), params as SqlValue[]);
    },
    async all<T>(statement: string, params: readonly SqlValue[] = []) {
      const rows = await sql.unsafe(toPostgresPlaceholders(statement), params as SqlValue[]);
      return rows as unknown as T[];
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (depth > 0) return work();
      depth += 1;
      await sql.unsafe('BEGIN');
      try {
        const result = await work();
        await sql.unsafe('COMMIT');
        return result;
      } catch (error) {
        await sql.unsafe('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

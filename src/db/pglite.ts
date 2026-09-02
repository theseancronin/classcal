/**
 * PGlite adapter — real Postgres, compiled to WebAssembly, running in-process.
 *
 * Used by the test suite and by local development, so both run the production
 * schema and the production SQL against genuine Postgres semantics without
 * needing a server or Docker. `postgresJs.ts` is the same port over a real
 * connection for deployment.
 */
import { PGlite } from '@electric-sql/pglite';

import { toPostgresPlaceholders } from './placeholders';
import type { SqlDatabase, SqlValue } from './port';

export type PgliteDatabase = SqlDatabase & { close(): Promise<void> };

export async function createPgliteDatabase(dataDir?: string): Promise<PgliteDatabase> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;

  let depth = 0;

  return {
    async execute(sql) {
      await db.exec(sql);
    },
    async run(sql, params: readonly SqlValue[] = []) {
      await db.query(toPostgresPlaceholders(sql), params as unknown[]);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      const result = await db.query<T>(toPostgresPlaceholders(sql), params as unknown[]);
      return result.rows;
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      // An inner call joins the outer transaction, matching the previous
      // adapter's behaviour and keeping the pipeline's nesting valid.
      if (depth > 0) return work();
      depth += 1;
      await db.exec('BEGIN');
      try {
        const result = await work();
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    async close() {
      await db.close();
    },
  };
}

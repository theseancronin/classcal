/**
 * `node:sqlite` adapter.
 *
 * Test-only. Its purpose is to run the production SQL and migrations for real,
 * so a schema mistake fails in CI rather than on a parent's phone.
 */
import { DatabaseSync } from 'node:sqlite';

import type { SqlDatabase, SqlValue } from './port';

export type NodeSqlDatabase = SqlDatabase & { close(): void };

export function createNodeSqlDatabase(location = ':memory:'): NodeSqlDatabase {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON');

  let depth = 0;

  return {
    async execute(sql) {
      db.exec(sql);
    },
    async run(sql, params: readonly SqlValue[] = []) {
      db.prepare(sql).run(...(params as SqlValue[]));
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      // SQLite has no nested transactions; an inner call joins the outer one.
      if (depth > 0) return work();
      depth += 1;
      db.exec('BEGIN');
      try {
        const result = await work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close() {
      db.close();
    },
  };
}

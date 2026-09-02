/**
 * `expo-sqlite` adapter -- the database the app actually runs on.
 *
 * Opened once and reused; the connection lives for the life of the process.
 */
import * as SQLite from 'expo-sqlite';

import type { SqlDatabase, SqlValue } from './port';
import { migrate } from './schema';

const DATABASE_NAME = 'classcal.db';

function wrap(db: SQLite.SQLiteDatabase): SqlDatabase {
  let depth = 0;

  return {
    async execute(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params: readonly SqlValue[] = []) {
      await db.runAsync(sql, params as SqlValue[]);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return (await db.getAllAsync(sql, params as SqlValue[])) as T[];
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (depth > 0) return work();
      depth += 1;
      try {
        let result!: T;
        await db.withTransactionAsync(async () => {
          result = await work();
        });
        return result;
      } finally {
        depth -= 1;
      }
    },
  };
}

let instance: Promise<SqlDatabase> | null = null;

/** Open (and migrate) the app database. Safe to call from anywhere. */
export function openDatabase(): Promise<SqlDatabase> {
  if (!instance) {
    instance = (async () => {
      const raw = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await raw.execAsync('PRAGMA journal_mode = WAL');
      const db = wrap(raw);
      await migrate(db);
      return db;
    })().catch((error) => {
      // Do not cache a failed open; the next call should retry.
      instance = null;
      throw error;
    });
  }
  return instance;
}

/**
 * Drop the cached connection so the next `openDatabase()` opens afresh.
 * Used by the test setup between cases, and after the database file is replaced.
 */
export function resetDatabaseConnection(): void {
  instance = null;
}

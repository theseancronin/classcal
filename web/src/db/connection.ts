/**
 * The server's database handle.
 *
 * A module-level singleton, because Next.js reuses the module across requests
 * and a new pool per request would exhaust the server's connection limit.
 *
 * With no DATABASE_URL set, an in-process PGlite database is used instead, so
 * `npm run dev` works on a clean checkout with nothing installed. That database
 * lives in `.pglite/` and is emphatically not for deployment.
 */
import type { SqlDatabase } from './port';
import { migrate } from './schema';

let handle: Promise<SqlDatabase> | undefined;

async function connect(): Promise<SqlDatabase> {
  const url = process.env.DATABASE_URL;

  const db = url
    ? (await import('./postgresJs')).createPostgresDatabase(url)
    : await (await import('./pglite')).createPgliteDatabase('.pglite');

  await migrate(db);
  return db;
}

export function getDatabase(): Promise<SqlDatabase> {
  if (!handle) handle = connect();
  return handle;
}

/**
 * Point the route handlers at a specific database. Used by the API tests so
 * they exercise the real handlers against a seeded database; production always
 * goes through `connect()`.
 */
export function setDatabase(db: SqlDatabase | undefined): void {
  handle = db ? Promise.resolve(db) : undefined;
}

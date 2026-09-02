/**
 * Test database harness.
 *
 * Creating a PGlite instance means booting Postgres, which is far too slow to
 * do per test. The schema is built once per file and each test starts from a
 * truncated database instead — same isolation, a fraction of the cost.
 */
import { createPgliteDatabase, type PgliteDatabase } from '@/db/pglite';
import { TABLES, migrate } from '@/db/schema';

/** Everything except the migrations ledger, which must survive a truncate. */
const DATA_TABLES = TABLES.filter((table) => table !== 'schema_migrations');

/** A migrated database, ready for a test file to share. */
export async function createTestDatabase(): Promise<PgliteDatabase> {
  const db = await createPgliteDatabase();
  await migrate(db);
  return db;
}

/** Empty every table, resetting identity sequences, without dropping schema. */
export async function truncateAll(db: PgliteDatabase): Promise<void> {
  await db.execute(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

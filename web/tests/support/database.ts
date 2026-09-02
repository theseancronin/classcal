/**
 * Test database harness.
 *
 * Creating a PGlite instance means booting Postgres, which is far too slow to
 * do per test. The schema is built once per file and each test starts from a
 * truncated database instead — same isolation, a fraction of the cost.
 */
import { createPgliteDatabase, type PgliteDatabase } from '@/db/pglite';
import { migrate } from '@/db/schema';

const TABLES = [
  'scheduled_notifications',
  'processing_runs',
  'event_changes',
  'event_classes',
  'normalized_events',
  'raw_events',
  'calendar_source',
];

/** A migrated database, ready for a test file to share. */
export async function createTestDatabase(): Promise<PgliteDatabase> {
  const db = await createPgliteDatabase();
  await migrate(db);
  return db;
}

/** Empty every table, resetting identity sequences, without dropping schema. */
export async function truncateAll(db: PgliteDatabase): Promise<void> {
  await db.execute(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

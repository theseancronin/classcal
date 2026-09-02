/**
 * The Postgres schema and its migrations.
 *
 * Forward-only SQL, tracked in `schema_migrations` rather than SQLite's
 * `PRAGMA user_version`. Applied on deploy and by the test harness, so the
 * suite exercises the production schema rather than a mock of it.
 *
 * Two deliberate carry-overs from the SQLite original:
 *
 *  - Booleans stay as `integer` 0/1. Postgres has a real boolean type, but the
 *    repository's `toSqlBoolean`/`fromSqlBoolean` helpers and every query that
 *    uses them are already tested; changing the storage type would churn them
 *    for no behavioural gain.
 *  - Timestamps stay as ISO-8601 `text`. Every comparison in the app is a
 *    lexicographic string compare on a UTC ISO string, which is exactly what
 *    the domain layer produces and what the tests assert against.
 *
 * `end` is quoted throughout: it is a reserved keyword in Postgres, though not
 * in SQLite.
 */
import type { SqlDatabase } from './port';

/** Each entry is one schema version. Append; never edit a released entry. */
const MIGRATIONS: readonly string[] = [
  // --- v1: initial schema -------------------------------------------------
  `
  CREATE TABLE calendar_source (
    id                TEXT PRIMARY KEY,
    feed_url          TEXT NOT NULL,
    last_attempt_at   TEXT,
    last_success_at   TEXT,
    last_error        TEXT,
    events_ingested   INTEGER NOT NULL DEFAULT 0,
    events_changed    INTEGER NOT NULL DEFAULT 0
  );

  -- Raw source events are immutable per version. A changed payload inserts a
  -- new row and clears is_current on the old one, so history is preserved.
  CREATE TABLE raw_events (
    version_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id       TEXT NOT NULL,
    source_calendar TEXT NOT NULL,
    source_uid      TEXT,
    title           TEXT NOT NULL,
    description     TEXT,
    location        TEXT,
    start           TEXT NOT NULL,
    "end"           TEXT,
    all_day         INTEGER NOT NULL,
    payload_hash    TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    source_url      TEXT,
    is_current      INTEGER NOT NULL DEFAULT 1,
    processing_status TEXT NOT NULL DEFAULT 'pending',
    processing_error  TEXT,
    processed_at      TEXT
  );

  CREATE UNIQUE INDEX raw_events_version ON raw_events (source_id, payload_hash);
  CREATE INDEX raw_events_current ON raw_events (source_id, is_current);
  CREATE INDEX raw_events_status ON raw_events (processing_status);

  CREATE TABLE normalized_events (
    id                     TEXT PRIMARY KEY,
    raw_event_id           TEXT NOT NULL,
    raw_version_id         INTEGER,
    title                  TEXT NOT NULL,
    summary                TEXT NOT NULL,
    date                   TEXT NOT NULL,
    end_date               TEXT NOT NULL,
    start_time             TEXT,
    end_time               TEXT,
    all_day                INTEGER NOT NULL,
    event_type             TEXT NOT NULL,
    importance             TEXT NOT NULL,
    applies_to             TEXT NOT NULL,
    class_details          TEXT NOT NULL,
    parent_action_required INTEGER NOT NULL,
    parent_action          TEXT,
    location               TEXT,
    tags                   TEXT NOT NULL,
    confidence             REAL NOT NULL,
    needs_review           INTEGER NOT NULL,
    original_title         TEXT NOT NULL,
    original_description   TEXT,
    source_url             TEXT NOT NULL,
    interpreter_id         TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
  );

  CREATE INDEX normalized_events_date ON normalized_events (date);
  CREATE INDEX normalized_events_importance ON normalized_events (importance, date);
  CREATE INDEX normalized_events_review ON normalized_events (needs_review);

  -- Denormalised for indexed class filtering; applies_to remains the record of
  -- truth and is what round-trips back into the domain object.
  CREATE TABLE event_classes (
    event_id     TEXT NOT NULL,
    school_class TEXT NOT NULL,
    PRIMARY KEY (event_id, school_class)
  );

  CREATE INDEX event_classes_class ON event_classes (school_class);

  CREATE TABLE event_changes (
    id           TEXT PRIMARY KEY,
    event_id     TEXT NOT NULL,
    detected_at  TEXT NOT NULL,
    changes      TEXT NOT NULL,
    description  TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX event_changes_event ON event_changes (event_id);
  CREATE INDEX event_changes_unacknowledged ON event_changes (acknowledged, detected_at);

  CREATE TABLE processing_runs (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    interpreter_id TEXT NOT NULL,
    fetched        INTEGER NOT NULL DEFAULT 0,
    created        INTEGER NOT NULL DEFAULT 0,
    updated        INTEGER NOT NULL DEFAULT 0,
    failed         INTEGER NOT NULL DEFAULT 0,
    error          TEXT
  );

  CREATE TABLE scheduled_notifications (
    idempotency_key TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL,
    reminder_type   TEXT NOT NULL,
    scheduled_at    TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    platform_id     TEXT
  );

  CREATE INDEX scheduled_notifications_event ON scheduled_notifications (event_id);
  `,

  // --- v2: web push subscriptions -----------------------------------------
  `
  -- One row per browser that has enabled reminders. There are no accounts, so
  -- the endpoint is the identity: it is opaque, issued by the browser's push
  -- service, and revocable by the parent at any time by turning reminders off.
  CREATE TABLE push_subscriptions (
    endpoint      TEXT PRIMARY KEY,
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    classes       TEXT NOT NULL,
    preferences   TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    -- Set when the push service reports the subscription is gone, so a dead
    -- endpoint is retried no further.
    failed_at     TEXT
  );

  CREATE INDEX push_subscriptions_active ON push_subscriptions (failed_at);
  `,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
  )`;

const TABLES = [
  'push_subscriptions',
  'scheduled_notifications',
  'processing_runs',
  'event_changes',
  'event_classes',
  'normalized_events',
  'raw_events',
  'calendar_source',
  'schema_migrations',
];

/**
 * Bring a database up to the latest schema version. Safe to call repeatedly;
 * already-applied migrations are skipped.
 */
export async function migrate(db: SqlDatabase): Promise<number> {
  await db.execute(MIGRATIONS_TABLE);

  const [row] = await db.all<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_migrations',
  );
  const current = Number(row?.version ?? 0);

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.transaction(async () => {
      await db.execute(MIGRATIONS[version]!);
      await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        version + 1,
        new Date().toISOString(),
      ]);
    });
  }

  return MIGRATIONS.length;
}

/** Drop everything and rebuild. Used by tests and by the admin reset. */
export async function resetDatabase(db: SqlDatabase): Promise<void> {
  for (const table of TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await migrate(db);
}

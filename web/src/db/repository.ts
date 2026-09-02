/**
 * Repositories.
 *
 * All SQL lives here. Screens and the pipeline speak in domain objects and never
 * see a row. Read queries are pure lookups -- no interpretation ever runs during
 * a read, which is what keeps opening the app instant and offline-safe.
 */
import { DEFAULT_SCHOOL } from '@/config/school';
import type {
  ClassSpecificDetail,
  EventChange,
  EventType,
  FieldChange,
  Importance,
  NormalizedSchoolEvent,
  ProcessingStatus,
  RawCalendarEvent,
  ScheduledNotification,
  SchoolClass,
  SyncStatus,
} from '@/domain/types';
import {
  fromSqlBoolean,
  fromSqlJson,
  toSqlBoolean,
  toSqlJson,
  type SqlDatabase,
  type SqlValue,
} from './port';

// ---------------------------------------------------------------------------
// Raw events
// ---------------------------------------------------------------------------

type RawRow = {
  version_id: number;
  source_id: string;
  source_calendar: string;
  source_uid: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string | null;
  all_day: number;
  payload_hash: string;
  fetched_at: string;
  source_url: string | null;
  is_current: number;
  processing_status: string;
  processing_error: string | null;
};

function toRawEvent(row: RawRow): RawCalendarEvent {
  return {
    sourceId: row.source_id,
    sourceCalendar: row.source_calendar,
    ...(row.source_uid ? { sourceUid: row.source_uid } : {}),
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.location ? { location: row.location } : {}),
    start: row.start,
    ...(row.end ? { end: row.end } : {}),
    allDay: fromSqlBoolean(row.all_day),
    rawPayloadHash: row.payload_hash,
    fetchedAt: row.fetched_at,
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
  };
}

export type RawEventVersion = {
  versionId: number;
  event: RawCalendarEvent;
  isCurrent: boolean;
  processingStatus: ProcessingStatus;
  processingError?: string;
};

export type UpsertOutcome = 'unchanged' | 'created' | 'changed';

/**
 * Store a source event version.
 *
 * Idempotent by `(source_id, payload_hash)`: re-ingesting an identical event is
 * a no-op, which is what stops the interpreter running on unchanged events.
 */
export async function upsertRawEvent(
  db: SqlDatabase,
  event: RawCalendarEvent,
): Promise<{ outcome: UpsertOutcome; versionId: number }> {
  const existing = await db.all<{ version_id: number; payload_hash: string; is_current: number }>(
    'SELECT version_id, payload_hash, is_current FROM raw_events WHERE source_id = ? ORDER BY version_id DESC',
    [event.sourceId],
  );

  const identical = existing.find((row) => row.payload_hash === event.rawPayloadHash);
  if (identical) {
    if (!fromSqlBoolean(identical.is_current)) {
      // The source reverted to a version we have seen before.
      await db.run('UPDATE raw_events SET is_current = 0 WHERE source_id = ?', [event.sourceId]);
      await db.run('UPDATE raw_events SET is_current = 1, fetched_at = ? WHERE version_id = ?', [
        event.fetchedAt,
        identical.version_id,
      ]);
      return { outcome: 'changed', versionId: identical.version_id };
    }
    await db.run('UPDATE raw_events SET fetched_at = ? WHERE version_id = ?', [
      event.fetchedAt,
      identical.version_id,
    ]);
    return { outcome: 'unchanged', versionId: identical.version_id };
  }

  await db.run('UPDATE raw_events SET is_current = 0 WHERE source_id = ?', [event.sourceId]);
  await db.run(
    `INSERT INTO raw_events (
       source_id, source_calendar, source_uid, title, description, location,
       start, "end", all_day, payload_hash, fetched_at, source_url, is_current, processing_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')`,
    [
      event.sourceId,
      event.sourceCalendar,
      event.sourceUid ?? null,
      event.title,
      event.description ?? null,
      event.location ?? null,
      event.start,
      event.end ?? null,
      toSqlBoolean(event.allDay),
      event.rawPayloadHash,
      event.fetchedAt,
      event.sourceUrl ?? null,
    ],
  );

  const [inserted] = await db.all<{ version_id: number }>(
    'SELECT version_id FROM raw_events WHERE source_id = ? AND payload_hash = ?',
    [event.sourceId, event.rawPayloadHash],
  );

  return {
    outcome: existing.length > 0 ? 'changed' : 'created',
    versionId: inserted!.version_id,
  };
}

/** Every stored version of one source event, newest first. */
export async function getRawEventHistory(
  db: SqlDatabase,
  sourceId: string,
): Promise<RawEventVersion[]> {
  const rows = await db.all<RawRow>(
    'SELECT * FROM raw_events WHERE source_id = ? ORDER BY version_id DESC',
    [sourceId],
  );
  return rows.map((row) => ({
    versionId: row.version_id,
    event: toRawEvent(row),
    isCurrent: fromSqlBoolean(row.is_current),
    processingStatus: row.processing_status as ProcessingStatus,
    ...(row.processing_error ? { processingError: row.processing_error } : {}),
  }));
}

/** Current versions awaiting interpretation, oldest first. */
export async function getUnprocessedRawEvents(
  db: SqlDatabase,
  limit = 500,
): Promise<RawEventVersion[]> {
  const rows = await db.all<RawRow>(
    `SELECT * FROM raw_events
      WHERE is_current = 1 AND processing_status IN ('pending', 'processing_failed')
      ORDER BY version_id ASC
      LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    versionId: row.version_id,
    event: toRawEvent(row),
    isCurrent: true,
    processingStatus: row.processing_status as ProcessingStatus,
    ...(row.processing_error ? { processingError: row.processing_error } : {}),
  }));
}

export async function markRawEventProcessed(
  db: SqlDatabase,
  versionId: number,
  status: ProcessingStatus,
  processedAt: string,
  error?: string,
): Promise<void> {
  await db.run(
    'UPDATE raw_events SET processing_status = ?, processing_error = ?, processed_at = ? WHERE version_id = ?',
    [status, error ?? null, processedAt, versionId],
  );
}

// ---------------------------------------------------------------------------
// Normalized events
// ---------------------------------------------------------------------------

type NormalizedRow = {
  id: string;
  raw_event_id: string;
  title: string;
  summary: string;
  date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: number;
  event_type: string;
  importance: string;
  applies_to: string;
  class_details: string;
  parent_action_required: number;
  parent_action: string | null;
  location: string | null;
  tags: string;
  confidence: number;
  needs_review: number;
  original_title: string;
  original_description: string | null;
  source_url: string;
  created_at: string;
  updated_at: string;
};

function toNormalizedEvent(row: NormalizedRow): NormalizedSchoolEvent {
  return {
    id: row.id,
    rawEventId: row.raw_event_id,
    title: row.title,
    summary: row.summary,
    date: row.date,
    endDate: row.end_date,
    ...(row.start_time ? { startTime: row.start_time } : {}),
    ...(row.end_time ? { endTime: row.end_time } : {}),
    allDay: fromSqlBoolean(row.all_day),
    eventType: row.event_type as EventType,
    importance: row.importance as Importance,
    appliesTo: fromSqlJson<SchoolClass[]>(row.applies_to, ['unknown']),
    classDetails: fromSqlJson<ClassSpecificDetail[]>(row.class_details, []),
    parentActionRequired: fromSqlBoolean(row.parent_action_required),
    ...(row.parent_action ? { parentAction: row.parent_action } : {}),
    ...(row.location ? { location: row.location } : {}),
    tags: fromSqlJson<string[]>(row.tags, []),
    confidence: row.confidence,
    needsReview: fromSqlBoolean(row.needs_review),
    originalTitle: row.original_title,
    ...(row.original_description ? { originalDescription: row.original_description } : {}),
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveNormalizedEvent(
  db: SqlDatabase,
  event: NormalizedSchoolEvent,
  meta: { rawVersionId?: number; interpreterId?: string } = {},
): Promise<void> {
  await db.run(
    `INSERT INTO normalized_events (
       id, raw_event_id, raw_version_id, title, summary, date, end_date, start_time, end_time,
       all_day, event_type, importance, applies_to, class_details, parent_action_required,
       parent_action, location, tags, confidence, needs_review, original_title,
       original_description, source_url, interpreter_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       raw_event_id = excluded.raw_event_id,
       raw_version_id = excluded.raw_version_id,
       title = excluded.title,
       summary = excluded.summary,
       date = excluded.date,
       end_date = excluded.end_date,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       all_day = excluded.all_day,
       event_type = excluded.event_type,
       importance = excluded.importance,
       applies_to = excluded.applies_to,
       class_details = excluded.class_details,
       parent_action_required = excluded.parent_action_required,
       parent_action = excluded.parent_action,
       location = excluded.location,
       tags = excluded.tags,
       confidence = excluded.confidence,
       needs_review = excluded.needs_review,
       original_title = excluded.original_title,
       original_description = excluded.original_description,
       source_url = excluded.source_url,
       interpreter_id = excluded.interpreter_id,
       updated_at = excluded.updated_at`,
    [
      event.id,
      event.rawEventId,
      meta.rawVersionId ?? null,
      event.title,
      event.summary,
      event.date,
      event.endDate,
      event.startTime ?? null,
      event.endTime ?? null,
      toSqlBoolean(event.allDay),
      event.eventType,
      event.importance,
      toSqlJson(event.appliesTo),
      toSqlJson(event.classDetails),
      toSqlBoolean(event.parentActionRequired),
      event.parentAction ?? null,
      event.location ?? null,
      toSqlJson(event.tags),
      event.confidence,
      toSqlBoolean(event.needsReview),
      event.originalTitle,
      event.originalDescription ?? null,
      event.sourceUrl,
      meta.interpreterId ?? null,
      event.createdAt,
      event.updatedAt,
    ],
  );

  await db.run('DELETE FROM event_classes WHERE event_id = ?', [event.id]);
  for (const schoolClass of event.appliesTo) {
    await db.run('INSERT INTO event_classes (event_id, school_class) VALUES (?, ?)', [
      event.id,
      schoolClass,
    ]);
  }
}

export async function getNormalizedEvent(
  db: SqlDatabase,
  id: string,
): Promise<NormalizedSchoolEvent | null> {
  const [row] = await db.all<NormalizedRow>('SELECT * FROM normalized_events WHERE id = ?', [id]);
  return row ? toNormalizedEvent(row) : null;
}

export type EventQuery = {
  /** Inclusive `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive `YYYY-MM-DD`. */
  to?: string;
  /** Restrict to these classes. `whole_school` events are always included. */
  classes?: readonly SchoolClass[];
  eventTypes?: readonly EventType[];
  importance?: readonly Importance[];
  /** Free-text search across title, summary and the original wording. */
  search?: string;
  needsReview?: boolean;
  limit?: number;
};

/**
 * The single read path used by every screen.
 *
 * Class filtering happens in SQL against `event_classes`, and always admits
 * whole-school events so a closure can never be filtered out of a family's view.
 */
export async function queryEvents(
  db: SqlDatabase,
  query: EventQuery = {},
): Promise<NormalizedSchoolEvent[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];

  if (query.from) {
    // An event is in range if it has not already ended.
    where.push('e.end_date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('e.date <= ?');
    params.push(query.to);
  }

  if (query.classes && query.classes.length > 0) {
    const placeholders = query.classes.map(() => '?').join(', ');
    where.push(
      `EXISTS (SELECT 1 FROM event_classes ec
                WHERE ec.event_id = e.id
                  AND (ec.school_class IN (${placeholders}) OR ec.school_class = 'whole_school'))`,
    );
    params.push(...query.classes);
  }

  if (query.eventTypes && query.eventTypes.length > 0) {
    where.push(`e.event_type IN (${query.eventTypes.map(() => '?').join(', ')})`);
    params.push(...query.eventTypes);
  }

  if (query.importance && query.importance.length > 0) {
    where.push(`e.importance IN (${query.importance.map(() => '?').join(', ')})`);
    params.push(...query.importance);
  }

  if (query.search && query.search.trim().length > 0) {
    where.push('(e.title LIKE ? OR e.summary LIKE ? OR e.original_title LIKE ? OR e.event_type LIKE ?)');
    const term = `%${query.search.trim()}%`;
    params.push(term, term, term, term);
  }

  if (query.needsReview !== undefined) {
    where.push('e.needs_review = ?');
    params.push(toSqlBoolean(query.needsReview));
  }

  const sql = `SELECT e.* FROM normalized_events e
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY e.date ASC, COALESCE(e.start_time, '00:00') ASC, e.title ASC
     ${query.limit ? 'LIMIT ?' : ''}`;

  if (query.limit) params.push(query.limit);

  const rows = await db.all<NormalizedRow>(sql, params);
  return rows.map(toNormalizedEvent);
}

/** Remove normalized events whose source event is no longer in the feed. */
export async function deleteOrphanedEvents(db: SqlDatabase, liveSourceIds: readonly string[]): Promise<number> {
  if (liveSourceIds.length === 0) return 0;
  const placeholders = liveSourceIds.map(() => '?').join(', ');
  const orphans = await db.all<{ id: string }>(
    `SELECT id FROM normalized_events WHERE raw_event_id NOT IN (${placeholders})`,
    [...liveSourceIds],
  );
  for (const orphan of orphans) {
    await db.run('DELETE FROM event_classes WHERE event_id = ?', [orphan.id]);
    await db.run('DELETE FROM event_changes WHERE event_id = ?', [orphan.id]);
    await db.run('DELETE FROM normalized_events WHERE id = ?', [orphan.id]);
  }
  await db.run(
    `UPDATE raw_events SET is_current = 0 WHERE source_id NOT IN (${placeholders})`,
    [...liveSourceIds],
  );
  return orphans.length;
}

// ---------------------------------------------------------------------------
// Event changes
// ---------------------------------------------------------------------------

type ChangeRow = {
  id: string;
  event_id: string;
  detected_at: string;
  changes: string;
  description: string;
  acknowledged: number;
};

function toEventChange(row: ChangeRow): EventChange {
  return {
    id: row.id,
    eventId: row.event_id,
    detectedAt: row.detected_at,
    changes: fromSqlJson<FieldChange[]>(row.changes, []),
    description: row.description,
    acknowledged: fromSqlBoolean(row.acknowledged),
  };
}

export async function saveEventChange(db: SqlDatabase, change: EventChange): Promise<void> {
  await db.run(
    `INSERT INTO event_changes (id, event_id, detected_at, changes, description, acknowledged)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       changes = excluded.changes,
       description = excluded.description`,
    [
      change.id,
      change.eventId,
      change.detectedAt,
      toSqlJson(change.changes),
      change.description,
      toSqlBoolean(change.acknowledged),
    ],
  );
}

export async function getRecentChanges(
  db: SqlDatabase,
  options: { onlyUnacknowledged?: boolean; eventId?: string; limit?: number } = {},
): Promise<EventChange[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (options.onlyUnacknowledged) where.push('acknowledged = 0');
  if (options.eventId) {
    where.push('event_id = ?');
    params.push(options.eventId);
  }
  params.push(options.limit ?? 20);

  const rows = await db.all<ChangeRow>(
    `SELECT * FROM event_changes
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY detected_at DESC LIMIT ?`,
    params,
  );
  return rows.map(toEventChange);
}

export async function acknowledgeChanges(db: SqlDatabase, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.run('UPDATE event_changes SET acknowledged = 1 WHERE id = ?', [id]);
  }
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

type SourceRow = {
  id: string;
  feed_url: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  events_ingested: number;
  events_changed: number;
};

export async function getSyncStatus(
  db: SqlDatabase,
  sourceId = DEFAULT_SCHOOL.id,
): Promise<SyncStatus> {
  const [row] = await db.all<SourceRow>('SELECT * FROM calendar_source WHERE id = ?', [sourceId]);
  if (!row) return { eventsIngested: 0, eventsChanged: 0 };
  return {
    ...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
    ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    eventsIngested: row.events_ingested,
    eventsChanged: row.events_changed,
  };
}

export async function getFeedUrl(db: SqlDatabase, sourceId = DEFAULT_SCHOOL.id): Promise<string> {
  const [row] = await db.all<SourceRow>('SELECT feed_url FROM calendar_source WHERE id = ?', [
    sourceId,
  ]);
  return row?.feed_url ?? DEFAULT_SCHOOL.calendarFeedUrl;
}

export async function setFeedUrl(
  db: SqlDatabase,
  feedUrl: string,
  sourceId = DEFAULT_SCHOOL.id,
): Promise<void> {
  await db.run(
    `INSERT INTO calendar_source (id, feed_url) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET feed_url = excluded.feed_url`,
    [sourceId, feedUrl],
  );
}

/**
 * Record the outcome of a sync.
 *
 * A failure updates `last_attempt_at` and `last_error` but deliberately leaves
 * `last_success_at` alone, so the UI can keep showing when the data was really
 * last known good.
 */
export async function recordSyncOutcome(
  db: SqlDatabase,
  outcome:
    | { ok: true; at: string; ingested: number; changed: number }
    | { ok: false; at: string; error: string },
  sourceId = DEFAULT_SCHOOL.id,
): Promise<void> {
  await db.run(
    `INSERT INTO calendar_source (id, feed_url) VALUES (?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [sourceId, DEFAULT_SCHOOL.calendarFeedUrl],
  );

  if (outcome.ok) {
    await db.run(
      `UPDATE calendar_source
          SET last_attempt_at = ?, last_success_at = ?, last_error = NULL,
              events_ingested = ?, events_changed = ?
        WHERE id = ?`,
      [outcome.at, outcome.at, outcome.ingested, outcome.changed, sourceId],
    );
  } else {
    await db.run(
      'UPDATE calendar_source SET last_attempt_at = ?, last_error = ? WHERE id = ?',
      [outcome.at, outcome.error, sourceId],
    );
  }
}

export async function startProcessingRun(
  db: SqlDatabase,
  startedAt: string,
  interpreterId: string,
): Promise<number> {
  await db.run('INSERT INTO processing_runs (started_at, interpreter_id) VALUES (?, ?)', [
    startedAt,
    interpreterId,
  ]);
  const [row] = await db.all<{ id: number }>(
    'SELECT id FROM processing_runs ORDER BY id DESC LIMIT 1',
  );
  return row!.id;
}

export async function finishProcessingRun(
  db: SqlDatabase,
  id: number,
  result: { finishedAt: string; fetched: number; created: number; updated: number; failed: number; error?: string },
): Promise<void> {
  await db.run(
    `UPDATE processing_runs
        SET finished_at = ?, fetched = ?, created = ?, updated = ?, failed = ?, error = ?
      WHERE id = ?`,
    [
      result.finishedAt,
      result.fetched,
      result.created,
      result.updated,
      result.failed,
      result.error ?? null,
      id,
    ],
  );
}

// ---------------------------------------------------------------------------
// Scheduled notifications
// ---------------------------------------------------------------------------

export async function getScheduledKeys(db: SqlDatabase): Promise<string[]> {
  const rows = await db.all<{ idempotency_key: string }>(
    'SELECT idempotency_key FROM scheduled_notifications',
  );
  return rows.map((row) => row.idempotency_key);
}

export async function saveScheduledNotification(
  db: SqlDatabase,
  notification: ScheduledNotification,
  platformId?: string,
): Promise<void> {
  await db.run(
    `INSERT INTO scheduled_notifications
       (idempotency_key, event_id, reminder_type, scheduled_at, title, body, platform_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
    [
      notification.idempotencyKey,
      notification.eventId,
      notification.reminderType,
      notification.scheduledAt,
      notification.title,
      notification.body,
      platformId ?? null,
    ],
  );
}

export async function getPlatformIds(db: SqlDatabase, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await db.all<{ platform_id: string | null }>(
    `SELECT platform_id FROM scheduled_notifications WHERE idempotency_key IN (${placeholders})`,
    [...keys],
  );
  return rows.map((row) => row.platform_id).filter((id): id is string => id !== null);
}

export async function deleteScheduledNotifications(
  db: SqlDatabase,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    await db.run('DELETE FROM scheduled_notifications WHERE idempotency_key = ?', [key]);
  }
}

/**
 * Raw events that need a human to look at them: interpretation threw, or the
 * output failed validation. Validation failures are deliberately excluded from
 * the automatic retry loop -- the same input through the same interpreter would
 * fail identically -- so this query is how they surface in the review screen.
 */
export async function getEventsNeedingAttention(
  db: SqlDatabase,
  limit = 100,
): Promise<RawEventVersion[]> {
  const rows = await db.all<RawRow>(
    `SELECT * FROM raw_events
      WHERE is_current = 1 AND processing_status IN ('processing_failed', 'validation_failed')
      ORDER BY version_id DESC
      LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    versionId: row.version_id,
    event: toRawEvent(row),
    isCurrent: true,
    processingStatus: row.processing_status as ProcessingStatus,
    ...(row.processing_error ? { processingError: row.processing_error } : {}),
  }));
}

/** Look up the current raw version for one source event, for reprocessing. */
export async function getCurrentRawEvent(
  db: SqlDatabase,
  sourceId: string,
): Promise<RawEventVersion | null> {
  const [row] = await db.all<RawRow>(
    'SELECT * FROM raw_events WHERE source_id = ? AND is_current = 1',
    [sourceId],
  );
  if (!row) return null;
  return {
    versionId: row.version_id,
    event: toRawEvent(row),
    isCurrent: true,
    processingStatus: row.processing_status as ProcessingStatus,
    ...(row.processing_error ? { processingError: row.processing_error } : {}),
  };
}

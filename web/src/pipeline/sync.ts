/**
 * The ingestion pipeline.
 *
 *   fetch -> parse -> store raw -> interpret (new/changed only)
 *         -> validate + normalize -> diff against the previous version
 *         -> store normalized event and any EventChange
 *
 * Failure rules, from spec section 33:
 *   - a failed fetch keeps the last known good data and records the failure;
 *   - a failed interpretation keeps the raw event and marks it for retry;
 *   - nothing is ever silently discarded.
 */
import { buildEventChange } from '@/changes/diff';
import { DEFAULT_SCHOOL } from '@/config/school';
import type { EventChange, RawCalendarEvent } from '@/domain/types';
import { fetchCalendar, type FetchOptions } from '@/ical/fetcher';
import { parseICalendar } from '@/ical/parser';
import type { CalendarEventInterpreter } from '@/interpreter/types';
import { normalizeInterpretation } from '@/normalize/normalize';
import type { SqlDatabase } from '@/db/port';
import {
  deleteOrphanedEvents,
  finishProcessingRun,
  getFeedUrl,
  getNormalizedEvent,
  getUnprocessedRawEvents,
  markRawEventProcessed,
  recordSyncOutcome,
  saveEventChange,
  saveNormalizedEvent,
  startProcessingRun,
  upsertRawEvent,
} from '@/db/repository';

export type SyncResult = {
  ok: boolean;
  /** Set when the feed could not be fetched or parsed. */
  error?: string;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  removed: number;
  changes: EventChange[];
  skipped: { reason: string; detail?: string }[];
};

export type SyncOptions = {
  db: SqlDatabase;
  interpreter: CalendarEventInterpreter;
  now?: () => Date;
  fetchOptions?: FetchOptions;
  /** Overrides the stored feed URL. Used by tests and by manual re-sync. */
  feedUrl?: string;
  /** Skip the network and use this iCalendar text. Used by tests and seeding. */
  source?: string;
};

const EMPTY_RESULT: Omit<SyncResult, 'ok'> = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  removed: 0,
  changes: [],
  skipped: [],
};

export async function syncCalendar(options: SyncOptions): Promise<SyncResult> {
  const { db, interpreter } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const runId = await startProcessingRun(db, startedAt, interpreter.id);

  let body: string;
  let fetchedAt: string;

  if (options.source !== undefined) {
    body = options.source;
    fetchedAt = startedAt;
  } else {
    const url = options.feedUrl ?? (await getFeedUrl(db));
    const fetched = await fetchCalendar(url, { now, ...options.fetchOptions });
    if (!fetched.ok) {
      // Keep everything already stored. The UI will show a stale-data warning.
      await recordSyncOutcome(db, { ok: false, at: fetched.fetchedAt, error: fetched.error });
      await finishProcessingRun(db, runId, {
        finishedAt: fetched.fetchedAt,
        ...EMPTY_RESULT,
        error: fetched.error,
      });
      return { ok: false, error: fetched.error, ...EMPTY_RESULT };
    }
    body = fetched.body;
    fetchedAt = fetched.fetchedAt;
  }

  const parsed = parseICalendar(body, {
    sourceCalendar: DEFAULT_SCHOOL.id,
    fetchedAt,
  });

  if (parsed.events.length === 0 && parsed.skipped.length > 0) {
    const error = `Calendar could not be read (${parsed.skipped[0]!.reason}).`;
    await recordSyncOutcome(db, { ok: false, at: fetchedAt, error });
    await finishProcessingRun(db, runId, { finishedAt: fetchedAt, ...EMPTY_RESULT, error });
    return { ok: false, error, ...EMPTY_RESULT, skipped: parsed.skipped };
  }

  const result: SyncResult = {
    ok: true,
    ...EMPTY_RESULT,
    fetched: parsed.events.length,
    skipped: parsed.skipped,
    changes: [],
  };

  // --- Store raw versions. Unchanged events are never re-interpreted. -------
  const toProcess: { event: RawCalendarEvent; versionId: number; isUpdate: boolean }[] = [];

  await db.transaction(async () => {
    for (const event of parsed.events) {
      const { outcome, versionId } = await upsertRawEvent(db, event);
      if (outcome === 'unchanged') {
        result.unchanged += 1;
        continue;
      }
      toProcess.push({ event, versionId, isUpdate: outcome === 'changed' });
    }

    result.removed = await deleteOrphanedEvents(
      db,
      parsed.events.map((e) => e.sourceId),
    );
  });

  // Anything left over from a previous failed run is retried alongside.
  const pending = await getUnprocessedRawEvents(db);
  for (const item of pending) {
    if (toProcess.some((entry) => entry.versionId === item.versionId)) continue;
    toProcess.push({ event: item.event, versionId: item.versionId, isUpdate: true });
  }

  // --- Interpret, validate, normalize, diff --------------------------------
  for (const item of toProcess) {
    const processedAt = now().toISOString();
    const previous = await getNormalizedEvent(db, item.event.sourceId);

    let interpretation: unknown;
    try {
      interpretation = await interpreter.interpret(item.event);
    } catch (error) {
      result.failed += 1;
      await markRawEventProcessed(
        db,
        item.versionId,
        'processing_failed',
        processedAt,
        error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      );
      continue;
    }

    const normalized = normalizeInterpretation(item.event, interpretation, {
      now: processedAt,
      ...(previous ? { createdAt: previous.createdAt } : {}),
    });

    if (!normalized.ok) {
      result.failed += 1;
      await markRawEventProcessed(
        db,
        item.versionId,
        'validation_failed',
        processedAt,
        normalized.errors.join('; ').slice(0, 300),
      );
      continue;
    }

    await db.transaction(async () => {
      await saveNormalizedEvent(db, normalized.event, {
        rawVersionId: item.versionId,
        interpreterId: interpreter.id,
      });
      await markRawEventProcessed(db, item.versionId, 'interpreted', processedAt);

      if (previous) {
        const change = buildEventChange(previous, normalized.event, { now: processedAt });
        if (change) {
          await saveEventChange(db, change);
          result.changes.push(change);
        }
        result.updated += 1;
      } else {
        result.created += 1;
      }
    });
  }

  const finishedAt = now().toISOString();
  await recordSyncOutcome(db, {
    ok: true,
    at: fetchedAt,
    ingested: result.fetched,
    changed: result.created + result.updated,
  });
  await finishProcessingRun(db, runId, {
    finishedAt,
    fetched: result.fetched,
    created: result.created,
    updated: result.updated,
    failed: result.failed,
  });

  return result;
}

/**
 * Re-run interpretation for one event, keeping its identity and creation time.
 * Used by the developer review screen.
 */
export async function reprocessEvent(
  db: SqlDatabase,
  interpreter: CalendarEventInterpreter,
  raw: RawCalendarEvent,
  versionId: number,
  now = new Date().toISOString(),
): Promise<{ ok: boolean; errors?: string[] }> {
  const previous = await getNormalizedEvent(db, raw.sourceId);

  let interpretation: unknown;
  try {
    interpretation = await interpreter.interpret(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRawEventProcessed(db, versionId, 'processing_failed', now, message.slice(0, 300));
    return { ok: false, errors: [message] };
  }

  const normalized = normalizeInterpretation(raw, interpretation, {
    now,
    ...(previous ? { createdAt: previous.createdAt } : {}),
  });

  if (!normalized.ok) {
    await markRawEventProcessed(
      db,
      versionId,
      'validation_failed',
      now,
      normalized.errors.join('; ').slice(0, 300),
    );
    return { ok: false, errors: normalized.errors };
  }

  await db.transaction(async () => {
    await saveNormalizedEvent(db, normalized.event, {
      rawVersionId: versionId,
      interpreterId: interpreter.id,
    });
    await markRawEventProcessed(db, versionId, 'interpreted', now);
    if (previous) {
      const change = buildEventChange(previous, normalized.event, { now });
      if (change) await saveEventChange(db, change);
    }
  });

  return { ok: true };
}

/**
 * Integration tests for the whole ingestion path, against a real Postgres
 * database running the production schema and SQL.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteDatabase, type PgliteDatabase } from '@/db/pglite';
import { createTestDatabase, truncateAll } from './support/database';
import {
  getRawEventHistory,
  getEventsNeedingAttention,
  getRecentChanges,
  getSyncStatus,
  getUnprocessedRawEvents,
  queryEvents,
} from '@/db/repository';
import { migrate } from '@/db/schema';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { InterpreterError, type CalendarEventInterpreter } from '@/interpreter/types';
import { syncCalendar } from '@/pipeline/sync';
import type { InterpretedCalendarEvent, RawCalendarEvent } from '@/domain/types';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

let db: PgliteDatabase;
const interpreter = new HeuristicCalendarEventInterpreter();
const now = () => new Date('2026-09-02T09:00:00.000Z');

beforeAll(async () => {
  db = await createTestDatabase();
});

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.close();
});

function sync(source = FIXTURE, options: Partial<Parameters<typeof syncCalendar>[0]> = {}) {
  return syncCalendar({ db, interpreter, now, source, ...options });
}

describe('migrations', () => {
  it('applies from a clean database', async () => {
    const fresh = await createPgliteDatabase();
    await expect(migrate(fresh)).resolves.toBeGreaterThan(0);
    await fresh.close();
  });

  it('is idempotent', async () => {
    await migrate(db);
    await expect(migrate(db)).resolves.toBeGreaterThan(0);
  });
});

describe('fixture -> raw -> interpreter -> normalized', () => {
  it('ingests and normalizes every fixture event', async () => {
    const result = await sync();
    expect(result.ok).toBe(true);
    expect(result.fetched).toBe(16);
    expect(result.created).toBe(16);
    expect(result.failed).toBe(0);

    const events = await queryEvents(db);
    expect(events).toHaveLength(16);
  });

  it('records a successful sync', async () => {
    await sync();
    const status = await getSyncStatus(db);
    expect(status.lastSuccessAt).toBe('2026-09-02T09:00:00.000Z');
    expect(status.lastError).toBeUndefined();
    expect(status.eventsIngested).toBe(16);
  });

  it('leaves nothing pending', async () => {
    await sync();
    expect(await getUnprocessedRawEvents(db)).toEqual([]);
  });

  it('stores the class-specific early finish times', async () => {
    await sync();
    const [event] = await queryEvents(db, { eventTypes: ['early_finish'], to: '2026-09-30' });
    const byClass = Object.fromEntries(
      event!.classDetails.map((d) => [d.schoolClass, d.finishTime]),
    );
    expect(byClass.junior_infants).toBe('12:50');
    expect(byClass.class_1).toBe('13:00');
  });
});

describe('idempotency', () => {
  it('does not reinterpret unchanged events on a repeat sync', async () => {
    await sync();
    const second = await sync();
    expect(second.unchanged).toBe(16);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
  });

  it('stores no duplicate events after repeated syncs', async () => {
    await sync();
    await sync();
    await sync();
    expect(await queryEvents(db)).toHaveLength(16);
  });
});

describe('changed events', () => {
  const CHANGED = FIXTURE.replace('Naíonáin @12.50in', 'Naíonáin @12.30in');

  it('creates a new raw version and keeps the old one', async () => {
    await sync();
    await sync(CHANGED);

    const history = await getRawEventHistory(db, 'fixture-early-finish-split:2026-09-22');
    expect(history).toHaveLength(2);
    expect(history[0]!.isCurrent).toBe(true);
    expect(history[1]!.isCurrent).toBe(false);
  });

  it('reprocesses only the changed event', async () => {
    await sync();
    const result = await sync(CHANGED);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(15);
  });

  it('records an EventChange with the previous and new time', async () => {
    await sync();
    const result = await sync(CHANGED);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.description).toContain('now finishes at 12:30');
    expect(result.changes[0]!.description).toContain('Previously 12:50');

    const stored = await getRecentChanges(db, { onlyUnacknowledged: true });
    expect(stored).toHaveLength(1);
  });

  it('records no change when the wording changes but the facts do not', async () => {
    await sync();
    const reworded = FIXTURE.replace('School closed earlier due to staff meeting', 'Early closing');
    const result = await sync(reworded);
    expect(result.updated).toBe(1);
    expect(result.changes).toEqual([]);
  });

  it('keeps the original creation time across an update', async () => {
    await sync();
    const before = (await queryEvents(db, { eventTypes: ['early_finish'], to: '2026-09-30' }))[0]!;

    await syncCalendar({
      db,
      interpreter,
      source: CHANGED,
      now: () => new Date('2026-09-10T09:00:00.000Z'),
    });

    const after = (await queryEvents(db, { eventTypes: ['early_finish'], to: '2026-09-30' }))[0]!;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });
});

describe('removed events', () => {
  it('removes a normalized event whose source event disappeared', async () => {
    await sync();
    const withoutClosure = FIXTURE.replace(
      /BEGIN:VEVENT\r?\nUID:fixture-school-closure[\s\S]*?END:VEVENT\r?\n/,
      '',
    );
    const result = await sync(withoutClosure);
    expect(result.removed).toBe(1);
    expect(await queryEvents(db, { eventTypes: ['school_closure'] })).toEqual([]);
  });
});

describe('failure handling', () => {
  const failing: CalendarEventInterpreter = {
    id: 'always-fails',
    async interpret() {
      throw new InterpreterError('model unavailable');
    },
  };

  const invalid: CalendarEventInterpreter = {
    id: 'invalid-output',
    async interpret() {
      return { eventType: 'not_a_type' } as unknown as InterpretedCalendarEvent;
    },
  };

  it('keeps the raw event when interpretation throws', async () => {
    const result = await syncCalendar({ db, interpreter: failing, now, source: FIXTURE });
    expect(result.failed).toBe(16);
    expect(await queryEvents(db)).toEqual([]);

    const pending = await getUnprocessedRawEvents(db);
    expect(pending).toHaveLength(16);
    expect(pending[0]!.processingStatus).toBe('processing_failed');
    expect(pending[0]!.processingError).toContain('model unavailable');
  });

  it('retries previously failed events on the next sync', async () => {
    await syncCalendar({ db, interpreter: failing, now, source: FIXTURE });
    const recovered = await sync();
    expect(recovered.failed).toBe(0);
    expect(await queryEvents(db)).toHaveLength(16);
  });

  it('routes invalid interpreter output to the failure state, not the database', async () => {
    const result = await syncCalendar({ db, interpreter: invalid, now, source: FIXTURE });
    expect(result.failed).toBe(16);
    expect(await queryEvents(db)).toEqual([]);
    // Validation failures are not auto-retried -- an identical input would fail
    // identically -- so they surface in the review queue instead.
    expect(await getUnprocessedRawEvents(db)).toEqual([]);
    const needsAttention = await getEventsNeedingAttention(db);
    expect(needsAttention).toHaveLength(16);
    expect(needsAttention[0]!.processingStatus).toBe('validation_failed');
    expect(needsAttention[0]!.processingError).toContain('eventType');
  });

  it('keeps last-known-good data when the fetch fails', async () => {
    await sync();
    const before = await queryEvents(db);

    const failed = await syncCalendar({
      db,
      interpreter,
      now,
      feedUrl: 'https://example.invalid/calendar.ics',
      fetchOptions: {
        fetchImpl: async () => {
          throw new Error('network down');
        },
      },
    });

    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('network down');
    expect(await queryEvents(db)).toEqual(before);
  });

  it('records the failure without clearing the last success time', async () => {
    await sync();
    await syncCalendar({
      db,
      interpreter,
      now: () => new Date('2026-09-03T09:00:00.000Z'),
      feedUrl: 'https://example.invalid/calendar.ics',
      fetchOptions: {
        fetchImpl: async () => {
          throw new Error('network down');
        },
      },
    });

    const status = await getSyncStatus(db);
    expect(status.lastSuccessAt).toBe('2026-09-02T09:00:00.000Z');
    expect(status.lastAttemptAt).toBe('2026-09-03T09:00:00.000Z');
    expect(status.lastError).toContain('network down');
  });

  it('rejects a response that is not a calendar', async () => {
    const result = await syncCalendar({
      db,
      interpreter,
      now,
      feedUrl: 'https://example.invalid/calendar.ics',
      fetchOptions: {
        fetchImpl: async () =>
          new Response('<html>not a calendar</html>', { status: 200 }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not an iCalendar feed');
  });

  it('reports an HTTP error from the school server', async () => {
    const result = await syncCalendar({
      db,
      interpreter,
      now,
      feedUrl: 'https://example.invalid/calendar.ics',
      fetchOptions: {
        fetchImpl: async () => new Response('', { status: 503, statusText: 'Service Unavailable' }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
  });
});

describe('read queries never interpret', () => {
  it('serves reads without touching the interpreter', async () => {
    await sync();

    let calls = 0;
    const counting: CalendarEventInterpreter = {
      id: 'counting',
      async interpret(event: RawCalendarEvent) {
        calls += 1;
        return interpreter.interpret(event);
      },
    };
    void counting;

    await queryEvents(db, { classes: ['junior_infants'] });
    await queryEvents(db, { search: 'swimming' });
    await getSyncStatus(db);

    expect(calls).toBe(0);
  });
});

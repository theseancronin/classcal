/**
 * The HTTP surface, exercised through the real route handlers.
 *
 * These cover the boundary the domain tests cannot: query-parameter parsing,
 * rejection of untrusted input, and whether a normalized event survives the
 * JSON round-trip to the browser intact.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as getEvents } from '../app/api/events/route';
import { setDatabase } from '@/db/connection';
import type { PgliteDatabase } from '@/db/pglite';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { syncCalendar } from '@/pipeline/sync';
import type { NormalizedSchoolEvent } from '@/domain/types';
import { createTestDatabase, truncateAll } from './support/database';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

let db: PgliteDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  setDatabase(db);
});

beforeEach(async () => {
  await truncateAll(db);
  await syncCalendar({
    db,
    interpreter: new HeuristicCalendarEventInterpreter(),
    source: FIXTURE,
    now: () => new Date('2026-09-02T09:00:00.000Z'),
  });
});

afterAll(async () => {
  setDatabase(undefined);
  await db.close();
});

const call = (query = ''): Promise<Response> =>
  getEvents(new Request(`https://classcal.test/api/events${query}`));

async function body(query = ''): Promise<{ events: NormalizedSchoolEvent[]; status: unknown }> {
  const response = await call(query);
  return response.json();
}

describe('GET /api/events', () => {
  it('returns events with a sync status', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.events.length).toBeGreaterThan(0);
    expect(payload.status).toBeTruthy();
  });

  it('filters by class, always including whole-school events', async () => {
    const { events } = await body('?classes=junior_infants');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(
        event.appliesTo.includes('junior_infants') || event.appliesTo.includes('whole_school'),
      ).toBe(true);
    }
  });

  it('accepts comma-separated and repeated class parameters alike', async () => {
    const commas = await body('?classes=junior_infants,class_4');
    const repeated = await body('?classes=junior_infants&classes=class_4');
    expect(commas.events.map((e) => e.id)).toEqual(repeated.events.map((e) => e.id));
  });

  it('filters by date range', async () => {
    const { events } = await body('?from=2026-09-01&to=2026-09-30');
    expect(events.every((e) => e.date <= '2026-09-30')).toBe(true);
  });

  it('rejects an unknown class rather than ignoring it', async () => {
    const response = await call('?classes=class_9');
    expect(response.status).toBe(400);
  });

  it('rejects a malformed date rather than coercing it', async () => {
    expect((await call('?from=not-a-date')).status).toBe(400);
  });

  it('rejects an out-of-range limit', async () => {
    expect((await call('?limit=99999')).status).toBe(400);
  });

  it('preserves the original wording through the JSON round-trip', async () => {
    const { events } = await body('?search=Sn%C3%A1mh');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.originalTitle).toContain('Snámh');
  });

  it('keeps class-specific times intact across serialization', async () => {
    const { events } = await body();
    const withDetails = events.find((e) => e.classDetails.length > 0);
    expect(withDetails).toBeDefined();
    expect(withDetails!.classDetails[0]).toHaveProperty('schoolClass');
  });

  it('sets a shared cache header so a morning rush hits one query', async () => {
    const response = await call();
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
  });
});

/**
 * The read layer and notification reconciliation, against real SQLite.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqlDatabase, type NodeSqlDatabase } from '@/db/nodeSqlite';
import { getScheduledKeys, queryEvents } from '@/db/repository';
import { migrate } from '@/db/schema';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { commitPlan, planNotifications } from '@/notifications/reconcile';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/notifications/schedule';
import { syncCalendar } from '@/pipeline/sync';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

let db: NodeSqlDatabase;

beforeEach(async () => {
  db = createNodeSqlDatabase();
  await migrate(db);
  await syncCalendar({
    db,
    interpreter: new HeuristicCalendarEventInterpreter(),
    source: FIXTURE,
    now: () => new Date('2026-09-02T09:00:00.000Z'),
  });
});

afterEach(() => {
  db.close();
});

describe('class filtering', () => {
  it('returns 3rd-class events plus whole-school events for a 3rd-class family', async () => {
    const events = await queryEvents(db, { classes: ['class_3'] });
    const types = events.map((e) => e.eventType);
    expect(types).toContain('swimming');
    expect(types).toContain('school_closure');
  });

  it('excludes events for classes the family does not have', async () => {
    const events = await queryEvents(db, { classes: ['junior_infants'] });
    expect(events.map((e) => e.title)).not.toContain('Swimming — 3rd Class');
  });

  it('always includes whole-school events, whatever the class filter', async () => {
    for (const schoolClass of ['junior_infants', 'class_2', 'class_6'] as const) {
      const events = await queryEvents(db, { classes: [schoolClass] });
      expect(events.some((e) => e.appliesTo.includes('whole_school'))).toBe(true);
    }
  });

  it('returns the union for a multi-class family, without duplicates', async () => {
    const events = await queryEvents(db, { classes: ['junior_infants', 'class_4'] });
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('date filtering', () => {
  it('excludes events before the from date', async () => {
    const events = await queryEvents(db, { from: '2026-12-01' });
    expect(events.every((e) => e.endDate >= '2026-12-01')).toBe(true);
  });

  it('excludes events after the to date', async () => {
    const events = await queryEvents(db, { to: '2026-09-30' });
    expect(events.every((e) => e.date <= '2026-09-30')).toBe(true);
  });

  it('keeps a multi-day event that straddles the from date', async () => {
    // The Halloween break runs 26-30 October.
    const events = await queryEvents(db, { from: '2026-10-28', to: '2026-10-28' });
    expect(events.map((e) => e.eventType)).toContain('school_holiday');
  });

  it('returns events in chronological order', async () => {
    const dates = (await queryEvents(db)).map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('importance filtering', () => {
  it('returns only critical and high events', async () => {
    const events = await queryEvents(db, { importance: ['critical', 'high'] });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => ['critical', 'high'].includes(e.importance))).toBe(true);
  });
});

describe('search', () => {
  it('finds events by normalized title', async () => {
    const events = await queryEvents(db, { search: 'Swimming' });
    expect(events.map((e) => e.eventType)).toEqual(['swimming']);
  });

  it('finds events by the original Irish wording', async () => {
    const events = await queryEvents(db, { search: 'Snámh' });
    expect(events.map((e) => e.eventType)).toEqual(['swimming']);
  });

  it('finds events by summary text', async () => {
    const events = await queryEvents(db, { search: 'closed' });
    expect(events.length).toBeGreaterThan(0);
  });

  it('finds events by event type', async () => {
    const events = await queryEvents(db, { search: 'parent_information_meeting' });
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns nothing for a term that matches nothing', async () => {
    expect(await queryEvents(db, { search: 'zzzzz' })).toEqual([]);
  });
});

describe('review filtering', () => {
  it('returns only events flagged for review', async () => {
    const events = await queryEvents(db, { needsReview: true });
    expect(events.every((e) => e.needsReview)).toBe(true);
  });
});

describe('notification reconciliation against the database', () => {
  const reconcile = async (
    preferences = DEFAULT_NOTIFICATION_PREFERENCES,
  ): Promise<{ scheduled: number; cancelled: number }> => {
    const plan = await planNotifications({
      db,
      preferences,
      selectedClasses: ['junior_infants', 'class_4'],
      now: new Date('2026-09-02T09:00:00.000Z'),
    });
    return commitPlan(db, plan);
  };

  it('schedules reminders for the family, and none twice', async () => {
    const first = await reconcile();
    expect(first.scheduled).toBeGreaterThan(0);
    expect(first.cancelled).toBe(0);

    const second = await reconcile();
    expect(second.scheduled).toBe(0);
    expect(second.cancelled).toBe(0);

    const keys = await getScheduledKeys(db);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cancels reminders when the parent turns a category off', async () => {
    await reconcile();
    const result = await reconcile({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      schoolClosure: false,
      earlyFinish: false,
      parentMeetings: false,
      classImportant: false,
    });

    expect(result.cancelled).toBeGreaterThan(0);
    expect(await getScheduledKeys(db)).toEqual([]);
  });
});

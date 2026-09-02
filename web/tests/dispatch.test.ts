/**
 * Reminder dispatch, against a real database.
 *
 * The property that matters most here is at-most-once delivery: a parent who
 * gets the same closure alert three times will turn reminders off, and then
 * miss the one that mattered.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PgliteDatabase } from '@/db/pglite';
import { toSqlJson } from '@/db/port';
import { queryEvents } from '@/db/repository';
import {
  activeSubscriptions,
  markSent,
  markSubscriptionFailed,
  pendingPushes,
} from '@/notifications/dispatch';
import { DEFAULT_NOTIFICATION_PREFERENCES, scheduleFor } from '@/notifications/schedule';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { syncCalendar } from '@/pipeline/sync';
import { createTestDatabase, truncateAll } from './support/database';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

let db: PgliteDatabase;

/** The sample calendar has a school closure on 28 September 2026. */
const BEFORE_CLOSURE = new Date('2026-09-01T09:00:00.000Z');

async function subscribe(
  endpoint: string,
  classes: string[],
  preferences = DEFAULT_NOTIFICATION_PREFERENCES,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO push_subscriptions
       (endpoint, p256dh, auth, classes, preferences, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [endpoint, 'key', 'auth', toSqlJson(classes), toSqlJson(preferences), now, now],
  );
}

/**
 * The moment just after the closure's first reminder fires.
 *
 * Derived from the scheduler rather than hard-coded, because the exact instant
 * depends on the reminder hour and the machine's UTC offset; asserting on a
 * literal would make this test pass or fail by timezone.
 */
async function dueForClosure(): Promise<Date> {
  const [closure] = await queryEvents(db, { eventTypes: ['school_closure'] });
  if (!closure) throw new Error('fixture has no school closure');

  const reminders = scheduleFor(closure, DEFAULT_NOTIFICATION_PREFERENCES, {
    now: BEFORE_CLOSURE.toISOString(),
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    selectedClasses: ['junior_infants'],
  });

  const earliest = reminders
    .map((reminder) => Date.parse(reminder.scheduledAt))
    .sort((a, b) => a - b)[0];
  if (earliest === undefined) throw new Error('closure produced no reminders');

  return new Date(earliest + 60_000);
}

beforeAll(async () => {
  db = await createTestDatabase();
});

beforeEach(async () => {
  await truncateAll(db);
  await syncCalendar({
    db,
    interpreter: new HeuristicCalendarEventInterpreter(),
    source: FIXTURE,
    now: () => BEFORE_CLOSURE,
  });
});

afterAll(async () => {
  await db.close();
});

describe('activeSubscriptions', () => {
  it('returns nothing when nobody has subscribed', async () => {
    expect(await activeSubscriptions(db)).toEqual([]);
  });

  it('round-trips classes and preferences', async () => {
    await subscribe('https://push.example/a', ['junior_infants', 'class_4']);
    const [target] = await activeSubscriptions(db);
    expect(target?.classes).toEqual(['junior_infants', 'class_4']);
    expect(target?.preferences.schoolClosure).toBe(true);
  });

  it('falls back to defaults rather than failing on a corrupt preferences row', async () => {
    await subscribe('https://push.example/a', ['class_4']);
    await db.run('UPDATE push_subscriptions SET preferences = ?', ['{"nonsense":true}']);
    const [target] = await activeSubscriptions(db);
    expect(target?.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('excludes a subscription the push service reported as gone', async () => {
    await subscribe('https://push.example/a', ['class_4']);
    await markSubscriptionFailed(db, 'https://push.example/a');
    expect(await activeSubscriptions(db)).toEqual([]);
  });
});

describe('pendingPushes', () => {
  it('sends nothing when no reminder is due yet', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    expect(await pendingPushes(db, BEFORE_CLOSURE)).toEqual([]);
  });

  it('produces the closure reminder once it comes due', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    const pending = await pendingPushes(db, await dueForClosure());
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((p) => p.notification.title.length > 0)).toBe(true);
  });

  it('never repeats a reminder already delivered to that browser', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    const now = await dueForClosure();

    const first = await pendingPushes(db, now);
    expect(first.length).toBeGreaterThan(0);

    for (const { target, notification } of first) {
      await markSent(db, target.endpoint, notification.idempotencyKey);
    }

    expect(await pendingPushes(db, now)).toEqual([]);
  });

  it('is idempotent when the same delivery is recorded twice', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    await markSent(db, 'https://push.example/a', 'key-1');
    await expect(markSent(db, 'https://push.example/a', 'key-1')).resolves.toBeUndefined();
  });

  it('still sends to a second browser that has not received it', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    await subscribe('https://push.example/b', ['junior_infants']);
    const now = await dueForClosure();

    const first = await pendingPushes(db, now);
    const forA = first.filter((p) => p.target.endpoint === 'https://push.example/a');
    for (const { target, notification } of forA) {
      await markSent(db, target.endpoint, notification.idempotencyKey);
    }

    const remaining = await pendingPushes(db, now);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((p) => p.target.endpoint === 'https://push.example/b')).toBe(true);
  });

  it('respects a parent who has turned closure reminders off', async () => {
    await subscribe('https://push.example/a', ['junior_infants'], {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      schoolClosure: false,
    });
    const pending = await pendingPushes(db, await dueForClosure());
    expect(pending.every((p) => !p.notification.title.toLowerCase().includes('closed'))).toBe(true);
  });

  it('sends nothing to a subscription with no classes selected', async () => {
    await subscribe('https://push.example/a', []);
    expect(await pendingPushes(db, await dueForClosure())).toEqual([]);
  });

  it('does not resurrect a reminder that came due long ago', async () => {
    await subscribe('https://push.example/a', ['junior_infants']);
    const due = await dueForClosure();
    // Well outside the delivery grace window.
    const late = new Date(due.getTime() + 7 * 86_400_000);
    const pending = await pendingPushes(db, late);
    const closureReminders = pending.filter((p) =>
      p.notification.scheduledAt < due.toISOString(),
    );
    expect(closureReminders).toEqual([]);
  });
});

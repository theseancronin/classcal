import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  idempotencyKey,
  isNotifiable,
  reconcileAll,
  reconcileSchedules,
  scheduleFor,
} from '@/notifications/schedule';
import type { NotificationPreferences } from '@/domain/types';
import { makeEvent } from './support/factories';

/** Well before the 2026-09-28 event date used by the factory. */
const NOW = '2026-09-01T09:00:00.000Z';

const CLOSURE = makeEvent({ id: 'closure', eventType: 'school_closure', importance: 'critical' });
const MEETING = makeEvent({
  id: 'meeting',
  eventType: 'parent_teacher_meeting',
  importance: 'high',
  appliesTo: ['parents'],
});
const SWIMMING = makeEvent({
  id: 'swimming',
  eventType: 'swimming',
  importance: 'normal',
  appliesTo: ['class_4'],
});

function prefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides };
}

describe('reminder ladders', () => {
  it('schedules 7-day, 1-day and morning-of reminders for a critical event', () => {
    const scheduled = scheduleFor(CLOSURE, prefs(), { now: NOW });
    expect(scheduled.map((n) => n.reminderType)).toEqual([
      'seven_days_before',
      'one_day_before',
      'morning_of',
    ]);
  });

  it('schedules 7-day and 1-day reminders for a high-importance event', () => {
    const scheduled = scheduleFor(MEETING, prefs(), { now: NOW });
    expect(scheduled.map((n) => n.reminderType)).toEqual([
      'seven_days_before',
      'one_day_before',
    ]);
  });

  it('schedules nothing for a normal event unless the parent opted in', () => {
    expect(scheduleFor(SWIMMING, prefs(), { now: NOW })).toEqual([]);
    const opted = scheduleFor(SWIMMING, prefs({ generalActivities: true }), { now: NOW });
    expect(opted.map((n) => n.reminderType)).toEqual(['one_day_before']);
  });

  it('schedules nothing for a low-importance event', () => {
    const reminder = makeEvent({ eventType: 'reminder', importance: 'low' });
    expect(scheduleFor(reminder, prefs({ generalActivities: true }), { now: NOW })).toEqual([]);
  });

  it('fires reminders at the expected instants', () => {
    const scheduled = scheduleFor(CLOSURE, prefs(), { now: NOW });
    expect(scheduled.map((n) => n.scheduledAt)).toEqual([
      '2026-09-21T18:00:00.000Z',
      '2026-09-27T18:00:00.000Z',
      '2026-09-28T07:00:00.000Z',
    ]);
  });

  it('respects a timezone offset', () => {
    const scheduled = scheduleFor(CLOSURE, prefs(), { now: NOW, utcOffsetMinutes: 60 });
    expect(scheduled.at(-1)!.scheduledAt).toBe('2026-09-28T06:00:00.000Z');
  });

  it('skips reminders whose time has already passed', () => {
    const scheduled = scheduleFor(CLOSURE, prefs(), { now: '2026-09-27T20:00:00.000Z' });
    expect(scheduled.map((n) => n.reminderType)).toEqual(['morning_of']);
  });
});

describe('preference overrides', () => {
  it('suppresses closure reminders when the parent turned them off', () => {
    expect(scheduleFor(CLOSURE, prefs({ schoolClosure: false }), { now: NOW })).toEqual([]);
  });

  it('suppresses a reminder type the parent turned off', () => {
    const scheduled = scheduleFor(CLOSURE, prefs({
      reminderTypes: { seven_days_before: false, one_day_before: true, morning_of: true },
    }), { now: NOW });
    expect(scheduled.map((n) => n.reminderType)).toEqual(['one_day_before', 'morning_of']);
  });

  it('suppresses meeting reminders when the parent turned them off', () => {
    expect(scheduleFor(MEETING, prefs({ parentMeetings: false }), { now: NOW })).toEqual([]);
  });

  it('never sends a critical alert from a low-confidence interpretation', () => {
    const uncertain = makeEvent({ ...CLOSURE, needsReview: true, confidence: 0.4 });
    expect(isNotifiable(uncertain, prefs())).toBe(false);
    expect(scheduleFor(uncertain, prefs(), { now: NOW })).toEqual([]);
  });
});

describe('idempotency', () => {
  it('builds the specified key shape', () => {
    expect(idempotencyKey('e1', 'morning_of', '2026-09-28T07:00:00.000Z')).toBe(
      'e1:morning_of:2026-09-28T07:00:00.000Z',
    );
  });

  it('produces identical keys across repeated runs', () => {
    const first = scheduleFor(CLOSURE, prefs(), { now: NOW }).map((n) => n.idempotencyKey);
    const second = scheduleFor(CLOSURE, prefs(), { now: NOW }).map((n) => n.idempotencyKey);
    expect(first).toEqual(second);
  });

  it('suppresses reminders that are already scheduled', () => {
    const desired = scheduleFor(CLOSURE, prefs(), { now: NOW });
    const existing = desired.map((n) => n.idempotencyKey);
    const result = reconcileSchedules(desired, existing);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual([]);
  });

  it('schedules only the missing reminders', () => {
    const desired = scheduleFor(CLOSURE, prefs(), { now: NOW });
    const result = reconcileSchedules(desired, [desired[0]!.idempotencyKey]);
    expect(result.toSchedule).toHaveLength(2);
    expect(result.toCancel).toEqual([]);
  });
});

describe('rescheduling after a change', () => {
  it('cancels reminders for an event that moved', () => {
    const before = scheduleFor(CLOSURE, prefs(), { now: NOW });
    const moved = makeEvent({ ...CLOSURE, date: '2026-10-05', endDate: '2026-10-05' });
    const after = scheduleFor(moved, prefs(), { now: NOW });

    const result = reconcileSchedules(after, before.map((n) => n.idempotencyKey));
    expect(result.toCancel).toEqual(before.map((n) => n.idempotencyKey));
    expect(result.toSchedule).toHaveLength(3);
  });

  it('cancels reminders for an event that no longer exists', () => {
    const stale = scheduleFor(CLOSURE, prefs(), { now: NOW }).map((n) => n.idempotencyKey);
    const result = reconcileAll([], prefs(), stale, { now: NOW });
    expect(result.toCancel).toEqual(stale);
    expect(result.toSchedule).toEqual([]);
  });

  it('cancels reminders when a preference is switched off', () => {
    const existing = scheduleFor(CLOSURE, prefs(), { now: NOW }).map((n) => n.idempotencyKey);
    const result = reconcileAll([CLOSURE], prefs({ schoolClosure: false }), existing, { now: NOW });
    expect(result.toCancel).toEqual(existing);
  });
});

describe('notification wording', () => {
  it('names the affected class and its own finish time', () => {
    const earlyFinish = makeEvent({
      id: 'ef',
      eventType: 'early_finish',
      importance: 'critical',
      appliesTo: ['whole_school'],
      classDetails: [
        { schoolClass: 'junior_infants', finishTime: '12:50' },
        { schoolClass: 'class_4', finishTime: '13:00' },
      ],
    });
    const [, , morningOf] = scheduleFor(earlyFinish, prefs(), {
      now: NOW,
      selectedClasses: ['junior_infants'],
    });
    expect(morningOf!.title).toBe('Early collection today');
    expect(morningOf!.body).toBe('Junior Infants finish at 12:50.');
  });

  it('titles a closure reminder by how far away it is', () => {
    const scheduled = scheduleFor(CLOSURE, prefs(), { now: NOW });
    expect(scheduled.map((n) => n.title)).toEqual([
      'School closed next week',
      'School closed tomorrow',
      'School closed today',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildHomeSections,
  dateRangeLabel,
  daysBetween,
  occursOn,
  relativeDateLabel,
} from '@/relevance/grouping';
import { makeEvent } from './support/factories';

const TODAY = '2026-09-21';

function sections(events: Parameters<typeof buildHomeSections>[0]) {
  const built = buildHomeSections(events, TODAY);
  return Object.fromEntries(built.map((s) => [s.id, s.events.map((e) => e.id)]));
}

describe('buildHomeSections', () => {
  it('puts a today event in Today', () => {
    const event = makeEvent({ id: 'a', date: TODAY, endDate: TODAY, eventType: 'sports', importance: 'normal' });
    expect(sections([event]).today).toEqual(['a']);
  });

  it('puts a tomorrow event in Tomorrow', () => {
    const event = makeEvent({ id: 'a', date: '2026-09-22', endDate: '2026-09-22', importance: 'normal' });
    expect(sections([event]).tomorrow).toEqual(['a']);
  });

  it('puts a critical event later this month in Important', () => {
    const event = makeEvent({ id: 'closure', date: '2026-09-28', endDate: '2026-09-28' });
    const result = sections([event]);
    expect(result.important).toEqual(['closure']);
    expect(result.next_seven_days ?? []).not.toContain('closure');
  });

  it('puts a routine event this week in Next 7 days', () => {
    const event = makeEvent({ id: 'a', date: '2026-09-25', endDate: '2026-09-25', importance: 'normal' });
    expect(sections([event]).next_seven_days).toEqual(['a']);
  });

  it('puts a distant routine event in Later', () => {
    const event = makeEvent({ id: 'a', date: '2026-11-25', endDate: '2026-11-25', importance: 'normal' });
    expect(sections([event]).later).toEqual(['a']);
  });

  it('never places one event in two sections', () => {
    const events = [
      makeEvent({ id: 'today-critical', date: TODAY, endDate: TODAY }),
      makeEvent({ id: 'tomorrow-critical', date: '2026-09-22', endDate: '2026-09-22' }),
      makeEvent({ id: 'soon-critical', date: '2026-09-28', endDate: '2026-09-28' }),
    ];
    const result = sections(events);
    const all = Object.values(result).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(result.today).toEqual(['today-critical']);
    expect(result.tomorrow).toEqual(['tomorrow-critical']);
    expect(result.important).toEqual(['soon-critical']);
  });

  it('excludes events that have already finished', () => {
    const event = makeEvent({ id: 'past', date: '2026-09-01', endDate: '2026-09-01' });
    expect(Object.values(sections([event])).flat()).toEqual([]);
  });

  it('still shows a multi-day event that is currently running', () => {
    const holiday = makeEvent({
      id: 'holiday',
      date: '2026-09-19',
      endDate: '2026-09-23',
      eventType: 'school_holiday',
    });
    expect(sections([holiday]).today).toEqual(['holiday']);
  });

  it('always renders Today, even when empty', () => {
    const built = buildHomeSections([], TODAY);
    expect(built.map((s) => s.id)).toEqual(['today']);
    expect(built[0]!.emptyMessage).toBe('No special events today.');
  });

  it('orders Important by importance, then date', () => {
    const events = [
      makeEvent({ id: 'meeting', date: '2026-09-24', endDate: '2026-09-24', eventType: 'parent_teacher_meeting', importance: 'high' }),
      makeEvent({ id: 'late-closure', date: '2026-09-30', endDate: '2026-09-30' }),
      makeEvent({ id: 'early-closure', date: '2026-09-29', endDate: '2026-09-29' }),
    ];
    expect(sections(events).important).toEqual(['early-closure', 'late-closure', 'meeting']);
  });

  it('orders Next 7 days chronologically, then by time', () => {
    const events = [
      makeEvent({ id: 'late', date: '2026-09-25', endDate: '2026-09-25', startTime: '14:40', importance: 'normal' }),
      makeEvent({ id: 'early', date: '2026-09-25', endDate: '2026-09-25', startTime: '09:15', importance: 'normal' }),
      makeEvent({ id: 'sooner', date: '2026-09-24', endDate: '2026-09-24', importance: 'normal' }),
    ];
    expect(sections(events).next_seven_days).toEqual(['sooner', 'early', 'late']);
  });
});

describe('date helpers', () => {
  it('counts days between dates', () => {
    expect(daysBetween('2026-09-21', '2026-09-28')).toBe(7);
    expect(daysBetween('2026-09-28', '2026-09-21')).toBe(-7);
  });

  it('detects a day inside a multi-day event', () => {
    const holiday = makeEvent({ date: '2026-10-26', endDate: '2026-10-30' });
    expect(occursOn(holiday, '2026-10-28')).toBe(true);
    expect(occursOn(holiday, '2026-10-31')).toBe(false);
  });

  it('labels relative dates in plain words', () => {
    expect(relativeDateLabel(TODAY, TODAY)).toBe('Today');
    expect(relativeDateLabel('2026-09-22', TODAY)).toBe('Tomorrow');
    expect(relativeDateLabel('2026-09-28', TODAY)).toBe('Mon 28 Sep');
  });

  it('includes the year for a date in another year', () => {
    expect(relativeDateLabel('2027-01-06', TODAY)).toContain('2027');
  });

  it('renders a single-day event date in full', () => {
    expect(dateRangeLabel({ date: '2026-09-28', endDate: '2026-09-28' })).toBe(
      'Monday 28 September 2026',
    );
  });

  it('renders a multi-day range', () => {
    expect(dateRangeLabel({ date: '2026-10-26', endDate: '2026-10-30' })).toBe(
      'Monday 26 October 2026 to Friday 30 October 2026',
    );
  });
});

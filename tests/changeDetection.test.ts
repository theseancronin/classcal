import { describe, expect, it } from 'vitest';

import { buildEventChange, diffNormalizedEvents } from '@/changes/diff';
import { NOW, makeEvent } from './support/factories';

const EARLY_FINISH = makeEvent({
  id: 'early-finish',
  title: 'Early finish',
  eventType: 'early_finish',
  date: '2026-09-24',
  endDate: '2026-09-24',
  appliesTo: ['whole_school'],
  classDetails: [
    { schoolClass: 'junior_infants', finishTime: '13:00' },
    { schoolClass: 'class_4', finishTime: '13:00' },
  ],
});

describe('diffNormalizedEvents', () => {
  it('reports nothing for an unchanged event', () => {
    expect(diffNormalizedEvents(EARLY_FINISH, EARLY_FINISH)).toEqual([]);
  });

  it('ignores a reworded summary', () => {
    const next = makeEvent({ ...EARLY_FINISH, summary: 'Completely different wording.' });
    expect(diffNormalizedEvents(EARLY_FINISH, next)).toEqual([]);
  });

  it('ignores a confidence change', () => {
    const next = makeEvent({ ...EARLY_FINISH, confidence: 0.5, needsReview: true });
    expect(diffNormalizedEvents(EARLY_FINISH, next)).toEqual([]);
  });

  it('detects a class-specific finish time change', () => {
    const next = makeEvent({
      ...EARLY_FINISH,
      classDetails: [
        { schoolClass: 'junior_infants', finishTime: '12:30' },
        { schoolClass: 'class_4', finishTime: '13:00' },
      ],
    });
    const changes = diffNormalizedEvents(EARLY_FINISH, next);
    expect(changes).toEqual([
      {
        field: 'classDetails',
        schoolClass: 'junior_infants',
        oldValue: '13:00',
        newValue: '12:30',
      },
    ]);
  });

  it('detects a date change', () => {
    const next = makeEvent({ ...EARLY_FINISH, date: '2026-09-25', endDate: '2026-09-25' });
    const fields = diffNormalizedEvents(EARLY_FINISH, next).map((c) => c.field);
    expect(fields).toContain('date');
    expect(fields).toContain('endDate');
  });

  it('detects an event-level time change', () => {
    const before = makeEvent({ startTime: '18:30' });
    const after = makeEvent({ startTime: '19:00' });
    expect(diffNormalizedEvents(before, after)).toEqual([
      { field: 'startTime', oldValue: '18:30', newValue: '19:00' },
    ]);
  });

  it('detects an affected-class change', () => {
    const before = makeEvent({ appliesTo: ['class_4'] });
    const after = makeEvent({ appliesTo: ['class_4', 'class_5'] });
    expect(diffNormalizedEvents(before, after)).toEqual([
      { field: 'appliesTo', oldValue: 'class_4', newValue: 'class_4,class_5' },
    ]);
  });

  it('detects an event type change', () => {
    const before = makeEvent({ eventType: 'school_event', importance: 'normal' });
    const after = makeEvent({ eventType: 'school_closure', importance: 'critical' });
    expect(diffNormalizedEvents(before, after).map((c) => c.field)).toEqual(['eventType']);
  });

  it('detects a cancellation', () => {
    const before = makeEvent({ eventType: 'sports', tags: [] });
    const after = makeEvent({ eventType: 'sports', tags: ['cancelled'] });
    expect(diffNormalizedEvents(before, after)).toEqual([
      { field: 'cancelled', oldValue: 'false', newValue: 'true' },
    ]);
  });

  it('detects a class gaining a stated time', () => {
    const before = makeEvent({ classDetails: [] });
    const after = makeEvent({ classDetails: [{ schoolClass: 'class_4', finishTime: '12:30' }] });
    expect(diffNormalizedEvents(before, after)).toEqual([
      { field: 'classDetails', schoolClass: 'class_4', oldValue: null, newValue: '12:30' },
    ]);
  });
});

describe('buildEventChange', () => {
  it('returns null when nothing material changed', () => {
    expect(buildEventChange(EARLY_FINISH, EARLY_FINISH, { now: NOW })).toBeNull();
  });

  it('renders the spec example wording', () => {
    const next = makeEvent({
      ...EARLY_FINISH,
      classDetails: [
        { schoolClass: 'junior_infants', finishTime: '12:30' },
        { schoolClass: 'class_4', finishTime: '13:00' },
      ],
    });
    const change = buildEventChange(EARLY_FINISH, next, { now: NOW });
    expect(change).not.toBeNull();
    expect(change!.description).toBe(
      'Junior Infants now finishes at 12:30. Previously 13:00.',
    );
    expect(change!.eventId).toBe('early-finish');
    expect(change!.acknowledged).toBe(false);
  });

  it('renders a date move in full', () => {
    const next = makeEvent({ ...EARLY_FINISH, date: '2026-09-25', endDate: '2026-09-25' });
    const change = buildEventChange(EARLY_FINISH, next, { now: NOW })!;
    expect(change.description).toBe(
      'This event has moved to Friday 25 September. Previously Thursday 24 September.',
    );
  });

  it('renders a cancellation plainly', () => {
    const before = makeEvent({ eventType: 'sports', tags: [] });
    const after = makeEvent({ eventType: 'sports', tags: ['cancelled'] });
    expect(buildEventChange(before, after, { now: NOW })!.description).toBe(
      'This event is cancelled.',
    );
  });

  it('renders a scope change using friendly class names', () => {
    const before = makeEvent({ appliesTo: ['class_4'] });
    const after = makeEvent({ appliesTo: ['class_4', 'class_5', 'class_6'] });
    const change = buildEventChange(before, after, { now: NOW })!;
    expect(change.description).toContain('4th–6th Class');
    expect(change.description).toContain('4th Class');
  });
});

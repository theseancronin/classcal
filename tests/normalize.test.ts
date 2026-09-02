import { describe, expect, it } from 'vitest';

import { importanceFor, parentActionRequiredFor } from '@/normalize/importance';
import { deriveDates, normalizeInterpretation } from '@/normalize/normalize';
import type { InterpretedCalendarEvent } from '@/domain/types';
import { NOW, makeRawEvent } from './support/factories';

function interpretation(
  overrides: Partial<InterpretedCalendarEvent> = {},
): Record<string, unknown> {
  return {
    title: 'School closed',
    summary: 'The school is closed.',
    eventType: 'school_closure',
    appliesTo: ['whole_school'],
    classDetails: [],
    parentActionRequired: true,
    tags: [],
    confidence: 0.95,
    ambiguous: false,
    ...overrides,
  };
}

function normalize(overrides: Partial<InterpretedCalendarEvent> = {}, raw = makeRawEvent()) {
  return normalizeInterpretation(raw, interpretation(overrides), { now: NOW });
}

describe('deterministic importance', () => {
  it('forces closures to critical', () => {
    expect(importanceFor('school_closure')).toBe('critical');
  });

  it('forces early finishes to critical', () => {
    expect(importanceFor('early_finish')).toBe('critical');
  });

  it('forces late starts and changed hours to critical', () => {
    expect(importanceFor('late_start')).toBe('critical');
    expect(importanceFor('changed_hours')).toBe('critical');
  });

  it('forces school holidays to critical', () => {
    expect(importanceFor('school_holiday')).toBe('critical');
  });

  it('treats meetings and deadlines as high', () => {
    expect(importanceFor('parent_teacher_meeting')).toBe('high');
    expect(importanceFor('deadline')).toBe('high');
  });

  it('treats routine activities as normal', () => {
    expect(importanceFor('swimming')).toBe('normal');
    expect(importanceFor('non_uniform_day')).toBe('normal');
  });

  it('does not let the interpreter downgrade a closure', () => {
    const result = normalize({ eventType: 'school_closure' });
    expect(result.ok && result.event.importance).toBe('critical');
  });

  it('does not let the interpreter downgrade an early finish', () => {
    const result = normalize({ eventType: 'early_finish' });
    expect(result.ok && result.event.importance).toBe('critical');
  });
});

describe('parent action enforcement', () => {
  it('forces parentActionRequired for attendance changes', () => {
    expect(parentActionRequiredFor('early_finish', false)).toBe(true);
    expect(parentActionRequiredFor('school_closure', false)).toBe(true);
  });

  it('overrides an interpreter that said no action was needed', () => {
    const result = normalize({ eventType: 'early_finish', parentActionRequired: false });
    expect(result.ok && result.event.parentActionRequired).toBe(true);
  });

  it('leaves routine events as the interpreter judged them', () => {
    expect(parentActionRequiredFor('sports', false)).toBe(false);
  });
});

describe('class canonicalisation', () => {
  it('rescues a recognisable free-text class', () => {
    const result = normalize({ appliesTo: ['R4'] as never });
    expect(result.ok && result.event.appliesTo).toEqual(['class_4']);
  });

  it('deduplicates repeated classes', () => {
    const result = normalize({ appliesTo: ['class_4', 'class_4', '4th class'] as never });
    expect(result.ok && result.event.appliesTo).toEqual(['class_4']);
  });

  it('collapses a full list of teaching classes to whole_school', () => {
    const result = normalize({
      appliesTo: [
        'junior_infants',
        'senior_infants',
        'class_1',
        'class_2',
        'class_3',
        'class_4',
        'class_5',
        'class_6',
      ],
    });
    expect(result.ok && result.event.appliesTo).toEqual(['whole_school']);
  });

  it('rejects an interpretation whose classes are entirely invented', () => {
    const result = normalize({ appliesTo: ['class_9', 'transition_year'] as never });
    expect(result.ok).toBe(false);
  });

  it('records a warning for a partially invented class list', () => {
    const result = normalize({ appliesTo: ['class_4', 'class_9'] as never });
    expect(result.ok && result.event.appliesTo).toEqual(['class_4']);
    expect(result.ok && result.warnings.join(' ')).toMatch(/class_9/);
  });
});

describe('time normalization', () => {
  it('normalizes a 12-hour class time to 24-hour', () => {
    const result = normalize({
      eventType: 'early_finish',
      classDetails: [{ schoolClass: 'junior_infants', finishTime: '12:50' }],
    });
    expect(result.ok && result.event.classDetails[0]!.finishTime).toBe('12:50');
  });

  it('rejects a malformed time at the schema boundary', () => {
    const result = normalize({
      classDetails: [{ schoolClass: 'junior_infants', finishTime: '1.00pm' } as never],
    });
    expect(result.ok).toBe(false);
  });

  it('deduplicates class details, keeping the first stated time', () => {
    const result = normalize({
      eventType: 'early_finish',
      classDetails: [
        { schoolClass: 'junior_infants', finishTime: '12:50' },
        { schoolClass: 'junior_infants', finishTime: '13:00' },
      ],
    });
    expect(result.ok && result.event.classDetails).toHaveLength(1);
    expect(result.ok && result.event.classDetails[0]!.finishTime).toBe('12:50');
  });
});

describe('semantic sanity checks', () => {
  it('marks a low-confidence interpretation for review', () => {
    const result = normalize({ confidence: 0.4 });
    expect(result.ok && result.event.needsReview).toBe(true);
  });

  it('marks an ambiguous interpretation for review', () => {
    const result = normalize({ ambiguous: true, confidence: 0.99 });
    expect(result.ok && result.event.needsReview).toBe(true);
  });

  it('does not mark a confident interpretation for review', () => {
    const result = normalize({ confidence: 0.95 });
    expect(result.ok && result.event.needsReview).toBe(false);
  });

  it('flags class times that name a class the event does not apply to', () => {
    const result = normalize({
      eventType: 'early_finish',
      appliesTo: ['class_4'],
      classDetails: [{ schoolClass: 'class_3', finishTime: '12:50' }],
    });
    expect(result.ok && result.event.needsReview).toBe(true);
    expect(result.ok && result.warnings.join(' ')).toMatch(/does not apply/);
  });

  it('flags a class that finishes before it starts', () => {
    const result = normalize({
      classDetails: [{ schoolClass: 'whole_school', startTime: '14:00', finishTime: '09:00' }],
    });
    expect(result.ok && result.event.needsReview).toBe(true);
  });

  it('flags an event that ends before it starts', () => {
    const result = normalize({ startTime: '15:00', endTime: '09:00' });
    expect(result.ok && result.event.needsReview).toBe(true);
  });
});

describe('rejection', () => {
  it('rejects an interpretation with an invalid event type', () => {
    const result = normalize({ eventType: 'sports_day' as never });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toMatch(/eventType/);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(normalize({ confidence: 4 }).ok).toBe(false);
  });

  it('rejects a completely malformed payload', () => {
    const result = normalizeInterpretation(makeRawEvent(), { nonsense: true }, { now: NOW });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty appliesTo list', () => {
    expect(normalize({ appliesTo: [] }).ok).toBe(false);
  });
});

describe('provenance', () => {
  it('preserves the original wording and source link', () => {
    const result = normalize();
    expect(result.ok && result.event.originalTitle).toBe(
      'Scoil Dúnta - Lá saoire School Closure',
    );
    expect(result.ok && result.event.sourceUrl).toContain('gsmnc.ie');
  });

  it('keeps createdAt stable when reprocessing', () => {
    const first = normalize();
    if (!first.ok) throw new Error('expected success');
    const again = normalizeInterpretation(makeRawEvent(), interpretation(), {
      now: '2026-10-01T09:00:00.000Z',
      createdAt: first.event.createdAt,
    });
    expect(again.ok && again.event.createdAt).toBe(first.event.createdAt);
    expect(again.ok && again.event.updatedAt).toBe('2026-10-01T09:00:00.000Z');
  });
});

describe('deriveDates', () => {
  it('treats an all-day event ending the next morning as one day', () => {
    expect(
      deriveDates(makeRawEvent({ start: '2026-09-28T00:00:00.000Z', end: '2026-09-29T00:00:00.000Z' })),
    ).toEqual({ date: '2026-09-28', endDate: '2026-09-28' });
  });

  it('spans a multi-day holiday correctly', () => {
    expect(
      deriveDates(makeRawEvent({ start: '2026-10-26T00:00:00.000Z', end: '2026-10-31T00:00:00.000Z' })),
    ).toEqual({ date: '2026-10-26', endDate: '2026-10-30' });
  });

  it('handles a missing end date', () => {
    const raw = makeRawEvent();
    delete (raw as { end?: string }).end;
    expect(deriveDates(raw)).toEqual({ date: '2026-09-28', endDate: '2026-09-28' });
  });

  it('never returns an end before the start', () => {
    const dates = deriveDates(
      makeRawEvent({ start: '2026-09-28T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' }),
    );
    expect(dates.endDate).toBe('2026-09-28');
  });
});

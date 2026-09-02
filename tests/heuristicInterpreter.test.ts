import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { parseICalendar } from '@/ical/parser';
import type { InterpretedCalendarEvent, RawCalendarEvent } from '@/domain/types';
import { interpretedCalendarEventSchema } from '@/domain/schemas';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

const interpreter = new HeuristicCalendarEventInterpreter();

let raw: RawCalendarEvent[];
const interpreted = new Map<string, InterpretedCalendarEvent>();

beforeAll(async () => {
  raw = parseICalendar(FIXTURE, {
    sourceCalendar: 'gsmnc',
    fetchedAt: '2026-09-02T09:00:00.000Z',
  }).events;

  for (const event of raw) {
    interpreted.set(event.sourceUid!, await interpreter.interpret(event));
  }
});

function get(uid: string): InterpretedCalendarEvent {
  const value = interpreted.get(uid);
  if (!value) throw new Error(`no interpretation for ${uid}`);
  return value;
}

describe('schema conformance', () => {
  it('produces schema-valid output for every fixture event', () => {
    for (const [uid, value] of interpreted) {
      const result = interpretedCalendarEventSchema.safeParse(value);
      expect(result.success, `${uid}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });
});

describe('event type classification', () => {
  const cases: [string, string][] = [
    ['fixture-school-closure', 'school_closure'],
    ['fixture-early-finish-split', 'early_finish'],
    ['fixture-holiday-range', 'school_holiday'],
    ['fixture-swimming-r3', 'swimming'],
    ['fixture-sports-r56', 'sports'],
    ['fixture-choir-r3-r6', 'choir'],
    ['fixture-non-uniform', 'non_uniform_day'],
    ['fixture-parent-teacher-half-day', 'early_finish'],
    ['fixture-parents-association', 'parent_association'],
    ['fixture-ji-parent-meeting', 'parent_information_meeting'],
    ['fixture-r4-parent-meeting', 'parent_information_meeting'],
    ['fixture-bilingual-drama', 'performance'],
  ];

  it.each(cases)('classifies %s as %s', (uid, expected) => {
    expect(get(uid).eventType).toBe(expected);
  });

  it('prefers early_finish over school_closure for a half day', () => {
    // "Scoil dúnta níos luath" contains "closed", but it is a half day.
    expect(get('fixture-early-finish-split').eventType).toBe('early_finish');
  });
});

describe('affected classes', () => {
  it('reads a Junior Infants-only event', () => {
    expect(get('fixture-ji-short-day').appliesTo).toEqual(['junior_infants']);
  });

  it('reads a 3rd-class-only event', () => {
    expect(get('fixture-swimming-r3').appliesTo).toEqual(['class_3']);
  });

  it('reads a 5th and 6th class event', () => {
    expect(get('fixture-sports-r56').appliesTo).toEqual(['class_5', 'class_6']);
  });

  it('expands the R3-R6 choir range', () => {
    expect(get('fixture-choir-r3-r6').appliesTo).toEqual([
      'class_3',
      'class_4',
      'class_5',
      'class_6',
    ]);
  });

  it('collapses an all-classes early finish to the individual classes it names', () => {
    const event = get('fixture-early-finish-split');
    expect(event.appliesTo).toEqual([
      'junior_infants',
      'senior_infants',
      'class_1',
      'class_2',
      'class_3',
      'class_4',
      'class_5',
      'class_6',
    ]);
  });

  it('defaults an unnamed closure to the whole school', () => {
    expect(get('fixture-school-closure').appliesTo).toEqual(['whole_school']);
  });

  it('defaults an unnamed non-uniform day to the whole school', () => {
    expect(get('fixture-non-uniform').appliesTo).toEqual(['whole_school']);
  });
});

describe('class-specific times', () => {
  it('gives infants and 1st-6th their own finish times', () => {
    const details = get('fixture-early-finish-split').classDetails;
    const byClass = Object.fromEntries(details.map((d) => [d.schoolClass, d.finishTime]));
    expect(byClass.junior_infants).toBe('12:50');
    expect(byClass.senior_infants).toBe('12:50');
    expect(byClass.class_1).toBe('13:00');
    expect(byClass.class_6).toBe('13:00');
  });

  it('reads the parent-teacher half day times', () => {
    const details = get('fixture-parent-teacher-half-day').classDetails;
    const byClass = Object.fromEntries(details.map((d) => [d.schoolClass, d.finishTime]));
    expect(byClass.junior_infants).toBe('12:20');
    expect(byClass.class_3).toBe('12:30');
  });

  it('reads a start and finish range for a single class', () => {
    const detail = get('fixture-ji-short-day').classDetails[0]!;
    expect(detail.schoolClass).toBe('junior_infants');
    expect(detail.startTime).toBe('09:00');
    expect(detail.finishTime).toBe('12:45');
  });

  it('promotes an afternoon finish time that crosses noon', () => {
    const detail = get('fixture-ji-full-day').classDetails[0]!;
    expect(detail.startTime).toBe('09:00');
    expect(detail.finishTime).toBe('13:40');
  });

  it('leaves classDetails empty when no time is stated', () => {
    expect(get('fixture-school-closure').classDetails).toEqual([]);
  });
});

describe('event-level times', () => {
  it('promotes a single shared time to event level', () => {
    const event = get('fixture-swimming-r3');
    expect(event.startTime).toBe('09:15');
  });

  it('does not promote times when classes differ', () => {
    const event = get('fixture-early-finish-split');
    expect(event.startTime).toBeUndefined();
    expect(event.endTime).toBeUndefined();
  });

  it('reads a meeting time range with no class-specific breakdown', () => {
    const event = get('fixture-parents-association');
    expect(event.startTime).toBe('19:30');
  });
});

describe('parent action', () => {
  it('requires action for a closure', () => {
    const event = get('fixture-school-closure');
    expect(event.parentActionRequired).toBe(true);
    expect(event.parentAction).toMatch(/childcare/i);
  });

  it('requires action for an early finish', () => {
    const event = get('fixture-early-finish-split');
    expect(event.parentActionRequired).toBe(true);
    expect(event.parentAction).toMatch(/earlier collection/i);
  });

  it('does not require action for routine training', () => {
    expect(get('fixture-sports-r56').parentActionRequired).toBe(false);
  });
});

describe('summaries and titles', () => {
  it('writes a parent-friendly early finish summary naming both times', () => {
    const event = get('fixture-early-finish-split');
    expect(event.title).toBe('Early finish');
    expect(event.summary).toContain('12:50');
    expect(event.summary).toContain('13:00');
    expect(event.summary).toMatch(/staff meeting/i);
  });

  it('names the class in the title for class activities', () => {
    expect(get('fixture-swimming-r3').title).toBe('Swimming — 3rd Class');
  });

  it('does not name classes in a whole-school title', () => {
    expect(get('fixture-school-closure').title).toBe('School closed');
  });

  it('never repeats the raw bilingual wording as the title', () => {
    for (const [uid, value] of interpreted) {
      const rawEvent = raw.find((e) => e.sourceUid === uid)!;
      expect(value.title).not.toBe(rawEvent.title);
    }
  });
});

describe('tags and ambiguity', () => {
  it('tags a staff meeting', () => {
    expect(get('fixture-early-finish-split').tags).toContain('staff_meeting');
  });

  it('tags a bus departure', () => {
    expect(get('fixture-swimming-r3').tags).toContain('bus');
  });

  it('flags a TBA event as ambiguous with lower confidence', () => {
    const event = get('fixture-ambiguous');
    expect(event.ambiguous).toBe(true);
    expect(event.confidence).toBeLessThan(0.85);
  });

  it('is confident about a plain closure', () => {
    expect(get('fixture-school-closure').confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe('interpreter contract', () => {
  it('exposes a stable id', () => {
    expect(interpreter.id).toBe('heuristic-v1');
  });

  it('never receives or returns family data', () => {
    for (const value of interpreted.values()) {
      expect(JSON.stringify(value)).not.toMatch(/aoife|jack/i);
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { stableHash } from '@/ical/hash';
import { parseICalendar } from '@/ical/parser';

const FIXTURE = readFileSync(new URL('../fixtures/gsmnc-sample.ics', import.meta.url), 'utf8');

const OPTIONS = { sourceCalendar: 'gsmnc', fetchedAt: '2026-09-02T09:00:00.000Z' };

function parse(source = FIXTURE) {
  return parseICalendar(source, OPTIONS);
}

describe('parseICalendar', () => {
  it('parses every fixture event', () => {
    const { events, skipped } = parse();
    expect(skipped).toEqual([]);
    expect(events).toHaveLength(16);
  });

  it('preserves source UID, title, location and all-day status', () => {
    const { events } = parse();
    const closure = events.find((e) => e.sourceUid === 'fixture-school-closure');
    expect(closure).toBeDefined();
    expect(closure!.title).toBe('Scoil Dúnta - Lá saoire School Closure');
    expect(closure!.allDay).toBe(true);
    expect(closure!.start).toBe('2026-09-28T00:00:00.000Z');
    expect(closure!.sourceCalendar).toBe('gsmnc');
    expect(closure!.fetchedAt).toBe(OPTIONS.fetchedAt);
  });

  it('unfolds long summary lines back into one string', () => {
    const { events } = parse();
    const earlyFinish = events.find((e) => e.sourceUid === 'fixture-early-finish-split');
    expect(earlyFinish!.title).toContain('Naíonáin @12.50in');
    expect(earlyFinish!.title).toContain('R1 - R6 @1.00in');
  });

  it('keeps the source URL when present', () => {
    const { events } = parse();
    expect(events[0]!.sourceUrl).toContain('gsmnc.ie/calendar');
  });

  it('anchors all-day dates at UTC midnight so the calendar date never shifts', () => {
    const { events } = parse();
    for (const event of events.filter((e) => e.allDay)) {
      expect(event.start.endsWith('T00:00:00.000Z')).toBe(true);
    }
  });

  it('omits empty optional fields rather than storing empty strings', () => {
    const { events } = parse();
    const closure = events.find((e) => e.sourceUid === 'fixture-school-closure')!;
    expect(closure.description).toBeUndefined();
    expect(closure.location).toBeUndefined();
  });

  it('keeps a location when the feed provides one', () => {
    const { events } = parse();
    const meeting = events.find((e) => e.sourceUid === 'fixture-ji-parent-meeting')!;
    expect(meeting.location).toBe('Halla na Scoile');
  });
});

describe('payload hashing', () => {
  it('is stable across repeated parses of identical input', () => {
    const first = parse().events.map((e) => e.rawPayloadHash);
    const second = parse().events.map((e) => e.rawPayloadHash);
    expect(first).toEqual(second);
  });

  it('changes when a material field changes', () => {
    const changed = FIXTURE.replace('@12.50in', '@12.30in');
    const before = parse().events.find((e) => e.sourceUid === 'fixture-early-finish-split')!;
    const after = parse(changed).events.find((e) => e.sourceUid === 'fixture-early-finish-split')!;
    expect(after.rawPayloadHash).not.toBe(before.rawPayloadHash);
  });

  it('ignores key ordering', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });
});

describe('malformed input', () => {
  it('reports an unparseable calendar instead of throwing', () => {
    const result = parse('this is not a calendar');
    expect(result.events).toEqual([]);
    expect(result.skipped[0]!.reason).toBe('calendar_unparseable');
  });

  it('skips a VEVENT with no summary but keeps the rest', () => {
    const source = FIXTURE.replace(
      'SUMMARY:Scoil Dúnta - Lá saoire School Closure',
      'SUMMARY:',
    );
    const result = parseICalendar(source, OPTIONS);
    expect(result.events).toHaveLength(15);
    expect(result.skipped.map((s) => s.reason)).toContain('missing_summary');
  });

  it('skips a VEVENT with no start date but keeps the rest', () => {
    const source = FIXTURE.replace('DTSTART;VALUE=DATE:20260928\n', '');
    const result = parseICalendar(source, OPTIONS);
    expect(result.events.length).toBeLessThan(16);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('strips control characters from source text', () => {
    const source = FIXTURE.replace('School Closure', 'School Closure');
    const closure = parseICalendar(source, OPTIONS).events.find(
      (e) => e.sourceUid === 'fixture-school-closure',
    )!;
    expect(closure.title).not.toContain('');
    expect(closure.title).toContain('School Closure');
  });

  it('caps an oversized title', () => {
    const source = FIXTURE.replace('School Closure', 'x'.repeat(2000));
    const closure = parseICalendar(source, OPTIONS).events.find(
      (e) => e.sourceUid === 'fixture-school-closure',
    )!;
    expect(closure.title.length).toBeLessThanOrEqual(500);
  });

  it('returns an empty calendar rather than failing when there are no events', () => {
    const result = parse('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR');
    expect(result.events).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

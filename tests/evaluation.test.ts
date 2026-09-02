/**
 * Model / interpreter evaluation against a real feed snapshot.
 *
 * `fixtures/live-snapshot.ics` is a captured copy of the GSMNC feed. Running the
 * interpreter over it measures coverage on real wording rather than on fixtures
 * chosen to make the rules look good, and the thresholds below fail the build if
 * accuracy regresses.
 *
 * Run `npm run evaluate` to see the full report.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CONFIDENCE_REVIEW_THRESHOLD } from '@/config/school';
import { decodeCalendarBytes } from '@/classes/text';
import { parseICalendar } from '@/ical/parser';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { normalizeInterpretation } from '@/normalize/normalize';
import type { RawCalendarEvent } from '@/domain/types';

const SNAPSHOT = new URL('../fixtures/live-snapshot.ics', import.meta.url);

const source = decodeCalendarBytes(readFileSync(SNAPSHOT));
const parsed = parseICalendar(source, {
  sourceCalendar: 'gsmnc',
  fetchedAt: '2026-09-02T09:00:00.000Z',
});

const interpreter = new HeuristicCalendarEventInterpreter();

const results = await Promise.all(
  parsed.events.map(async (event: RawCalendarEvent) => ({
    event,
    interpreted: await interpreter.interpret(event),
  })),
);

describe('interpreter evaluation on the live feed snapshot', () => {
  it('parses the whole snapshot without skipping events', () => {
    expect(parsed.events.length).toBeGreaterThan(100);
    expect(parsed.skipped).toEqual([]);
  });

  it('produces schema-valid, persistable output for every event', () => {
    const failures: string[] = [];
    for (const { event, interpreted } of results) {
      const outcome = normalizeInterpretation(event, interpreted, { now: '2026-09-02T09:00:00.000Z' });
      if (!outcome.ok) failures.push(`${event.title.slice(0, 60)}: ${outcome.errors.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('classifies at least 90% of events as something other than "other"', () => {
    const classified = results.filter((r) => r.interpreted.eventType !== 'other');
    expect(classified.length / results.length).toBeGreaterThanOrEqual(0.9);
  });

  it('resolves affected classes for every event', () => {
    const unresolved = results.filter((r) => r.interpreted.appliesTo.includes('unknown'));
    expect(unresolved.map((r) => r.event.title)).toEqual([]);
  });

  it('holds no more than 15% of events for review', () => {
    const review = results.filter((r) => r.interpreted.confidence < CONFIDENCE_REVIEW_THRESHOLD);
    expect(review.length / results.length).toBeLessThanOrEqual(0.15);
  });

  it('finds every closure and early finish in the snapshot', () => {
    // Recall on attendance-changing events matters far more than precision:
    // missing a closure is the single worst failure this app can have.
    const critical = results.filter((r) =>
      ['school_closure', 'school_holiday', 'early_finish', 'late_start'].includes(
        r.interpreted.eventType,
      ),
    );
    expect(critical.length).toBeGreaterThanOrEqual(20);

    // Nothing whose wording clearly says the school is shut may be classified
    // as a routine activity.
    const missed = results.filter(
      (r) =>
        /scoil d|school clos|dúnta|leath lá|half day|níos luath/i.test(r.event.title) &&
        !['school_closure', 'school_holiday', 'early_finish', 'changed_hours'].includes(
          r.interpreted.eventType,
        ),
    );
    expect(missed.map((r) => r.event.title)).toEqual([]);
  });

  it('extracts a time wherever the source states one', () => {
    const statesTime = results.filter((r) => /\d[:.]\d\d/.test(r.event.title));
    const extracted = statesTime.filter(
      (r) =>
        r.interpreted.startTime !== undefined ||
        r.interpreted.endTime !== undefined ||
        r.interpreted.classDetails.length > 0,
    );
    expect(extracted.length / statesTime.length).toBeGreaterThanOrEqual(0.9);
  });

  it('reports the classification distribution', () => {
    const byType = new Map<string, number>();
    for (const { interpreted } of results) {
      byType.set(interpreted.eventType, (byType.get(interpreted.eventType) ?? 0) + 1);
    }
    const report = [...byType]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${String(count).padStart(4)}  ${type}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n${results.length} events\n${report}\n`);
    expect(byType.size).toBeGreaterThan(5);
  });
});

/**
 * Live-feed smoke test.
 *
 * Hits the school's real iCalendar feed, so it is deliberately kept out of the
 * default suite: it needs the network and it fails when the school's server is
 * down, neither of which should break CI. Run it with `npm run smoke` to check
 * the pipeline against what the school is actually publishing today.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getSyncStatus, queryEvents } from '@/db/repository';
import { createPgliteDatabase } from '@/db/pglite';
import { migrate } from '@/db/schema';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { syncCalendar } from '@/pipeline/sync';

describe('live GSMNC feed', () => {
  it('ingests, interprets and stores the real calendar', async () => {
    const db = await createPgliteDatabase();
    await migrate(db);

    const result = await syncCalendar({
      db,
      interpreter: new HeuristicCalendarEventInterpreter(),
    });

    const all = await queryEvents(db);
    const byType: Record<string, number> = {};
    for (const event of all) byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;

    const report = {
      sync: result,
      status: await getSyncStatus(db),
      totalEvents: all.length,
      byType,
      needsReview: all.filter((e) => e.needsReview).length,
      unresolvedClasses: all.filter((e) => e.appliesTo.length === 0).length,
      juniorInfantsSees: (await queryEvents(db, { classes: ['junior_infants'] })).length,
      sample: all.slice(0, 5).map((e) => ({
        date: e.date,
        title: e.title,
        type: e.eventType,
        importance: e.importance,
      })),
    };

    writeFileSync('smoke-report.json', JSON.stringify(report, null, 2));

    // The feed is live, so assert on invariants rather than exact counts.
    expect(result.fetched).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(0);
    expect(byType.other ?? 0).toBe(0);
    expect(report.unresolvedClasses).toBe(0);

    await db.close();
  }, 180000);
});

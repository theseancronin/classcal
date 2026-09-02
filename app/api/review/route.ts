/**
 * The developer review queue (spec 27).
 *
 * Two populations matter here: events the pipeline could not interpret at all,
 * and events it interpreted with low confidence. The first are bugs; the second
 * are the calibration signal for whether the confidence threshold is right.
 *
 * Guarded by CRON_SECRET where one is set, since it exposes raw feed content
 * and processing errors rather than the parent-facing view.
 */
import { NextResponse } from 'next/server';

import { getDatabase } from '@/db/connection';
import { getEventsNeedingAttention, queryEvents } from '@/db/repository';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const secret = env().CRON_SECRET;
  if (secret) {
    const url = new URL(request.url);
    const provided =
      request.headers.get('authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('key');
    if (provided !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = await getDatabase();
  const [failed, lowConfidence] = await Promise.all([
    getEventsNeedingAttention(db),
    queryEvents(db, { needsReview: true, limit: 200 }),
  ]);

  return NextResponse.json({ failed, lowConfidence });
}

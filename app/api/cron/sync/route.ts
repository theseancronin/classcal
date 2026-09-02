/**
 * Scheduled calendar sync.
 *
 * The school's feed sends no CORS headers, so it can only be fetched
 * server-side. Running it here once on a schedule — rather than on every
 * parent's device — also means the feed is fetched once per interval no matter
 * how many families are using the app, and one interpretation is shared by all
 * of them.
 */
import { NextResponse } from 'next/server';

import { getDatabase } from '@/db/connection';
import { createInterpreter } from '@/interpreter/factory';
import { syncCalendar } from '@/pipeline/sync';
import { env, interpreterSettings } from '@/server/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = env().CRON_SECRET;
  if (secret) {
    const authorization = request.headers.get('authorization');
    if (authorization !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const db = await getDatabase();
    const result = await syncCalendar({
      db,
      interpreter: createInterpreter(interpreterSettings()),
    });
    return NextResponse.json(result);
  } catch (error) {
    // A failed sync must not look like a successful one: the client uses the
    // stored last-success timestamp to decide whether to warn about staleness.
    const message = error instanceof Error ? error.message : 'sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

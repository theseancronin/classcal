/**
 * The read endpoint the app runs on.
 *
 * Query parameters are validated before they reach the repository: everything
 * here arrives from the browser and is untrusted. Unknown values are rejected
 * rather than coerced, so a malformed class name cannot widen a query.
 *
 * The family's class selection is sent per request rather than stored on the
 * server. There are no accounts, so the server never learns which household is
 * asking — only which classes are being asked about.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDatabase } from '@/db/connection';
import { getSyncStatus, queryEvents } from '@/db/repository';
import { eventTypeSchema, importanceSchema, schoolClassSchema } from '@/domain/schemas';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  classes: z.array(schoolClassSchema).optional(),
  eventTypes: z.array(eventTypeSchema).optional(),
  importance: z.array(importanceSchema).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Repeated or comma-separated values both work: ?classes=a&classes=b or ?classes=a,b */
function list(params: URLSearchParams, key: string): string[] | undefined {
  const values = params.getAll(key).flatMap((value) => value.split(','));
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;

  const parsed = querySchema.safeParse({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    classes: list(params, 'classes'),
    eventTypes: list(params, 'eventTypes'),
    importance: list(params, 'importance'),
    search: params.get('search') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = await getDatabase();
  const [events, status] = await Promise.all([
    queryEvents(db, parsed.data),
    getSyncStatus(db),
  ]);

  return NextResponse.json(
    { events, status },
    // Events change rarely. A short shared cache absorbs the morning rush
    // without letting a closure sit stale for long.
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}

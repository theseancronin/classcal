/**
 * Recording a push subscription.
 *
 * The body arrives from the browser and is untrusted, so it is validated
 * before it reaches the database. Only what is needed to deliver a reminder is
 * stored: the push endpoint, its two keys, the classes to filter by, and the
 * categories the parent wants. No names, no child data, nothing identifying the
 * household beyond the opaque endpoint the browser itself issued.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDatabase } from '@/db/connection';
import { toSqlJson } from '@/db/port';
import { notificationPreferencesSchema, schoolClassSchema } from '@/domain/schemas';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
      p256dh: z.string().min(1).max(500),
      auth: z.string().min(1).max(500),
    }),
  }),
  classes: z.array(schoolClassSchema).max(16),
  preferences: notificationPreferencesSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid subscription', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { subscription, classes, preferences } = parsed.data;
  const now = new Date().toISOString();
  const db = await getDatabase();

  // Re-subscribing from the same browser updates the existing row rather than
  // creating a duplicate, and clears any earlier delivery failure.
  await db.run(
    `INSERT INTO push_subscriptions
       (endpoint, p256dh, auth, classes, preferences, created_at, updated_at, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh      = excluded.p256dh,
       auth        = excluded.auth,
       classes     = excluded.classes,
       preferences = excluded.preferences,
       updated_at  = excluded.updated_at,
       failed_at   = NULL`,
    [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      toSqlJson(classes),
      toSqlJson(preferences),
      now,
      now,
    ],
  );

  return NextResponse.json({ ok: true });
}

/** Turning reminders off removes the subscription entirely. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const endpoint = new URL(request.url).searchParams.get('endpoint');
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }

  const db = await getDatabase();
  await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  return NextResponse.json({ ok: true });
}

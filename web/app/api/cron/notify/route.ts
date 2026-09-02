/**
 * Sending due reminders.
 *
 * Run on a schedule, more often than reminders are granular — every 15 minutes
 * is ample. Which reminders are due is decided by `notifications/dispatch.ts`;
 * this route is only the Web Push call and the bookkeeping around it.
 */
import { NextResponse } from 'next/server';
import webpush from 'web-push';

import { getDatabase } from '@/db/connection';
import { markSent, markSubscriptionFailed, pendingPushes } from '@/notifications/dispatch';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const config = env();

  if (config.CRON_SECRET) {
    if (request.headers.get('authorization') !== `Bearer ${config.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'push is not configured' }, { status: 503 });
  }

  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  );

  const db = await getDatabase();
  const pending = await pendingPushes(db);

  let sent = 0;
  let retired = 0;
  let failed = 0;

  for (const { target, notification } of pending) {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify({
          title: notification.title,
          body: notification.body,
          // Lets a repeat reminder for the same event replace the earlier one
          // in the tray rather than stacking.
          tag: notification.eventId,
          url: `/event/${encodeURIComponent(notification.eventId)}`,
        }),
      );
      await markSent(db, target.endpoint, notification.idempotencyKey);
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser has thrown the subscription away — uninstalled, or the
        // parent cleared site data. Stop trying.
        await markSubscriptionFailed(db, target.endpoint);
        retired += 1;
      } else {
        // A transient failure. Leave it unrecorded so the next run retries it.
        failed += 1;
      }
    }
  }

  return NextResponse.json({ due: pending.length, sent, retired, failed });
}

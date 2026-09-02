/**
 * Notification delivery.
 *
 * The thin platform adapter. Every decision about which reminders should exist
 * is made by `schedule.ts` and `reconcile.ts`; this module only talks to
 * expo-notifications.
 */
import * as Notifications from 'expo-notifications';

import type { SqlDatabase } from '@/db/port';
import type { NotificationPreferences, SchoolClass } from '@/domain/types';
import { commitPlan, planNotifications } from './reconcile';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export type SyncNotificationsOptions = {
  db: SqlDatabase;
  preferences: NotificationPreferences;
  selectedClasses: readonly SchoolClass[];
  now?: Date;
};

/**
 * Bring the device's scheduled reminders in line with the current events and
 * preferences: schedule what is missing, cancel what is obsolete, leave the rest
 * untouched so a reminder is never scheduled twice.
 */
export async function syncNotifications(
  options: SyncNotificationsOptions,
): Promise<{ scheduled: number; cancelled: number }> {
  const plan = await planNotifications(options);

  for (const platformId of plan.platformIdsToCancel) {
    await Notifications.cancelScheduledNotificationAsync(platformId).catch(() => {
      // Already fired or already cancelled; the record is removed regardless.
    });
  }

  const platformIds = new Map<string, string>();
  for (const notification of plan.toSchedule) {
    const platformId = await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: { eventId: notification.eventId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(notification.scheduledAt),
      },
    });
    platformIds.set(notification.idempotencyKey, platformId);
  }

  return commitPlan(options.db, plan, platformIds);
}

/**
 * Reconciling scheduled reminders against the database.
 *
 * Decides what should be scheduled and what should be cancelled, and records the
 * outcome. Contains no platform code, so the reconciliation rules are tested
 * against a real database rather than mocked.
 *
 * `delivery.ts` is the thin adapter that turns these decisions into actual
 * platform notifications.
 */
import type { SqlDatabase } from '@/db/port';
import {
  deleteScheduledNotifications,
  getPlatformIds,
  getScheduledKeys,
  queryEvents,
  saveScheduledNotification,
} from '@/db/repository';
import type {
  NotificationPreferences,
  ScheduledNotification,
  SchoolClass,
} from '@/domain/types';
import { toDateKey } from '@/relevance/grouping';
import { reconcileAll } from './schedule';

export type ReconcilePlan = {
  toSchedule: ScheduledNotification[];
  /** Idempotency keys to remove. */
  toCancel: string[];
  /** Platform notification ids matching `toCancel`, for the adapter to cancel. */
  platformIdsToCancel: string[];
};

export type PlanOptions = {
  db: SqlDatabase;
  preferences: NotificationPreferences;
  selectedClasses: readonly SchoolClass[];
  now?: Date;
};

/** Work out which reminders should be added and which removed. */
export async function planNotifications(options: PlanOptions): Promise<ReconcilePlan> {
  const { db, preferences, selectedClasses } = options;
  const now = options.now ?? new Date();

  const events = await queryEvents(db, {
    from: toDateKey(now),
    ...(selectedClasses.length > 0 ? { classes: selectedClasses } : {}),
  });

  const existingKeys = await getScheduledKeys(db);
  const { toSchedule, toCancel } = reconcileAll(events, preferences, existingKeys, {
    now: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset(),
    selectedClasses,
  });

  return {
    toSchedule,
    toCancel,
    platformIdsToCancel: await getPlatformIds(db, toCancel),
  };
}

/** Record the plan once the adapter has applied it. */
export async function commitPlan(
  db: SqlDatabase,
  plan: ReconcilePlan,
  platformIds: Map<string, string> = new Map(),
): Promise<{ scheduled: number; cancelled: number }> {
  if (plan.toCancel.length > 0) {
    await deleteScheduledNotifications(db, plan.toCancel);
  }
  for (const notification of plan.toSchedule) {
    await saveScheduledNotification(
      db,
      notification,
      platformIds.get(notification.idempotencyKey),
    );
  }
  return { scheduled: plan.toSchedule.length, cancelled: plan.toCancel.length };
}

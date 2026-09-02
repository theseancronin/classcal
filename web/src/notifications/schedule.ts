/**
 * Notification scheduling.
 *
 * Pure functions: given an event, the parent's preferences and the current time,
 * produce the exact set of reminders that should exist. Nothing here touches the
 * platform notification APIs -- delivery is a thin adapter over this output, so
 * the interesting logic is fully testable.
 */
import { describeClassTimes, formatClassList } from '@/domain/labels';
import {
  type Importance,
  type NormalizedSchoolEvent,
  type NotificationPreferences,
  type ReminderType,
  type ScheduledNotification,
  type SchoolClass,
} from '@/domain/types';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  schoolClosure: true,
  earlyFinish: true,
  parentMeetings: true,
  classImportant: true,
  generalActivities: false,
  reminderTypes: {
    seven_days_before: true,
    one_day_before: true,
    morning_of: true,
  },
};

/** The reminder ladder for each importance level (spec 19.2). */
const REMINDERS_BY_IMPORTANCE: Record<Importance, readonly ReminderType[]> = {
  critical: ['seven_days_before', 'one_day_before', 'morning_of'],
  high: ['seven_days_before', 'one_day_before'],
  normal: ['one_day_before'],
  low: [],
};

/** Local time at which a "morning of" reminder fires. */
const MORNING_OF_HOUR = 7;

/** Local time at which the advance reminders fire. */
const ADVANCE_REMINDER_HOUR = 18;

/**
 * Whether the parent's category preferences allow any reminder for this event.
 * A `normal` event only notifies when the parent opted into general activities.
 */
export function isNotifiable(
  event: Pick<NormalizedSchoolEvent, 'eventType' | 'importance' | 'needsReview'>,
  preferences: NotificationPreferences,
): boolean {
  // A low-confidence interpretation must not drive a high-impact alert.
  if (event.needsReview && event.importance === 'critical') return false;

  switch (event.eventType) {
    case 'school_closure':
    case 'school_holiday':
      return preferences.schoolClosure;
    case 'early_finish':
    case 'late_start':
    case 'changed_hours':
      return preferences.earlyFinish;
    case 'parent_teacher_meeting':
    case 'parent_information_meeting':
    case 'parent_association':
      return preferences.parentMeetings;
    case 'deadline':
    case 'trip':
      return preferences.classImportant;
    default:
      return preferences.generalActivities;
  }
}

function reminderInstant(
  date: string,
  reminderType: ReminderType,
  utcOffsetMinutes: number,
): string {
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  const offsetMs = utcOffsetMinutes * 60_000;

  switch (reminderType) {
    case 'seven_days_before':
      return new Date(midnightUtc - 7 * 86_400_000 + ADVANCE_REMINDER_HOUR * 3_600_000 - offsetMs).toISOString();
    case 'one_day_before':
      return new Date(midnightUtc - 86_400_000 + ADVANCE_REMINDER_HOUR * 3_600_000 - offsetMs).toISOString();
    case 'morning_of':
      return new Date(midnightUtc + MORNING_OF_HOUR * 3_600_000 - offsetMs).toISOString();
  }
}

/** `eventId + reminderType + scheduledAt` -- the spec's idempotency key. */
export function idempotencyKey(
  eventId: string,
  reminderType: ReminderType,
  scheduledAt: string,
): string {
  return `${eventId}:${reminderType}:${scheduledAt}`;
}

export type ScheduleOptions = {
  /** ISO instant. Reminders already in the past are not scheduled. */
  now: string;
  /** Minutes east of UTC for the school's timezone. Europe/Dublin is 0 or 60. */
  utcOffsetMinutes?: number;
  /** Classes the family selected, used to word the reminder for this household. */
  selectedClasses?: readonly SchoolClass[];
};

/**
 * The reminders that should exist for one event.
 *
 * Deterministic: calling this repeatedly for an unchanged event produces
 * identical idempotency keys, so re-running a sync never duplicates a reminder.
 */
export function scheduleFor(
  event: NormalizedSchoolEvent,
  preferences: NotificationPreferences,
  options: ScheduleOptions,
): ScheduledNotification[] {
  if (!isNotifiable(event, preferences)) return [];

  const nowMs = Date.parse(options.now);
  const offset = options.utcOffsetMinutes ?? 0;
  const wanted = REMINDERS_BY_IMPORTANCE[event.importance];

  const notifications: ScheduledNotification[] = [];

  for (const reminderType of wanted) {
    if (!preferences.reminderTypes[reminderType]) continue;

    const scheduledAt = reminderInstant(event.date, reminderType, offset);
    if (Date.parse(scheduledAt) <= nowMs) continue;

    notifications.push({
      idempotencyKey: idempotencyKey(event.id, reminderType, scheduledAt),
      eventId: event.id,
      reminderType,
      scheduledAt,
      title: notificationTitle(event, reminderType),
      body: notificationBody(event, options.selectedClasses),
    });
  }

  return notifications;
}

/**
 * Reconcile the reminders that should exist against those already scheduled.
 *
 * Anything whose key no longer appears is obsolete -- because the event moved,
 * was downgraded, or the parent changed a preference -- and must be cancelled.
 */
export function reconcileSchedules(
  desired: readonly ScheduledNotification[],
  existingKeys: readonly string[],
): { toSchedule: ScheduledNotification[]; toCancel: string[] } {
  const desiredKeys = new Set(desired.map((n) => n.idempotencyKey));
  const existing = new Set(existingKeys);

  return {
    toSchedule: desired.filter((n) => !existing.has(n.idempotencyKey)),
    toCancel: existingKeys.filter((key) => !desiredKeys.has(key)),
  };
}

/**
 * Reconcile every reminder for a whole family in one pass. Reminders belonging
 * to events that no longer exist are cancelled too.
 */
export function reconcileAll(
  events: readonly NormalizedSchoolEvent[],
  preferences: NotificationPreferences,
  existingKeys: readonly string[],
  options: ScheduleOptions,
): { toSchedule: ScheduledNotification[]; toCancel: string[] } {
  const desired = events.flatMap((event) => scheduleFor(event, preferences, options));
  return reconcileSchedules(desired, existingKeys);
}

function notificationTitle(event: NormalizedSchoolEvent, reminderType: ReminderType): string {
  const when =
    reminderType === 'morning_of'
      ? 'today'
      : reminderType === 'one_day_before'
        ? 'tomorrow'
        : 'next week';

  switch (event.eventType) {
    case 'school_closure':
      return `School closed ${when}`;
    case 'school_holiday':
      return `School holidays start ${when}`;
    case 'early_finish':
      return `Early collection ${when}`;
    case 'late_start':
      return `Late start ${when}`;
    case 'changed_hours':
      return `School hours changed ${when}`;
    case 'parent_teacher_meeting':
    case 'parent_information_meeting':
      return `Parent meeting ${when}`;
    default:
      return `${event.title} ${when}`;
  }
}

function notificationBody(
  event: NormalizedSchoolEvent,
  selectedClasses: readonly SchoolClass[] = [],
): string {
  const relevantDetails = event.classDetails.filter(
    (detail) => selectedClasses.length === 0 || selectedClasses.includes(detail.schoolClass),
  );

  const times = describeClassTimes(relevantDetails, 'finish');
  if (times) return times;

  if (event.startTime) {
    return `${formatClassList(event.appliesTo)} · ${event.startTime}. ${event.summary}`;
  }
  return event.summary;
}

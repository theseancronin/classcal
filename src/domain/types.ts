/**
 * ClassCal domain types.
 *
 * These are the canonical vocabulary of the application. String literals for
 * classes, event types and importance levels must never be written inline
 * elsewhere in the codebase -- import from here.
 */

export const SCHOOL_CLASSES = [
  'junior_infants',
  'senior_infants',
  'class_1',
  'class_2',
  'class_3',
  'class_4',
  'class_5',
  'class_6',
  'whole_school',
  'parents',
  'unknown',
] as const;

export type SchoolClass = (typeof SCHOOL_CLASSES)[number];

/** The classes a parent may actually select for a child. */
export const SELECTABLE_CLASSES = [
  'junior_infants',
  'senior_infants',
  'class_1',
  'class_2',
  'class_3',
  'class_4',
  'class_5',
  'class_6',
] as const;

export type SelectableClass = (typeof SELECTABLE_CLASSES)[number];

export const CLASS_LABELS: Record<SchoolClass, string> = {
  junior_infants: 'Junior Infants',
  senior_infants: 'Senior Infants',
  class_1: '1st Class',
  class_2: '2nd Class',
  class_3: '3rd Class',
  class_4: '4th Class',
  class_5: '5th Class',
  class_6: '6th Class',
  whole_school: 'Whole school',
  parents: 'Parents',
  unknown: 'Unspecified',
};

export const EVENT_TYPES = [
  'school_closure',
  'school_holiday',
  'early_finish',
  'late_start',
  'changed_hours',
  'parent_teacher_meeting',
  'parent_information_meeting',
  'parent_association',
  'class_activity',
  'sports',
  'swimming',
  'choir',
  'performance',
  'school_event',
  'non_uniform_day',
  'trip',
  'deadline',
  'reminder',
  'other',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  school_closure: 'School closed',
  school_holiday: 'School holidays',
  early_finish: 'Early finish',
  late_start: 'Late start',
  changed_hours: 'Changed school hours',
  parent_teacher_meeting: 'Parent/teacher meeting',
  parent_information_meeting: 'Parent information meeting',
  parent_association: 'Parents association',
  class_activity: 'Class activity',
  sports: 'Sports',
  swimming: 'Swimming',
  choir: 'Choir',
  performance: 'Performance',
  school_event: 'School event',
  non_uniform_day: 'Non-uniform day',
  trip: 'Trip',
  deadline: 'Deadline',
  reminder: 'Reminder',
  other: 'Event',
};

export const IMPORTANCE_LEVELS = ['critical', 'high', 'normal', 'low'] as const;

export type Importance = (typeof IMPORTANCE_LEVELS)[number];

export const IMPORTANCE_RANK: Record<Importance, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Event types that always change whether or when a child attends school.
 * The interpreter is never permitted to downgrade these below `critical`.
 */
export const ATTENDANCE_CRITICAL_EVENT_TYPES: readonly EventType[] = [
  'school_closure',
  'early_finish',
  'late_start',
  'changed_hours',
];

/** A raw event exactly as it appeared in the source calendar. Immutable per version. */
export type RawCalendarEvent = {
  sourceId: string;
  sourceCalendar: string;
  sourceUid?: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO-8601 instant. */
  start: string;
  /** ISO-8601 instant. */
  end?: string;
  allDay: boolean;
  rawPayloadHash: string;
  /** ISO-8601 instant. */
  fetchedAt: string;
  sourceUrl?: string;
};

export type ClassSpecificDetail = {
  schoolClass: SchoolClass;
  /** `HH:mm`, 24 hour. */
  startTime?: string;
  /** `HH:mm`, 24 hour. */
  finishTime?: string;
  note?: string;
};

export type NormalizedSchoolEvent = {
  id: string;
  rawEventId: string;

  title: string;
  summary: string;

  /** `YYYY-MM-DD` in the school's local timezone. */
  date: string;
  /** Inclusive last day for multi-day events; equals `date` for single-day events. */
  endDate: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;

  eventType: EventType;
  importance: Importance;

  appliesTo: SchoolClass[];
  classDetails: ClassSpecificDetail[];

  parentActionRequired: boolean;
  parentAction?: string;

  location?: string;

  tags: string[];

  confidence: number;
  needsReview: boolean;

  originalTitle: string;
  originalDescription?: string;

  sourceUrl: string;

  createdAt: string;
  updatedAt: string;
};

/** The unvalidated shape an interpreter (heuristic or LLM) is asked to produce. */
export type InterpretedCalendarEvent = {
  title: string;
  summary: string;
  eventType: EventType;
  appliesTo: SchoolClass[];
  classDetails: ClassSpecificDetail[];
  parentActionRequired: boolean;
  parentAction?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  tags: string[];
  confidence: number;
  ambiguous: boolean;
};

export const MATERIAL_CHANGE_FIELDS = [
  'date',
  'endDate',
  'startTime',
  'endTime',
  'classDetails',
  'appliesTo',
  'eventType',
  'cancelled',
] as const;

export type MaterialChangeField = (typeof MATERIAL_CHANGE_FIELDS)[number];

export type FieldChange = {
  field: MaterialChangeField;
  /** Human-readable previous value, or null when the field was previously absent. */
  oldValue: string | null;
  newValue: string | null;
  /** Present when the change is scoped to a single class, e.g. a per-class finish time. */
  schoolClass?: SchoolClass;
};

export type EventChange = {
  id: string;
  eventId: string;
  detectedAt: string;
  changes: FieldChange[];
  /** Rendered sentence, e.g. "Junior Infants now finish at 12:30. Previously 13:00." */
  description: string;
  acknowledged: boolean;
};

export type Child = {
  id: string;
  /** Optional. When absent the class label is used instead. */
  name?: string;
  schoolClass: SelectableClass;
};

export type FamilySelection = {
  children: Child[];
  setupCompletedAt?: string;
};

export type ReminderType = 'seven_days_before' | 'one_day_before' | 'morning_of';

export type NotificationPreferences = {
  schoolClosure: boolean;
  earlyFinish: boolean;
  parentMeetings: boolean;
  classImportant: boolean;
  generalActivities: boolean;
  reminderTypes: Record<ReminderType, boolean>;
};

export type ScheduledNotification = {
  /** `eventId:reminderType:scheduledAt` -- guarantees at-most-once scheduling. */
  idempotencyKey: string;
  eventId: string;
  reminderType: ReminderType;
  /** ISO-8601 instant at which the reminder should fire. */
  scheduledAt: string;
  title: string;
  body: string;
};

export type ProcessingStatus =
  | 'pending'
  | 'interpreted'
  | 'validation_failed'
  | 'processing_failed';

export type SyncStatus = {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  eventsIngested: number;
  eventsChanged: number;
};

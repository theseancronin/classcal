/**
 * Runtime schemas for every value that crosses a trust boundary:
 * the calendar feed, the interpreter (including the LLM), and local storage.
 */
import { z } from 'zod';

import {
  EVENT_TYPES,
  IMPORTANCE_LEVELS,
  SCHOOL_CLASSES,
  SELECTABLE_CLASSES,
} from './types';

/** Hard caps so a hostile or malformed feed cannot exhaust memory or the UI. */
export const FIELD_LIMITS = {
  title: 500,
  description: 5000,
  location: 300,
  summary: 400,
  parentAction: 300,
  tag: 40,
  tags: 12,
  classDetails: 12,
  childName: 40,
  children: 12,
} as const;

export const schoolClassSchema = z.enum(SCHOOL_CLASSES);
export const selectableClassSchema = z.enum(SELECTABLE_CLASSES);
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const importanceSchema = z.enum(IMPORTANCE_LEVELS);

/** `HH:mm`, 24-hour. */
export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm 24-hour time');

/** `YYYY-MM-DD`. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD date');

export const isoInstantSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'expected an ISO-8601 instant');

export const classSpecificDetailSchema = z.object({
  schoolClass: schoolClassSchema,
  startTime: timeStringSchema.optional(),
  finishTime: timeStringSchema.optional(),
  note: z.string().max(FIELD_LIMITS.summary).optional(),
});

/**
 * Class identifiers as they arrive *from* an interpreter, before deterministic
 * canonicalisation. Kept as free text so that recoverable wording ("R4",
 * "4th class") can be rescued by `canonicalizeClasses` rather than failing the
 * whole event, per spec section 16. Anything unrecoverable is rejected there.
 */
const proposedClassSchema = z.string().min(1).max(60);

const proposedClassDetailSchema = z.object({
  schoolClass: proposedClassSchema,
  startTime: timeStringSchema.optional(),
  finishTime: timeStringSchema.optional(),
  note: z.string().max(FIELD_LIMITS.summary).optional(),
});

export const rawCalendarEventSchema = z.object({
  sourceId: z.string().min(1),
  sourceCalendar: z.string().min(1),
  sourceUid: z.string().min(1).optional(),
  title: z.string().max(FIELD_LIMITS.title),
  description: z.string().max(FIELD_LIMITS.description).optional(),
  location: z.string().max(FIELD_LIMITS.location).optional(),
  start: isoInstantSchema,
  end: isoInstantSchema.optional(),
  allDay: z.boolean(),
  rawPayloadHash: z.string().min(1),
  fetchedAt: isoInstantSchema,
  sourceUrl: z.string().optional(),
});

/**
 * The contract every interpreter must satisfy.
 *
 * Strict where a mistake is unrecoverable -- an invented `eventType` or an
 * out-of-range confidence fails outright -- and lenient only on class
 * identifiers, which the deterministic layer immediately re-canonicalises.
 * Unknown keys are stripped, so a model cannot smuggle extra fields through.
 */
export const interpretedCalendarEventSchema = z.object({
  title: z.string().min(1).max(FIELD_LIMITS.title),
  summary: z.string().max(FIELD_LIMITS.summary),
  eventType: eventTypeSchema,
  appliesTo: z.array(proposedClassSchema).min(1),
  classDetails: z.array(proposedClassDetailSchema).max(FIELD_LIMITS.classDetails),
  parentActionRequired: z.boolean(),
  parentAction: z.string().max(FIELD_LIMITS.parentAction).optional(),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  location: z.string().max(FIELD_LIMITS.location).optional(),
  tags: z.array(z.string().max(FIELD_LIMITS.tag)).max(FIELD_LIMITS.tags),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
});

export const normalizedSchoolEventSchema = z.object({
  id: z.string().min(1),
  rawEventId: z.string().min(1),
  title: z.string().min(1).max(FIELD_LIMITS.title),
  summary: z.string().max(FIELD_LIMITS.summary),
  date: dateStringSchema,
  endDate: dateStringSchema,
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  allDay: z.boolean(),
  eventType: eventTypeSchema,
  importance: importanceSchema,
  appliesTo: z.array(schoolClassSchema).min(1),
  classDetails: z.array(classSpecificDetailSchema),
  parentActionRequired: z.boolean(),
  parentAction: z.string().max(FIELD_LIMITS.parentAction).optional(),
  location: z.string().max(FIELD_LIMITS.location).optional(),
  tags: z.array(z.string().max(FIELD_LIMITS.tag)),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  originalTitle: z.string().max(FIELD_LIMITS.title),
  originalDescription: z.string().max(FIELD_LIMITS.description).optional(),
  sourceUrl: z.string(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export const childSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(FIELD_LIMITS.childName).optional(),
  schoolClass: selectableClassSchema,
});

export const familySelectionSchema = z.object({
  children: z.array(childSchema).max(FIELD_LIMITS.children),
  setupCompletedAt: isoInstantSchema.optional(),
});

export const reminderTypeSchema = z.enum([
  'seven_days_before',
  'one_day_before',
  'morning_of',
]);

export const notificationPreferencesSchema = z.object({
  schoolClosure: z.boolean(),
  earlyFinish: z.boolean(),
  parentMeetings: z.boolean(),
  classImportant: z.boolean(),
  generalActivities: z.boolean(),
  reminderTypes: z.object({
    seven_days_before: z.boolean(),
    one_day_before: z.boolean(),
    morning_of: z.boolean(),
  }),
});

export type InterpretedCalendarEventInput = z.input<typeof interpretedCalendarEventSchema>;

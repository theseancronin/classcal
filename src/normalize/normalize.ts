/**
 * The deterministic post-processing layer.
 *
 * Every interpretation -- heuristic or model-generated -- passes through here
 * before it can be stored. Responsibilities, in order:
 *
 *   1. validate the interpreter's output against the runtime schema;
 *   2. re-canonicalise and deduplicate class identifiers;
 *   3. normalize times;
 *   4. apply deterministic importance and parent-action rules;
 *   5. run semantic sanity checks;
 *   6. mark low-confidence or ambiguous output for review;
 *   7. emit a fully-formed NormalizedSchoolEvent, or a list of errors.
 *
 * Nothing that fails validation reaches storage.
 */
import { canonicalizeClasses, collapseClassList, sortClasses } from '@/classes/classAliases';
import { normalizeTime } from '@/classes/timeParsing';
import { CONFIDENCE_REVIEW_THRESHOLD, DEFAULT_SCHOOL } from '@/config/school';
import {
  interpretedCalendarEventSchema,
  normalizedSchoolEventSchema,
} from '@/domain/schemas';
import type {
  ClassSpecificDetail,
  NormalizedSchoolEvent,
  RawCalendarEvent,
  SchoolClass,
} from '@/domain/types';
import { importanceFor, isAttendanceCritical, parentActionRequiredFor } from './importance';

export type NormalizeOptions = {
  /** ISO instant used for createdAt/updatedAt. Injected so tests are stable. */
  now: string;
  /** Preserved across reprocessing so an event keeps its identity. */
  id?: string;
  createdAt?: string;
  sourceUrl?: string;
  confidenceThreshold?: number;
};

export type NormalizeResult =
  | { ok: true; event: NormalizedSchoolEvent; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Derive the calendar date(s) an event covers.
 *
 * All-day iCalendar events use an exclusive DTEND, so a one-day event ending
 * the next morning must not be reported as two days long.
 */
export function deriveDates(event: RawCalendarEvent): { date: string; endDate: string } {
  const date = event.start.slice(0, 10);
  if (!event.end) return { date, endDate: date };

  const endMs = Date.parse(event.end);
  const startMs = Date.parse(event.start);
  if (Number.isNaN(endMs) || endMs <= startMs) return { date, endDate: date };

  const exclusiveShift = event.allDay ? 86_400_000 : 0;
  const inclusiveEnd = new Date(endMs - exclusiveShift);
  const endDate = inclusiveEnd.toISOString().slice(0, 10);
  return { date, endDate: endDate < date ? date : endDate };
}

/** A class detail as proposed by an interpreter, before canonicalisation. */
type ProposedClassDetail = {
  schoolClass: string;
  startTime?: string;
  finishTime?: string;
  note?: string;
};

/** Deduplicate per-class details, keeping the first stated time for each class. */
function normalizeClassDetails(
  details: readonly ProposedClassDetail[],
  warnings: string[],
): ClassSpecificDetail[] {
  const byClass = new Map<SchoolClass, ClassSpecificDetail>();

  for (const detail of details) {
    const { classes } = canonicalizeClasses([detail.schoolClass]);
    const schoolClass = classes[0];
    if (!schoolClass) {
      warnings.push(`dropped class detail for unrecognised class "${String(detail.schoolClass)}"`);
      continue;
    }

    const startTime = detail.startTime ? normalizeTime(detail.startTime) : null;
    const finishTime = detail.finishTime ? normalizeTime(detail.finishTime) : null;
    if (detail.startTime && !startTime) warnings.push(`dropped unreadable start time "${detail.startTime}"`);
    if (detail.finishTime && !finishTime) warnings.push(`dropped unreadable finish time "${detail.finishTime}"`);

    if (!startTime && !finishTime && !detail.note) continue;

    const existing = byClass.get(schoolClass);
    if (existing) continue;

    byClass.set(schoolClass, {
      schoolClass,
      ...(startTime ? { startTime } : {}),
      ...(finishTime ? { finishTime } : {}),
      ...(detail.note ? { note: detail.note } : {}),
    });
  }

  return sortClasses([...byClass.keys()]).map((c) => byClass.get(c)!);
}

export function normalizeInterpretation(
  raw: RawCalendarEvent,
  interpretation: unknown,
  options: NormalizeOptions,
): NormalizeResult {
  const warnings: string[] = [];

  // --- 1. Runtime validation of the interpreter's output -------------------
  const parsed = interpretedCalendarEventSchema.safeParse(interpretation);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const value = parsed.data;

  // --- 2. Classes ---------------------------------------------------------
  const canonical = canonicalizeClasses(value.appliesTo);
  for (const rejected of canonical.rejected) {
    warnings.push(`rejected unrecognised class "${String(rejected)}"`);
  }
  if (canonical.classes.length === 0) {
    // Nothing in the proposed list mapped to a real class. Reprocessing this
    // through the review queue is far safer than storing an event nobody sees.
    return {
      ok: false,
      errors: [`appliesTo: no recognisable class in [${value.appliesTo.join(', ')}]`],
    };
  }
  const appliesTo = collapseClassList(canonical.classes);

  // --- 3. Times -----------------------------------------------------------
  const classDetails = normalizeClassDetails(value.classDetails, warnings);
  const startTime = value.startTime ? normalizeTime(value.startTime) : null;
  const endTime = value.endTime ? normalizeTime(value.endTime) : null;
  if (value.startTime && !startTime) warnings.push(`dropped unreadable start time "${value.startTime}"`);
  if (value.endTime && !endTime) warnings.push(`dropped unreadable end time "${value.endTime}"`);

  // --- 4. Deterministic importance and action -----------------------------
  const eventType = value.eventType;
  const importance = importanceFor(eventType);
  const parentActionRequired = parentActionRequiredFor(eventType, value.parentActionRequired);

  // --- 5. Semantic sanity checks ------------------------------------------
  let needsReview = value.ambiguous || value.confidence < (options.confidenceThreshold ?? CONFIDENCE_REVIEW_THRESHOLD);

  if (classDetails.length > 0) {
    const detailClasses = new Set(classDetails.map((d) => d.schoolClass));
    const covered = appliesTo.includes('whole_school')
      ? true
      : [...detailClasses].every((c) => appliesTo.includes(c));
    if (!covered) {
      // A per-class time for a class the event does not apply to means the
      // interpretation is internally inconsistent.
      warnings.push('class-specific times name a class the event does not apply to');
      needsReview = true;
    }
  }

  if (isAttendanceCritical(eventType) && appliesTo.includes('unknown')) {
    warnings.push('attendance-changing event with unresolved classes');
    needsReview = true;
  }

  for (const detail of classDetails) {
    if (detail.startTime && detail.finishTime && detail.startTime >= detail.finishTime) {
      warnings.push(`${detail.schoolClass} finishes before it starts`);
      needsReview = true;
    }
  }

  if (startTime && endTime && startTime > endTime) {
    warnings.push('event ends before it starts');
    needsReview = true;
  }

  const { date, endDate } = deriveDates(raw);

  // --- 6. Assemble --------------------------------------------------------
  const candidate: NormalizedSchoolEvent = {
    id: options.id ?? raw.sourceId,
    rawEventId: raw.sourceId,
    title: value.title,
    summary: value.summary,
    date,
    endDate,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    allDay: raw.allDay,
    eventType,
    importance,
    appliesTo,
    classDetails,
    parentActionRequired,
    ...(value.parentAction ? { parentAction: value.parentAction } : {}),
    ...(value.location ?? raw.location ? { location: value.location ?? raw.location! } : {}),
    tags: [...new Set(value.tags)],
    confidence: value.confidence,
    needsReview,
    originalTitle: raw.title,
    ...(raw.description ? { originalDescription: raw.description } : {}),
    sourceUrl: options.sourceUrl ?? raw.sourceUrl ?? DEFAULT_SCHOOL.calendarPageUrl,
    createdAt: options.createdAt ?? options.now,
    updatedAt: options.now,
  };

  // --- 7. Final gate ------------------------------------------------------
  const validated = normalizedSchoolEventSchema.safeParse(candidate);
  if (!validated.success) {
    return {
      ok: false,
      errors: validated.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }

  return { ok: true, event: candidate, warnings };
}

/**
 * Deterministic importance rules.
 *
 * Importance is never taken from the interpreter. An LLM that decides a school
 * closure is "normal" would hide the single most consequential thing the app
 * exists to surface, so this module has the final say.
 */
import {
  ATTENDANCE_CRITICAL_EVENT_TYPES,
  type EventType,
  type Importance,
} from '@/domain/types';

/** Events that reliably require a parent to do something in advance. */
const HIGH_IMPORTANCE_TYPES: readonly EventType[] = [
  'parent_teacher_meeting',
  'parent_information_meeting',
  'deadline',
  'trip',
];

/** Informational events that rarely need action. */
const LOW_IMPORTANCE_TYPES: readonly EventType[] = ['reminder'];

/**
 * A school holiday changes attendance, so it is critical -- but only where the
 * calendar marks the holiday period itself, which is what `school_holiday` means.
 */
export function importanceFor(eventType: EventType): Importance {
  if (ATTENDANCE_CRITICAL_EVENT_TYPES.includes(eventType)) return 'critical';
  if (eventType === 'school_holiday') return 'critical';
  if (HIGH_IMPORTANCE_TYPES.includes(eventType)) return 'high';
  if (LOW_IMPORTANCE_TYPES.includes(eventType)) return 'low';
  return 'normal';
}

/**
 * Whether a parent must act. Forced true for anything that changes attendance
 * or collection, regardless of what the interpreter proposed.
 */
export function parentActionRequiredFor(eventType: EventType, proposed: boolean): boolean {
  if (ATTENDANCE_CRITICAL_EVENT_TYPES.includes(eventType)) return true;
  if (eventType === 'school_holiday') return true;
  return proposed;
}

export function isAttendanceCritical(eventType: EventType): boolean {
  return ATTENDANCE_CRITICAL_EVENT_TYPES.includes(eventType) || eventType === 'school_holiday';
}

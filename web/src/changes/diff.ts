/**
 * Normalized-event diffing.
 *
 * A calendar that changes silently is worse than no calendar at all, so any
 * change to a field that affects when or whether a child attends produces an
 * EventChange record the UI can surface prominently.
 */
import { formatLongDateNoYear } from '@/domain/dates';
import { formatClassList } from '@/domain/labels';
import {
  CLASS_LABELS,
  type EventChange,
  type FieldChange,
  type NormalizedSchoolEvent,
  type SchoolClass,
} from '@/domain/types';
import { EVENT_TYPE_LABELS } from '@/domain/types';

function timesFor(
  event: NormalizedSchoolEvent,
  schoolClass: SchoolClass,
): { startTime?: string; finishTime?: string } {
  const detail = event.classDetails.find((d) => d.schoolClass === schoolClass);
  return detail ?? {};
}

/**
 * Compare two versions of the same normalized event and return the material
 * differences. Cosmetic changes -- a reworded summary, a new tag, a confidence
 * shift -- are deliberately ignored so parents are not alerted about nothing.
 */
export function diffNormalizedEvents(
  previous: NormalizedSchoolEvent,
  next: NormalizedSchoolEvent,
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (previous.date !== next.date) {
    changes.push({ field: 'date', oldValue: previous.date, newValue: next.date });
  }
  if (previous.endDate !== next.endDate) {
    changes.push({ field: 'endDate', oldValue: previous.endDate, newValue: next.endDate });
  }
  if (previous.startTime !== next.startTime) {
    changes.push({
      field: 'startTime',
      oldValue: previous.startTime ?? null,
      newValue: next.startTime ?? null,
    });
  }
  if (previous.endTime !== next.endTime) {
    changes.push({
      field: 'endTime',
      oldValue: previous.endTime ?? null,
      newValue: next.endTime ?? null,
    });
  }
  if (previous.eventType !== next.eventType) {
    changes.push({ field: 'eventType', oldValue: previous.eventType, newValue: next.eventType });
  }

  const previousClasses = previous.appliesTo.join(',');
  const nextClasses = next.appliesTo.join(',');
  if (previousClasses !== nextClasses) {
    changes.push({ field: 'appliesTo', oldValue: previousClasses, newValue: nextClasses });
  }

  // Per-class times, compared across the union of both versions' classes so a
  // class gaining or losing a stated time is caught.
  const classes = new Set<SchoolClass>([
    ...previous.classDetails.map((d) => d.schoolClass),
    ...next.classDetails.map((d) => d.schoolClass),
  ]);
  for (const schoolClass of classes) {
    const before = timesFor(previous, schoolClass);
    const after = timesFor(next, schoolClass);
    if (before.finishTime !== after.finishTime) {
      changes.push({
        field: 'classDetails',
        schoolClass,
        oldValue: before.finishTime ?? null,
        newValue: after.finishTime ?? null,
      });
    }
    if (before.startTime !== after.startTime) {
      changes.push({
        field: 'classDetails',
        schoolClass,
        oldValue: before.startTime ?? null,
        newValue: after.startTime ?? null,
      });
    }
  }

  const wasCancelled = isCancelled(previous);
  const isNowCancelled = isCancelled(next);
  if (wasCancelled !== isNowCancelled) {
    changes.push({
      field: 'cancelled',
      oldValue: String(wasCancelled),
      newValue: String(isNowCancelled),
    });
  }

  return changes;
}

/**
 * Cancellation is an explicit tag set by the interpreter when the source says
 * so. A closure is not a cancellation -- a change in closure semantics is
 * already reported through the `eventType` field.
 */
function isCancelled(event: NormalizedSchoolEvent): boolean {
  return event.tags.includes('cancelled');
}

/**
 * Render a change set as the sentence a parent reads:
 *
 *   "Junior Infants now finish at 12:30. Previously 13:00."
 */
export function describeChanges(
  event: NormalizedSchoolEvent,
  changes: readonly FieldChange[],
): string {
  const sentences: string[] = [];

  for (const change of changes) {
    switch (change.field) {
      case 'date':
        sentences.push(
          `This event has moved to ${formatDate(change.newValue)}. Previously ${formatDate(change.oldValue)}.`,
        );
        break;
      case 'endDate':
        // A single-day event that moved already reported its new date; saying
        // "it now runs until" the same day again would just be noise.
        if (change.newValue !== event.date) {
          sentences.push(`It now runs until ${formatDate(change.newValue)}.`);
        }
        break;
      case 'startTime':
        sentences.push(timeSentence('starts', change.oldValue, change.newValue));
        break;
      case 'endTime':
        sentences.push(timeSentence('finishes', change.oldValue, change.newValue));
        break;
      case 'classDetails': {
        const label = change.schoolClass ? CLASS_LABELS[change.schoolClass] : 'Some classes';
        sentences.push(timeSentence('finishes', change.oldValue, change.newValue, label));
        break;
      }
      case 'appliesTo':
        sentences.push(
          `This now affects ${formatClassList(splitClasses(change.newValue))}. Previously ${formatClassList(splitClasses(change.oldValue))}.`,
        );
        break;
      case 'eventType':
        sentences.push(
          `This is now recorded as "${labelFor(change.newValue)}". Previously "${labelFor(change.oldValue)}".`,
        );
        break;
      case 'cancelled':
        sentences.push(change.newValue === 'true' ? 'This event is cancelled.' : 'This event is back on.');
        break;
    }
  }

  return sentences.join(' ') || `${event.title} was updated.`;
}

function timeSentence(
  verb: string,
  oldValue: string | null,
  newValue: string | null,
  subject = 'It',
): string {
  if (newValue === null) return `${subject} no longer has a stated ${verb} time.`;
  if (oldValue === null) return `${subject} now ${verb} at ${newValue}.`;
  return `${subject} now ${verb} at ${newValue}. Previously ${oldValue}.`;
}

function splitClasses(value: string | null): SchoolClass[] {
  return value ? (value.split(',') as SchoolClass[]) : [];
}

function labelFor(value: string | null): string {
  if (!value) return 'unknown';
  return EVENT_TYPE_LABELS[value as keyof typeof EVENT_TYPE_LABELS] ?? value;
}

function formatDate(value: string | null): string {
  return value ? formatLongDateNoYear(value) : 'an unknown date';
}

export type BuildChangeOptions = { now: string; id?: string };

/**
 * Build an EventChange record, or null when nothing material changed.
 */
export function buildEventChange(
  previous: NormalizedSchoolEvent,
  next: NormalizedSchoolEvent,
  options: BuildChangeOptions,
): EventChange | null {
  const changes = diffNormalizedEvents(previous, next);
  if (changes.length === 0) return null;

  return {
    id: options.id ?? `${next.id}:${options.now}`,
    eventId: next.id,
    detectedAt: options.now,
    changes,
    description: describeChanges(next, changes),
    acknowledged: false,
  };
}

/**
 * The parent relevance engine.
 *
 * Entirely deterministic and entirely local. The interpreter is never asked
 * whether a parent should see an event -- that is a set-intersection question,
 * and code answers it correctly every time.
 */
import { formatClassList } from '@/domain/labels';
import {
  CLASS_LABELS,
  type Child,
  type FamilySelection,
  type NormalizedSchoolEvent,
  type SchoolClass,
  type SelectableClass,
} from '@/domain/types';

export type RelevanceOptions = {
  /**
   * Parent-association events concern the association rather than a class.
   * Hidden unless the parent opts in (spec 17).
   */
  includeParentAssociation?: boolean;
};

export function selectedClassesOf(family: FamilySelection): SelectableClass[] {
  return [...new Set(family.children.map((child) => child.schoolClass))];
}

/**
 * An event is relevant when it applies to the whole school, or when any of its
 * classes is one the family has selected.
 */
export function isRelevant(
  event: Pick<NormalizedSchoolEvent, 'appliesTo' | 'eventType'>,
  selectedClasses: readonly SchoolClass[],
  options: RelevanceOptions = {},
): boolean {
  if (event.eventType === 'parent_association' && options.includeParentAssociation !== true) {
    return false;
  }

  if (event.appliesTo.includes('whole_school')) return true;

  // A parents-wide event (a parent-teacher meeting, say) concerns every family.
  if (event.appliesTo.includes('parents') && event.appliesTo.length === 1) return true;

  return event.appliesTo.some((schoolClass) => selectedClasses.includes(schoolClass));
}

export function filterRelevant(
  events: readonly NormalizedSchoolEvent[],
  selectedClasses: readonly SchoolClass[],
  options: RelevanceOptions = {},
): NormalizedSchoolEvent[] {
  // Filtering never duplicates: one event in, at most one event out, however
  // many of the family's children it happens to affect.
  return events.filter((event) => isRelevant(event, selectedClasses, options));
}

/**
 * Which of the family's children an event affects, in the family's own order.
 * A whole-school event affects every child -- once.
 */
export function affectedChildren(
  event: Pick<NormalizedSchoolEvent, 'appliesTo'>,
  family: FamilySelection,
): Child[] {
  if (event.appliesTo.includes('whole_school')) return [...family.children];
  return family.children.filter((child) => event.appliesTo.includes(child.schoolClass));
}

/**
 * The badge shown on an event card.
 *
 *   named children:   "Aoife · Junior Infants"
 *   several children: "Aoife + Jack · Whole school"
 *   unnamed:          "Junior Infants and 4th Class"
 */
export function affectedLabel(
  event: Pick<NormalizedSchoolEvent, 'appliesTo'>,
  family: FamilySelection,
): string {
  const children = affectedChildren(event, family);
  const scope = formatClassList(event.appliesTo);

  const named = children.filter((child) => child.name && child.name.trim().length > 0);

  // Only use child names when every affected child has one, otherwise the label
  // would silently omit a child.
  if (children.length > 0 && named.length === children.length) {
    const names = named.map((child) => child.name!.trim()).join(' + ');
    return `${names} · ${scope}`;
  }

  if (children.length > 0) {
    return children.map((child) => CLASS_LABELS[child.schoolClass]).join(' + ');
  }

  return scope;
}

/**
 * The per-child time for an event, used on the detail screen so a parent with
 * children in different classes sees the right finish time for each.
 */
export function classTimeFor(
  event: Pick<NormalizedSchoolEvent, 'classDetails' | 'startTime' | 'endTime'>,
  schoolClass: SchoolClass,
): { startTime?: string; finishTime?: string } {
  const detail = event.classDetails.find((d) => d.schoolClass === schoolClass);
  if (detail) {
    return {
      ...(detail.startTime ? { startTime: detail.startTime } : {}),
      ...(detail.finishTime ? { finishTime: detail.finishTime } : {}),
    };
  }
  return {
    ...(event.startTime ? { startTime: event.startTime } : {}),
    ...(event.endTime ? { finishTime: event.endTime } : {}),
  };
}

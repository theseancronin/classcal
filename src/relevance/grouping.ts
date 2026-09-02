/**
 * The home screen's information hierarchy (spec section 32).
 *
 * Pure and deterministic so the ordering rules are testable without rendering:
 *
 *   1. changed-event alerts
 *   2. today
 *   3. tomorrow
 *   4. important upcoming
 *   5. next seven days
 *   6. later
 *
 * An event appears in exactly one section, so nothing is ever counted twice.
 */
import { formatLongDate, formatShortDate } from '@/domain/dates';
import { IMPORTANCE_RANK, type NormalizedSchoolEvent } from '@/domain/types';

export type HomeSectionId = 'today' | 'tomorrow' | 'important' | 'next_seven_days' | 'later';

export type HomeSection = {
  id: HomeSectionId;
  title: string;
  /** Shown when the section has no events. Only `today` renders when empty. */
  emptyMessage?: string;
  events: NormalizedSchoolEvent[];
};

const SECTION_TITLES: Record<HomeSectionId, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  important: 'Important',
  next_seven_days: 'Next 7 days',
  later: 'Later',
};

/** How far ahead the "Important" section reaches. */
const IMPORTANT_HORIZON_DAYS = 60;

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  return toDateKey(new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * 86_400_000));
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/** True when a multi-day event covers the given day. */
export function occursOn(event: NormalizedSchoolEvent, dateKey: string): boolean {
  return event.date <= dateKey && event.endDate >= dateKey;
}

function byImportanceThenDate(a: NormalizedSchoolEvent, b: NormalizedSchoolEvent): number {
  const importance = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  if (importance !== 0) return importance;
  return a.date.localeCompare(b.date);
}

function byDateThenTime(a: NormalizedSchoolEvent, b: NormalizedSchoolEvent): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.startTime ?? '00:00').localeCompare(b.startTime ?? '00:00');
}

/**
 * Group already-relevant events into the home sections.
 *
 * `events` must already have been through the relevance filter -- this function
 * is about ordering, not about who sees what.
 */
export function buildHomeSections(
  events: readonly NormalizedSchoolEvent[],
  today: string,
): HomeSection[] {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);

  const placed = new Set<string>();
  const take = (predicate: (event: NormalizedSchoolEvent) => boolean) => {
    const taken = events.filter((event) => !placed.has(event.id) && predicate(event));
    for (const event of taken) placed.add(event.id);
    return taken;
  };

  // Events that have already finished never appear.
  const upcoming = events.filter((event) => event.endDate >= today);
  const isUpcoming = (event: NormalizedSchoolEvent) => upcoming.includes(event);

  const todayEvents = take((e) => isUpcoming(e) && occursOn(e, today)).sort(byDateThenTime);
  const tomorrowEvents = take((e) => isUpcoming(e) && occursOn(e, tomorrow)).sort(byDateThenTime);

  const important = take(
    (e) =>
      isUpcoming(e) &&
      (e.importance === 'critical' || e.importance === 'high') &&
      daysBetween(today, e.date) <= IMPORTANT_HORIZON_DAYS,
  ).sort(byImportanceThenDate);

  const thisWeek = take((e) => isUpcoming(e) && e.date <= weekEnd).sort(byDateThenTime);
  const later = take(isUpcoming).sort(byDateThenTime);

  const sections: HomeSection[] = [
    {
      id: 'today',
      title: SECTION_TITLES.today,
      emptyMessage: 'No special events today.',
      events: todayEvents,
    },
    { id: 'tomorrow', title: SECTION_TITLES.tomorrow, events: tomorrowEvents },
    { id: 'important', title: SECTION_TITLES.important, events: important },
    { id: 'next_seven_days', title: SECTION_TITLES.next_seven_days, events: thisWeek },
    { id: 'later', title: SECTION_TITLES.later, events: later },
  ];

  return sections.filter(
    (section) => section.events.length > 0 || section.emptyMessage !== undefined,
  );
}

/**
 * "Today", "Tomorrow", "Mon 28 Sep" -- a parent should never have to work out
 * what a bare date means.
 */
export function relativeDateLabel(dateKey: string, today: string): string {
  const delta = daysBetween(today, dateKey);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';

  const sameYear = dateKey.slice(0, 4) === today.slice(0, 4);
  return formatShortDate(dateKey, !sameYear);
}

/** The long form used on the event detail screen. */
export function fullDateLabel(dateKey: string): string {
  return formatLongDate(dateKey);
}

/** "Monday 26 October to Friday 30 October" for multi-day events. */
export function dateRangeLabel(event: Pick<NormalizedSchoolEvent, 'date' | 'endDate'>): string {
  if (event.date === event.endDate) return fullDateLabel(event.date);
  return `${fullDateLabel(event.date)} to ${fullDateLabel(event.endDate)}`;
}

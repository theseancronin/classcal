/**
 * Date formatting.
 *
 * Deliberately hand-rolled rather than `Intl.DateTimeFormat`. Hermes on Android
 * ships a different (and sometimes trimmed) ICU dataset from Node, so relying on
 * the platform would mean the tests and the phone disagree about what a date
 * looks like. The school calendar is Irish-English only, so a fixed table is
 * both sufficient and predictable.
 *
 * All date keys are `YYYY-MM-DD` and are treated as wall-clock dates in the
 * school's timezone -- never shifted into the device's timezone.
 */

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

type DateParts = { year: number; month: number; day: number; weekday: number };

/** Parse a `YYYY-MM-DD` key. Returns null for anything malformed. */
export function parseDateKey(dateKey: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  // Reject impossible dates such as 2026-02-31, which Date.UTC silently rolls.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day, weekday: date.getUTCDay() };
}

/** "Monday 28 September 2026" */
export function formatLongDate(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  return `${WEEKDAYS_LONG[parts.weekday]} ${parts.day} ${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
}

/** "Monday 28 September" -- used where the year is obvious from context. */
export function formatLongDateNoYear(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  return `${WEEKDAYS_LONG[parts.weekday]} ${parts.day} ${MONTHS_LONG[parts.month - 1]}`;
}

/** "Mon 28 Sep", or "Mon 28 Sep 2027" when the year differs. */
export function formatShortDate(dateKey: string, includeYear = false): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  const base = `${WEEKDAYS_SHORT[parts.weekday]} ${parts.day} ${MONTHS_SHORT[parts.month - 1]}`;
  return includeYear ? `${base} ${parts.year}` : base;
}

/** "September 2026" -- the calendar screen's month heading. */
export function formatMonthTitle(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  return `${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
}

/** Weekday initials for the month grid header, starting on Monday. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Day of week with Monday as 0, which is how the month grid is laid out. */
export function mondayIndex(dateKey: string): number {
  const parts = parseDateKey(dateKey);
  if (!parts) return 0;
  return (parts.weekday + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Render a stored `HH:mm` for display. 24-hour is unambiguous and is the default
 * the spec asks for; 12-hour is offered because some parents prefer it.
 */
export function formatTime(time: string, use24Hour = true): string {
  if (use24Hour) return time;
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute}${suffix}`;
}

/** "09:00 to 12:45", "from 09:00", "until 12:45", or null. */
export function formatTimeRange(
  start: string | undefined,
  end: string | undefined,
  use24Hour = true,
): string | null {
  if (start && end) return `${formatTime(start, use24Hour)} to ${formatTime(end, use24Hour)}`;
  if (start) return `from ${formatTime(start, use24Hour)}`;
  if (end) return `until ${formatTime(end, use24Hour)}`;
  return null;
}

/**
 * "just now", "2 hours ago", "3 days ago" -- used for the "last updated" line,
 * where precision matters less than making staleness obvious.
 */
export function formatRelativeInstant(instant: string, now: string): string {
  const deltaMs = Date.parse(now) - Date.parse(instant);
  if (Number.isNaN(deltaMs)) return 'unknown';

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Deterministic time extraction and normalization.
 *
 * The GSMNC feed publishes every event as an all-day entry and puts the real
 * times inside the summary text, in a wide range of formats:
 *
 *   "09:00 -12:45"      "2.40-3.40"        "@12.50in & R1 - R6 @1.00in"
 *   "@9:15"             "6.30in"           "3:00i.n. - 5:00i.n."
 *   "2:00i.n. go dti 3.30i.n."             "11.00"
 *
 * Irish meridiem markers: "i.n." (iarnoin) = pm, "r.n." (roimh noin) = am.
 * The "in" suffix seen in "12.50in" is the same i.n. marker without periods.
 */
import { foldForMatching } from './text';

export type Meridiem = 'am' | 'pm' | null;

/**
 * Hours at or below this are assumed to be afternoon when no meridiem marker is
 * present. A primary school day runs roughly 08:00-16:00, so a bare "1.40"
 * means 13:40 and a bare "9:00" means 09:00.
 */
const AFTERNOON_CUTOFF_HOUR = 7;

export function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Convert an hour/minute pair plus an optional meridiem marker into `HH:mm`.
 * Returns null when the values cannot represent a real time.
 */
export function buildTime(hour: number, minute: number, meridiem: Meridiem): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  let h = hour;

  if (meridiem === 'pm') {
    if (h < 1 || h > 12) return null;
    if (h !== 12) h += 12;
  } else if (meridiem === 'am') {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
  } else {
    if (h < 0 || h > 23) return null;
    // No marker: apply the school-day heuristic.
    if (h >= 1 && h <= AFTERNOON_CUTOFF_HOUR) h += 12;
  }

  if (h < 0 || h > 23) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/**
 * Normalize a single already-isolated time string such as "1.00pm", "13:00",
 * "12.50in" or "9:15". Returns null if the input is not a time.
 */
export function normalizeTime(input: string): string | null {
  const folded = foldForMatching(input);
  const match = /^(\d{1,2})\s*[:.h]?\s*(\d{2})?\s*(a\.?m\.?|p\.?m\.?|i\.?n\.?|r\.?n\.?|in|rn)?$/.exec(
    folded.replace(/\s+/g, ''),
  );
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  return buildTime(hour, minute, readMeridiem(match[3]));
}

function readMeridiem(marker: string | undefined): Meridiem {
  if (!marker) return null;
  const cleaned = marker.replace(/\./g, '');
  if (cleaned === 'am' || cleaned === 'rn') return 'am';
  if (cleaned === 'pm' || cleaned === 'in') return 'pm';
  return null;
}

export type TimeMention = {
  time: string;
  /** Character offset in the folded text -- used to associate times with classes. */
  index: number;
  /** Length of the matched substring in the folded text. */
  length: number;
  /** True when the source explicitly stated am/pm rather than relying on the heuristic. */
  explicitMeridiem: boolean;
};

/**
 * A clock time in the body of a sentence. Requires either a `:`/`.` separator
 * with two minute digits, or an explicit meridiem marker, so that stray numbers
 * ("Rang 5", "2026") are not mistaken for times.
 */
const TIME_PATTERN =
  /(?<![\d:.])(\d{1,2})\s*(?:[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|i\.?n\.?|r\.?n\.?|in\b|rn\b)?(?![\d:.])/g;

/** Find every time mentioned in a piece of text, in order of appearance. */
export function findTimes(input: string): TimeMention[] {
  const folded = foldForMatching(input);
  const mentions: TimeMention[] = [];

  TIME_PATTERN.lastIndex = 0;
  for (let m = TIME_PATTERN.exec(folded); m; m = TIME_PATTERN.exec(folded)) {
    const [whole, hourText, minuteText, marker] = m;
    const meridiem = readMeridiem(marker);
    // Reject bare integers: a time needs minutes or an explicit meridiem.
    if (minuteText === undefined && meridiem === null) continue;

    const hour = Number(hourText);
    const minute = minuteText === undefined ? 0 : Number(minuteText);
    const time = buildTime(hour, minute, meridiem);
    if (time === null) continue;

    mentions.push({
      time,
      index: m.index,
      length: whole.trimEnd().length,
      explicitMeridiem: meridiem !== null,
    });
  }

  return applyRangeCoherence(folded, mentions);
}

/**
 * Fix the common "9:00 -1:40" case: the second time of a range must not be
 * earlier than the first, so an unmarked afternoon time is promoted.
 * Conversely "8:30-8:55" must stay in the morning.
 */
function applyRangeCoherence(folded: string, mentions: TimeMention[]): TimeMention[] {
  for (let i = 1; i < mentions.length; i += 1) {
    const previous = mentions[i - 1]!;
    const current = mentions[i]!;
    const between = folded.slice(previous.index + previous.length, current.index);
    const isRange = /^\s*(-|to|go dti|until|go)\s*$/.test(between);
    if (!isRange || current.explicitMeridiem) continue;

    if (toMinutes(current.time) < toMinutes(previous.time)) {
      const [h, m] = current.time.split(':').map(Number);
      const promoted = buildTime((h! + 12) % 24, m!, null);
      if (promoted && toMinutes(promoted) >= toMinutes(previous.time)) {
        mentions[i] = { ...current, time: promoted };
      }
    }
  }
  return mentions;
}

/** The first time range in the text, if the text contains two or more times. */
export function findTimeRange(input: string): { start?: string; end?: string } {
  const times = findTimes(input);
  const first = times[0];
  if (!first) return {};
  const second = times[1];
  if (!second) return { start: first.time };
  return { start: first.time, end: second.time };
}

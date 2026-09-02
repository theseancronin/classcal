/**
 * iCalendar -> RawCalendarEvent.
 *
 * Parsing is delegated to ical.js (RFC 5545). This module's job is to defend
 * the rest of the application from the feed: every field is length-capped,
 * control characters are stripped, and a malformed VEVENT is skipped rather
 * than aborting the whole sync.
 */
import ICAL from 'ical.js';

import { FIELD_LIMITS } from '@/domain/schemas';
import type { RawCalendarEvent } from '@/domain/types';
import { stableHash } from './hash';

export type ParseResult = {
  events: RawCalendarEvent[];
  /** VEVENTs that could not be read, with the reason. Surfaced in admin review. */
  skipped: { reason: string; detail?: string }[];
};

export type ParseOptions = {
  sourceCalendar: string;
  fetchedAt: string;
};

/** C0 and C1 control characters, written as escapes to keep the source printable. */
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');

/**
 * Remove control characters and clamp length. Calendar text is untrusted: it is
 * rendered as plain React Native `<Text>` (never HTML), but oversized or
 * control-character-laden values are still rejected at the boundary.
 */
function sanitizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, limit);
}

/**
 * Convert an ICAL.Time to an ISO instant.
 *
 * Date-only values are anchored at UTC midnight so that the calendar date is
 * preserved exactly, regardless of the device timezone. The school calendar is
 * a wall-clock calendar; it must never shift a day because a parent is abroad.
 */
function toIsoInstant(time: ICAL.Time | null): string | undefined {
  if (!time) return undefined;
  if (time.isDate) {
    const y = String(time.year).padStart(4, '0');
    const m = String(time.month).padStart(2, '0');
    const d = String(time.day).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  const jsDate = time.toJSDate();
  return Number.isNaN(jsDate.getTime()) ? undefined : jsDate.toISOString();
}

/** Maximum VEVENTs accepted from one feed, as a denial-of-service guard. */
const MAX_EVENTS = 2000;

export function parseICalendar(source: string, options: ParseOptions): ParseResult {
  const events: RawCalendarEvent[] = [];
  const skipped: ParseResult['skipped'] = [];

  let component: ICAL.Component;
  try {
    component = new ICAL.Component(ICAL.parse(source));
  } catch (error) {
    return {
      events: [],
      skipped: [{ reason: 'calendar_unparseable', detail: describeError(error) }],
    };
  }

  const vevents = component.getAllSubcomponents('vevent');
  const seenSourceIds = new Set<string>();

  for (const vevent of vevents.slice(0, MAX_EVENTS)) {
    try {
      const event = new ICAL.Event(vevent);

      const title = sanitizeText(event.summary, FIELD_LIMITS.title);
      if (!title) {
        skipped.push({ reason: 'missing_summary', detail: event.uid ?? undefined });
        continue;
      }

      const start = toIsoInstant(event.startDate);
      if (!start) {
        skipped.push({ reason: 'missing_or_invalid_start', detail: title });
        continue;
      }

      const allDay = event.startDate?.isDate === true;
      const end = toIsoInstant(event.endDate);
      const sourceUid = sanitizeText(event.uid, 200);
      const description = sanitizeText(event.description, FIELD_LIMITS.description);
      const location = sanitizeText(event.location, FIELD_LIMITS.location);
      const sourceUrl = sanitizeText(vevent.getFirstPropertyValue('url'), 500);

      // A UID may legitimately repeat across recurrence overrides, so the start
      // date is folded in to keep the identity stable but unique.
      const sourceId = `${sourceUid ?? stableHash({ title, start })}:${start.slice(0, 10)}`;
      if (seenSourceIds.has(sourceId)) {
        skipped.push({ reason: 'duplicate_source_id', detail: sourceId });
        continue;
      }
      seenSourceIds.add(sourceId);

      const payload = { title, description, location, start, end, allDay };

      events.push({
        sourceId,
        sourceCalendar: options.sourceCalendar,
        ...(sourceUid ? { sourceUid } : {}),
        title,
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        start,
        ...(end ? { end } : {}),
        allDay,
        rawPayloadHash: stableHash(payload),
        fetchedAt: options.fetchedAt,
        ...(sourceUrl ? { sourceUrl } : {}),
      });
    } catch (error) {
      skipped.push({ reason: 'vevent_unreadable', detail: describeError(error) });
    }
  }

  if (vevents.length > MAX_EVENTS) {
    skipped.push({
      reason: 'event_limit_exceeded',
      detail: `${vevents.length} events, cap ${MAX_EVENTS}`,
    });
  }

  return { events, skipped };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}

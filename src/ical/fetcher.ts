/**
 * Fetching the school's iCalendar feed.
 *
 * A failed fetch must never destroy what is already stored, so this module
 * returns a discriminated result and never throws to its caller.
 */
import { decodeCalendarBytes } from '@/classes/text';

export type FetchSuccess = { ok: true; body: string; fetchedAt: string };
export type FetchFailure = { ok: false; error: string; fetchedAt: string };
export type FetchResult = FetchSuccess | FetchFailure;

export type FetchOptions = {
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const DEFAULT_TIMEOUT_MS = 20_000;

/** Refuse to buffer an implausibly large feed. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * `webcal://` is a Google/Apple convention for "subscribe to this iCal feed";
 * over the wire it is plain HTTPS.
 */
export function normalizeFeedUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, 'https://');
}

export async function fetchCalendar(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchedAt = now().toISOString();

  const target = normalizeFeedUrl(url.trim());
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, error: 'Calendar URL must be an http(s) or webcal address.', fetchedAt };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(target, {
      signal: controller.signal,
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Calendar server returned ${response.status} ${response.statusText}`.trim(),
        fetchedAt,
      };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return { ok: false, error: 'Calendar feed is unexpectedly large.', fetchedAt };
    }

    // The feed is mostly UTF-8 but contains invalid byte sequences in practice.
    const body = decodeCalendarBytes(new Uint8Array(buffer));
    if (!body.includes('BEGIN:VCALENDAR')) {
      return { ok: false, error: 'Response was not an iCalendar feed.', fetchedAt };
    }

    return { ok: true, body, fetchedAt };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Calendar request timed out.'
        : `Could not reach the calendar: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, error: message.slice(0, 300), fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}

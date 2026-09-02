/**
 * Per-school configuration.
 *
 * GSMNC specifics live here rather than being scattered through the codebase,
 * so onboarding a second school is a matter of adding a `SchoolConfig`.
 */
import type { SchoolClass } from '@/domain/types';

export type SchoolConfig = {
  id: string;
  name: string;
  shortName: string;
  websiteUrl: string;
  /** The page a parent should open to verify anything the app shows. */
  calendarPageUrl: string;
  /** The iCalendar feed. Overridable at runtime -- feed tokens rotate. */
  calendarFeedUrl: string;
  timezone: string;
  locale: string;
  /** School-specific wording that the generic alias table would not catch. */
  extraClassAliases: Record<string, SchoolClass[]>;
};

export const GSMNC: SchoolConfig = {
  id: 'gsmnc',
  name: 'Gaelscoil Mhainistir na Corann',
  shortName: 'GSMNC',
  websiteUrl: 'https://www.gsmnc.ie/',
  calendarPageUrl: 'https://www.gsmnc.ie/calendar/',
  // The `download` token is observed, not permanent. Treat it as a default that
  // a parent can correct in Settings if the school rotates the feed.
  calendarFeedUrl: 'https://www.gsmnc.ie/ical.php?download=1788297153',
  timezone: 'Europe/Dublin',
  locale: 'en-IE',
  extraClassAliases: {},
};

export const DEFAULT_SCHOOL = GSMNC;

/** How old a successful sync may be before the UI calls the data stale. */
export const STALE_AFTER_HOURS = 24;

/** Minimum gap between automatic background syncs. */
export const SYNC_INTERVAL_MINUTES = 30;

/** Interpreted events below this confidence are held for review. */
export const CONFIDENCE_REVIEW_THRESHOLD = 0.85;

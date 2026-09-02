/**
 * Family configuration.
 *
 * Child names and class selections never leave the browser. There are no
 * accounts: this is the only place a household is described, it is never sent
 * to the server or the interpreter, and "Clear family data" in Settings removes
 * it entirely.
 *
 * Reads are synchronous because localStorage is, which avoids a loading flash
 * on first paint. They are guarded for server rendering, where there is no
 * window and the defaults are the correct answer.
 */
import { familySelectionSchema, notificationPreferencesSchema } from '@/domain/schemas';
import type { FamilySelection, NotificationPreferences, SelectableClass } from '@/domain/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/notifications/schedule';

const FAMILY_KEY = 'classcal.family.v1';
const PREFERENCES_KEY = 'classcal.preferences.v1';
const DISPLAY_KEY = 'classcal.display.v1';

export const EMPTY_FAMILY: FamilySelection = { children: [] };

export type DisplayPreferences = {
  use24HourTime: boolean;
  /** Parent-association events are hidden by default (spec 17). */
  showParentAssociation: boolean;
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  use24HourTime: true,
  showParentAssociation: false,
};

/**
 * Storage is untrusted input too: it may have been written by an older version
 * of the app, and in a private window it can throw on access. Everything read
 * back is validated and falls back to a default rather than breaking the first
 * screen a parent sees.
 */
function readValidated<T>(key: string, parse: (value: unknown) => T | null, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    return parse(JSON.parse(stored)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota. The in-memory state stays correct for
    // this session; there is nothing useful to tell the parent here.
  }
}

export function loadFamily(): FamilySelection {
  return readValidated(
    FAMILY_KEY,
    (value) => {
      const result = familySelectionSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    EMPTY_FAMILY,
  );
}

export function saveFamily(family: FamilySelection): void {
  write(FAMILY_KEY, familySelectionSchema.parse(family));
}

export function loadPreferences(): NotificationPreferences {
  return readValidated(
    PREFERENCES_KEY,
    (value) => {
      const result = notificationPreferencesSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
}

export function savePreferences(preferences: NotificationPreferences): void {
  write(PREFERENCES_KEY, preferences);
}

export function loadDisplayPreferences(): DisplayPreferences {
  return readValidated(
    DISPLAY_KEY,
    (value) =>
      typeof value === 'object' && value !== null
        ? { ...DEFAULT_DISPLAY_PREFERENCES, ...(value as Partial<DisplayPreferences>) }
        : null,
    DEFAULT_DISPLAY_PREFERENCES,
  );
}

export function saveDisplayPreferences(preferences: DisplayPreferences): void {
  write(DISPLAY_KEY, preferences);
}

/** Remove every trace of the family from the browser. */
export function clearFamilyData(): void {
  if (typeof window === 'undefined') return;
  for (const key of [FAMILY_KEY, PREFERENCES_KEY, DISPLAY_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do; the caller resets in-memory state regardless.
    }
  }
}

/** Setup is complete once at least one class has been chosen. */
export function isSetupComplete(family: FamilySelection): boolean {
  return family.children.length > 0;
}

let childCounter = 0;

/** Ids only need to be unique within one browser. */
export function newChildId(schoolClass: SelectableClass): string {
  childCounter += 1;
  return `${schoolClass}-${Date.now().toString(36)}-${childCounter}`;
}

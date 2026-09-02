/**
 * Family configuration.
 *
 * Child names and class selections never leave the device. They are stored in
 * plain device storage, are never sent to the interpreter, and are removed
 * entirely by "Clear family data" in Settings.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

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
 * of the app, so everything read back is validated and falls back to a default
 * rather than crashing the first screen a parent sees.
 */
async function readValidated<T>(
  key: string,
  parse: (value: unknown) => T | null,
  fallback: T,
): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return fallback;
    return parse(JSON.parse(stored)) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadFamily(): Promise<FamilySelection> {
  return readValidated(
    FAMILY_KEY,
    (value) => {
      const result = familySelectionSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    EMPTY_FAMILY,
  );
}

export async function saveFamily(family: FamilySelection): Promise<void> {
  const validated = familySelectionSchema.parse(family);
  await AsyncStorage.setItem(FAMILY_KEY, JSON.stringify(validated));
}

export async function loadPreferences(): Promise<NotificationPreferences> {
  return readValidated(
    PREFERENCES_KEY,
    (value) => {
      const result = notificationPreferencesSchema.safeParse(value);
      return result.success ? result.data : null;
    },
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
}

export async function savePreferences(preferences: NotificationPreferences): Promise<void> {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export async function loadDisplayPreferences(): Promise<DisplayPreferences> {
  return readValidated(
    DISPLAY_KEY,
    (value) =>
      typeof value === 'object' && value !== null
        ? { ...DEFAULT_DISPLAY_PREFERENCES, ...(value as Partial<DisplayPreferences>) }
        : null,
    DEFAULT_DISPLAY_PREFERENCES,
  );
}

export async function saveDisplayPreferences(preferences: DisplayPreferences): Promise<void> {
  await AsyncStorage.setItem(DISPLAY_KEY, JSON.stringify(preferences));
}

/** Remove every trace of the family from the device. */
export async function clearFamilyData(): Promise<void> {
  await AsyncStorage.multiRemove([FAMILY_KEY, PREFERENCES_KEY, DISPLAY_KEY]);
}

/** Setup is complete once at least one class has been chosen. */
export function isSetupComplete(family: FamilySelection): boolean {
  return family.children.length > 0;
}

let childCounter = 0;

/** Ids only need to be unique within one device. */
export function newChildId(schoolClass: SelectableClass): string {
  childCounter += 1;
  return `${schoolClass}-${Date.now().toString(36)}-${childCounter}`;
}

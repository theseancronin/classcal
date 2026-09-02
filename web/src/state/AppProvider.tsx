'use client';

/**
 * The single piece of app-wide state.
 *
 * Holds the household (from localStorage, never sent anywhere), the events for
 * that household (from the API), and enough sync metadata to be honest about
 * staleness. Events are fetched for the selected classes only, so the payload a
 * parent downloads is already the payload they can see.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  FamilySelection,
  NormalizedSchoolEvent,
  NotificationPreferences,
  SyncStatus,
} from '@/domain/types';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  EMPTY_FAMILY,
  loadDisplayPreferences,
  loadFamily,
  loadPreferences,
  saveDisplayPreferences,
  saveFamily,
  savePreferences,
  type DisplayPreferences,
} from '@/family/store';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/notifications/schedule';
import { selectedClassesOf } from '@/relevance/relevance';
import { toDateKey } from '@/relevance/grouping';

/** Beyond this, the calendar is presented as possibly out of date (spec 26). */
const STALE_AFTER_HOURS = 24;

type AppState = {
  /** False until localStorage has been read, so nothing renders from defaults. */
  ready: boolean;
  family: FamilySelection;
  preferences: NotificationPreferences;
  display: DisplayPreferences;
  events: NormalizedSchoolEvent[];
  status: SyncStatus | undefined;
  loading: boolean;
  /** Set when the last fetch failed; the cached events are still shown. */
  error: string | undefined;
  stale: boolean;
  today: string;
  setFamily: (family: FamilySelection) => void;
  setPreferences: (preferences: NotificationPreferences) => void;
  setDisplay: (display: DisplayPreferences) => void;
  refresh: () => Promise<void>;
};

const AppContext = createContext<AppState | undefined>(undefined);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [family, setFamilyState] = useState<FamilySelection>(EMPTY_FAMILY);
  const [preferences, setPreferencesState] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [display, setDisplayState] = useState(DEFAULT_DISPLAY_PREFERENCES);
  const [events, setEvents] = useState<NormalizedSchoolEvent[]>([]);
  const [status, setStatus] = useState<SyncStatus>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [today, setToday] = useState(() => toDateKey(new Date()));

  // localStorage is only available in the browser, so the first read happens
  // after mount rather than during render.
  useEffect(() => {
    setFamilyState(loadFamily());
    setPreferencesState(loadPreferences());
    setDisplayState(loadDisplayPreferences());
    setReady(true);
  }, []);

  const classes = useMemo(() => selectedClassesOf(family), [family]);
  const classKey = classes.join(',');

  const refresh = useCallback(async () => {
    if (classes.length === 0) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ classes: classes.join(',') });
      const response = await fetch(`/api/events?${params.toString()}`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const payload = (await response.json()) as {
        events: NormalizedSchoolEvent[];
        status: SyncStatus;
      };
      setEvents(payload.events);
      setStatus(payload.status);
      setError(undefined);
    } catch (cause) {
      // Keep whatever is already on screen. Showing nothing would be a worse
      // lie than showing yesterday's calendar with a staleness warning.
      setError(cause instanceof Error ? cause.message : 'Could not refresh');
    } finally {
      setLoading(false);
    }
  }, [classes.length, classKey]);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  // Refresh when the tab is brought back to the foreground: a parent checking
  // at the school gate should not be looking at a morning-old page.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      setToday(toDateKey(new Date()));
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const setFamily = useCallback((next: FamilySelection) => {
    setFamilyState(next);
    saveFamily(next);
  }, []);

  const setPreferences = useCallback((next: NotificationPreferences) => {
    setPreferencesState(next);
    savePreferences(next);
  }, []);

  const setDisplay = useCallback((next: DisplayPreferences) => {
    setDisplayState(next);
    saveDisplayPreferences(next);
  }, []);

  const stale = useMemo(() => {
    if (!status?.lastSuccessAt) return true;
    const age = Date.now() - new Date(status.lastSuccessAt).getTime();
    return age > STALE_AFTER_HOURS * 60 * 60 * 1000;
  }, [status]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      family,
      preferences,
      display,
      events,
      status,
      loading,
      error,
      stale,
      today,
      setFamily,
      setPreferences,
      setDisplay,
      refresh,
    }),
    [
      ready, family, preferences, display, events, status, loading, error,
      stale, today, setFamily, setPreferences, setDisplay, refresh,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

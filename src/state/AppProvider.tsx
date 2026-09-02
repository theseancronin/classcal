/**
 * The single application context.
 *
 * Owns the database connection, the family configuration and the sync lifecycle
 * so that no screen has to know how any of it works. Screens read events through
 * `useEvents`, which is a pure database read -- interpretation never runs on the
 * render path.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { STALE_AFTER_HOURS, SYNC_INTERVAL_MINUTES } from '@/config/school';
import { openDatabase } from '@/db/expoSqlite';
import type { SqlDatabase } from '@/db/port';
import {
  acknowledgeChanges,
  getRecentChanges,
  getSyncStatus,
  queryEvents,
  setFeedUrl,
  type EventQuery,
} from '@/db/repository';
import type {
  EventChange,
  FamilySelection,
  NormalizedSchoolEvent,
  NotificationPreferences,
  SyncStatus,
} from '@/domain/types';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  EMPTY_FAMILY,
  clearFamilyData,
  isSetupComplete,
  loadDisplayPreferences,
  loadFamily,
  loadPreferences,
  saveDisplayPreferences,
  saveFamily,
  savePreferences,
  type DisplayPreferences,
} from '@/family/store';
import { readInterpreterSettings } from '@/interpreter/config';
import { createInterpreter } from '@/interpreter/factory';
import { syncCalendar, type SyncResult } from '@/pipeline/sync';
import { selectedClassesOf } from '@/relevance/relevance';
import { syncNotifications } from '@/notifications/delivery';
import { toDateKey } from '@/relevance/grouping';

export type AppContextValue = {
  ready: boolean;
  db: SqlDatabase | null;

  family: FamilySelection;
  setupComplete: boolean;
  updateFamily: (family: FamilySelection) => Promise<void>;

  preferences: NotificationPreferences;
  updatePreferences: (preferences: NotificationPreferences) => Promise<void>;

  display: DisplayPreferences;
  updateDisplay: (display: DisplayPreferences) => Promise<void>;

  syncStatus: SyncStatus;
  syncing: boolean;
  /** True when the last sync failed or the data is older than the stale window. */
  stale: boolean;
  lastSyncError: string | null;
  refresh: (options?: { force?: boolean }) => Promise<SyncResult | null>;
  updateFeedUrl: (url: string) => Promise<void>;

  changes: EventChange[];
  dismissChanges: () => Promise<void>;

  clearEverything: () => Promise<void>;

  /** `YYYY-MM-DD` today, recomputed when the app returns to the foreground. */
  today: string;

  /** Bumped after every write, so screens know to re-read. */
  revision: number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export type AppProviderProps = {
  children: ReactNode;
  /**
   * Whether to sync from the network on launch and on foreground. Tests seed the
   * database directly and turn this off so they never touch the school's server.
   */
  autoSync?: boolean;
};

export function AppProvider({ children, autoSync = true }: AppProviderProps) {
  const [db, setDb] = useState<SqlDatabase | null>(null);
  const [ready, setReady] = useState(false);
  const [family, setFamily] = useState<FamilySelection>(EMPTY_FAMILY);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [display, setDisplay] = useState<DisplayPreferences>(DEFAULT_DISPLAY_PREFERENCES);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ eventsIngested: 0, eventsChanged: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [changes, setChanges] = useState<EventChange[]>([]);
  const [revision, setRevision] = useState(0);
  const [today, setToday] = useState(() => toDateKey(new Date()));

  const interpreter = useMemo(() => createInterpreter(readInterpreterSettings()), []);
  const syncInFlight = useRef<Promise<SyncResult | null> | null>(null);

  // --- Boot ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [database, loadedFamily, loadedPreferences, loadedDisplay] = await Promise.all([
        openDatabase(),
        loadFamily(),
        loadPreferences(),
        loadDisplayPreferences(),
      ]);
      if (cancelled) return;

      setDb(database);
      setFamily(loadedFamily);
      setPreferences(loadedPreferences);
      setDisplay(loadedDisplay);
      setSyncStatus(await getSyncStatus(database));
      setChanges(await getRecentChanges(database, { onlyUnacknowledged: true }));
      setReady(true);
    })().catch(() => {
      // A failed boot must still render the app; the UI shows the sync error.
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Sync ---------------------------------------------------------------
  const refresh = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!db) return null;
      if (syncInFlight.current) return syncInFlight.current;

      if (!options.force && syncStatus.lastAttemptAt) {
        const elapsedMinutes = (Date.now() - Date.parse(syncStatus.lastAttemptAt)) / 60_000;
        if (elapsedMinutes < SYNC_INTERVAL_MINUTES) return null;
      }

      setSyncing(true);
      const work = (async () => {
        try {
          const result = await syncCalendar({ db, interpreter });
          setLastSyncError(result.ok ? null : (result.error ?? 'Sync failed.'));
          setSyncStatus(await getSyncStatus(db));
          setChanges(await getRecentChanges(db, { onlyUnacknowledged: true }));
          setRevision((n) => n + 1);
          return result;
        } finally {
          setSyncing(false);
          syncInFlight.current = null;
        }
      })();

      syncInFlight.current = work;
      return work;
    },
    [db, interpreter, syncStatus.lastAttemptAt],
  );

  // Refresh on launch and whenever the app returns to the foreground, rate
  // limited to the configured interval.
  useEffect(() => {
    if (!ready || !db || !autoSync) return;
    void refresh();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setToday(toDateKey(new Date()));
      void refresh();
    });

    return () => subscription.remove();
  }, [ready, db, autoSync, refresh]);

  // --- Notifications ------------------------------------------------------
  // Reminders are reconciled after every change to events or preferences, so a
  // moved event never leaves a stale reminder behind.
  useEffect(() => {
    if (!db || !preferences || !isSetupComplete(family)) return;
    void syncNotifications({
      db,
      preferences,
      selectedClasses: selectedClassesOf(family),
    }).catch(() => {
      // Notification permission may be denied; the rest of the app still works.
    });
  }, [db, preferences, family, revision]);

  // --- Mutations ----------------------------------------------------------
  const updateFamily = useCallback(async (next: FamilySelection) => {
    await saveFamily(next);
    setFamily(next);
    setRevision((n) => n + 1);
  }, []);

  const updatePreferences = useCallback(async (next: NotificationPreferences) => {
    await savePreferences(next);
    setPreferences(next);
  }, []);

  const updateDisplay = useCallback(async (next: DisplayPreferences) => {
    await saveDisplayPreferences(next);
    setDisplay(next);
  }, []);

  const updateFeedUrl = useCallback(
    async (url: string) => {
      if (!db) return;
      await setFeedUrl(db, url);
      await refresh({ force: true });
    },
    [db, refresh],
  );

  const dismissChanges = useCallback(async () => {
    if (!db) return;
    await acknowledgeChanges(db, changes.map((change) => change.id));
    setChanges([]);
  }, [db, changes]);

  const clearEverything = useCallback(async () => {
    await clearFamilyData();
    setFamily(EMPTY_FAMILY);
    setDisplay(DEFAULT_DISPLAY_PREFERENCES);
    setRevision((n) => n + 1);
  }, []);

  const stale = useMemo(() => {
    if (!syncStatus.lastSuccessAt) return true;
    const ageHours = (Date.now() - Date.parse(syncStatus.lastSuccessAt)) / 3_600_000;
    return ageHours > STALE_AFTER_HOURS || lastSyncError !== null;
  }, [syncStatus.lastSuccessAt, lastSyncError]);

  const value: AppContextValue = {
    ready,
    db,
    family,
    setupComplete: isSetupComplete(family),
    updateFamily,
    preferences: preferences ?? {
      schoolClosure: true,
      earlyFinish: true,
      parentMeetings: true,
      classImportant: true,
      generalActivities: false,
      reminderTypes: { seven_days_before: true, one_day_before: true, morning_of: true },
    },
    updatePreferences,
    display,
    updateDisplay,
    syncStatus,
    syncing,
    stale,
    lastSyncError,
    refresh,
    updateFeedUrl,
    changes,
    dismissChanges,
    clearEverything,
    today,
    revision,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Read events from the database. Re-runs whenever the query or the data changes.
 */
export function useEvents(query: EventQuery): {
  events: NormalizedSchoolEvent[];
  loading: boolean;
} {
  const { db, revision } = useApp();
  const [events, setEvents] = useState<NormalizedSchoolEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const key = JSON.stringify(query);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setLoading(true);

    queryEvents(db, JSON.parse(key) as EventQuery)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [db, key, revision]);

  return { events, loading };
}

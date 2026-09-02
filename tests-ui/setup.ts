/**
 * Test environment for the screen tests.
 *
 * The native modules are replaced with in-memory equivalents so the real screens
 * and the real application state can be exercised without a device:
 *
 *   - `expo-sqlite` is backed by Node's own SQLite, so the production schema and
 *     SQL run for real;
 *   - AsyncStorage is a plain object;
 *   - notification scheduling is recorded rather than delivered.
 */
// --- expo-sqlite ------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  // Required inside the factory: jest hoists mock factories above imports.
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const databases = new Map<string, InstanceType<typeof DatabaseSync>>();

  const openDatabaseAsync = async (name: string) => {
    let db = databases.get(name);
    if (!db) {
      db = new DatabaseSync(':memory:');
      databases.set(name, db);
    }
    const handle = db;

    return {
      execAsync: async (sql: string) => {
        handle.exec(sql);
      },
      runAsync: async (sql: string, params: unknown[] = []) =>
        handle.prepare(sql).run(...(params as never[])),
      getAllAsync: async (sql: string, params: unknown[] = []) =>
        handle.prepare(sql).all(...(params as never[])),
      withTransactionAsync: async (work: () => Promise<void>) => {
        handle.exec('BEGIN');
        try {
          await work();
          handle.exec('COMMIT');
        } catch (error) {
          handle.exec('ROLLBACK');
          throw error;
        }
      },
    };
  };

  return {
    openDatabaseAsync,
    __reset: () => {
      for (const db of databases.values()) db.close();
      databases.clear();
    },
  };
});

// --- AsyncStorage -----------------------------------------------------------

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => store[key] ?? null,
      setItem: async (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: async (key: string) => {
        delete store[key];
      },
      multiRemove: async (keys: string[]) => {
        for (const key of keys) delete store[key];
      },
      clear: async () => {
        store = {};
      },
    },
  };
});

// --- expo-notifications -----------------------------------------------------

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'platform-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// --- expo-constants ---------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eventInterpreter: 'heuristic' } } },
}));

/**
 * The database port.
 *
 * The app runs on `expo-sqlite` on the device; the tests run the *same SQL*
 * against Node's built-in `node:sqlite`. Keeping the surface this small is what
 * makes that possible, and means the schema and queries are genuinely exercised
 * by the test suite rather than mocked away.
 */

export interface SqlDatabase {
  /** Run one or more statements with no parameters, for migrations. */
  execute(sql: string): Promise<void>;
  /** Run a single parameterised statement. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Run a single parameterised query. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run `work` inside a transaction, rolling back if it throws. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export type SqlValue = string | number | null;

/** SQLite has no boolean type; 0/1 is the convention used throughout. */
export function toSqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function fromSqlBoolean(value: number | null): boolean {
  return value === 1;
}

export function toSqlJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Parse a JSON column, falling back to `fallback` rather than throwing.
 * A single corrupt row must not take down the whole screen.
 */
export function fromSqlJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

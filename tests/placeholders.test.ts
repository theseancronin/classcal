/**
 * The `?` → `$n` translation sits under every query, so its edge cases matter:
 * a mistake here silently changes which parameter binds where.
 */
import { describe, expect, it } from 'vitest';

import { toPostgresPlaceholders } from '@/db/placeholders';

describe('toPostgresPlaceholders', () => {
  it('numbers placeholders from one, in order', () => {
    expect(toPostgresPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('leaves SQL without placeholders untouched', () => {
    const sql = 'SELECT count(*) FROM normalized_events';
    expect(toPostgresPlaceholders(sql)).toBe(sql);
  });

  it('keeps counting across many placeholders', () => {
    const sql = `INSERT INTO t VALUES (${Array(12).fill('?').join(', ')})`;
    expect(toPostgresPlaceholders(sql)).toContain('$12');
    expect(toPostgresPlaceholders(sql)).not.toContain('?');
  });

  it('ignores a question mark inside a string literal', () => {
    expect(toPostgresPlaceholders("SELECT 'why?' WHERE a = ?")).toBe(
      "SELECT 'why?' WHERE a = $1",
    );
  });

  it('handles an escaped quote inside a string literal', () => {
    expect(toPostgresPlaceholders("SELECT 'it''s a ? mark' WHERE a = ?")).toBe(
      "SELECT 'it''s a ? mark' WHERE a = $1",
    );
  });

  it('ignores a question mark inside a quoted identifier', () => {
    expect(toPostgresPlaceholders('SELECT "odd?col" FROM t WHERE a = ?')).toBe(
      'SELECT "odd?col" FROM t WHERE a = $1',
    );
  });

  it('ignores a question mark inside a line comment', () => {
    expect(toPostgresPlaceholders('SELECT 1 -- really?\nWHERE a = ?')).toBe(
      'SELECT 1 -- really?\nWHERE a = $1',
    );
  });

  it('ignores a question mark inside a block comment', () => {
    expect(toPostgresPlaceholders('SELECT 1 /* who? */ WHERE a = ?')).toBe(
      'SELECT 1 /* who? */ WHERE a = $1',
    );
  });

  it('handles nested block comments as Postgres does', () => {
    const sql = 'SELECT 1 /* a /* ? */ ? */ WHERE x = ?';
    expect(toPostgresPlaceholders(sql)).toBe('SELECT 1 /* a /* ? */ ? */ WHERE x = $1');
  });

  it('preserves the reserved-word quoting the repository relies on', () => {
    expect(toPostgresPlaceholders('INSERT INTO raw_events (start, "end") VALUES (?, ?)')).toBe(
      'INSERT INTO raw_events (start, "end") VALUES ($1, $2)',
    );
  });

  it('does not treat an unterminated literal as placeholder text', () => {
    expect(toPostgresPlaceholders("SELECT 'oops ? ")).toBe("SELECT 'oops ? ");
  });
});

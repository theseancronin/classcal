/**
 * Placeholder translation.
 *
 * The repository is written with SQLite-style `?` placeholders. Postgres wants
 * `$1, $2, …`. Rewriting 728 lines of tested SQL to change punctuation would be
 * a poor trade, so the translation happens here instead — once, in one place.
 *
 * The scan has to respect string literals, quoted identifiers and comments: a
 * `?` inside `'why?'` is data, not a placeholder, and must be left alone.
 */

export function toPostgresPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];

    // Single-quoted string literal: '' is an escaped quote, not a terminator.
    if (char === "'") {
      const end = scanQuoted(sql, i, "'");
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Double-quoted identifier.
    if (char === '"') {
      const end = scanQuoted(sql, i, '"');
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Line comment, to end of line.
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i);
      const end = newline === -1 ? sql.length : newline;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment, which Postgres allows to nest.
    if (char === '/' && next === '*') {
      const end = scanBlockComment(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (char === '?') {
      index += 1;
      out += `$${index}`;
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/** Advance past a quoted run starting at `start`, handling doubled quotes. */
function scanQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2; // Escaped quote, still inside.
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length; // Unterminated; let the database report it.
}

/** Advance past a `/* … *​/` comment, honouring nesting as Postgres does. */
function scanBlockComment(sql: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < sql.length) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth += 1;
      i += 2;
      continue;
    }
    if (sql[i] === '*' && sql[i + 1] === '/') {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return sql.length;
}

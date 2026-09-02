/**
 * Shared text preparation for the deterministic normalizers.
 *
 * The GSMNC feed mixes Irish and English, uses inconsistent accenting
 * ("Naíonáin", "Nai", "Naionain") and occasionally contains bytes that are not
 * valid UTF-8. Everything downstream works on an accent-folded, lowercased,
 * whitespace-collapsed form so that a single alias table covers all variants.
 */

/** Strip diacritics without depending on a locale-aware collator. */
export function foldAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Lowercase, fold accents, replace the Unicode punctuation the feed uses
 * (en dashes, curly quotes, non-breaking spaces) with ASCII equivalents, and
 * collapse runs of whitespace.
 */
export function foldForMatching(input: string): string {
  return foldAccents(input)
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode bytes that are *mostly* UTF-8 but contain invalid sequences, which the
 * school's feed does. Invalid bytes are reinterpreted as windows-1252 rather
 * than discarded, so "Naíonáin" survives even in a damaged region.
 */
export function decodeCalendarBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: true });

  try {
    return utf8.decode(bytes);
  } catch {
    // The feed is valid UTF-8 apart from isolated damaged regions. Decoding the
    // whole file as windows-1252 would mangle every correctly-encoded accent, so
    // fall back one line at a time and keep the good lines as UTF-8.
    return decodeLineByLine(bytes, utf8);
  }
}

const LINE_FEED = 0x0a;

function decodeLineByLine(bytes: Uint8Array, utf8: TextDecoder): string {
  const latin1 = new TextDecoder('windows-1252');
  const out: string[] = [];
  let lineStart = 0;

  for (let i = 0; i <= bytes.length; i += 1) {
    if (i !== bytes.length && bytes[i] !== LINE_FEED) continue;
    const line = bytes.subarray(lineStart, i);
    try {
      out.push(utf8.decode(line));
    } catch {
      out.push(latin1.decode(line));
    }
    lineStart = i + 1;
  }

  return out.join('\n');
}

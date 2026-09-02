/**
 * A small, dependency-free content hash.
 *
 * Used only to detect that a source event's payload changed, so a fast
 * non-cryptographic function is appropriate. `crypto.subtle` is deliberately
 * avoided: it is async and not uniformly available across the React Native
 * runtimes this app targets.
 *
 * Two independent FNV-1a lanes with different offset bases give a 64-bit
 * digest, which is ample for a calendar containing a few hundred events.
 */

const FNV_PRIME = 0x01000193;

function fnv1a(input: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function contentHash(input: string): string {
  const a = fnv1a(input, 0x811c9dc5);
  const b = fnv1a(`${input}`, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Hash an object by its own key order after sorting, so that a re-serialised
 * payload with reordered keys does not read as a change.
 */
export function stableHash(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${key}=${serialize(value[key])}`);
  return contentHash(parts.join(''));
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(serialize).join('');
  if (typeof value === 'object') return stableHash(value as Record<string, unknown>);
  return String(value);
}

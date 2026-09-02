/**
 * Deterministic school-class alias resolution.
 *
 * This is the single place that decides which classes a piece of calendar text
 * refers to. The LLM interpreter may propose classes, but its output is always
 * re-run through `canonicalizeClasses` before persistence, so an invented or
 * mis-spelled identifier can never reach the database.
 */
import { SCHOOL_CLASSES, type SchoolClass } from '@/domain/types';
import { foldForMatching } from './text';

const NUMBERED_CLASSES: readonly SchoolClass[] = [
  'class_1',
  'class_2',
  'class_3',
  'class_4',
  'class_5',
  'class_6',
];

const INFANT_CLASSES: readonly SchoolClass[] = ['junior_infants', 'senior_infants'];

/** Canonical order used whenever a class list is rendered or compared. */
const CLASS_ORDER: Record<SchoolClass, number> = {
  whole_school: 0,
  junior_infants: 1,
  senior_infants: 2,
  class_1: 3,
  class_2: 4,
  class_3: 5,
  class_4: 6,
  class_5: 7,
  class_6: 8,
  parents: 9,
  unknown: 10,
};

export function sortClasses(classes: Iterable<SchoolClass>): SchoolClass[] {
  return [...new Set(classes)].sort((a, b) => CLASS_ORDER[a] - CLASS_ORDER[b]);
}

/** True for a value that is a member of the canonical `SchoolClass` union. */
export function isSchoolClass(value: unknown): value is SchoolClass {
  return typeof value === 'string' && (SCHOOL_CLASSES as readonly string[]).includes(value);
}

function classForNumber(n: number): SchoolClass | null {
  return n >= 1 && n <= 6 ? (`class_${n}` as SchoolClass) : null;
}

/**
 * Phrases that name a specific class directly. Longest-first matching means
 * "junior infants" wins over the bare "infants" rule.
 */
const DIRECT_ALIASES: ReadonlyArray<readonly [RegExp, readonly SchoolClass[]]> = [
  // --- Junior Infants ---
  [/\bnaionain\s+bheaga\b/g, ['junior_infants']],
  [/\bnaion(?:ain)?\.?\s*bh(?:eaga)?\b/g, ['junior_infants']],
  [/\bnai\.?\s*bh(?:eaga)?\b/g, ['junior_infants']],
  [/\bjunior\s+infants?\b/g, ['junior_infants']],
  [/\bjnr\.?\s+infants?\b/g, ['junior_infants']],

  // --- Senior Infants ---
  [/\bnaionain\s+mhora\b/g, ['senior_infants']],
  [/\bnaion(?:ain)?\.?\s*mh(?:ora)?\b/g, ['senior_infants']],
  [/\bnai\.?\s*mh(?:ora)?\b/g, ['senior_infants']],
  [/\bsenior\s+infants?\b/g, ['senior_infants']],
  [/\bsnr\.?\s+infants?\b/g, ['senior_infants']],

  // --- Both infant classes (spec rule 9: bare "Infants" means both) ---
  [/\bnaionain\b/g, INFANT_CLASSES],
  [/\binfants?\b/g, INFANT_CLASSES],

  // --- Whole school ---
  [/\ban\s+scoil\s+ar\s+fad\b/g, ['whole_school']],
  [/\bscoil\s+ar\s+fad\b/g, ['whole_school']],
  [/\bwhole\s+school\b/g, ['whole_school']],
  [/\ball\s+classes\b/g, ['whole_school']],
  [/\bschool[-\s]wide\b/g, ['whole_school']],
  [/\bgach\s+rang\b/g, ['whole_school']],

  // --- Parents ---
  [/\btuismitheoiri\b/g, ['parents']],
  [/\bthuismitheoiri\b/g, ['parents']],
  [/\btuisti\b/g, ['parents']],
  [/\bthuisti\b/g, ['parents']],
  [/\bparents?\b/g, ['parents']],
  [/\bcairde\b/g, ['parents']],
];

/**
 * A single numbered-class mention: "R4", "Rang a 4", "4th", "4th class",
 * "class 4", "rang 4". A bare number is deliberately not an anchor -- bare
 * numbers are only accepted when chained after an explicit mention, so a time
 * such as "12:00" never becomes 1st and 2nd class.
 */
const CLASS_ANCHOR = String.raw`(?:rang(?:anna)?\s*(?:a\s*)?([1-6])|class(?:es)?\s*([1-6])|r\.?\s*([1-6])\b|([1-6])\s*(?:st|nd|rd|th)\b)`;

/** Separators that continue a class chain. */
const CHAIN_LINK = String.raw`\s*(?:-|to\b|go\s+dti\b|&|\+|and\b|agus\b|/|,)\s*`;

const CLASS_CHAIN = new RegExp(
  `${CLASS_ANCHOR}(?:${CHAIN_LINK}(?:${CLASS_ANCHOR}|[1-6]\\b))*`,
  'g',
);

const RANGE_SEPARATORS = new Set(['-', 'to', 'go dti']);

function anchorNumber(groups: (string | undefined)[]): number | null {
  for (const g of groups) {
    if (g !== undefined) return Number(g);
  }
  return null;
}

/**
 * Expand one chain expression such as "R3-R6", "Rang 5&6" or "1st to 6th"
 * into the classes it names.
 */
function expandChain(chain: string): SchoolClass[] {
  const found: SchoolClass[] = [];
  const anchorRe = new RegExp(`${CLASS_ANCHOR}|([1-6])\\b`, 'g');
  const numbers: { value: number; index: number; end: number }[] = [];

  for (let m = anchorRe.exec(chain); m; m = anchorRe.exec(chain)) {
    const value = anchorNumber(m.slice(1));
    if (value === null) continue;
    numbers.push({ value, index: m.index, end: m.index + m[0].length });
  }

  for (let i = 0; i < numbers.length; i += 1) {
    const current = numbers[i]!;
    const cls = classForNumber(current.value);
    if (cls) found.push(cls);

    const next = numbers[i + 1];
    if (!next) continue;

    const separator = chain.slice(current.end, next.index).trim().toLowerCase();
    if (RANGE_SEPARATORS.has(separator) && next.value > current.value) {
      for (let n = current.value + 1; n < next.value; n += 1) {
        const filler = classForNumber(n);
        if (filler) found.push(filler);
      }
    }
  }

  return found;
}

export type ClassMatch = {
  classes: SchoolClass[];
  /** The matched substring of the folded text, useful for debugging and review. */
  text: string;
  index: number;
};

/**
 * Find every class reference in a piece of source text, in order of appearance.
 * Overlapping matches are resolved first-come, and the numbered-chain pass runs
 * before the alias passes so "R1-R6" is never split apart.
 */
export function findClassMatches(input: string): ClassMatch[] {
  const folded = foldForMatching(input);
  const claimed: { start: number; end: number }[] = [];
  const matches: ClassMatch[] = [];

  const overlaps = (start: number, end: number) =>
    claimed.some((span) => start < span.end && end > span.start);

  const collect = (regex: RegExp, resolve: (text: string) => SchoolClass[]) => {
    regex.lastIndex = 0;
    for (let m = regex.exec(folded); m; m = regex.exec(folded)) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      if (overlaps(start, end)) continue;
      const classes = resolve(m[0]);
      if (classes.length === 0) continue;
      claimed.push({ start, end });
      matches.push({ classes: sortClasses(classes), text: m[0], index: start });
    }
  };

  collect(CLASS_CHAIN, expandChain);
  for (const [pattern, classes] of DIRECT_ALIASES) {
    collect(pattern, () => [...classes]);
  }

  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Resolve all classes named anywhere in the text.
 *
 * Returns an empty array when the text names no class at all; callers decide
 * whether that means whole-school or `unknown` based on the event type.
 */
export function resolveClasses(input: string): SchoolClass[] {
  const all = findClassMatches(input).flatMap((m) => m.classes);
  return sortClasses(all);
}

/**
 * Coerce an arbitrary list of proposed class identifiers (typically from a
 * language model) to canonical values, dropping anything unrecognised.
 */
export function canonicalizeClasses(values: readonly unknown[]): {
  classes: SchoolClass[];
  rejected: unknown[];
} {
  const classes: SchoolClass[] = [];
  const rejected: unknown[] = [];

  for (const value of values) {
    if (isSchoolClass(value)) {
      classes.push(value);
      continue;
    }
    if (typeof value === 'string') {
      const resolved = resolveClasses(value);
      if (resolved.length > 0) {
        classes.push(...resolved);
        continue;
      }
    }
    rejected.push(value);
  }

  return { classes: sortClasses(classes), rejected };
}

/**
 * `whole_school` subsumes the individual classes, so a list containing it is
 * collapsed. A list naming every teaching class is promoted to `whole_school`
 * so the relevance engine and the UI treat it as one event for the family.
 */
export function collapseClassList(classes: readonly SchoolClass[]): SchoolClass[] {
  const set = new Set(sortClasses(classes));
  const hasParents = set.has('parents');

  const asWholeSchool = (): SchoolClass[] =>
    hasParents ? ['whole_school', 'parents'] : ['whole_school'];

  if (set.has('whole_school')) return asWholeSchool();
  if (ALL_TEACHING_CLASSES.every((c) => set.has(c))) return asWholeSchool();

  set.delete('unknown');
  return set.size === 0 ? ['unknown'] : sortClasses(set);
}

export const ALL_TEACHING_CLASSES: readonly SchoolClass[] = [
  ...INFANT_CLASSES,
  ...NUMBERED_CLASSES,
];

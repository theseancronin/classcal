/**
 * Human-readable rendering of domain values.
 *
 * Kept separate from the types so both the interpreter's generated summaries and
 * the UI produce identical wording for the same data.
 */
import { CLASS_LABELS, type ClassSpecificDetail, type SchoolClass } from './types';

const NUMBERED_ORDER: readonly SchoolClass[] = [
  'class_1',
  'class_2',
  'class_3',
  'class_4',
  'class_5',
  'class_6',
];

const SHORT_NUMBERED: Record<string, string> = {
  class_1: '1st',
  class_2: '2nd',
  class_3: '3rd',
  class_4: '4th',
  class_5: '5th',
  class_6: '6th',
};

/**
 * Render a class list compactly: consecutive numbered classes collapse to a
 * range, and both infant classes collapse to "Infants".
 *
 * `["junior_infants","senior_infants","class_1",...,"class_6"]`
 *   -> "Infants and 1st–6th Class"
 */
export function formatClassList(classes: readonly SchoolClass[]): string {
  const set = new Set(classes);
  if (set.has('whole_school')) return 'Whole school';

  const parts: string[] = [];

  const hasJunior = set.has('junior_infants');
  const hasSenior = set.has('senior_infants');
  if (hasJunior && hasSenior) parts.push('Infants');
  else if (hasJunior) parts.push(CLASS_LABELS.junior_infants);
  else if (hasSenior) parts.push(CLASS_LABELS.senior_infants);

  const numbered = NUMBERED_ORDER.filter((c) => set.has(c));
  for (const run of consecutiveRuns(numbered)) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    if (run.length >= 3) parts.push(`${SHORT_NUMBERED[first]}–${SHORT_NUMBERED[last]} Class`);
    else parts.push(...run.map((c) => CLASS_LABELS[c]));
  }

  if (set.has('parents')) parts.push(CLASS_LABELS.parents);
  if (parts.length === 0) return CLASS_LABELS.unknown;

  return joinWithAnd(parts);
}

function consecutiveRuns(classes: readonly SchoolClass[]): SchoolClass[][] {
  const runs: SchoolClass[][] = [];
  for (const cls of classes) {
    const index = NUMBERED_ORDER.indexOf(cls);
    const current = runs[runs.length - 1];
    const previousIndex = current ? NUMBERED_ORDER.indexOf(current[current.length - 1]!) : -99;
    if (current && index === previousIndex + 1) current.push(cls);
    else runs.push([cls]);
  }
  return runs;
}

export function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Describe per-class times, grouping classes that share a time.
 *
 * `Infants 12:50, 1st–6th Class 13:00` with `which: "finish"` becomes
 * "Infants finish at 12:50 and 1st–6th Class finish at 13:00".
 */
export function describeClassTimes(
  details: readonly ClassSpecificDetail[],
  which: 'start' | 'finish',
): string | null {
  const byTime = new Map<string, SchoolClass[]>();

  for (const detail of details) {
    const time = which === 'finish' ? detail.finishTime : detail.startTime;
    if (!time) continue;
    const existing = byTime.get(time);
    if (existing) existing.push(detail.schoolClass);
    else byTime.set(time, [detail.schoolClass]);
  }

  if (byTime.size === 0) return null;

  const verb = which === 'finish' ? 'finish' : 'start';
  const phrases = [...byTime.entries()].map(
    ([time, classes]) => `${formatClassList(classes)} ${verb} at ${time}`,
  );

  return `${joinWithAnd(phrases)}.`;
}

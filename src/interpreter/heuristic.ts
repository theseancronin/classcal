/**
 * The rule-based interpreter.
 *
 * This is the default implementation and it runs entirely on-device with no
 * network access. It exists because the product principle is "use deterministic
 * software wherever ordinary code is more reliable" -- the GSMNC calendar uses a
 * small, highly repetitive vocabulary, and regular expressions read it more
 * reliably (and far more cheaply) than a language model.
 *
 * The Gemma interpreter is an optional upgrade for unusual wording; this module
 * is what makes the app useful with no model configured at all.
 */
import { findClassMatches, resolveClasses, sortClasses } from '@/classes/classAliases';
import { findTimes, type TimeMention } from '@/classes/timeParsing';
import { foldForMatching } from '@/classes/text';
import { describeClassTimes } from '@/domain/labels';
import {
  CLASS_LABELS,
  type ClassSpecificDetail,
  type EventType,
  type InterpretedCalendarEvent,
  type RawCalendarEvent,
  type SchoolClass,
} from '@/domain/types';
import type { CalendarEventInterpreter } from './types';

/**
 * Event-type rules, evaluated in order -- the first match wins, so the more
 * specific and more consequential patterns are listed first. A closure that is
 * really a half day must classify as `early_finish`, not `school_closure`.
 */
const TYPE_RULES: ReadonlyArray<{ type: EventType; pattern: RegExp; tags?: string[] }> = [
  {
    type: 'early_finish',
    pattern:
      /\b(nios luath|leath la|leath-la|half day|half-day|early finish|finishing early|closed earlier|close early|closing early|early collection)\b/,
    tags: ['collection_change'],
  },
  {
    type: 'late_start',
    pattern: /\b(late start|starting later|nios deanai ag tosnu|delayed start|opens later)\b/,
  },
  {
    // Deliberately narrower than "saoire" alone: "Lá saoire" is a single day off
    // and belongs under school_closure, whereas "Laethanta saoire" is a period.
    type: 'school_holiday',
    pattern: /\b(laethanta saoire|holidays|mid[- ]?term|halloween break|easter break|break\b)/,
  },
  {
    type: 'school_closure',
    pattern: /\b(scoil dunta|dunadh scoile|school clos|closed|closure|no school)\b/,
  },
  {
    type: 'parent_teacher_meeting',
    pattern:
      /\b(cruinnithe tuisti\s*\/\s*muinteoiri|tuisti\s*\/\s*muinteoiri|parent\s*\/?\s*teacher meeting)/,
  },
  {
    type: 'parent_association',
    pattern: /\b(cairde|parents? association)\b/,
  },
  {
    type: 'parent_information_meeting',
    pattern:
      /\b(cruinniu|cruinnithe|parents? meeting|information meeting|open evening|open night|trathnona oscailte|maidin eolais)\b/,
  },
  {
    type: 'non_uniform_day',
    pattern:
      /\b(gan eide|non[- ]uniform|no uniform|gleasadh suas|dress up|geansaithe nollag|christmas jumper|pyjama)\b/,
  },
  { type: 'swimming', pattern: /\b(snamh|swimming)\b/ },
  { type: 'choir', pattern: /\b(cor na scoile|choir)\b/ },
  {
    type: 'sports',
    pattern:
      /\b(peil|traenail|iomanaiocht|camogaiocht|camogie|hurling|sport|spoirt|rasanna|trastire|cross ?country|athletics|gleacaiocht|gymnastics|blitz|sports day)\b/,
  },
  {
    type: 'performance',
    pattern:
      /\b(seo |seo$|show|dramaiocht|drama|ceili|concert|coirm|nativity|play|public speaking|uraidi|spelling bee|laoch an litrithe)\b/,
  },
  { type: 'trip', pattern: /\b(turas|trip|outing|excursion|visit to)\b/ },
  { type: 'deadline', pattern: /\b(spriocdhata|deadline|last day (for|to)|due back|closing date)\b/ },
  {
    type: 'school_event',
    pattern:
      /\b(maidin caife|coffee morning|crannchur|raffle|seachtain|week\b|la na|grandparents|open day|assembly|mass|aifreann|graduation)\b/,
  },
  {
    // Themed days and fortnights: "Lá Bac ar Bhéarla", "Coicís na Gaeilge",
    // "Lá Idir Náisiúnta / Multi Cultural Day". These are whole-school events
    // with no other distinguishing vocabulary, so this rule runs last.
    type: 'school_event',
    pattern: /(^la\b|\bcoicis\b|\bday\b|\bfeile\b|\bfestival\b)/,
  },
];

/** Extra tags recognised independently of the primary event type. */
const TAG_RULES: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: 'staff_meeting', pattern: /\b(cruinniu foirne|staff meeting)\b/ },
  { tag: 'bank_holiday', pattern: /\b(la saoire bainc|bank holiday)\b/ },
  { tag: 'training_day', pattern: /\b(traenail on roinn|training day|inservice|in-service)\b/ },
  { tag: 'lunch_provided', pattern: /\b(lon curtha ar fail|lunch provided)\b/ },
  { tag: 'full_day', pattern: /\b(la iomlan|full day)\b/ },
  { tag: 'bus', pattern: /\b(bus|fagaint an scoil|leaving the school)\b/ },
  { tag: 'collection_change', pattern: /\b(bailiu|collection|pick ?up)\b/ },
  { tag: 'time_tba', pattern: /\b(lbc|tba|tbc|le cinntiu)\b/ },
];

/** Wording that signals the event is provisional or unclear. */
const AMBIGUITY_PATTERN = /\b(lbc|tba|tbc|le cinntiu|maybe|possibly|\?)\b/;

const CANCELLATION_PATTERN = /\b(curtha ar ceal|cancelled|canceled|ar ceal)\b/;

/** Event types whose associated time is a finishing time, not a starting time. */
const FINISH_TIME_TYPES: readonly EventType[] = ['early_finish', 'changed_hours'];

/**
 * Types whose whole-school scope is certain when no class is named -- a closure
 * with no class mentioned closes the school for everyone.
 *
 * Other unnamed events also default to `whole_school` (see `interpretDeterministically`),
 * because showing one extra event is far less harmful than hiding one that
 * mattered, but those are marked lower-confidence since the scope was inferred.
 */
const CERTAIN_WHOLE_SCHOOL_TYPES: readonly EventType[] = [
  'school_closure',
  'school_holiday',
  'early_finish',
  'late_start',
  'changed_hours',
  'non_uniform_day',
  'school_event',
];

function detectType(folded: string): { type: EventType; tags: string[] } {
  for (const rule of TYPE_RULES) {
    if (rule.pattern.test(folded)) {
      return { type: rule.type, tags: [...(rule.tags ?? [])] };
    }
  }
  return { type: 'other', tags: [] };
}

function detectTags(folded: string): string[] {
  return TAG_RULES.filter((rule) => rule.pattern.test(folded)).map((rule) => rule.tag);
}

/**
 * Associate times with the class they follow.
 *
 * "Naíonáin @12.50in & R1 - R6 @1.00in" gives each class its own finish time by
 * scanning the text between one class mention and the next.
 */
function buildClassDetails(text: string, eventType: EventType): ClassSpecificDetail[] {
  const folded = foldForMatching(text);
  const classMatches = findClassMatches(text);
  const times = findTimes(text);
  if (classMatches.length === 0 || times.length === 0) return [];

  const wantsFinishTime = FINISH_TIME_TYPES.includes(eventType);
  const byClass = new Map<SchoolClass, ClassSpecificDetail>();

  classMatches.forEach((match, i) => {
    const windowStart = match.index + match.text.length;
    const next = classMatches[i + 1];
    const windowEnd = next ? next.index : folded.length;

    const inWindow = times.filter((t) => t.index >= windowStart && t.index < windowEnd);
    if (inWindow.length === 0) return;

    const detail = timesToDetail(inWindow, wantsFinishTime);
    for (const schoolClass of match.classes) {
      // First mention wins: the Irish half of a bilingual summary comes first
      // and the English half repeats the same information.
      if (!byClass.has(schoolClass)) {
        byClass.set(schoolClass, { schoolClass, ...detail });
      }
    }
  });

  return sortClasses([...byClass.keys()]).map((c) => byClass.get(c)!);
}

function timesToDetail(
  times: TimeMention[],
  wantsFinishTime: boolean,
): { startTime?: string; finishTime?: string } {
  const first = times[0]!;
  const second = times[1];

  if (second) return { startTime: first.time, finishTime: second.time };
  return wantsFinishTime ? { finishTime: first.time } : { startTime: first.time };
}

/** Event-level times, used when no per-class breakdown was found. */
function buildEventTimes(
  text: string,
  eventType: EventType,
  classDetails: ClassSpecificDetail[],
): { startTime?: string; endTime?: string } {
  if (classDetails.length > 0) {
    const starts = new Set(classDetails.map((d) => d.startTime));
    const finishes = new Set(classDetails.map((d) => d.finishTime));
    // Only promote to event level when every class shares the same time.
    if (starts.size === 1 && finishes.size === 1) {
      const start = classDetails[0]!.startTime;
      const finish = classDetails[0]!.finishTime;
      return { ...(start ? { startTime: start } : {}), ...(finish ? { endTime: finish } : {}) };
    }
    return {};
  }

  const times = findTimes(text);
  const first = times[0];
  if (!first) return {};
  const second = times[1];
  if (second) return { startTime: first.time, endTime: second.time };
  return FINISH_TIME_TYPES.includes(eventType)
    ? { endTime: first.time }
    : { startTime: first.time };
}

const TITLE_TEMPLATES: Record<EventType, string> = {
  school_closure: 'School closed',
  school_holiday: 'School holidays',
  early_finish: 'Early finish',
  late_start: 'Late start',
  changed_hours: 'Changed school hours',
  parent_teacher_meeting: 'Parent/teacher meetings',
  parent_information_meeting: 'Parent meeting',
  parent_association: 'Parents association meeting',
  class_activity: 'Class activity',
  sports: 'Sports',
  swimming: 'Swimming',
  choir: 'Choir',
  performance: 'Performance',
  school_event: 'School event',
  non_uniform_day: 'Non-uniform day',
  trip: 'School trip',
  deadline: 'Deadline',
  reminder: 'Reminder',
  other: 'School calendar event',
};

/** Types where naming the class in the title genuinely helps a parent scan. */
const CLASS_IN_TITLE: readonly EventType[] = [
  'swimming',
  'sports',
  'choir',
  'class_activity',
  'trip',
  'performance',
  'parent_information_meeting',
];

function buildTitle(eventType: EventType, appliesTo: SchoolClass[]): string {
  const base = TITLE_TEMPLATES[eventType];
  if (!CLASS_IN_TITLE.includes(eventType)) return base;

  const named = appliesTo.filter((c) => c !== 'whole_school' && c !== 'unknown' && c !== 'parents');
  if (named.length === 0 || named.length > 3) return base;
  return `${base} — ${named.map((c) => CLASS_LABELS[c]).join(', ')}`;
}

function buildSummary(
  eventType: EventType,
  classDetails: ClassSpecificDetail[],
  times: { startTime?: string; endTime?: string },
  tags: string[],
): string {
  const reason = tags.includes('staff_meeting')
    ? ' because of a staff meeting'
    : tags.includes('training_day')
      ? ' for a Department training day'
      : tags.includes('bank_holiday')
        ? ' for the bank holiday'
        : '';

  switch (eventType) {
    case 'school_closure':
      return `The school is closed${reason}.`;
    case 'school_holiday':
      return 'The school is closed for holidays.';
    case 'early_finish': {
      const detail = describeClassTimes(classDetails, 'finish');
      return detail
        ? `School finishes early${reason}. ${detail}`
        : `School finishes earlier than usual${reason}.`;
    }
    case 'late_start': {
      const detail = describeClassTimes(classDetails, 'start');
      return detail ? `School starts later than usual. ${detail}` : 'School starts later than usual.';
    }
    case 'changed_hours': {
      const detail = describeClassTimes(classDetails, 'finish');
      return detail ? `School hours have changed. ${detail}` : 'School hours have changed.';
    }
    case 'parent_teacher_meeting':
      return withTime('Parent and teacher meetings take place', times);
    case 'parent_information_meeting':
      return withTime('An information meeting for parents takes place', times);
    case 'parent_association':
      return withTime('The parents association meets', times);
    case 'non_uniform_day':
      return 'Children do not wear school uniform.';
    case 'swimming':
      return withTime('Swimming', times);
    case 'choir':
      return withTime('Choir practice', times);
    case 'sports':
      return withTime('Sports training', times);
    case 'performance':
      return withTime('A school performance takes place', times);
    case 'trip':
      return withTime('A school trip takes place', times);
    case 'deadline':
      return 'Something is due on this date.';
    case 'class_activity':
      return withTime('A class activity takes place', times);
    case 'school_event':
      return withTime('A school event takes place', times);
    default:
      return 'See the original calendar wording for details.';
  }
}

function withTime(lead: string, times: { startTime?: string; endTime?: string }): string {
  if (times.startTime && times.endTime) return `${lead} from ${times.startTime} to ${times.endTime}.`;
  if (times.startTime) return `${lead} at ${times.startTime}.`;
  if (times.endTime) return `${lead}, finishing at ${times.endTime}.`;
  return `${lead}.`;
}

const ACTION_TEMPLATES: Partial<Record<EventType, string>> = {
  school_closure: 'Arrange childcare — there is no school on this day.',
  early_finish: 'Arrange an earlier collection.',
  late_start: 'Bring your child in later than usual.',
  changed_hours: 'Check the new start and finish times.',
  school_holiday: 'Arrange childcare for the holidays.',
  parent_teacher_meeting: 'Book or attend your meeting slot.',
  parent_information_meeting: 'Attend if you can.',
  non_uniform_day: 'Send your child in their own clothes.',
  deadline: 'Return or complete this before the date.',
  swimming: 'Pack swimming gear.',
  trip: 'Check whether a permission slip or payment is needed.',
};

/** Types where a parent must do something. Enforced again in normalization. */
const ACTION_REQUIRED_TYPES: readonly EventType[] = [
  'school_closure',
  'school_holiday',
  'early_finish',
  'late_start',
  'changed_hours',
  'parent_teacher_meeting',
  'parent_information_meeting',
  'deadline',
  'non_uniform_day',
];

export class HeuristicCalendarEventInterpreter implements CalendarEventInterpreter {
  readonly id = 'heuristic-v1';

  async interpret(event: RawCalendarEvent): Promise<InterpretedCalendarEvent> {
    return interpretDeterministically(event);
  }
}

/** Exposed separately so the Gemma adapter can reuse it as its fallback. */
export function interpretDeterministically(event: RawCalendarEvent): InterpretedCalendarEvent {
  const text = [event.title, event.description].filter(Boolean).join(' \n ');
  const folded = foldForMatching(text);

  const { type: detectedType, tags: typeTags } = detectType(folded);
  const cancelled = CANCELLATION_PATTERN.test(folded);

  let appliesTo = resolveClasses(text);
  let eventType = detectedType;

  // A named class with no recognisable activity is a class activity, not "other".
  if (eventType === 'other' && appliesTo.some((c) => c !== 'parents')) {
    eventType = 'class_activity';
  }

  // Scope inferred rather than stated. Tracked so confidence reflects the guess.
  const scopeInferred = appliesTo.length === 0;
  if (scopeInferred) appliesTo = ['whole_school'];

  const classDetails = buildClassDetails(text, eventType);
  const times = buildEventTimes(text, eventType, classDetails);
  const tags = [...new Set([...typeTags, ...detectTags(folded), ...(cancelled ? ['cancelled'] : [])])];

  const ambiguous =
    AMBIGUITY_PATTERN.test(folded) || eventType === 'other' || appliesTo.includes('unknown');

  const parentActionRequired = ACTION_REQUIRED_TYPES.includes(eventType);
  const parentAction = ACTION_TEMPLATES[eventType];

  return {
    title: buildTitle(eventType, appliesTo),
    summary: buildSummary(eventType, classDetails, times, tags),
    eventType,
    appliesTo: sortClasses(appliesTo),
    classDetails,
    parentActionRequired,
    ...(parentAction ? { parentAction } : {}),
    ...times,
    ...(event.location ? { location: event.location } : {}),
    tags: tags.slice(0, 12),
    confidence: scoreConfidence(eventType, appliesTo, ambiguous, scopeInferred),
    ambiguous,
  };
}

/**
 * Confidence reflects how much of the event the rules actually explained.
 * Anything below the review threshold is held back from critical notifications.
 */
function scoreConfidence(
  eventType: EventType,
  appliesTo: SchoolClass[],
  ambiguous: boolean,
  scopeInferred: boolean,
): number {
  let score = 0.95;
  if (eventType === 'other') score -= 0.35;
  if (eventType === 'class_activity') score -= 0.1;
  if (appliesTo.includes('unknown')) score -= 0.25;
  // An inferred whole-school scope is safe but unverified, except for the types
  // where "no class named" genuinely means "everyone".
  if (scopeInferred && !CERTAIN_WHOLE_SCHOOL_TYPES.includes(eventType)) score -= 0.15;
  if (ambiguous) score -= 0.15;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

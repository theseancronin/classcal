/** Builders that keep the tests readable and the fixtures honest. */
import type {
  Child,
  FamilySelection,
  NormalizedSchoolEvent,
  RawCalendarEvent,
  SelectableClass,
} from '@/domain/types';

export const NOW = '2026-09-20T09:00:00.000Z';

export function makeRawEvent(overrides: Partial<RawCalendarEvent> = {}): RawCalendarEvent {
  return {
    sourceId: 'raw-1',
    sourceCalendar: 'gsmnc',
    sourceUid: 'uid-1',
    title: 'Scoil Dúnta - Lá saoire School Closure',
    start: '2026-09-28T00:00:00.000Z',
    end: '2026-09-29T00:00:00.000Z',
    allDay: true,
    rawPayloadHash: 'hash-1',
    fetchedAt: NOW,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<NormalizedSchoolEvent> = {}): NormalizedSchoolEvent {
  return {
    id: 'event-1',
    rawEventId: 'raw-1',
    title: 'School closed',
    summary: 'The school is closed.',
    date: '2026-09-28',
    endDate: '2026-09-28',
    allDay: true,
    eventType: 'school_closure',
    importance: 'critical',
    appliesTo: ['whole_school'],
    classDetails: [],
    parentActionRequired: true,
    tags: [],
    confidence: 0.95,
    needsReview: false,
    originalTitle: 'Scoil Dúnta - Lá saoire School Closure',
    sourceUrl: 'https://www.gsmnc.ie/calendar/',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeChild(schoolClass: SelectableClass, name?: string): Child {
  return { id: `child-${schoolClass}`, schoolClass, ...(name ? { name } : {}) };
}

export function makeFamily(...children: Child[]): FamilySelection {
  return { children, setupCompletedAt: NOW };
}

/** The spec's worked example household: Aoife in Junior Infants, Jack in 4th. */
export const AOIFE_AND_JACK = makeFamily(
  makeChild('junior_infants', 'Aoife'),
  makeChild('class_4', 'Jack'),
);

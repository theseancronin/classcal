import { describe, expect, it } from 'vitest';

import {
  affectedChildren,
  affectedLabel,
  classTimeFor,
  filterRelevant,
  isRelevant,
  selectedClassesOf,
} from '@/relevance/relevance';
import { AOIFE_AND_JACK, makeChild, makeEvent, makeFamily } from './support/factories';

const JUNIOR_INFANTS_ONLY = makeFamily(makeChild('junior_infants'));

describe('isRelevant', () => {
  it('shows a Junior Infants event to a Junior Infants household', () => {
    const event = makeEvent({ appliesTo: ['junior_infants'], eventType: 'class_activity' });
    expect(isRelevant(event, ['junior_infants'])).toBe(true);
  });

  it('hides a 4th-class event from a Junior Infants-only household', () => {
    const event = makeEvent({ appliesTo: ['class_4'], eventType: 'class_activity' });
    expect(isRelevant(event, ['junior_infants'])).toBe(false);
  });

  it('shows a whole-school event to every household', () => {
    const event = makeEvent({ appliesTo: ['whole_school'] });
    expect(isRelevant(event, ['junior_infants'])).toBe(true);
    expect(isRelevant(event, ['class_6'])).toBe(true);
  });

  it('shows an event to a household with any matching child', () => {
    const event = makeEvent({ appliesTo: ['class_4'], eventType: 'swimming' });
    expect(isRelevant(event, ['junior_infants', 'class_4'])).toBe(true);
  });

  it('shows an event that matches both children', () => {
    const event = makeEvent({ appliesTo: ['junior_infants', 'class_4'], eventType: 'class_activity' });
    expect(isRelevant(event, ['junior_infants', 'class_4'])).toBe(true);
  });

  it('shows a parents-wide event to everyone', () => {
    const event = makeEvent({ appliesTo: ['parents'], eventType: 'parent_teacher_meeting' });
    expect(isRelevant(event, ['class_2'])).toBe(true);
  });

  it('hides parent-association events unless the parent opts in', () => {
    const event = makeEvent({ appliesTo: ['parents'], eventType: 'parent_association' });
    expect(isRelevant(event, ['class_2'])).toBe(false);
    expect(isRelevant(event, ['class_2'], { includeParentAssociation: true })).toBe(true);
  });
});

describe('filterRelevant', () => {
  const events = [
    makeEvent({ id: 'closure', appliesTo: ['whole_school'] }),
    makeEvent({ id: 'ji', appliesTo: ['junior_infants'], eventType: 'class_activity' }),
    makeEvent({ id: 'r4', appliesTo: ['class_4'], eventType: 'swimming' }),
    makeEvent({ id: 'r3', appliesTo: ['class_3'], eventType: 'swimming' }),
    makeEvent({ id: 'r56', appliesTo: ['class_5', 'class_6'], eventType: 'sports' }),
  ];

  it('returns exactly the events for the spec Scenario A household', () => {
    const ids = filterRelevant(events, ['junior_infants', 'class_4']).map((e) => e.id);
    expect(ids).toEqual(['closure', 'ji', 'r4']);
  });

  it('excludes 3rd-only and 5th/6th-only events', () => {
    const ids = filterRelevant(events, ['junior_infants', 'class_4']).map((e) => e.id);
    expect(ids).not.toContain('r3');
    expect(ids).not.toContain('r56');
  });

  it('never duplicates a whole-school event for a multi-child family', () => {
    const result = filterRelevant([events[0]!], ['junior_infants', 'class_4']);
    expect(result).toHaveLength(1);
  });

  it('narrows immediately when a class is removed', () => {
    const before = filterRelevant(events, ['junior_infants', 'class_4']).map((e) => e.id);
    const after = filterRelevant(events, ['junior_infants']).map((e) => e.id);
    expect(before).toContain('r4');
    expect(after).not.toContain('r4');
    expect(after).toEqual(['closure', 'ji']);
  });

  it('shows only whole-school events to a household whose classes match nothing', () => {
    const ids = filterRelevant(events, ['class_2']).map((e) => e.id);
    expect(ids).toEqual(['closure']);
  });
});

describe('affectedChildren', () => {
  it('returns both children for a whole-school event, once each', () => {
    const children = affectedChildren(makeEvent({ appliesTo: ['whole_school'] }), AOIFE_AND_JACK);
    expect(children.map((c) => c.name)).toEqual(['Aoife', 'Jack']);
  });

  it('returns only the affected child for a class event', () => {
    const children = affectedChildren(makeEvent({ appliesTo: ['class_4'] }), AOIFE_AND_JACK);
    expect(children.map((c) => c.name)).toEqual(['Jack']);
  });

  it('returns no children for an event that affects neither', () => {
    expect(affectedChildren(makeEvent({ appliesTo: ['class_3'] }), AOIFE_AND_JACK)).toEqual([]);
  });
});

describe('affectedLabel', () => {
  it('names one child and their class', () => {
    expect(affectedLabel(makeEvent({ appliesTo: ['junior_infants'] }), AOIFE_AND_JACK)).toBe(
      'Aoife · Junior Infants',
    );
  });

  it('names both children for a whole-school event', () => {
    expect(affectedLabel(makeEvent({ appliesTo: ['whole_school'] }), AOIFE_AND_JACK)).toBe(
      'Aoife + Jack · Whole school',
    );
  });

  it('falls back to class names when children are unnamed', () => {
    const family = makeFamily(makeChild('junior_infants'), makeChild('class_4'));
    expect(affectedLabel(makeEvent({ appliesTo: ['whole_school'] }), family)).toBe(
      'Junior Infants + 4th Class',
    );
  });

  it('falls back to class names when only some children are named', () => {
    const family = makeFamily(makeChild('junior_infants', 'Aoife'), makeChild('class_4'));
    expect(affectedLabel(makeEvent({ appliesTo: ['whole_school'] }), family)).toBe(
      'Junior Infants + 4th Class',
    );
  });

  it('describes the class scope when no child is affected', () => {
    expect(affectedLabel(makeEvent({ appliesTo: ['class_3'] }), JUNIOR_INFANTS_ONLY)).toBe(
      '3rd Class',
    );
  });
});

describe('classTimeFor', () => {
  const earlyFinish = makeEvent({
    eventType: 'early_finish',
    appliesTo: ['whole_school'],
    classDetails: [
      { schoolClass: 'junior_infants', finishTime: '12:50' },
      { schoolClass: 'class_4', finishTime: '13:00' },
    ],
  });

  it('gives each child the finish time for their own class', () => {
    expect(classTimeFor(earlyFinish, 'junior_infants').finishTime).toBe('12:50');
    expect(classTimeFor(earlyFinish, 'class_4').finishTime).toBe('13:00');
  });

  it('falls back to the event-level time for a class with no detail', () => {
    const event = makeEvent({ startTime: '18:30', classDetails: [] });
    expect(classTimeFor(event, 'class_4').startTime).toBe('18:30');
  });
});

describe('selectedClassesOf', () => {
  it('deduplicates two children in the same class', () => {
    const family = makeFamily(makeChild('class_4', 'Jack'), {
      id: 'twin',
      name: 'Jill',
      schoolClass: 'class_4',
    });
    expect(selectedClassesOf(family)).toEqual(['class_4']);
  });
});

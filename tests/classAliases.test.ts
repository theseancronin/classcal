import { describe, expect, it } from 'vitest';

import {
  ALL_TEACHING_CLASSES,
  canonicalizeClasses,
  collapseClassList,
  resolveClasses,
} from '@/classes/classAliases';

describe('infant class aliases', () => {
  it('maps Naíonáin Bheaga to junior infants', () => {
    expect(resolveClasses('Naíonáin Bheaga ar scoil')).toEqual(['junior_infants']);
  });

  it('maps Naíonáin Mhóra to senior infants', () => {
    expect(resolveClasses('Naíonáin Mhóra sa halla')).toEqual(['senior_infants']);
  });

  it('handles the abbreviated forms the feed actually uses', () => {
    expect(resolveClasses('Gleacaíocht le Mary Naí Bh & Nai Mh')).toEqual([
      'junior_infants',
      'senior_infants',
    ]);
    expect(resolveClasses('Céilí Naí Bheaga & Naíonáin Mhóra')).toEqual([
      'junior_infants',
      'senior_infants',
    ]);
  });

  it('maps unaccented Irish spellings', () => {
    expect(resolveClasses('Naionain Bheaga')).toEqual(['junior_infants']);
  });

  it('treats a bare Infants / Naíonáin as both infant classes', () => {
    expect(resolveClasses('Infants @12:50')).toEqual(['junior_infants', 'senior_infants']);
    expect(resolveClasses('Naíonáin @12.50in')).toEqual(['junior_infants', 'senior_infants']);
  });

  it('does not widen an explicit junior/senior reference to both', () => {
    expect(resolveClasses('Junior Infants in school from 9:00')).toEqual(['junior_infants']);
    expect(resolveClasses('Senior Infants only')).toEqual(['senior_infants']);
  });
});

describe('numbered class aliases', () => {
  it('maps R1 through R6', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(resolveClasses(`Snámh R${n}`)).toEqual([`class_${n}`]);
    }
  });

  it('maps Rang 1 through Rang 6', () => {
    for (let n = 1; n <= 6; n += 1) {
      expect(resolveClasses(`Traenáil Rang ${n}`)).toEqual([`class_${n}`]);
    }
  });

  it('maps ordinal English class names', () => {
    expect(resolveClasses('3rd Class swimming')).toEqual(['class_3']);
    expect(resolveClasses('6th class public speaking')).toEqual(['class_6']);
  });

  it('maps the Irish "Rang a 4" form', () => {
    expect(resolveClasses('Cruinniú le tuistí Rang a 4')).toEqual(['class_4', 'parents']);
  });
});

describe('class ranges', () => {
  it('expands R3-R6', () => {
    expect(resolveClasses('Cór na Scoile 2:40 - 3:45, R3-R6')).toEqual([
      'class_3',
      'class_4',
      'class_5',
      'class_6',
    ]);
  });

  it('expands a spaced range R4 - R6', () => {
    expect(resolveClasses('Céilí R4 - R6')).toEqual(['class_4', 'class_5', 'class_6']);
  });

  it('expands R1 - R3', () => {
    expect(resolveClasses('Céilí R1 - R3')).toEqual(['class_1', 'class_2', 'class_3']);
  });

  it('expands an English ordinal range without a trailing noun', () => {
    expect(resolveClasses('Half Day @11:50 Infants / @12:00 1st to 6th')).toEqual([
      'junior_infants',
      'senior_infants',
      'class_1',
      'class_2',
      'class_3',
      'class_4',
      'class_5',
      'class_6',
    ]);
  });

  it('expands "3rd - 6th class"', () => {
    expect(resolveClasses('School Choir 3rd - 6th class: 2:40- 3:45')).toEqual([
      'class_3',
      'class_4',
      'class_5',
      'class_6',
    ]);
  });
});

describe('class combinations', () => {
  it('maps Rang 5&6 to class_5 and class_6 only', () => {
    expect(resolveClasses('Traenáil Peil Gaelach Rang 5&6 2.40-3.40 Astro')).toEqual([
      'class_5',
      'class_6',
    ]);
  });

  it('maps "R5 & R6"', () => {
    expect(resolveClasses('Morning sports for R5 & R6')).toEqual(['class_5', 'class_6']);
  });

  it('maps "Rang 1 & 2"', () => {
    expect(resolveClasses('Gleacaíocht le Mary Rang 1 & 2')).toEqual(['class_1', 'class_2']);
  });

  it('does not expand a combination separator into a range', () => {
    expect(resolveClasses('Rang 2 & 6')).toEqual(['class_2', 'class_6']);
  });
});

describe('whole school and parents', () => {
  it('recognises Irish and English whole-school phrases', () => {
    expect(resolveClasses('Scoil ar fad sa halla')).toEqual(['whole_school']);
    expect(resolveClasses('Whole school assembly')).toEqual(['whole_school']);
  });

  it('recognises parent references', () => {
    expect(resolveClasses('Cruinnithe Tuismitheoirí / Múinteoirí')).toEqual(['parents']);
    expect(resolveClasses('Cairde/Parents Association meeting')).toEqual(['parents']);
  });
});

describe('false positives', () => {
  it('does not read clock times as classes', () => {
    expect(resolveClasses('Coffee morning 09:15 - 1.30')).toEqual([]);
    expect(resolveClasses('11.00 start')).toEqual([]);
  });

  it('does not read a year as a class', () => {
    expect(resolveClasses('Calendar 2026')).toEqual([]);
  });

  it('returns nothing for text that names no class', () => {
    expect(resolveClasses('Lá Bac ar Bhéarla / Ban on English day')).toEqual([]);
  });
});

describe('canonicalizeClasses', () => {
  it('passes through valid canonical identifiers', () => {
    expect(canonicalizeClasses(['class_4', 'junior_infants']).classes).toEqual([
      'junior_infants',
      'class_4',
    ]);
  });

  it('rescues recognisable free text', () => {
    expect(canonicalizeClasses(['R4', 'Senior Infants']).classes).toEqual([
      'senior_infants',
      'class_4',
    ]);
  });

  it('rejects invented identifiers', () => {
    const result = canonicalizeClasses(['class_9', 'transition_year', 42, null]);
    expect(result.classes).toEqual([]);
    expect(result.rejected).toEqual(['class_9', 'transition_year', 42, null]);
  });

  it('deduplicates repeated classes', () => {
    expect(canonicalizeClasses(['class_4', 'R4', '4th class']).classes).toEqual(['class_4']);
  });
});

describe('collapseClassList', () => {
  it('collapses a full list of teaching classes to whole_school', () => {
    expect(collapseClassList([...ALL_TEACHING_CLASSES])).toEqual(['whole_school']);
  });

  it('drops individual classes when whole_school is present', () => {
    expect(collapseClassList(['whole_school', 'class_3'])).toEqual(['whole_school']);
  });

  it('keeps parents alongside whole_school', () => {
    expect(collapseClassList(['whole_school', 'parents'])).toEqual(['whole_school', 'parents']);
  });

  it('leaves a partial list alone', () => {
    expect(collapseClassList(['class_5', 'class_6'])).toEqual(['class_5', 'class_6']);
  });

  it('falls back to unknown for an empty list', () => {
    expect(collapseClassList([])).toEqual(['unknown']);
  });
});

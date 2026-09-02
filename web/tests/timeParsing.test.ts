import { describe, expect, it } from 'vitest';

import { findTimeRange, findTimes, normalizeTime } from '@/classes/timeParsing';

describe('normalizeTime', () => {
  it('normalizes 12-hour times with an English meridiem', () => {
    expect(normalizeTime('1.00pm')).toBe('13:00');
    expect(normalizeTime('9:15am')).toBe('09:15');
    expect(normalizeTime('12.30pm')).toBe('12:30');
    expect(normalizeTime('12:30am')).toBe('00:30');
  });

  it('normalizes Irish meridiem markers', () => {
    expect(normalizeTime('12.50in')).toBe('12:50');
    expect(normalizeTime('1.00in')).toBe('13:00');
    expect(normalizeTime('3:00i.n.')).toBe('15:00');
    expect(normalizeTime('9:30r.n.')).toBe('09:30');
  });

  it('passes through 24-hour times', () => {
    expect(normalizeTime('13:00')).toBe('13:00');
    expect(normalizeTime('09:00')).toBe('09:00');
    expect(normalizeTime('23:59')).toBe('23:59');
  });

  it('applies the school-day heuristic to unmarked times', () => {
    expect(normalizeTime('2.40')).toBe('14:40');
    expect(normalizeTime('11.00')).toBe('11:00');
    expect(normalizeTime('8:30')).toBe('08:30');
  });

  it('rejects impossible times', () => {
    expect(normalizeTime('25:00')).toBeNull();
    expect(normalizeTime('12:75')).toBeNull();
    expect(normalizeTime('13:00pm')).toBeNull();
    expect(normalizeTime('not a time')).toBeNull();
  });
});

describe('findTimes', () => {
  it('extracts both ends of a morning range', () => {
    expect(findTimes('Junior Infants in school from 9:00 -12:45').map((t) => t.time)).toEqual([
      '09:00',
      '12:45',
    ]);
  });

  it('promotes the second half of a range that crosses noon', () => {
    expect(findTimes('Junior Infants in school from 9:00 -1:40').map((t) => t.time)).toEqual([
      '09:00',
      '13:40',
    ]);
  });

  it('keeps an early-morning range in the morning', () => {
    expect(findTimes('Morning sports gathering ó 8:30-8:55').map((t) => t.time)).toEqual([
      '08:30',
      '08:55',
    ]);
  });

  it('reads an afternoon activity range', () => {
    expect(findTimes('Traenáil Peil Rang 5&6 2.40-3.40 Astro').map((t) => t.time)).toEqual([
      '14:40',
      '15:40',
    ]);
  });

  it('reads the two class-specific finish times of an early closure', () => {
    const text = 'Scoil dúnta níos luath - Naíonáin @12.50in & R1 - R6 @1.00in';
    expect(findTimes(text).map((t) => t.time)).toEqual(['12:50', '13:00']);
  });

  it('reads an Irish "go dtí" range', () => {
    const text = 'Tráthnóna Oscailte ó 2:00i.n. go dtí 3.30i.n.';
    expect(findTimes(text).map((t) => t.time)).toEqual(['14:00', '15:30']);
  });

  it('reads a single departure time', () => {
    expect(findTimes('3rd class swimming - bus leaving the school @9:15').map((t) => t.time)).toEqual(
      ['09:15'],
    );
  });

  it('ignores bare numbers that are not times', () => {
    expect(findTimes('Traenáil Peil Gaelach Rang 5&6 Astro')).toEqual([]);
    expect(findTimes('Céilí R4 - R6')).toEqual([]);
  });

  it('ignores a year', () => {
    expect(findTimes('calyear=2026')).toEqual([]);
  });
});

describe('findTimeRange', () => {
  it('returns start and end when both are present', () => {
    expect(findTimeRange('Parent / Teacher meetings 3:00i.n. - 5:00i.n.')).toEqual({
      start: '15:00',
      end: '17:00',
    });
  });

  it('returns only a start when one time is present', () => {
    expect(findTimeRange('Cruinniú Cairde sa Halla @ 7.30in')).toEqual({ start: '19:30' });
  });

  it('returns nothing when no time is present', () => {
    expect(findTimeRange('Laethanta Saoire na Nollag')).toEqual({});
  });
});

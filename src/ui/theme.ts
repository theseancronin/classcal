/**
 * The design system.
 *
 * The brief is a calendar that feels calmer than the source calendar it
 * replaces, so the palette is deliberately restrained: one warm neutral ground,
 * one ink, and colour reserved almost entirely for importance. Because colour
 * must never be the only signal (WCAG 2.2 AA, spec 30), every importance level
 * also carries a distinct label, icon and border weight.
 */

export const colors = {
  // Ground and surfaces
  background: '#FBF9F6',
  surface: '#FFFFFF',
  surfaceSunken: '#F2EEE8',

  // Ink
  ink: '#1A1815',
  inkMuted: '#5C564E',
  inkFaint: '#8A8279',

  // Lines
  border: '#E2DBD1',
  borderStrong: '#C8BFB2',

  // Importance. Chosen for contrast against both surface and background.
  critical: '#A8261C',
  criticalSurface: '#FCEFED',
  high: '#8A5A00',
  highSurface: '#FDF4E3',
  normal: '#3A6B5C',
  normalSurface: '#EDF4F1',
  low: '#5C564E',
  lowSurface: '#F2EEE8',

  // Accents
  accent: '#1F4E5F',
  accentSurface: '#E8F0F2',
  onAccent: '#FFFFFF',

  changed: '#4A3A7A',
  changedSurface: '#F0EDF8',
} as const;

/** A 4pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/**
 * Strong date typography and a clear hierarchy are what make the feed scannable.
 * Sizes are in points and respect the OS font-scale setting by default.
 */
export const typography = {
  screenTitle: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 1.1 },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  date: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '400' },
  badge: { fontSize: 12, fontWeight: '600' },
} as const;

import type { Importance } from '@/domain/types';

export type ImportanceStyle = {
  color: string;
  surface: string;
  /** A label, so importance is never conveyed by colour alone. */
  label: string;
  /** A shape cue that survives greyscale and screen readers alike. */
  icon: string;
  /** Left border width; criticality is legible at a glance from shape. */
  borderWidth: number;
};

export const importanceStyles: Record<Importance, ImportanceStyle> = {
  critical: {
    color: colors.critical,
    surface: colors.criticalSurface,
    label: 'Important',
    icon: '!',
    borderWidth: 5,
  },
  high: {
    color: colors.high,
    surface: colors.highSurface,
    label: 'Needs action',
    icon: '*',
    borderWidth: 3,
  },
  normal: {
    color: colors.normal,
    surface: colors.normalSurface,
    label: 'Activity',
    icon: '·',
    borderWidth: 0,
  },
  low: {
    color: colors.low,
    surface: colors.lowSurface,
    label: 'Note',
    icon: '·',
    borderWidth: 0,
  },
};

/** Minimum touch target, per WCAG 2.2 target-size guidance. */
export const MIN_TOUCH_TARGET = 44;

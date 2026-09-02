/**
 * Importance styling.
 *
 * Colour is never the only signal: each level also carries a distinct label,
 * an icon that survives greyscale, and a left-border weight, so importance is
 * legible to a colour-blind parent and to a screen reader alike (spec 30).
 */
import type { Importance } from '@/domain/types';

export type ImportanceStyle = {
  /** Tailwind classes for the card's tinted surface and left border. */
  surface: string;
  /** Tailwind classes for the pill. */
  pill: string;
  /** A label, so importance is never conveyed by colour alone. */
  label: string;
  /** A shape cue that survives greyscale. */
  icon: string;
};

export const importanceStyles: Record<Importance, ImportanceStyle> = {
  critical: {
    surface: 'bg-critical-surface border-l-[5px] border-l-critical',
    pill: 'bg-critical text-white',
    label: 'Important',
    icon: '!',
  },
  high: {
    surface: 'bg-high-surface border-l-[3px] border-l-high',
    pill: 'bg-high text-white',
    label: 'Needs action',
    icon: '*',
  },
  normal: {
    surface: 'bg-surface',
    pill: 'bg-normal-surface text-normal',
    label: 'Activity',
    icon: '\u00B7',
  },
  low: {
    surface: 'bg-surface',
    pill: 'bg-low-surface text-low',
    label: 'Note',
    icon: '\u00B7',
  },
};

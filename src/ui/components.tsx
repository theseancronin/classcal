'use client';

/**
 * Shared presentation pieces.
 *
 * Every control clears the 44px target size from WCAG 2.2, and importance is
 * always carried by a label and a shape as well as a colour.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatTimeRange } from '@/domain/dates';

import { EVENT_TYPE_LABELS, type Importance, type NormalizedSchoolEvent } from '@/domain/types';
import { dateRangeLabel, relativeDateLabel } from '@/relevance/grouping';
import { importanceStyles } from './importance';

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-3xl font-bold tracking-tight text-ink">{children}</h1>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-widest text-ink-faint">
      {children}
    </h2>
  );
}

export function ImportancePill({ importance }: { importance: Importance }) {
  const style = importanceStyles[importance];
  if (importance === 'normal' || importance === 'low') return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${style.pill}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'changed' }) {
  const tones = {
    neutral: 'bg-sunken text-ink-muted',
    changed: 'bg-changed-surface text-changed',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-6 text-center">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const variants = {
    primary: 'bg-accent text-on-accent hover:opacity-90',
    secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
    danger: 'bg-surface text-critical border border-critical hover:bg-critical-surface',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

/**
 * One event in a list.
 *
 * The accessible name spells out date, type, importance and affected classes,
 * because the visual grouping that makes those obvious on screen is not
 * available to a screen reader reading one card at a time.
 */
export function EventCard({
  event,
  today,
  use24HourTime,
  affected,
}: {
  event: NormalizedSchoolEvent;
  today: string;
  use24HourTime: boolean;
  /** e.g. "Aoife" or "Junior Infants" — who in this house it touches. */
  affected?: string;
}) {
  const style = importanceStyles[event.importance];
  const when = relativeDateLabel(event.date, today);
  const time = formatTimeRange(event.startTime, event.endTime, use24HourTime);

  const label = [
    style.label,
    event.title,
    when,
    time,
    affected ? `for ${affected}` : '',
    event.parentActionRequired ? 'Action needed' : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Link
      href={`/event/${encodeURIComponent(event.id)}`}
      aria-label={label}
      className={`block rounded-lg border border-line p-4 transition hover:border-line-strong ${style.surface}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold text-ink">{event.title}</p>
        <ImportancePill importance={event.importance} />
      </div>

      <p className="mt-1 text-sm font-semibold text-ink-muted">
        {dateRangeLabel(event)}
        {time ? ` · ${time}` : ''}
      </p>

      {event.summary ? (
        <p className="mt-2 text-sm text-ink-muted">{event.summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge>{EVENT_TYPE_LABELS[event.eventType]}</Badge>
        {affected ? <Badge>{affected}</Badge> : null}
        {event.needsReview ? <Badge tone="changed">Unconfirmed</Badge> : null}
      </div>
    </Link>
  );
}

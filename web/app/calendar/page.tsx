'use client';

/**
 * Month grid and agenda.
 *
 * The home feed answers "what do I need to know?"; this screen answers "what
 * about that week in October?". Days carry a dot per importance level present,
 * so the shape of a month is visible before anything is tapped.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  WEEKDAY_INITIALS,
  daysInMonth,
  formatMonthTitle,
  mondayIndex,
  parseDateKey,
} from '@/domain/dates';
import { EVENT_TYPE_LABELS, type EventType, type NormalizedSchoolEvent } from '@/domain/types';
import { affectedLabel } from '@/relevance/relevance';
import { occursOn, toDateKey } from '@/relevance/grouping';
import { useApp } from '@/state/AppProvider';
import { EmptyState, EventCard, ScreenTitle } from '@/ui/components';

const FULL_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (value: number): string => String(value).padStart(2, '0');

export default function CalendarPage() {
  const { ready, events, family, display, today } = useApp();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [search, setSearch] = useState('');
  const [type, setType] = useState<EventType | 'all'>('all');
  const [selectedDay, setSelectedDay] = useState<string>();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      if (type !== 'all' && event.eventType !== type) return false;
      if (!term) return true;
      return (
        event.title.toLowerCase().includes(term) ||
        event.summary.toLowerCase().includes(term) ||
        event.originalTitle.toLowerCase().includes(term)
      );
    });
  }, [events, search, type]);

  const grid = useMemo(() => buildGrid(month, filtered), [month, filtered]);

  const agenda = useMemo(() => {
    if (selectedDay) return filtered.filter((event) => occursOn(event, selectedDay));
    return filtered.filter((event) => event.date.startsWith(month));
  }, [filtered, month, selectedDay]);

  const presentTypes = useMemo(
    () => [...new Set(events.map((event) => event.eventType))].sort(),
    [events],
  );

  const monthTitle = formatMonthTitle(`${month}-01`);

  if (!ready) return null;

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <ScreenTitle>Calendar</ScreenTitle>
        <Link
          href="/"
          className="rounded-md px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-surface"
        >
          For you
        </Link>
      </header>

      <div className="mt-4">
        <label htmlFor="search" className="sr-only">
          Search events
        </label>
        <input
          id="search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events"
          className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-ink"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by event type">
        <FilterChip active={type === 'all'} onClick={() => setType('all')}>
          All
        </FilterChip>
        {presentTypes.map((eventType) => (
          <FilterChip
            key={eventType}
            active={type === eventType}
            onClick={() => setType(eventType)}
          >
            {EVENT_TYPE_LABELS[eventType]}
          </FilterChip>
        ))}
      </div>

      <nav className="mt-6 flex items-center justify-between" aria-label="Month">
        <button
          type="button"
          onClick={() => {
            setMonth(shiftMonth(month, -1));
            setSelectedDay(undefined);
          }}
          className="rounded-md px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-surface"
        >
          &larr; Previous
        </button>
        <h2 className="text-lg font-bold text-ink" aria-live="polite">
          {monthTitle}
        </h2>
        <button
          type="button"
          onClick={() => {
            setMonth(shiftMonth(month, 1));
            setSelectedDay(undefined);
          }}
          className="rounded-md px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-surface"
        >
          Next &rarr;
        </button>
      </nav>

      <table className="mt-3 w-full table-fixed border-collapse">
        <caption className="sr-only">{monthTitle}. Days with events are marked.</caption>
        <thead>
          <tr>
            {WEEKDAY_INITIALS.map((initial, index) => (
              <th
                key={`${initial}-${index}`}
                scope="col"
                className="pb-2 text-xs font-bold uppercase text-ink-faint"
              >
                <abbr title={FULL_WEEKDAYS[index]} className="no-underline">
                  {initial}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell, dayIndex) => (
                <td key={dayIndex} className="p-0.5 text-center align-top">
                  {cell ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDay((current) =>
                          current === cell.dateKey ? undefined : cell.dateKey,
                        )
                      }
                      aria-pressed={selectedDay === cell.dateKey}
                      aria-label={`${cell.day} ${monthTitle}, ${cell.count} ${
                        cell.count === 1 ? 'event' : 'events'
                      }`}
                      className={`flex h-11 w-full flex-col items-center justify-center rounded-md text-sm ${
                        selectedDay === cell.dateKey
                          ? 'bg-accent text-on-accent'
                          : cell.dateKey === today
                            ? 'bg-accent-surface font-bold text-accent'
                            : 'text-ink hover:bg-sunken'
                      }`}
                    >
                      {cell.day}
                      <span className="mt-0.5 flex gap-0.5" aria-hidden="true">
                        {cell.hasCritical ? <Dot className="bg-critical" /> : null}
                        {cell.hasHigh ? <Dot className="bg-high" /> : null}
                        {cell.count > 0 && !cell.hasCritical && !cell.hasHigh ? (
                          <Dot className="bg-line-strong" />
                        ) : null}
                      </span>
                    </button>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 text-xs font-bold uppercase tracking-widest text-ink-faint">
        {selectedDay ? `Events on ${selectedDay}` : monthTitle}
      </h2>

      {agenda.length === 0 ? (
        <div className="mt-2">
          <EmptyState title="Nothing here" body="No events match for this period." />
        </div>
      ) : (
        <ul className="mt-2 space-y-3">
          {agenda.map((event) => (
            <li key={event.id}>
              <EventCard
                event={event}
                today={today}
                use24HourTime={display.use24HourTime}
                affected={affectedLabel(event, family) || undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`block h-1 w-1 rounded-full ${className}`} />;
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-2 text-xs font-semibold ${
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line bg-surface text-ink-muted hover:bg-sunken'
      }`}
    >
      {children}
    </button>
  );
}

type Cell = {
  day: number;
  dateKey: string;
  count: number;
  hasCritical: boolean;
  hasHigh: boolean;
};

/** Lay a month out as weeks starting Monday, padded with nulls. */
function buildGrid(month: string, events: readonly NormalizedSchoolEvent[]): (Cell | null)[][] {
  const parts = parseDateKey(`${month}-01`);
  if (!parts) return [];

  const total = daysInMonth(parts.year, parts.month);
  const leading = mondayIndex(`${month}-01`);

  const cells: (Cell | null)[] = Array(leading).fill(null);
  for (let day = 1; day <= total; day += 1) {
    const dateKey = `${month}-${pad(day)}`;
    const onDay = events.filter((event) => occursOn(event, dateKey));
    cells.push({
      day,
      dateKey,
      count: onDay.length,
      hasCritical: onDay.some((event) => event.importance === 'critical'),
      hasHigh: onDay.some((event) => event.importance === 'high'),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Cell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function shiftMonth(month: string, delta: number): string {
  const parts = parseDateKey(`${month}-01`);
  if (!parts) return month;
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
  return toDateKey(date).slice(0, 7);
}

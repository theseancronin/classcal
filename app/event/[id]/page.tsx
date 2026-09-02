'use client';

/**
 * One event, in full.
 *
 * This is where a parent goes to answer "so what time do I collect them?", so
 * the per-child times are the most prominent thing after the date. The original
 * school wording is always available but never the default, because it is the
 * thing the app exists to translate.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { formatLongDate, formatTimeRange } from '@/domain/dates';
import { CLASS_LABELS, EVENT_TYPE_LABELS } from '@/domain/types';
import { describeClassTimes } from '@/domain/labels';
import { affectedChildren, classTimeFor } from '@/relevance/relevance';
import { dateRangeLabel } from '@/relevance/grouping';
import { useApp } from '@/state/AppProvider';
import { Badge, Button, EmptyState, ImportancePill } from '@/ui/components';
import { importanceStyles } from '@/ui/importance';

export default function EventPage() {
  const params = useParams<{ id: string }>();
  const { ready, events, family, display } = useApp();
  const [showOriginal, setShowOriginal] = useState(false);

  const id = decodeURIComponent(params.id);
  const event = useMemo(() => events.find((candidate) => candidate.id === id), [events, id]);

  if (!ready) return null;

  if (!event) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <BackLink />
        <div className="mt-6">
          <EmptyState
            title="Event not found"
            body="It may have been removed from the school calendar, or it is not for your classes."
          />
        </div>
      </main>
    );
  }

  const style = importanceStyles[event.importance];
  const children = affectedChildren(event, family);
  const finishes = describeClassTimes(event.classDetails, 'finish');
  const starts = describeClassTimes(event.classDetails, 'start');
  const time = formatTimeRange(event.startTime, event.endTime, display.use24HourTime);

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <BackLink />

      <article className={`mt-4 rounded-lg border border-line p-5 ${style.surface}`}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">{event.title}</h1>
          <ImportancePill importance={event.importance} />
        </div>

        <p className="mt-2 text-base font-semibold text-ink-muted">
          {formatLongDate(event.date)}
          {event.endDate !== event.date ? ` — ${formatLongDate(event.endDate)}` : ''}
        </p>
        {time ? <p className="text-base text-ink-muted">{time}</p> : null}

        <p className="mt-4 text-base text-ink">{event.summary}</p>

        {event.parentActionRequired && event.parentAction ? (
          <div className="mt-4 rounded-md border border-high bg-high-surface p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-high">What to do</p>
            <p className="mt-1 text-ink">{event.parentAction}</p>
          </div>
        ) : null}
      </article>

      {/* Per-child times are the whole point of the app for early finishes. */}
      {children.length > 0 ? (
        <section aria-labelledby="who" className="mt-6">
          <h2 id="who" className="text-xs font-bold uppercase tracking-widest text-ink-faint">
            In your family
          </h2>
          <ul className="mt-2 space-y-2">
            {children.map((child) => {
              const times = classTimeFor(event, child.schoolClass);
              return (
                <li
                  key={child.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface p-4"
                >
                  <span className="font-semibold text-ink">
                    {child.name ?? CLASS_LABELS[child.schoolClass]}
                    {child.name ? (
                      <span className="ml-2 font-normal text-ink-faint">
                        {CLASS_LABELS[child.schoolClass]}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right text-sm text-ink-muted">
                    {times.finishTime ? (
                      <>
                        Finishes <strong className="text-ink">{times.finishTime}</strong>
                      </>
                    ) : times.startTime ? (
                      <>
                        Starts <strong className="text-ink">{times.startTime}</strong>
                      </>
                    ) : (
                      'Normal day'
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 space-y-2 text-sm text-ink-muted">
        {starts ? <p>{starts}</p> : null}
        {finishes ? <p>{finishes}</p> : null}
        {event.location ? <p>Location: {event.location}</p> : null}
        <p>
          <Badge>{EVENT_TYPE_LABELS[event.eventType]}</Badge>
        </p>
      </section>

      {event.needsReview ? (
        <p role="status" className="mt-4 rounded-md border border-line bg-sunken p-3 text-sm text-ink-muted">
          This one was hard to read automatically. Check the school&rsquo;s wording below before
          relying on it.
        </p>
      ) : null}

      <section className="mt-6">
        <Button variant="secondary" onClick={() => setShowOriginal((value) => !value)}>
          {showOriginal ? 'Hide' : 'Show'} the school&rsquo;s original wording
        </Button>

        {showOriginal ? (
          <div className="mt-3 rounded-md border border-line bg-sunken p-4">
            {/* Rendered as text, never as markup: this is untrusted feed content. */}
            <p className="font-semibold text-ink">{event.originalTitle}</p>
            {event.originalDescription ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                {event.originalDescription}
              </p>
            ) : null}
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-block text-sm font-semibold text-accent underline"
            >
              View on the school website
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/" className="text-sm font-semibold text-accent underline">
      &larr; Back
    </Link>
  );
}

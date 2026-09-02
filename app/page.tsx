'use client';

/**
 * The home feed.
 *
 * The one screen most parents will ever look at. It answers "is there anything
 * I need to do?" without scrolling: today and tomorrow first, then anything
 * important on the horizon, then the rest.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { affectedLabel } from '@/relevance/relevance';
import { buildHomeSections } from '@/relevance/grouping';
import { isSetupComplete } from '@/family/store';
import { useApp } from '@/state/AppProvider';
import { EmptyState, EventCard, ScreenTitle, SectionHeader } from '@/ui/components';
import { StaleBanner } from '@/ui/banners';

export default function HomePage() {
  const router = useRouter();
  const { ready, family, display, events, status, error, stale, today, refresh, loading, loadedOnce } =
    useApp();

  useEffect(() => {
    if (ready && !isSetupComplete(family)) router.replace('/setup');
  }, [ready, family, router]);

  const sections = useMemo(() => buildHomeSections(events, today), [events, today]);

  if (!ready || !isSetupComplete(family)) return null;

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <ScreenTitle>For you</ScreenTitle>
          {loadedOnce ? (
            <StaleBanner
              lastSuccessAt={status?.lastSuccessAt}
              stale={stale}
              error={error}
              onRetry={() => void refresh()}
            />
          ) : null}
        </div>
        <nav className="flex shrink-0 gap-2 text-sm font-semibold">
          <Link href="/calendar" className="rounded-md px-3 py-2 text-accent hover:bg-accent-surface">
            Calendar
          </Link>
          <Link href="/settings" className="rounded-md px-3 py-2 text-accent hover:bg-accent-surface">
            Settings
          </Link>
        </nav>
      </header>

      {loading && events.length === 0 ? (
        <p className="mt-8 text-ink-muted">Loading the calendar&hellip;</p>
      ) : null}

      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`section-${section.id}`}>
          <SectionHeader>
            <span id={`section-${section.id}`}>{section.title}</span>
          </SectionHeader>

          {section.events.length === 0 ? (
            section.emptyMessage ? (
              <p className="text-sm text-ink-muted">{section.emptyMessage}</p>
            ) : null
          ) : (
            <ul className="space-y-3">
              {section.events.map((event) => (
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
        </section>
      ))}

      {events.length === 0 && !loading ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing scheduled"
            body="Once the school publishes events for your classes, they will appear here."
          />
        </div>
      ) : null}
    </main>
  );
}

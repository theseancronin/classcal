'use client';

/**
 * Honesty banners.
 *
 * The app must never imply the calendar is current when a refresh has failed
 * (spec 26). Staleness is stated in words a parent can act on, with a link to
 * the school's own calendar as the fallback.
 */
import { formatRelativeInstant } from '@/domain/dates';
import { DEFAULT_SCHOOL } from '@/config/school';
import { Button } from './components';

export function StaleBanner({
  lastSuccessAt,
  stale,
  error,
  onRetry,
}: {
  lastSuccessAt: string | undefined;
  stale: boolean;
  error: string | undefined;
  onRetry: () => void;
}) {
  // Rendered client-side only, so reading the clock here is safe: there is no
  // server render to disagree with.
  const now = new Date().toISOString();

  if (!stale && !error) {
    return lastSuccessAt ? (
      <p className="mt-2 text-xs text-ink-faint">
        Last updated {formatRelativeInstant(lastSuccessAt, now)}.
      </p>
    ) : null;
  }

  return (
    <div
      role="status"
      className="mt-4 rounded-lg border border-high bg-high-surface p-4"
    >
      <p className="text-sm font-semibold text-ink">
        {lastSuccessAt
          ? `Calendar last updated ${formatRelativeInstant(lastSuccessAt, now)}.`
          : 'The calendar has not been downloaded yet.'}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        It may be out of date. Check the{' '}
        <a
          href={DEFAULT_SCHOOL.calendarPageUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          official school calendar
        </a>{' '}
        for recent changes.
      </p>
      <div className="mt-3">
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

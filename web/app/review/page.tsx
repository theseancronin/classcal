'use client';

/**
 * Developer review screen (spec 27).
 *
 * Not linked from anywhere a parent goes. It exists to answer two questions
 * while the app is in use: what did the pipeline fail on, and is the confidence
 * threshold set anywhere near right?
 */
import { useCallback, useEffect, useState } from 'react';

import type { RawEventVersion } from '@/db/repository';
import type { NormalizedSchoolEvent } from '@/domain/types';
import { ScreenTitle } from '@/ui/components';

type ReviewPayload = {
  failed: RawEventVersion[];
  lowConfidence: NormalizedSchoolEvent[];
};

export default function ReviewPage() {
  const [data, setData] = useState<ReviewPayload>();
  const [error, setError] = useState<string>();
  const [key, setKey] = useState('');

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const query = key ? `?key=${encodeURIComponent(key)}` : '';
      const response = await fetch(`/api/review${query}`);
      if (response.status === 401) throw new Error('Wrong or missing key.');
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setData((await response.json()) as ReviewPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the review queue.');
    }
  }, [key]);

  useEffect(() => {
    void load();
    // Only on mount; re-running is driven by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <ScreenTitle>Review queue</ScreenTitle>
      <p className="mt-2 text-sm text-ink-muted">
        Events the pipeline could not interpret, and events it interpreted with low confidence.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="key" className="block text-sm font-semibold text-ink-muted">
            Access key (if configured)
          </label>
          <input
            id="key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 rounded-md border border-line bg-surface px-3 py-3 text-base text-ink"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent"
        >
          Reload
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-critical bg-critical-surface p-3 text-sm">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <Section title={`Failed to interpret (${data.failed.length})`}>
            {data.failed.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing failed. </p>
            ) : (
              <ul className="space-y-2">
                {data.failed.map((version) => (
                  <li
                    key={version.versionId}
                    className="rounded-md border border-critical bg-critical-surface p-4"
                  >
                    <p className="font-semibold text-ink">{version.event.title}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {version.event.start} · {version.processingStatus}
                    </p>
                    {version.processingError ? (
                      <p className="mt-2 font-mono text-xs text-critical">
                        {version.processingError}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Low confidence (${data.lowConfidence.length})`}>
            {data.lowConfidence.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing below the review threshold.</p>
            ) : (
              <ul className="space-y-2">
                {data.lowConfidence.map((event) => (
                  <li key={event.id} className="rounded-md border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-ink">{event.title}</p>
                      <span className="shrink-0 font-mono text-xs text-ink-muted">
                        {event.confidence.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {event.date} · {event.eventType} · {event.importance} ·{' '}
                      {event.appliesTo.join(', ')}
                    </p>
                    {/* Raw feed text, rendered as text: it is untrusted input. */}
                    <p className="mt-2 text-sm text-ink-muted">{event.originalTitle}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

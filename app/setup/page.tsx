'use client';

/**
 * First launch.
 *
 * Two steps, because asking for child names up front is a barrier and they are
 * genuinely optional: the class selection alone is enough to personalise the
 * whole app. The names never leave the browser.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DEFAULT_SCHOOL } from '@/config/school';
import { CLASS_LABELS, SELECTABLE_CLASSES, type Child, type SelectableClass } from '@/domain/types';
import { newChildId } from '@/family/store';
import { useApp } from '@/state/AppProvider';
import { Button, ScreenTitle } from '@/ui/components';

export default function SetupPage() {
  const router = useRouter();
  const { setFamily } = useApp();
  const [step, setStep] = useState<'classes' | 'names'>('classes');
  const [selected, setSelected] = useState<SelectableClass[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const toggle = (schoolClass: SelectableClass): void => {
    setSelected((current) =>
      current.includes(schoolClass)
        ? current.filter((c) => c !== schoolClass)
        : [...current, schoolClass],
    );
  };

  const finish = (): void => {
    const children: Child[] = selected.map((schoolClass) => {
      const name = names[schoolClass]?.trim();
      return {
        id: newChildId(schoolClass),
        schoolClass,
        ...(name ? { name } : {}),
      };
    });
    setFamily({ children, setupCompletedAt: new Date().toISOString() });
    router.replace('/');
  };

  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-8">
      {step === 'classes' ? (
        <>
          <ScreenTitle>Which classes?</ScreenTitle>
          <p className="mt-2 text-ink-muted">
            Pick every class you have a child in. {DEFAULT_SCHOOL.name} publishes one calendar for
            the whole school &mdash; this is what filters it down to yours.
          </p>

          <fieldset className="mt-6">
            <legend className="sr-only">School classes</legend>
            <div className="grid grid-cols-2 gap-2">
              {SELECTABLE_CLASSES.map((schoolClass) => {
                const checked = selected.includes(schoolClass);
                return (
                  <label
                    key={schoolClass}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm font-semibold transition ${
                      checked
                        ? 'border-accent bg-accent-surface text-accent'
                        : 'border-line bg-surface text-ink hover:bg-sunken'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(schoolClass)}
                      className="h-5 w-5"
                    />
                    {CLASS_LABELS[schoolClass]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-6 flex gap-3">
            <Button onClick={() => setStep('names')} disabled={selected.length === 0}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <ScreenTitle>Name them? (optional)</ScreenTitle>
          <p className="mt-2 text-ink-muted">
            Adding names lets the app say &ldquo;Aoife finishes at 12:00&rdquo; instead of
            &ldquo;Junior Infants finishes at 12:00&rdquo;. Names stay on this device.
          </p>

          <div className="mt-6 space-y-3">
            {selected.map((schoolClass) => (
              <div key={schoolClass}>
                <label
                  htmlFor={`name-${schoolClass}`}
                  className="block text-sm font-semibold text-ink-muted"
                >
                  {CLASS_LABELS[schoolClass]}
                </label>
                <input
                  id={`name-${schoolClass}`}
                  type="text"
                  value={names[schoolClass] ?? ''}
                  onChange={(e) => setNames((n) => ({ ...n, [schoolClass]: e.target.value }))}
                  placeholder="Child's name"
                  autoComplete="off"
                  className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-ink"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <Button onClick={finish}>Done</Button>
            <Button variant="secondary" onClick={() => setStep('classes')}>
              Back
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

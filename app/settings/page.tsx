'use client';

/**
 * Settings.
 *
 * Everything a parent might need to change after setup, plus the two honesty
 * obligations: say plainly what is stored and where, and make deleting it a
 * single action.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DEFAULT_SCHOOL } from '@/config/school';
import {
  CLASS_LABELS,
  SELECTABLE_CLASSES,
  type NotificationPreferences,
  type SelectableClass,
} from '@/domain/types';
import { EMPTY_FAMILY, clearFamilyData, newChildId } from '@/family/store';
import { useApp } from '@/state/AppProvider';
import { Button, ScreenTitle } from '@/ui/components';
import { NotificationSettings } from '@/ui/NotificationSettings';

export default function SettingsPage() {
  const router = useRouter();
  const { family, setFamily, preferences, setPreferences, display, setDisplay, status } = useApp();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const selected = family.children.map((child) => child.schoolClass);

  const toggleClass = (schoolClass: SelectableClass): void => {
    const existing = family.children.find((child) => child.schoolClass === schoolClass);
    setFamily({
      ...family,
      children: existing
        ? family.children.filter((child) => child.schoolClass !== schoolClass)
        : [...family.children, { id: newChildId(schoolClass), schoolClass }],
    });
  };

  const rename = (id: string, name: string): void => {
    setFamily({
      ...family,
      children: family.children.map((child) =>
        child.id === id ? { ...child, ...(name.trim() ? { name: name.trim() } : { name: undefined }) } : child,
      ),
    });
  };

  const clearEverything = (): void => {
    clearFamilyData();
    setFamily(EMPTY_FAMILY);
    router.replace('/setup');
  };

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <ScreenTitle>Settings</ScreenTitle>
        <Link
          href="/"
          className="rounded-md px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-surface"
        >
          For you
        </Link>
      </header>

      <Section title="Your classes">
        <fieldset>
          <legend className="sr-only">School classes</legend>
          <div className="grid grid-cols-2 gap-2">
            {SELECTABLE_CLASSES.map((schoolClass) => {
              const checked = selected.includes(schoolClass);
              return (
                <label
                  key={schoolClass}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm font-semibold ${
                    checked
                      ? 'border-accent bg-accent-surface text-accent'
                      : 'border-line bg-surface text-ink hover:bg-sunken'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleClass(schoolClass)}
                    className="h-5 w-5"
                  />
                  {CLASS_LABELS[schoolClass]}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Section>

      {family.children.length > 0 ? (
        <Section title="Names (optional)">
          <div className="space-y-3">
            {family.children.map((child) => (
              <div key={child.id}>
                <label
                  htmlFor={`child-${child.id}`}
                  className="block text-sm font-semibold text-ink-muted"
                >
                  {CLASS_LABELS[child.schoolClass]}
                </label>
                <input
                  id={`child-${child.id}`}
                  type="text"
                  defaultValue={child.name ?? ''}
                  onBlur={(e) => rename(child.id, e.target.value)}
                  placeholder="Child's name"
                  autoComplete="off"
                  className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-ink"
                />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Reminders">
        <NotificationSettings
          preferences={preferences}
          onChange={setPreferences}
          classes={selected}
        />
      </Section>

      <Section title="Display">
        <Toggle
          label="24-hour time"
          description="Show 13:00 rather than 1:00 pm."
          checked={display.use24HourTime}
          onChange={(value) => setDisplay({ ...display, use24HourTime: value })}
        />
        <Toggle
          label="Show Parents' Association events"
          description="Hidden by default, since they are not school-wide obligations."
          checked={display.showParentAssociation}
          onChange={(value) => setDisplay({ ...display, showParentAssociation: value })}
        />
      </Section>

      <Section title="Calendar source">
        <p className="text-sm text-ink-muted">
          Events come from {DEFAULT_SCHOOL.name}&rsquo;s published calendar, refreshed
          automatically.
        </p>
        {status?.lastSuccessAt ? (
          <p className="mt-1 text-sm text-ink-muted">
            Last successful update: {new Date(status.lastSuccessAt).toLocaleString('en-IE')}.
          </p>
        ) : null}
        <p className="mt-2">
          <a
            href={DEFAULT_SCHOOL.calendarPageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-semibold text-accent underline"
          >
            Open the official school calendar
          </a>
        </p>
      </Section>

      <Section title="Your data">
        <p className="text-sm text-ink-muted">
          Your classes, your children&rsquo;s names and your reminder settings are stored only in
          this browser. They are never sent to the server, and never sent to the service that
          interprets the calendar.
        </p>
        <div className="mt-3">
          {confirmingClear ? (
            <div className="rounded-md border border-critical bg-critical-surface p-4">
              <p className="text-sm font-semibold text-ink">
                Delete your classes, names and settings from this browser?
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" onClick={clearEverything}>
                  Delete everything
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingClear(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingClear(true)}>
              Clear family data
            </Button>
          )}
        </div>
      </Section>
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

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5"
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description ? (
          <span className="block text-sm text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export type { NotificationPreferences };

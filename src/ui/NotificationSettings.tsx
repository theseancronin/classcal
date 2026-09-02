'use client';

/**
 * Reminder settings and the Web Push subscription flow.
 *
 * The honest part of this screen is the platform caveat. On Android, Chrome
 * grants Web Push to an ordinary tab. On iOS, Safari only allows it once the
 * page has been added to the home screen — so rather than showing a button
 * that silently fails, an iOS user in a normal tab is told exactly what to tap.
 *
 * Which reminders exist is still decided by `notifications/schedule.ts`; this
 * component only records the parent's preferences and the push subscription.
 */
import { useCallback, useEffect, useState } from 'react';

import type { NotificationPreferences, ReminderType, SelectableClass } from '@/domain/types';

type PushState =
  | 'unsupported'
  | 'needs_install'
  | 'prompt'
  | 'granted'
  | 'denied';

const CATEGORIES: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'schoolClosure',
    label: 'School closures',
    description: 'Days the school is shut.',
  },
  {
    key: 'earlyFinish',
    label: 'Early finishes',
    description: 'Days your children finish before the usual time.',
  },
  {
    key: 'parentMeetings',
    label: 'Parent meetings',
    description: 'Information evenings and parent-teacher meetings.',
  },
  {
    key: 'classImportant',
    label: 'Important class events',
    description: 'Trips, performances and anything needing something brought in.',
  },
  {
    key: 'generalActivities',
    label: 'Everyday activities',
    description: 'Swimming, choir, sports. Off by default.',
  },
];

const REMINDER_LABELS: Record<ReminderType, string> = {
  seven_days_before: 'A week before',
  one_day_before: 'The day before',
  morning_of: 'On the morning',
};

/** True when the page is running as an installed, standalone app. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own non-standard flag, which is the only signal on iOS.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function NotificationSettings({
  preferences,
  onChange,
  classes,
}: {
  preferences: NotificationPreferences;
  onChange: (preferences: NotificationPreferences) => void;
  classes: readonly SelectableClass[];
}) {
  const [push, setPush] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      // iOS below 16.4, or a browser without Web Push at all.
      setPush(isIos() ? 'needs_install' : 'unsupported');
      return;
    }
    if (isIos() && !isStandalone()) {
      setPush('needs_install');
      return;
    }
    setPush(
      Notification.permission === 'granted'
        ? 'granted'
        : Notification.permission === 'denied'
          ? 'denied'
          : 'prompt',
    );
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const keyResponse = await fetch('/api/push/key');
      if (!keyResponse.ok) throw new Error('Reminders are not configured on the server yet.');
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      const saved = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription, classes, preferences }),
      });
      if (!saved.ok) throw new Error('Could not save your reminder settings.');

      setPush('granted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not turn on reminders.');
    } finally {
      setBusy(false);
    }
  }, [classes, preferences]);

  return (
    <div className="space-y-3">
      {push === 'needs_install' ? (
        <div className="rounded-md border border-line bg-accent-surface p-4">
          <p className="text-sm font-semibold text-ink">Add ClassCal to your Home Screen first</p>
          <p className="mt-1 text-sm text-ink-muted">
            On iPhone and iPad, reminders only work once the app is on your Home Screen. Tap the
            Share button, then <strong>Add to Home Screen</strong>, and open ClassCal from the new
            icon.
          </p>
        </div>
      ) : null}

      {push === 'unsupported' ? (
        <p className="rounded-md border border-line bg-sunken p-4 text-sm text-ink-muted">
          This browser cannot show reminders. The calendar still works, and you can check it any
          time.
        </p>
      ) : null}

      {push === 'denied' ? (
        <p className="rounded-md border border-line bg-sunken p-4 text-sm text-ink-muted">
          Notifications are blocked for this site in your browser settings. You will need to allow
          them there before reminders can be turned on.
        </p>
      ) : null}

      {push === 'prompt' ? (
        <div className="rounded-md border border-line bg-surface p-4">
          <p className="text-sm text-ink-muted">
            Get reminded before closures and early finishes.
          </p>
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className="mt-3 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            {busy ? 'Turning on…' : 'Turn on reminders'}
          </button>
        </div>
      ) : null}

      {push === 'granted' ? (
        <p role="status" className="rounded-md border border-normal bg-normal-surface p-3 text-sm text-ink">
          Reminders are on for this device.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-critical bg-critical-surface p-3 text-sm text-ink">
          {error}
        </p>
      ) : null}

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold text-ink">Remind me about</legend>
        <div className="space-y-2">
          {CATEGORIES.map((category) => (
            <label
              key={category.key}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-4"
            >
              <input
                type="checkbox"
                checked={Boolean(preferences[category.key])}
                onChange={(e) =>
                  onChange({ ...preferences, [category.key]: e.target.checked })
                }
                className="mt-0.5 h-5 w-5"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">{category.label}</span>
                <span className="block text-sm text-ink-muted">{category.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold text-ink">When</legend>
        <div className="space-y-2">
          {(Object.keys(REMINDER_LABELS) as ReminderType[]).map((reminder) => (
            <label
              key={reminder}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface p-4"
            >
              <input
                type="checkbox"
                checked={preferences.reminderTypes[reminder]}
                onChange={(e) =>
                  onChange({
                    ...preferences,
                    reminderTypes: {
                      ...preferences.reminderTypes,
                      [reminder]: e.target.checked,
                    },
                  })
                }
                className="h-5 w-5"
              />
              <span className="text-sm font-semibold text-ink">{REMINDER_LABELS[reminder]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

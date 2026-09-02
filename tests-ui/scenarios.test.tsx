/**
 * The acceptance scenarios from the specification, run against the real screens,
 * the real application state and a real SQLite database seeded from the
 * fixture calendar.
 *
 * Scenario A -- a Junior Infants + 4th Class household sees the right events.
 * Scenario B -- an early finish shows each child's own finish time.
 * Scenario C -- removing a class removes that class's events immediately.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from '../app/index';
import SettingsScreen from '../app/settings';
import EventDetailScreen from '../app/event/[id]';
import { AppProvider } from '@/state/AppProvider';
import { openDatabase, resetDatabaseConnection } from '@/db/expoSqlite';
import { HeuristicCalendarEventInterpreter } from '@/interpreter/heuristic';
import { syncCalendar } from '@/pipeline/sync';
import { saveFamily } from '@/family/store';
import { queryEvents } from '@/db/repository';
import type { FamilySelection } from '@/domain/types';

const FIXTURE = readFileSync(path.join(__dirname, '..', 'fixtures', 'gsmnc-sample.ics'), 'utf8');

const AOIFE_AND_JACK: FamilySelection = {
  children: [
    { id: 'c1', name: 'Aoife', schoolClass: 'junior_infants' },
    { id: 'c2', name: 'Jack', schoolClass: 'class_4' },
  ],
  setupCompletedAt: '2026-09-01T00:00:00.000Z',
};

/**
 * The fixture calendar covers the 2026/27 school year, so the events are in the
 * future relative to the sync instant used below.
 */
const TODAY = new Date('2026-09-02T09:00:00.000Z');

// Jest only allows a mock factory to close over names beginning with "mock".
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockSearchParams: { current: Record<string, string> } = { current: {} };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams.current,
  Link: ({ children }: { children: unknown }) => children,
  Stack: { Screen: () => null },
}));

async function seed(family: FamilySelection = AOIFE_AND_JACK) {
  await saveFamily(family);
  const db = await openDatabase();
  await syncCalendar({
    db,
    interpreter: new HeuristicCalendarEventInterpreter(),
    source: FIXTURE,
    now: () => TODAY,
  });
  return db;
}

/**
 * Wraps a screen in the same providers the real app supplies, with fixed safe
 * area metrics so layout does not depend on a device.
 */
function Harness({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <AppProvider autoSync={false}>{children}</AppProvider>
    </SafeAreaProvider>
  );
}

async function renderHome() {
  const view = render(
    <Harness>
      <HomeScreen />
    </Harness>,
  );
  await waitFor(() => expect(screen.queryByText(/Your school calendar/)).toBeTruthy());
  return view;
}

jest.setTimeout(20_000);

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockSearchParams.current = {};
  // Fresh in-memory database and storage per test. Modules are deliberately NOT
  // reset: doing so gives the test file and the components separate copies of
  // React, which breaks hooks.
  (require('expo-sqlite') as { __reset: () => void }).__reset();
  resetDatabaseConnection();
  void (
    require('@react-native-async-storage/async-storage') as {
      default: { clear: () => Promise<void> };
    }
  ).default.clear();
});

// ---------------------------------------------------------------------------

describe('Scenario A: a Junior Infants and 4th Class household', () => {
  beforeEach(async () => {
    await seed();
  });

  it('shows Junior Infants events', async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByText(/Aoife · Junior Infants/)).toBeTruthy();
    });
  });

  it('shows whole-school closures', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getAllByText('School closed').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Aoife \+ Jack · Whole school/).length).toBeGreaterThan(0);
  });

  it('shows a 4th Class event', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getByText(/Parent meeting — 4th Class/)).toBeTruthy());
  });

  it('excludes 3rd-class-only events', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getAllByText('School closed').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Swimming — 3rd Class/)).toBeNull();
  });

  it('excludes 5th and 6th class-only events', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getAllByText('School closed').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Sports — 5th Class, 6th Class/)).toBeNull();
  });

  it('shows a whole-school event once, not once per child', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getAllByText('School closed')).toHaveLength(1));
  });

  it('puts the closure under Important', async () => {
    await renderHome();
    await waitFor(() => expect(screen.getByText('IMPORTANT')).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------

describe('Scenario B: an early finish with different times per class', () => {
  it('shows each child their own finish time', async () => {
    const db = await seed();
    const [earlyFinish] = await queryEvents(db, {
      eventTypes: ['early_finish'],
      to: '2026-09-30',
    });
    mockSearchParams.current = { id: earlyFinish!.id };

    render(
      <Harness>
        <EventDetailScreen />
      </Harness>,
    );

    await waitFor(() => expect(screen.getAllByText('Early finish').length).toBeGreaterThan(0));

    // Aoife is in Junior Infants (12:50); Jack is in 4th Class (13:00).
    expect(screen.getByText('Aoife')).toBeTruthy();
    expect(screen.getByText('Jack')).toBeTruthy();
    expect(screen.getByText('until 12:50')).toBeTruthy();
    expect(screen.getByText('until 13:00')).toBeTruthy();
  });

  it('exposes the school original wording behind a toggle', async () => {
    const db = await seed();
    const [earlyFinish] = await queryEvents(db, {
      eventTypes: ['early_finish'],
      to: '2026-09-30',
    });
    mockSearchParams.current = { id: earlyFinish!.id };

    render(
      <Harness>
        <EventDetailScreen />
      </Harness>,
    );
    await waitFor(() => expect(screen.getAllByText('Early finish').length).toBeGreaterThan(0));

    expect(screen.queryByText(/Scoil dúnta níos luath/)).toBeNull();

    fireEvent.press(screen.getByText('Show original wording'));
    expect(screen.getByText(/Scoil dúnta níos luath/)).toBeTruthy();
  });

  it('tells the parent what to do', async () => {
    const db = await seed();
    const [earlyFinish] = await queryEvents(db, {
      eventTypes: ['early_finish'],
      to: '2026-09-30',
    });
    mockSearchParams.current = { id: earlyFinish!.id };

    render(
      <Harness>
        <EventDetailScreen />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByText('What you need to do')).toBeTruthy());
    expect(screen.getByText(/Arrange an earlier collection/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('Scenario C: removing a class', () => {
  it('removes that class\'s events from Home immediately', async () => {
    await seed();

    const view = render(
      <Harness>
        <SettingsScreen />
        <HomeScreen />
      </Harness>,
    );

    await waitFor(() => expect(screen.getByText(/Parent meeting — 4th Class/)).toBeTruthy());

    // Deselect 4th Class in Settings.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('4th Class'));
    });

    await waitFor(() => expect(screen.queryByText(/Parent meeting — 4th Class/)).toBeNull());

    // Junior Infant and whole-school events are untouched.
    expect(screen.getAllByText('School closed').length).toBeGreaterThan(0);
    view.unmount();
  });

  it('refuses to remove the last remaining class', async () => {
    await seed({
      children: [{ id: 'c1', name: 'Aoife', schoolClass: 'junior_infants' }],
      setupCompletedAt: '2026-09-01T00:00:00.000Z',
    });

    render(
      <Harness>
        <SettingsScreen />
      </Harness>,
    );

    await waitFor(() => expect(screen.getByLabelText('Junior Infants')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Junior Infants'));
    });

    // Still selected.
    await waitFor(() =>
      expect(screen.getByLabelText('Junior Infants').props.accessibilityState.checked).toBe(true),
    );
  });
});

// ---------------------------------------------------------------------------

describe('stale data honesty', () => {
  it('says when the calendar was last updated', async () => {
    await seed();
    await renderHome();
    await waitFor(() => expect(screen.getByText(/Last updated/)).toBeTruthy());
  });

  it('warns rather than implying the data is current when nothing has synced', async () => {
    await saveFamily(AOIFE_AND_JACK);
    await openDatabase();

    render(
      <Harness>
        <HomeScreen />
      </Harness>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Calendar may be out of date/)).toBeTruthy(),
    );
  });
});

// ---------------------------------------------------------------------------

describe('untrusted calendar content', () => {
  it('renders markup in a calendar entry as literal text', async () => {
    await saveFamily(AOIFE_AND_JACK);
    const db = await openDatabase();

    const hostile = FIXTURE.replace(
      'SUMMARY:Scoil Dúnta - Lá saoire School Closure',
      'SUMMARY:Scoil Dúnta <img src=x onerror=alert(1)> School Closure',
    );
    await syncCalendar({
      db,
      interpreter: new HeuristicCalendarEventInterpreter(),
      source: hostile,
      now: () => TODAY,
    });

    const [closure] = await queryEvents(db, { eventTypes: ['school_closure'] });
    mockSearchParams.current = { id: closure!.id };

    render(
      <Harness>
        <EventDetailScreen />
      </Harness>,
    );
    await waitFor(() => expect(screen.getAllByText('School closed').length).toBeGreaterThan(0));
    fireEvent.press(screen.getByText('Show original wording'));

    // The markup is displayed as characters, never interpreted.
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
  });
});

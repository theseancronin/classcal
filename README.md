# ClassCal

A parent-focused school calendar for **Gaelscoil Mhainistir na Corann (GSMNC)**.

The school publishes one calendar for the whole school. Every class's events are
mixed together, class references switch between Irish and English (`Naíonáin
Bheaga`, `Junior Infants`, `R3-R6`, `Rang 5&6`), and the things that actually
change your day — a closure, a half day, an early collection — sit among choir
practices and football training.

ClassCal answers one question: **what do I need to know for my children?**

You pick your children's classes once. After that the app shows closures, early
finishes, meetings and your own children's activities, with the school's original
wording always one tap away.

---

## Contents

- [Quick start](#quick-start)
- [Running it on your phone](#running-it-on-your-phone)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [The interpreter](#the-interpreter)
- [Configuration](#configuration)
- [Testing](#testing)
- [Model evaluation](#model-evaluation)
- [Privacy](#privacy)
- [Security](#security)
- [Accessibility](#accessibility)
- [Deviations from the specification](#deviations-from-the-specification)
- [Known limitations](#known-limitations)
- [Outstanding work](#outstanding-work)

---

## Quick start

Requires Node 22+ (Node 24 recommended — the test suite uses the built-in
`node:sqlite` module).

```bash
npm install
```

```bash
npm test
```

```bash
npm start
```

There is no database server to install, no Docker, no API key and no account.
Everything runs on the device.

---

## Running it on your phone

**Android, over your home wifi** — the fastest way to see it:

1. Install **Expo Go** from the Play Store on your phone.
2. On this machine, run:

```bash
npm start
```

3. Scan the QR code in the terminal with Expo Go. The phone and this machine need
   to be on the same wifi network.

**A standalone Android app** you can keep, with no Expo Go and no dev server:

```bash
npx eas build --platform android --profile preview
```

That produces an `.apk` you download and install directly. It needs a free Expo
account (`npx eas login`); no Google Play account and no fee.

---

## How it works

```text
  GSMNC iCalendar feed
          |
          v
  fetch + tolerant decode          src/ical/fetcher.ts
          |
          v
  RFC 5545 parse, field caps       src/ical/parser.ts
          |
          v
  store raw version (hashed)       src/db/repository.ts
          |
      new or changed?  -- no --> stop. Nothing is reinterpreted.
          | yes
          v
  interpreter                      src/interpreter/
          |
          v
  validate + canonicalise
  + deterministic importance       src/normalize/
          |
          v
  diff against previous version    src/changes/diff.ts
          |
          v
  SQLite on the device             src/db/
          |
     +----+----------------+
     v                     v
  screens (app/)     reminders (src/notifications/)
     |
     v
  deterministic relevance filter   src/relevance/
```

The guiding rule, taken from the specification:

> Use deterministic software for dates, filtering, state, changes and
> notifications. Use the language model only where language understanding adds
> value.

So the LLM never decides whether an event is important, whether you should see
it, when to remind you, or whether something changed. Those are all ordinary code
with tests.

---

## Architecture

| Directory | Responsibility |
|---|---|
| `src/domain/` | Types, Zod schemas, date and label formatting. The vocabulary of the app. |
| `src/classes/` | Class alias resolution and time extraction. The deterministic heart. |
| `src/ical/` | Fetching, RFC 5545 parsing, payload hashing. |
| `src/interpreter/` | The `CalendarEventInterpreter` interface and its implementations. |
| `src/normalize/` | Validation, canonicalisation, importance rules, sanity checks. |
| `src/relevance/` | Who sees what, and the home screen's ordering. |
| `src/changes/` | Normalized-event diffing and change wording. |
| `src/notifications/` | Reminder scheduling, reconciliation, delivery. |
| `src/db/` | Schema, migrations, repositories, the two SQLite adapters. |
| `src/pipeline/` | The sync orchestration that ties it together. |
| `src/state/` | The React context: database, family, sync lifecycle. |
| `src/ui/` | Design tokens and shared components. |
| `app/` | Screens (expo-router file-based routes). |

### Screens

| Route | Purpose |
|---|---|
| `/` | Personalised "For You" feed |
| `/setup` | First-launch class selection and optional child names |
| `/calendar` | Month grid, agenda list, filters, search |
| `/event/[id]` | Full detail, per-class times, original wording, source link |
| `/settings` | Children, classes, notifications, display, source, privacy |
| `/review` | Developer review queue (development builds only) |

### The database port

`src/db/port.ts` defines a four-method interface. Two adapters implement it:

- `expoSqlite.ts` — `expo-sqlite`, what the app runs on;
- `nodeSqlite.ts` — Node's built-in `node:sqlite`, used by the tests.

This means the integration tests run the **production schema, migrations and
SQL** for real, rather than against a mock.

---

## The interpreter

Turning `Scoil dúnta níos luath - Cruinniú Foirne - Naíonáin @12.50in & R1 - R6
@1.00in` into structured data is the one genuinely hard problem here. It sits
behind a single interface:

```ts
interface CalendarEventInterpreter {
  readonly id: string;
  interpret(event: RawCalendarEvent): Promise<InterpretedCalendarEvent>;
}
```

Two implementations ship:

### `HeuristicCalendarEventInterpreter` (default)

Rule-based, on-device, no network. The school's calendar uses a small, highly
repetitive vocabulary, and regular expressions read it more reliably — and far
more cheaply — than a language model. On the live feed it classifies 100% of
events, resolves affected classes for all of them, and holds 7.4% for review. See [Model evaluation](#model-evaluation).

**This is why the app works with no AI configured at all.**

### `GemmaCalendarEventInterpreter` (optional)

Talks to any OpenAI-compatible chat-completions endpoint — Ollama, llama.cpp,
vLLM or a hosted gateway — so the product is not tied to a vendor. It requests
schema-constrained JSON, validates every response, retries with backoff, and
falls back to the deterministic rules if the model is unavailable, so an event is
never lost.

Whichever is active, output goes through the same deterministic post-processing
before it can be stored (`src/normalize/normalize.ts`):

1. validate against the runtime schema;
2. re-canonicalise and deduplicate class identifiers;
3. normalize times;
4. **apply importance and parent-action rules in code** — a model cannot
   downgrade a closure;
5. run semantic sanity checks;
6. mark low-confidence or ambiguous output for review;
7. persist only what survives all of the above.

### Using Gemma

Run a local model:

```bash
ollama pull gemma3:4b-it-qat
```

Then set the environment variables before starting the app:

```bash
EXPO_PUBLIC_EVENT_INTERPRETER=gemma EXPO_PUBLIC_GEMMA_BASE_URL=http://localhost:11434/v1 npm start
```

On a physical phone, `localhost` is the phone — use your machine's LAN address
(for example `http://192.168.1.20:11434/v1`).

> **On the specification's "Gemma 4 E2B":** no Gemma 4 exists. The adapter
> targets a Gemma 3 instruct build by default and the model id is configurable,
> so it will pick up a Gemma 4 the day one ships.

---

## Configuration

Configuration lives in `app.json` under `extra`, overridable by environment
variables at build time.

| Variable | `app.json` key | Default | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_EVENT_INTERPRETER` | `eventInterpreter` | `heuristic` | `heuristic` or `gemma` |
| `EXPO_PUBLIC_GEMMA_BASE_URL` | `gemmaBaseUrl` | — | OpenAI-compatible endpoint |
| `EXPO_PUBLIC_GEMMA_MODEL` | `gemmaModel` | `gemma3:4b-it-qat` | Model id |
| `EXPO_PUBLIC_GEMMA_API_KEY` | `gemmaApiKey` | — | Bearer token, if the endpoint needs one |

The calendar feed URL, timezone and school details are in
`src/config/school.ts`. A parent can also paste a new feed address in Settings if
the school rotates its download token — the token in the config is a default, not
a permanent truth.

> **`EXPO_PUBLIC_*` values are embedded in the app bundle and are not secret.**
> An endpoint that needs a real credential should sit behind a proxy rather than
> shipping the key in the app.

### Adding another school

`SchoolConfig` in `src/config/school.ts` holds everything school-specific — name,
URLs, timezone, extra aliases. The generic alias table already covers standard
Irish primary-school wording, so a second school is largely a configuration
exercise.

---

## Testing

Two runners, because they serve different purposes:

```bash
npm test
```

runs both. Individually:

```bash
npm run test:logic
```

Vitest — 291 tests over the domain logic, parsing, normalization, relevance,
diffing, scheduling, and full pipeline integration against real SQLite. Fast
(about two seconds) and has no React Native dependency.

```bash
npm run test:ui
```

Jest + React Native Testing Library — 15 tests rendering the real screens with
the real application state and a real seeded database.

```bash
npm run typecheck
```

TypeScript in strict mode, with `noUncheckedIndexedAccess`.

### What is covered

**Unit** — class aliases and ranges, time parsing, importance rules, relevance
rules, change diffing, notification scheduling, duplicate suppression, date
formatting, home-screen sectioning.

**Integration** — iCal fixture to raw storage; new raw event through the
interpreter; valid interpretation to normalized storage; invalid model response
to the review queue; changed raw event to an `EventChange`; class-filtered
queries; search; notification reconciliation.

**Screen** — the specification's acceptance scenarios:

- **A** — a Junior Infants + 4th Class household sees Junior Infant events, 4th
  Class events and whole-school closures, and does *not* see 3rd-only or
  5th/6th-only events. The whole-school closure appears once, not once per child.
- **B** — a whole-school early finish shows Infants finishing at 12:50 and 1st–6th
  at 13:00, with each child's own time.
- **C** — removing 4th Class in Settings removes 4th-only events immediately.

Plus: stale-data honesty, and markup in a calendar entry rendering as literal
text.

---

## Model evaluation

`fixtures/live-snapshot.ics` is a captured copy of the real GSMNC feed (162
events). `tests/evaluation.test.ts` runs the active interpreter over all of it
and fails the build if quality regresses:

```bash
npm run evaluate
```

Current thresholds:

| Measure | Threshold | Actual |
|---|---|---|
| Events parsed without being skipped | all | 162/162 |
| Producing schema-valid, persistable output | all | 162/162 |
| Classified as something other than `other` | ≥ 90% | 100% |
| Affected classes resolved | all | 162/162 |
| Held for review | ≤ 15% | 7.4% (12/162) |
| Times extracted where the source states one | ≥ 90% | 100% (66/66) |
| Wording that clearly says "school shut" misclassified | zero | zero |

That last row is the one that matters. **For attendance-changing events, recall
beats precision**: showing one extra closure is a minor annoyance, missing one
means a child left at the school gate.

To evaluate a different interpreter, point `EVENT_INTERPRETER` at it and rerun.
To refresh the snapshot, download the feed to
`fixtures/live-snapshot.ics` and rerun — expect to adjust rules if the school
changes its house style.

---

## Privacy

- ClassCal reads **only** the school's public calendar.
- Child names and class selections are stored **on the device** and are never
  transmitted — not to the school, not to a server, not to any model. There is no
  server to send them to.
- Only the public calendar title, description and date are ever sent to an
  inference endpoint, and only when Gemma is explicitly configured. A test
  asserts that no family data appears in a model request.
- No accounts, no sign-in, no analytics, no tracking.
- No date of birth, student ID, or any other identifier is collected. A child's
  name is optional.
- **Settings → Clear family data** removes everything about your family from the
  device.

---

## Security

Calendar content is untrusted input from a public website, and is treated as
such:

- **XSS** — there is no HTML renderer in the app. Every piece of calendar text
  goes through React Native `<Text>`, which escapes by construction. A test seeds
  `<img src=x onerror=alert(1)>` into a calendar entry and asserts it renders as
  literal characters.
- **Prompt injection** — the Gemma system instruction states that calendar text
  is untrusted data and must never be followed as instructions. More importantly,
  it does not matter whether the model is fooled: importance, relevance, class
  membership and change detection are all decided in code afterwards. A test
  feeds an injection attempt through the whole path and asserts the closure still
  comes out `critical`.
- **Model capability** — no tools, no filesystem, no database, no browsing. One
  HTTP call to one configured endpoint; a test asserts exactly that.
- **Malformed iCal** — a broken `VEVENT` is skipped and reported, not fatal. An
  unparseable calendar leaves existing data untouched.
- **Oversized fields** — every field is length-capped at the parse boundary, the
  feed is size-capped, and there is a cap on event count.
- **Bad encoding** — the real feed contains byte sequences that are not valid
  UTF-8; decoding falls back per line so one damaged line cannot corrupt the rest.
- **Admin surface** — the review queue is gated on `__DEV__` both at the entry
  point and inside the screen, and is not reachable in a production build.
- **Credentials** — there is no backend and no server-side secret. The one
  configurable credential is documented above as non-secret.

---

## Accessibility

Targeting WCAG 2.2 AA:

- **Importance is never colour alone.** Every level carries a symbol, a word
  (`Important`, `Needs action`) and a distinct left-border weight. The month grid
  uses a filled square versus a hollow dot.
- Every interactive element has an accessibility role, label and state; touch
  targets are at least 44pt.
- Event cards expose one ordered sentence to screen readers rather than a pile of
  fragments.
- Dates are written unambiguously (`Monday 28 September 2026`, or `Today` /
  `Tomorrow`); 24-hour time is the default and 12-hour is a setting.
- Text scales with the OS font-size setting.
- Banners use `accessibilityRole="alert"`.

---

## Deviations from the specification

The specification describes a Next.js PWA with PostgreSQL. The application was
built as an **Expo React Native app for Android that runs entirely on-device**,
at the request of the project owner, who chose the server-free variant.

| Specified | Built | Why |
|---|---|---|
| Next.js + React Server Components | Expo React Native | Requested change to a native app |
| PostgreSQL + Prisma/Drizzle | SQLite via `expo-sqlite`, hand-written SQL behind a port | No server exists to host Postgres. The port lets the same SQL be tested under `node:sqlite`. |
| HTTP API under `/api` | In-process repository functions | Same shapes and same filters; there is no network boundary to cross |
| PWA manifest + service worker | Native install; SQLite persistence | Native app; offline is inherent |
| Playwright E2E | React Native Testing Library screen tests | Playwright drives browsers |
| `/admin/review` with `ADMIN_SECRET` | `/review`, gated on `__DEV__` | No server means no server-side auth; a dev-build gate is the equivalent |
| Scheduled 30-minute server refresh | Refresh on launch and on foreground, rate-limited to 30 minutes | No server to run a cron |
| "Gemma 4 E2B" | Configurable Gemma 3 instruct via OpenAI-compatible endpoint | Gemma 4 does not exist |

Everything else — the domain model, taxonomies, alias rules, importance rules,
relevance engine, change detection, notification scheduling, review queue,
fixtures and the privacy posture — follows the specification.

---

## Known limitations

- **One school.** The architecture is school-agnostic (`SchoolConfig`), but only
  GSMNC is configured and only its wording has been evaluated.
- **The feed publishes everything as all-day events** with times buried in the
  summary text and empty `DESCRIPTION`/`LOCATION` fields. Times are therefore
  extracted from text. Where the school states no time, the app shows none rather
  than guessing.
- **No recurrence expansion.** The feed contains no `RRULE`, so `RRULE`,
  `EXDATE` and recurrence overrides are unhandled. They would need work if the
  school changed how it publishes.
- **Unnamed events default to whole-school.** This deliberately favours recall,
  and costs some precision: a football training entry that names no class is
  shown to everyone, flagged lower-confidence.
- **Bilingual summaries are shown in English.** The interpreter generates English
  parent-facing summaries; the original Irish is always available behind "Show
  original wording". Irish-language summaries are a post-MVP item.
- **The heuristic interpreter is tuned to this school's house style.** A
  different school's phrasing would need either rule additions or Gemma.
- **Notifications are local, not push.** Scheduled on-device with
  `expo-notifications`. That is the right shape for a serverless app, but
  reminders only fire for calendar data the phone has already synced.
- **iOS is untested.** The codebase is cross-platform and Expo builds for both,
  but only Android has been targeted.

---

## Outstanding work

Deferred deliberately, in rough priority order:

1. **Run against the live feed on a device over time** — the sync path is tested
   against fixtures and a captured snapshot, but not yet against weeks of real
   changes.
2. **A labelled evaluation set.** The specification asks for 100+ manually
   labelled events. The current evaluation checks structural quality over all 162
   real events rather than per-event correctness against a gold standard. That
   should exist before enabling Gemma by default.
3. **Personalised iCal export** (spec Phase 2) — subscribe to your filtered view
   from Google or Apple Calendar.
4. **School-year rollover / class promotion** — children do not currently move up
   a class in September.
5. **Irish-language parent-facing summaries.**
6. **iOS verification and an App Store or TestFlight path.**
7. **Automated accessibility assertions.** Roles and labels are set throughout
   and the non-colour rule is enforced by design, but there is no automated
   contrast or a11y audit in CI.

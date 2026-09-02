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

It is a **web app**. Parents open a link. There is nothing to install from an app
store, and it works the same on Android and iPhone.

---

## Quick start

Requires Node 22+ (Node 24 recommended).

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:3000>. On first run there is no calendar data yet — fetch
it once:

```bash
curl http://localhost:3000/api/cron/sync
```

With no `DATABASE_URL` set, the app uses **PGlite** — real Postgres compiled to
WebAssembly, running in-process and stored in `.pglite/`. A clean checkout runs
with no database server, no Docker and no setup.

### Tests

```bash
npm test
```

| Command | What it runs |
|---|---|
| `npm run test:logic` | 324 tests: parsing, interpretation, normalization, relevance, change detection, notifications, queries and the HTTP API — against real Postgres |
| `npm run test:ui` | 8 screen-level acceptance scenarios |
| `npm run typecheck` | TypeScript strict, with `noUncheckedIndexedAccess` |
| `npm run evaluate` | The interpreter against a 162-event snapshot of the live feed |
| `npm run smoke` | The full pipeline against the school's **live** feed — needs the network, so it sits outside the default suite |

---

## How it works

```
GSMNC iCalendar feed
      │  fetched server-side (the feed sends no CORS headers,
      │  so a browser cannot read it directly)
      ▼
  fetch + tolerant UTF-8 decode        src/ical/fetcher.ts
  RFC 5545 parse, field caps           src/ical/parser.ts
  store raw version, hashed            src/db/repository.ts
      │
      │  only new or changed events are interpreted
      ▼
  interpret                            src/interpreter/
  validate, canonicalise, importance   src/normalize/
  diff against the previous version    src/changes/diff.ts
      ▼
  Postgres
      │
      ├── GET /api/events   → the app, filtered to the household's classes
      └── /api/cron/notify  → Web Push reminders
```

The sync runs **once on the server** for everyone, rather than on every parent's
device: one fetch, one interpretation, shared by every family.

### Directories

| Path | What |
|---|---|
| `src/domain/` | Types, Zod schemas, date and label formatting |
| `src/classes/` | Irish/English class alias resolution, time extraction |
| `src/ical/` | Fetch, parse, hash |
| `src/interpreter/` | The `CalendarEventInterpreter` interface, heuristic and Gemma implementations |
| `src/normalize/` | Validation, importance rules, sanity checks |
| `src/relevance/` | Who sees what; home-screen grouping |
| `src/changes/` | Event diffing and change wording |
| `src/notifications/` | Reminder scheduling, reconciliation and dispatch (all pure) |
| `src/db/` | Schema, migrations, repository and the Postgres adapters |
| `src/pipeline/` | Sync orchestration |
| `src/server/` | Server-only configuration |
| `src/state/` | The single React context |
| `src/ui/` | Design tokens and shared components |
| `src/family/` | The household, in localStorage |
| `app/` | Next.js routes and API handlers |

### Screens

| Route | Purpose |
|---|---|
| `/` | The personalised "For you" feed |
| `/setup` | First visit: pick classes, optionally name children |
| `/calendar` | Month grid, agenda, search, filters |
| `/event/[id]` | One event: per-child times, the school's original wording |
| `/settings` | Classes, names, reminders, display, data |
| `/review` | Developer queue: failures and low-confidence interpretations |

---

## The interpreter

The default interpreter is **rule-based**, not a model. The school's vocabulary
is small and repetitive, and regex handles it completely:

| Measure | Result on the live 162-event feed |
|---|---|
| Events parsed | 162 / 162 |
| Classified as `other` | 0 |
| Unresolved class references | 0 |
| Class-specific times extracted | 66 / 66 |
| Held for review (low confidence) | 12 (7.4%) |
| Closures misclassified | 0 |

A **Gemma** adapter is available for any OpenAI-compatible endpoint and falls
back to the heuristic on any failure. It is an optional upgrade, never a
requirement:

```bash
ollama pull gemma3:4b-it-qat
```

Then set `EVENT_INTERPRETER=gemma` and `GEMMA_BASE_URL=http://localhost:11434/v1`.

### What a model is never allowed to decide

Importance, relevance, change detection and reminder scheduling are **all
deterministic code**. A model can propose a summary and a category; it can never
downgrade a closure, hide an event, or trigger an alert. There is a test proving
that a prompt-injection attempt in the feed still produces a critical closure.

The interpreter is only ever sent public calendar text. Child names and class
selections never leave the browser.

### Recall over precision

An event naming no class defaults to whole-school and is flagged low confidence.
A football training shown to everyone is a minor annoyance; a missed closure is a
child left at the gate.

---

## Configuration

Copy `.env.example` to `.env.local`. Everything is optional for local
development.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres. Unset uses local PGlite. |
| `CRON_SECRET` | — | Protects `/api/cron/*` and `/api/review`. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | Web Push. Generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `EVENT_INTERPRETER` | `heuristic` | `heuristic` or `gemma` |
| `GEMMA_BASE_URL` / `GEMMA_MODEL` / `GEMMA_API_KEY` | — | The inference endpoint |

None of these are `NEXT_PUBLIC_`, so none reach the browser bundle.

School details (feed URL, timezone, class aliases) live in `src/config/school.ts`.

---

## Deployment

Any Node host works. On Vercel, `vercel.json` already schedules both jobs:

- `/api/cron/sync` three times a day — fetch and interpret the calendar
- `/api/cron/notify` every 15 minutes — send due reminders

Set `DATABASE_URL` to any Postgres (Neon and Supabase both have free tiers), plus
`CRON_SECRET` and the VAPID pair. Migrations run automatically on first
connection.

---

## Notifications

Reminders are scheduled by importance:

| Importance | Reminders |
|---|---|
| Critical (closures, early finishes) | a week before, the day before, and that morning |
| High (meetings, action needed) | a week before, the day before |
| Normal | the day before |
| Low | none |

Delivery is **at most once per browser**, keyed by
`(endpoint, event + reminder type + scheduled time)`. A parent who gets the same
closure alert three times turns reminders off, and then misses the one that
mattered.

### The iOS caveat

Web Push works in an ordinary Android Chrome tab. On iPhone and iPad, Safari only
permits it once the app is **added to the Home Screen**. The settings screen
detects this and tells the parent exactly what to tap, rather than showing a
button that would silently fail.

---

## Privacy

- **No accounts.** Nothing to sign up for.
- Your classes, your children's names and your reminder settings are stored
  **only in your browser**. They are never sent to the server.
- The server sees which *classes* an anonymous request asks about, never which
  household is asking.
- A push subscription stores only the browser's own opaque endpoint, the classes
  to filter by, and which categories you want.
- "Clear family data" in Settings removes everything.

---

## Honesty about staleness

The app must never imply the calendar is current when it isn't (spec §26).

- It shows when it last updated successfully.
- If a refresh fails it keeps showing the cached calendar, says so, and links to
  the school's own calendar.
- Before the first fetch settles it says nothing about freshness, because it does
  not yet know.
- An event the interpreter was unsure about is labelled "Unconfirmed" and never
  triggers a critical alert.

---

## Accessibility

- Importance is never colour alone: each level carries a label, a
  greyscale-legible icon and a border weight.
- Every control clears the 44px WCAG 2.2 target size.
- Event cards carry a full accessible name — date, type, importance, who it
  affects — because the visual grouping that makes those obvious on screen is not
  available to a screen reader reading one card at a time.
- Pinch-to-zoom is never blocked; `prefers-reduced-motion` is respected.

---

## Deviations from the specification

| Spec | Built | Why |
|---|---|---|
| PostgreSQL with Prisma/Drizzle | Postgres with raw SQL over a small port | The port lets the same SQL run on PGlite in tests and hosted Postgres in production, so the schema is genuinely exercised rather than mocked. An ORM would have added a layer without removing one. |
| Push notifications "if time permits" | Built | It is the main thing a school calendar is *for*. |
| Admin corrections UI | Read-only review queue | The queue answers the calibration question the spec asked it for; reprocessing is an API concern. |

An earlier iteration was built as an Expo React Native app. That was the wrong
call for this audience: it would have meant App Store and Play Store listings, a
$99/year Apple developer account, and no way to simply send parents a link. It is
preserved at the `rn-final` git tag.

---

## Known limitations

1. No labelled gold-standard evaluation set yet; the accuracy figures come from
   the live feed rather than human-verified labels.
2. Not yet verified against the live feed across a full school year.
3. No school-year rollover or class promotion.
4. Parent-facing summaries are English only, though Irish source text is parsed
   and always available.
5. `parent_association` events are hidden by default and opt-in.
6. Personalised iCal export (spec Phase 2) is not built.

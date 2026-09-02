# ClassCal — Project Context

## What it is

A parent-focused school calendar app for Gaelscoil Mhainistir na Corann (GSMNC), an Irish primary school. The school publishes one iCalendar feed mixing every class's events together in bilingual Irish/English. ClassCal lets a parent pick their children's classes and see only what matters to them — closures, early finishes, meetings, their children's activities — with per-class finish times and plain-English summaries.

## How to run it

### Prerequisites
- Node 22+ (Node 24 recommended — tests use built-in `node:sqlite`)
- npm
- For on-device: Expo Go app on an Android phone (same wifi as your dev machine)

### Install dependencies
```bash
cd G:\projects\classcal
npm install
```

### Start the dev server
```bash
npm start
```
This launches Metro + Expo. Scan the QR code with Expo Go on your Android phone, or press `a` to open in an Android emulator if you have one configured.

### Run tests
```bash
npm test              # all 306 tests (291 Vitest + 15 Jest screen tests)
npm run test:logic    # Vitest only (domain, parsing, pipeline, notifications)
npm run test:ui       # Jest only (screen-level acceptance scenarios)
npm run typecheck     # TypeScript strict mode
npm run evaluate      # evaluation against the live 162-event feed
```

### Build a standalone APK
```bash
npx eas login         # free Expo account
npx eas build --platform android --profile preview
```

### Optional: enable the Gemma LLM interpreter
```bash
ollama pull gemma3:4b-it-qat
EXPO_PUBLIC_EVENT_INTERPRETER=gemma EXPO_PUBLIC_GEMMA_BASE_URL=http://<your-lan-ip>:11434/v1 npm start
```
The app works fully without any AI model — the default rule-based interpreter handles 100% of the school's events.

## Tech stack

- **Expo SDK 57 / React Native 0.86 / React 19** — Android app, no server
- **TypeScript strict** with `noUncheckedIndexedAccess`
- **expo-sqlite** — on-device SQLite for all persistence
- **Zod** — runtime schema validation at every trust boundary
- **ical.js** — RFC 5545 parsing
- **expo-router** — file-based routing
- **expo-notifications** — local scheduled reminders
- **Vitest** — unit/integration tests of pure domain logic
- **Jest + React Native Testing Library** — screen-level acceptance tests

## Architecture overview

```
GSMNC iCalendar feed
    → fetch + tolerant UTF-8 decode (src/ical/fetcher.ts)
    → RFC 5545 parse, field caps (src/ical/parser.ts)
    → store raw version, hashed (src/db/repository.ts)
    → if new/changed: interpret (src/interpreter/)
    → validate + canonicalise + deterministic importance (src/normalize/)
    → diff against previous version (src/changes/diff.ts)
    → SQLite on device (src/db/)
    → screens read via queryEvents() ← never interprets on read path
    → reminders reconciled via planNotifications() + commitPlan()
```

### Key directories

| Directory | What |
|---|---|
| `src/domain/` | Types, Zod schemas, date/label formatting |
| `src/classes/` | Irish/English class alias resolution, time extraction |
| `src/ical/` | Fetch, parse, hash |
| `src/interpreter/` | CalendarEventInterpreter interface + heuristic + Gemma implementations |
| `src/normalize/` | Post-processing: validation, importance rules, sanity checks |
| `src/relevance/` | Who sees what, home screen grouping |
| `src/changes/` | Event diffing, change wording |
| `src/notifications/` | Reminder scheduling + reconciliation (pure) + delivery (platform) |
| `src/db/` | Schema, migrations, repositories, two SQLite adapters (expo + node) |
| `src/pipeline/` | Sync orchestration |
| `src/state/` | React context (AppProvider) |
| `src/ui/` | Design tokens, shared components, banners |
| `src/family/` | AsyncStorage for child names and preferences |
| `app/` | Expo Router screens |
| `tests/` | Vitest tests |
| `tests-ui/` | Jest screen tests |
| `fixtures/` | 16-event sample ICS + 162-event live snapshot |

### Screens (expo-router file routes)

| Route | Screen |
|---|---|
| `/` (app/index.tsx) | Home — personalised "For You" feed |
| `/setup` (app/setup.tsx) | First-launch class selection + optional child names |
| `/calendar` (app/calendar.tsx) | Month grid + agenda + filters + search |
| `/event/[id]` (app/event/[id].tsx) | Event detail with per-class times, original wording, source link |
| `/settings` (app/settings.tsx) | Children, classes, notifications, display, feed URL, privacy |
| `/review` (app/review.tsx) | Developer review queue (__DEV__ only) |

## Key design decisions

1. **Rule-based interpreter is the default.** The school's vocabulary is small and repetitive. Regex classifies 100% of 162 real events with zero unresolved classes. The Gemma adapter is an optional upgrade, not a requirement.

2. **Importance/relevance/changes/reminders are all deterministic code.** A model can never downgrade a closure or hide an event. There's a test proving a prompt-injection attempt still produces a critical closure.

3. **Database port pattern.** `src/db/port.ts` defines a 4-method interface. `expo-sqlite` runs on the phone; `node:sqlite` runs in tests. The production schema and SQL are tested for real, not mocked.

4. **Events naming no class default to whole_school** (recall over precision). A football training with no class named shows for everyone, flagged low-confidence. A missed closure means a child at the gate.

5. **No server.** Originally spec'd as Next.js + PostgreSQL. User chose Expo + on-device at project start. All domain logic carried over unchanged; deviations documented in README.

## Current state (as of 2026-09-02)

- **306 tests passing** (291 Vitest + 15 Jest)
- **Typecheck clean** (strict + noUncheckedIndexedAccess)
- **Android bundle builds** (npx expo export --platform android)
- **Dev server serves** (Metro bundles successfully)
- **Evaluation:** 162/162 parsed, 0 "other", 0 unresolved classes, 66/66 times extracted, 7.4% held for review, 0 closure misclassifications

## What's deferred

1. Labelled 100+ event gold-standard evaluation set
2. Verification against the live feed on a physical device over time
3. Personalised iCal export (spec Phase 2)
4. School-year rollover / class promotion
5. Irish-language parent-facing summaries
6. iOS verification
7. Automated accessibility/contrast auditing

## Configuration

| Env var | app.json key | Default | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_EVENT_INTERPRETER` | `eventInterpreter` | `heuristic` | `heuristic` or `gemma` |
| `EXPO_PUBLIC_GEMMA_BASE_URL` | `gemmaBaseUrl` | — | OpenAI-compatible endpoint |
| `EXPO_PUBLIC_GEMMA_MODEL` | `gemmaModel` | `gemma3:4b-it-qat` | Model id |
| `EXPO_PUBLIC_GEMMA_API_KEY` | `gemmaApiKey` | — | Bearer token |

School config (feed URL, timezone, aliases) is in `src/config/school.ts`.

## Important files for common tasks

- **Adding an event type:** `src/domain/types.ts` (EVENT_TYPES union), `src/interpreter/heuristic.ts` (TYPE_RULES), `src/normalize/importance.ts` (importance mapping)
- **Adding a class alias:** `src/classes/classAliases.ts` (CLASS_ALIAS_PATTERNS)
- **Changing the feed URL:** `src/config/school.ts` (DEFAULT_SCHOOL.calendarFeedUrl) or Settings screen at runtime
- **Adjusting confidence/review threshold:** `src/config/school.ts` (CONFIDENCE_REVIEW_THRESHOLD)
- **Adjusting reminder timing:** `src/notifications/schedule.ts` (REMINDERS_BY_IMPORTANCE, MORNING_OF_HOUR, ADVANCE_REMINDER_HOUR)

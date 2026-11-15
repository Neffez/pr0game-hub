# Code Review: pr0game-hub

**Date:** 2026-11-15
**Scope:** The changes of this week (`9ae64eb..1cd55db`, 2026-11-09 to 2026-11-14: notification rules and quiet hours,
"who threatens me", hub display names, player profile pastes, Units statistics, build orders by hand and before the
start, planet limit of colony saves, filtered CSV export, About page, galaxy points strip, the follow-ups of
`CODEREVIEW_NEW_FEATURES.md`), plus the findings of the 2026-11-04 review that are still open.
**Method:** Diff review of every server, package and web change of the week, with the surrounding code where the diff
touches a contract (tenancy, auth, notifications, migrations); then a verification pass of the carried-over findings
against the current tree. Findings are evidence-based; theoretical items are marked as such.

**Closed findings are not listed.** Everything of the 2026-11-04 review that landed (first to third commit series,
B-01 to B-30 except the theoretical table, A-02, A-04, A-07, A-09, I-01, I-02, I-04, I-06, I-07, C-10a to C-10d),
all of `CODEREVIEW_NEW_FEATURES.md` (B-1 to B-12, U-1 to U-10, shipped 2026-11-09/10) and this review's new findings
N-01 to N-11 (fixed 2026-11-15, see "Fixed since this review" below) are out of this file; the history is in git
(`git log -- CODEREVIEW.md`).

**Verification run (this tree, after the fixes of 2026-11-15):** `pnpm install`, `pnpm --filter "./packages/*" build`,
once with the Battlerust WASM built and once without.

| Check | With WASM | Without WASM |
|---|---|---|
| `pnpm typecheck` | passes | passes (types in `packages/battle/wasm-types/`) |
| `apps/server` tests | 337 passed | 332 passed, 5 skipped (simulations) |
| `apps/web` tests | 116 passed | 116 passed |
| `packages/flight`, `parser`, `planner`, `loot` | 49 / 159 / 26 / 52 passed | same |
| `packages/battle` | 21 passed | 8 passed, 13 skipped (engine suites) |
| `apps/tools` | 64 passed | 49 passed, 15 skipped (battle simulator page) |

### How to read a finding

| Field | Meaning |
|---|---|
| **Impact** | How much it hurts users, operators, or future work if the issue is real |
| **Risk** | How likely it is to go wrong, times how bad that is |
| **Effort** | Implementation size: **Low** (hours), **Medium** (1–3 days), **High** (a week or a careful refactor) |

Severity of a finding is **Impact × Risk**, not Impact alone.

---

## Executive summary

The week's work is consistent with the hub's rules: every new endpoint is in `openapi.yaml` (the path test keeps it
so), every new table carries `group_id` or a key (the group-scope test passes), the new server logic has its own
suites (`threats`, `notifyRules`, `displayName`, `export`, planner `edit`/`planned`, parser `playercard` fixtures),
texts exist in both languages (new `locale-keys` test), and the pages got their tour steps. The planet limit matches
the game's `PlayerUtil::maxPlanetCount` (checked against the pr0game source). The overview parser fix (the
`.planeth` box with the queues) and the upgrade advisor calibration are the right fixes for the reported symptoms.

The eleven new findings of this review (held notifications tied to a subscription id and deleted before delivery,
the duplicate index of migration 086, access requests on a placeholder's username, `DISPLAY` in the routes layer with
dead member joins, the WASM dependency of `pnpm typecheck`, and smaller validation and typing items) are fixed; what
remains open are the theoretical items of this week and the carried-over findings of the 2026-11-04 review, to do
when the files are touched.

---

## What is in good shape (this week)

- Notification rules are one model for push and Discord (`notify.ts`: quiet hours, held rows, muted storages;
  `wanted()` takes the rules), with tests for midnight crossing, device time zones, re-registration, expiry and the
  Discord path.
- `notify_held` replaces by `(target, tag)`, so a newer attack notification supersedes the held one; expired rows are
  dropped on flush; at most `HELD_MAX` go out.
- The display name is validated once (`parseDisplayName`: NFC, letters of any script, no `@`, no control characters),
  the backfill from sanitized in-game names is a data migration with a test, and `@mentions` cover display, in-game
  and login name.
- Build orders before the start: the write hook has an explicit `allowBeforeStart` next to `allowEnded`/`allowToken`;
  planned planets use galaxy 0 so the existing key validation covers them; `assignPlanet` refuses a target with steps.
- CSV export neutralizes formula-looking texts (`=`, `+`, `-`, `@`, tab, CR) and only for strings; filters are
  validated in the route and applied in the repo.
- `playerCard` store is conservative: a galaxy view of the system wins, another player's planet is never overwritten.
- Defense advisor requests carry a newest-request token like `useLoader` (no stale answer after a planet change).

---

## 1. New findings (changes of 2026-11-09 to 2026-11-14)

### Fixed since this review (2026-11-15)

| ID | Finding | Fix |
|---|---|---|
| N-01 | Held notifications followed the push subscription id, not its owner | Migration 088: triggers drop the held rows of a subscription when it is deleted or moves to another user, and of a deleted user; flushes drop rows of a vanished target; test for a browser registered by another user and for unsubscribe |
| N-02 | Migration 086 recreated the duplicate `stat_snapshots_time` | Migration 089 drops it; `test/schema.test.ts` fails on two indexes over the same columns |
| N-03 | Held notifications were deleted before their delivery | `dueHeld` / `sentHeld`: rows are deleted per row (push) or per message (Discord) after success, expired ones on the next flush; one flush at a time; tests for a failing push service and webhook |
| N-04 | An access request with a placeholder's username could not be assigned to another placeholder, with a misleading error | Own `409 username_of_placeholder` naming the member; the list returns that member as `placeholder` and the admin page preselects it |
| N-05 | `DISPLAY` lived in `routes/util.ts` and the data layer imported it | `repo/sql.ts` (`DISPLAY`, `displayOf`, `displayNameOf`, `likeTerm`); `routes/util.ts` re-exports; no repo imports `routes/` any more |
| N-06 | Dead `group_members` joins after the display-name change | `MEMBER()` deleted, the left joins nothing reads removed (bound parameters adjusted); inner joins that filter by membership and the reads of `ingame_name` stay |
| N-07 | Two identities without a stated rule | Rule in `repo/sql.ts` and README ("Member names"); the admin's placeholder list is marked as the match list it is |
| N-08 | Start resources and temperature defined twice | `plannedPlanet` defaults to `startResourcesOf({})`; `INITIAL_TEMP` lives in `@pr0hub/core/production` next to `positionTemp` |
| N-09 | Hand-rolled validation of the new endpoints | `threats` uses `clampInt` (which now treats an empty parameter as missing); `storage-alerts` keeps the caller's planets only; `build-order/assign` needs a synced planet of the caller (`build_order_target_invalid`) |
| N-10 | `pnpm typecheck` and tests depended on the Docker WASM build | Committed module types (`packages/battle/wasm-types/`, checked against the generated `battlerust.d.ts`); engine suites `skipIf` the binary is missing, with a warning; README note |
| N-11 | `HostileView` kept `useLoader<any>` | Typed `/hostile` response |
| N-T2 | `threatsOf` scanned every combat report of the group | Migration 090: `combat_reports (group_id, time)` (the index of 083 is partial); the query plan uses it |

The carried-over C-02 (the last four loaders), C-03 (setting keys), C-07 (`ABBR`, `phalanxRange`), C-08 (query
parameters, `readError`), C-10e, I-03 (`noUnusedLocals`, `noUncheckedIndexedAccess` on flight) and I-05 were fixed the
same day; their rows below show what is left of them. Typing the loaders also found a bug: `/raids` missile impacts
lacked the `created_at` the list falls back to.

### Theoretical (this week)

| ID | Issue | Why theoretical |
|---|---|---|
| N-T1 | `Store.playerCard` overwrites a slot kept for a destroyed planet or debris field (`player_id` NULL) in a viewed system with the card's home planet | Home planets cannot be destroyed or abandoned in the game; the row is the player's own former slot |
| N-T3 | `GET /api/:uni/browse/:g` loads the newest scores of every player in the galaxy per request | One `json_each` query; bounded by systems × positions |
| N-T4 | `QuietHours.vue` stores the device time zone at the last change; a device that travels keeps the old zone until the user touches the setting | Documented in the component; the shown `tz` makes it visible |

---

## 2. Carried over from the 2026-11-04 review (still open, verified 2026-11-15)

Evidence re-checked against this tree; sizes updated. Only what is still open is listed.

### Architecture

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| A-01 | OpenAPI is hand-written; no typed client | Since 2026-11-15 the server tests validate every 2xx JSON answer against the spec (`test/contract.ts`, 171 of 185 operations called) and the token-facing GETs are described in full; 51 answers, mostly admin and write endpoints, are still `type: object`; web client is `api<T = any>` | High | Low | Medium | Fill the remaining schemas when an endpoint is touched; generate types from the YAML for the web and replace `apiTypes.ts` (C-02) |
| A-03 | Group isolation is a convention plus a grep test, not an API | `test/groupScope.test.ts` enforces `group_id` or a key per statement (all week's statements pass); no `GroupDb` | High | Medium | High | A `GroupDb` that injects `group_id`; ban raw `db.prepare` in `routes/` except admin. Do when touching a repo anyway |
| A-05 | Route / repo / domain split is uneven | `store.ts` 995 lines, `routes/plans.ts` 823, `routes/admin.ts` 740; plan writes and catch-up live in the route; the repos no longer import `routes/` (N-05 fixed) | Medium | Medium | High (incremental) | Move plan writes next to `repo/plans.ts`; routes = auth + `groupContext` + HTTP mapping |
| A-06 | One synchronous SQLite connection; `universe.json` parses on the event loop | Pluck cache fixed; no worker for the 16 MB ingest; crawler, hall poller, SSE and push share the loop | Medium | Medium | High | Parse/store `universe.json` in a worker with its own connection, or chunk the transaction. Keep the in-memory bus |
| A-08 | `@pr0hub/core` is a kitchen-sink in a folder called `parser` | Root barrel still `export *`; apps use subpaths | Medium | Low | Low (document) / High (rename) | Do not rename; document; prefer subpath imports; stop growing the barrel |
| A-10 | Tools and hub share math, not UI or settings | Unit editor twice (Vue SFC vs `shared/units.js`), tools i18n untyped, hub 800 px vs tools 640 px, three share-hash dialects | High (velocity) | Medium | Medium–High | Shared hash module beyond the universe keys; type tool `TEXTS`; share the unit-editor field list |

### Clean code

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| C-01 | God files | `store.ts` 995, `routes/plans.ts` 823, `routes/admin.ts` 740, `AdminView.vue` 1041, `OverviewView.vue` 916, `locales/de.ts` 3189 (each), `flight-calculator/main.js` 1351, `test/api.test.ts` 1987 | High (velocity) | Medium | High (split when touching) | `store/*.ts` by ingest kind, `routes/plans` → CRUD / fleets / enemy, AdminView → Universes / Groups / Ingests / System, locales by namespace with the same `typeof de` check |
| C-02 | API client defaults to `any` | `api<T = any>` in `api.ts`; no `useLoader<any>` is left (the last four typed in `apiTypes.ts`, 2026-11-15), but most `uniApi` calls still pass no type | High | High | Medium | Make `T` required; generate the types from `openapi.yaml` (A-01) instead of `apiTypes.ts` by hand |
| C-03 | SQL rows and JSON columns are untyped blobs | `SELECT *` + `as any[]` on reports/galaxy; most `JSON.parse` undefended (unknown universe setting keys are refused since 2026-11-15) | High | High | Medium | Typed row interfaces per table; one `parseJson<T>` |
| C-04 | Mixed `user_id` / `userId`, snake / camel in one payload | `/raids` aggregates `userId`, raw rows `user_id`; plan types snake_case on the web, others camelCase | Medium | Medium | Medium | CamelCase at the HTTP boundary; map in the route; update OpenAPI and web types together |
| C-05 | Three text pipelines, two compact-number formats | `CHANGELOG.md` + `changelog.ts`, `push.ts` strings, locales, tools `i18n.js`; `push.ts` `short()` (Intl compact) vs hub Mio/Mrd | Medium | Low–Medium | Medium | Share compact numbers and mission labels from core; keep push strings server-side |
| C-06 | `format.ts` and `composables.ts` are kitchen sinks | unchanged | Medium | Low | Medium | `format/` (numbers, dates, labels) vs `toolLinks.ts` vs `protection.ts`; one file per composable |
| C-07 | Duplicated catalogs and formulas | Live overlays in `liveUnits.ts`, `battle/live.ts`, `flight/ships.ts`, `gen-costs.mjs` (`ABBR`, `phalanxRange`, start resources unified 2026-11-15) | Medium | Medium | Medium | One live overlay for costs/combat/drives/cargo |
| C-08 | Validation is ad-hoc | Body validation per route (`clampInt` on every numeric list parameter and `readError` in the web since 2026-11-15; export keeps its documented `400 export_invalid`) | Medium | Medium | Medium | Schemas on the token surface (A-01) |
| C-09 | Tools UI is a second, untyped stack | `tsc` never sees `main.js` / `units.js` / `i18n.js`; `t()` interpolates raw; `kpi()` copied per tool | High (velocity, XSS footgun) | Medium | Low (type `TEXTS`, name `kpi(label, valueHtml)`) / High (migrate) | JSDoc + `checkJs` on `shared/*.js` first; `Object.keys(de)` equals `Object.keys(en)` per tool; keep HTML out of `TEXTS` |
| C-10f | Two short-name tables in the parser | Catalog `unit.short` vs `tech.json` `deShort`; parsers use tech.json first, catalog second | Medium | Medium | Low | One source for shorts (catalog), tech.json as the fallback only |
| C-10g | Folder `parser` / package `@pr0hub/core` | see A-08 | Low | Low | Low | document |
| C-11 | Test structure: two characterization dumps, thin UI coverage | `api.test.ts` 1987 lines on one in-memory world; `parse.test.ts` 1332; web has 24 suites, the heaviest views (Overview, Admin, Loot, Messages) untested; `noUncheckedIndexedAccess` off | High (confidence) | Medium | Medium | Split `api.test.ts` by domain (the new suites `threats`, `notifyRules`, `displayName` show the pattern); `store/*.test.ts` on parsed fixtures; Overview/Admin smoke tests; `noUncheckedIndexedAccess` on `flight` and `loot` |

### Improvements

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| I-03 | DX: packages must be built first, tools JS outside `tsc` | `noUnusedLocals` fails the typecheck (not in the web app: vue-tsc misses template refs), `noUncheckedIndexedAccess` on `flight` (`loot` left out: only bounded parallel-array accesses); web/server import `dist/` of workspace packages | Medium | Low–Medium | Low–Medium | Workspace "source" condition or `dev` watch; `checkJs` for tools `shared/*.js` |

### XSS posture (unchanged)

Hub: no `v-html` / `innerHTML` in `apps/web/src`; the week's new views (`ThreatList`, `NotifyKinds`, `QuietHours`,
`ChangelogView` About) interpolate with `{{ }}`. Tools: `innerHTML` plus `esc()` on name paths; `t()` does not escape
interpolations (C-09).

### Theoretical / hardening (unchanged)

| ID | Issue | Why theoretical |
|---|---|---|
| B-T1 | Invite `openInvite` then later `UPDATE used_at` | Handler is sync; one process cannot interleave |
| B-T2 | Settlement `isFinal()` then PUT/finalize | Same; no `await` between check and write |
| B-T3 | Login throttle is an in-memory `Map` | Fine for one process; resets on restart |
| B-T4 | CSRF allows missing `Origin` | Documented for scripts; `Lax` blocks cross-site POST cookies; no GET writes remain |
| B-T5 | Crawler / hall poller `fetch(gameUrl + …)` | Only hub admins set `gameUrl` |
| B-T6 | scrypt string has no N/r/p | Node defaults; cost rotation needs a format change |
| B-T7 | `GET /api/universes` returns every universe's settings | Any logged-in user; intended for the picker |

---

## Areas not verified

- Browser flows (source-only review): quiet hours on iOS web push, the About page logged out, the build order before
  the start on a phone.
- Delivery to real push services and Discord with held rows (the tests use a fake sender).
- Runtime of `threatsOf` and `/browse/:g` on a group with a year of reports (N-T2, N-T3).
- Deployment, hosts, backup schedule — out of this repository by design.

---

## Recommended order

### Now

Nothing: N-01 to N-11 and the small carried-over items (C-02 loaders, C-03 setting keys, C-07 shorts and phalanx range,
C-08 query parameters and errors, C-10e, I-03 checks, I-05, N-T2 index) are fixed (2026-11-15).

### When the files are touched (Wave 3 of the 2026-11-04 review)

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | A-01 / C-02 | Generated types for the web from the checked spec; remaining schemas | Medium |
| 2 | A-05 / C-01 | Split `store.ts`, `plans.ts`, AdminView, locales | High |
| 3 | A-03 | `GroupDb` | High |
| 4 | A-06 | `universe.json` off the event loop | High |
| 5 | A-08 / A-10 / C-09 | Slimmer core exports; tools TS incrementally; typed tool i18n | High |
| 6 | C-03 / C-04 / C-06 / C-08 | Typed rows, camelCase on the wire, split `format.ts`, schemas | Medium |
| 7 | C-05 / C-07 / C-10f-g | Shared compact numbers; one live-unit overlay; one shorts table | Medium |
| 8 | C-11 / I-03 | Split `api.test.ts`, Store tests, source condition for workspace packages | Medium |

### What not to do

- Do not rewrite the SPA or the tools in a new framework.
- Do not add Postgres or a multi-instance event bus until the product needs more than one Node process.
- Do not generate Fastify from OpenAPI; a path-drift check plus hand-written schemas on the token surface is enough.
- Do not rename `packages/parser` → `packages/core` in the same breath as other work.
- Do not add a foreign key from `notify_held` to `push_subscriptions` by a table rebuild; the triggers of migration 088
  (N-01) are enough and keep the Discord targets (`u:<user id>`) in the same table. A rebuild of `push_subscriptions`
  or `users` must recreate them (`test/schema.test.ts` checks they exist).

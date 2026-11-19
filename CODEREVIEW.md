# Code Review: pr0game-hub

**Date:** 2026-11-19 (second pass of the day)
**Scope:** The whole repository at `707c9b4`, with the focus on bugs: the server (auth and tokens, ingest and `Store`,
notifications and their schedulers, push / Discord delivery, the event stream, build order and settlement routes,
member management, housekeeping and backup), the parser's time and galaxy code, `@pr0hub/flight` (flight and missile
math), and the web app's API client, live events and time helpers. Also the two commits after the morning review
(`a2d7e6d` weekly universe.json credit, `707c9b4` time indexes and `synchronous = NORMAL`): no findings.
**Method:** Source review of the modules above. Suspected bugs were checked against the schema and the callers, and
F-01 was reproduced with a throw-away test against an in-memory database. Each finding says how it was found
(**Reproduced** / **Code**). Theoretical items are listed separately.

**Closed findings are not listed.** R-01 to R-09 of this morning's review (fixed the same day) and the earlier closed
ones are out of this file; the history is in git (`git log -- CODEREVIEW.md`).

**Verification run (this tree, `707c9b4`):** `pnpm --filter "./packages/*" build`, `pnpm typecheck`, `pnpm test`.

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `apps/server` tests | 412 passed (59 files) |
| `apps/web` tests | 141 passed (31 files) |
| `packages/flight`, `parser`, `loot`, `battle`, `api-types` | 50 / 170 / 52 / 24 / 3 passed |
| `packages/planner` | 86 passed, 4 skipped (the optimizer benchmark) |
| `apps/tools` | 74 passed |

### How to read a finding

| Field | Meaning |
|---|---|
| **Impact** | How much it hurts users, operators, or future work if the issue is real |
| **Risk** | How likely it is to go wrong, times how bad that is |
| **Effort** | Implementation size: **Low** (hours), **Medium** (1–3 days), **High** (a week or a careful refactor) |

Severity of a finding is **Impact × Risk**, not Impact alone.

---

## Executive summary

The tests are green and the code keeps to its own rules (group scope, OpenAPI contract, token write flags). The bugs
found are in paths the tests do not combine: cleanup when a member leaves, an API token on the event stream, and the
admin's undo of a sync.

One finding was urgent. **F-01:** when a member was removed from a group while they still had a building alert or a
build order there, every push and Discord delivery of that group failed, attack warnings included, and the tick that
sends launch reminders stopped at that group. The rest was medium or low: an event stream opened with an API token was
cut off after 25 seconds (F-02), undoing a statistics sync deleted the whole snapshot (F-03), a cut-off galaxy copy
logged debris after the cut as cleared (F-04), merging a placeholder lost their settlement corrections and delivery
ticks (F-05), and the backup script deleted every backup when `keep` was not a positive number (F-06).

**Status:** F-01 to F-06 and the theoretical items F-T1 to F-T5 are fixed (same day). Still open are the theoretical
items of earlier passes (R-T, N-T) and the carried-over items of section 2.

---

## What is in good shape

- **Auth:** scrypt runs off the event loop. Unknown users and placeholder accounts pay the same dummy hash. Login
  attempts count from their start (concurrent tries cannot slip past the limit). Token management needs a session.
  A password change or account recovery revokes the API tokens.
- **Write guard:** the API `preHandler` rejects cross-origin writes, read-only tokens and writes to a universe that
  has not started or has ended, all in one place. Routes opt out explicitly (`allowToken`, `allowEnded`,
  `allowBeforeStart`, `tokenWrite`).
- **Every column that references a user has a foreign key** (checked over the migrated schema; only
  `users.discord_user_id` has none, and it is not a hub user id). So `mergeUser` and user deletion reach all rows
  except JSON-embedded keys (the settlement keys, now rewritten by `mergeUser`, F-05).
- **Ingest:** a sync for another member cannot replace their empire, overview, fleets or build pages (`Store.record`
  and `FOR_USER_PAGES`). An older galaxy view or spy report never overwrites a newer state (`newestAt`, the
  `seen_at` check). Sync feedback and credits run outside the transaction and never fail a sync.
- **Time handling:** `localToEpoch` resolves the repeated autumn hour against "now" and the skipped spring hour
  against the offset before the switch. `nearestClock` checks both offsets. The game's statistics times come from
  synced data, as the project rules ask.
- **Build order writes** check the revision inside the transaction and update only `WHERE revision = ?`.

---

## 1. New findings (full review, 2026-11-19)

All six were fixed the same day, with a test each (details in `CHANGELOG.md`, 2026-11-19), and so were the theoretical
items below.

| ID | Finding | Fix |
|---|---|---|
| F-01 | A removed member's building alert or build order broke push and Discord delivery for the whole group, and the tick stopped at that group | Trigger on `group_members` drops building alerts, fleet alerts and full-storage state when a membership ends (migration 097, also removes existing orphans); `nextBuildingAlert` / `nextBuildOrderStep` join `group_members`; one `try/catch` per group in both ticks (`test/memberRemoval.test.ts`) |
| F-02 | An event stream opened with an API token was closed after 25 s | Heartbeat checks `loadRequestUser` (token or cookie); a revoked token still ends the stream (`test/events.test.ts`) |
| F-03 | Undoing a statistics sync deleted the whole snapshot, including rows from other syncs | `removeScores` deletes only the rows matching the record's lines (rank, points, in-game id when known) and their score events; a snapshot goes only once empty (`test/api.test.ts`, "taking a sync back") |
| F-04 | A cut-off galaxy text copy logged the debris after the cut as cleared | The debris loop skips positions after `lastPosition` (`test/api.test.ts`, cut-off galaxy copy) |
| F-05 | `mergeUser` left the settlement member keys (`u<id>`) of the placeholder behind | `mergeSettlementKeys` rewrites the key on the parsed JSON of `data`, `overrides`, `done`, `done_before` in the placeholder's groups (`test/mergeUser.test.ts`) |
| F-06 | `backup.js` deleted every backup when `keep` was 0 or not a number | `keep` must be an integer ≥ 1 (exit 2 otherwise); the file just written is never deleted |

One limit of the F-03 fix: the score rows do not record which sync brought them, so rows that another sync brought with
the very same lines (the same page pasted twice) go too. They are identical rows; pasting that page again restores
them.

### Theoretical (this pass), fixed the same day

| ID | Issue | Fix |
|---|---|---|
| F-T1 | `undoIngest` converted page times without `near`: in the repeated autumn hour the undo looked for the other instant | Converts with `near` = the sync's `created_at`, like `Store` did when it stored it |
| F-T2 | Reopening a settlement that is not finalized overwrote `done_before` with `[]` | Reopening an open settlement does nothing (`test/settlements.test.ts`) |
| F-T3 | `storeCombatReport` took over a `text-…` report without comparing coordinates | Compares the target when the report shows it (`test/settlements.test.ts`) |
| F-T4 | Fleet save moved a time of day to the next day with `+ 86400` (one hour off across a daylight saving switch) | Next calendar day with `setDate` |
| F-T5 | `INGEST_LIMITS.universeJsonConcurrent` was dead code around a synchronous handler | Removed with its `ingest_busy` error |

### Theoretical (earlier passes, still open)

| ID | Issue | Why theoretical |
|---|---|---|
| R-T1 | A galaxy copy without a page time is stored as seen now (`Store.galaxySeenAt`): pasting the same old text again makes the system look fresh and earns galaxy credits each day | The seen time was like this before; the credits only reward it. Members of one alliance; the page time is in the HTML copies |
| R-T2 | `researchState` counts the queue of an older page as done when a newer overview shows no research: a cancelled research raises the level until the next research or empire page | Documented in the code; cancelling is rare and the next page corrects it |
| R-T3 | A sync stores steps seen done without raising the revision; a client PATCH from an older copy with the same revision sends them as not done | The next sync checks them off again (documented in `syncBuildOrder`) |
| R-T4 | A write token can change the build order in every group of its user | Tokens are personal and opt-in; scoping tokens to a group is a feature, not a fix |
| R-T5 | Free expedition slots are scheduled (`AlertSchedule`) only for members with an empire, buildings or research page (`storageWatchers`) | Without research the slot count is unknown anyway; data events and `ALERT_RECHECK` still deliver |
| N-T1 | `Store.playerCard` overwrites a slot kept for a destroyed planet or debris field (`player_id` NULL) in a viewed system with the card's home planet | Home planets cannot be destroyed or abandoned in the game; the row is the player's own former slot |
| N-T3 | `GET /api/:uni/browse/:g` loads the newest scores of every player in the galaxy per request | One `json_each` query; bounded by systems × positions |
| N-T4 | `QuietHours.vue` stores the device time zone at the last change; a device that travels keeps the old zone until the user touches the setting | Documented in the component; the shown `tz` makes it visible |

---

## 2. Carried over from the 2026-11-04 review (still open, verified 2026-11-19)

Evidence re-checked against this tree; sizes updated. Only what is still open is listed.

### Architecture

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| A-01 | OpenAPI is hand-written | The server tests validate every 2xx JSON answer against the spec (`test/contract.ts`); the web types are generated from it; all endpoints of this week are described, 41 older answers (mostly admin and write endpoints) are still `type: object` (ratchet `MAX_UNDESCRIBED` 41 in `test/specSchemas.test.ts`); the spec is 8.3k lines | High | Low | Low–Medium | Fill the remaining schemas when an endpoint is touched |
| A-03 | Group isolation is a convention plus a grep test, not an API | `test/groupScope.test.ts` passes for all new statements; no `GroupDb` | High | Medium | High | A `GroupDb` that injects `group_id`; ban raw `db.prepare` in `routes/` except admin. Do when touching a repo anyway |
| A-05 | Route / repo / domain split is uneven | `store.ts` 1025 lines, `routes/plans.ts` 820, `routes/admin.ts` 730; the build order's write logic (preconditions, miner credit) and the optimize request parsing live in `routes/buildOrders.ts` / `optimize.ts` | Medium | Medium | High (incremental) | Move plan and build order writes next to their repos; routes = auth + `groupContext` + HTTP mapping |
| A-06 | One synchronous SQLite connection; `universe.json` parses on the event loop | Unchanged; the ingest now also computes impact and credits on the loop (R-03); the optimizer runs in workers | Medium | Medium | High | Parse/store `universe.json` in a worker with its own connection, or chunk the transaction |
| A-08 | `@pr0hub/core` is a kitchen-sink in a folder called `parser` | Root barrel still `export *`; new subpath `@pr0hub/core/planetPages` for the tools is the right direction | Medium | Low | Low (document) / High (rename) | Do not rename; prefer subpath imports; stop growing the barrel |
| A-10 | Tools and hub share math, not UI or settings | The auto plan exists twice as UI (`BuildOrderAutoPlan.vue`, `apps/tools/auto-plan/main.js`) on one planner (good), but with separate inputs, texts and hash; unit editor twice, tools i18n untyped, three share-hash dialects | High (velocity) | Medium | Medium–High | Shared hash module beyond the universe keys; type tool `TEXTS`; share the unit-editor field list |

### Clean code

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| C-01 | God files | `store.ts` 1025, `routes/plans.ts` 820, `routes/admin.ts` 730, `AdminView.vue` 1067, `OverviewView.vue` 884, `locales/de.ts` 3597 / `en.ts` 3593, `planner/simulate.ts` 948, `flight-calculator/main.js` 1351, `test/api.test.ts` 2004 | High (velocity) | Medium | High (split when touching) | `store/*.ts` by ingest kind, `routes/plans` → CRUD / fleets / enemy, AdminView → Universes / Groups / Ingests / System, locales by namespace with the same `typeof de` check |
| C-02 | API client types | 82 call sites still pass a hand-written type (102 on 2026-11-15; ratchet `MAX_HAND_WRITTEN` in `apps/web/test/api-types-ratchet.test.ts`) | Medium | Low | Low | Replace the inline types when a view is touched |
| C-03 | SQL rows and JSON columns are untyped blobs | `SELECT *` + `as` casts on reports and galaxy; the new code adds more `JSON.parse(...) as` (`shipyard_snapshots.data`, `combat_reports.fleets` in `battleFleet`, `groups.goals` defended with `try`) | High | High | Medium | Typed row interfaces per table; one `parseJson<T>` |
| C-04 | Mixed `user_id` / `userId`, snake / camel in one payload | `/raids` aggregates `userId`, raw rows `user_id`; plan types snake_case on the web; the new endpoints are camelCase throughout | Medium | Medium | Medium | CamelCase at the HTTP boundary; map in the route; update OpenAPI and web types together |
| C-05 | Three text pipelines, two compact-number formats | `CHANGELOG.md` + `changelog.ts`, `push.ts` strings, locales, tools `i18n.js`, now also `recapText.ts` (Markdown for Discord, DE/EN); `push.ts` `short()` vs hub Mio/Mrd | Medium | Low–Medium | Medium | Share compact numbers and mission labels from core; keep server texts in one module per channel |
| C-06 | `format.ts` and `composables.ts` are kitchen sinks | unchanged | Medium | Low | Medium | `format/` (numbers, dates, labels) vs `toolLinks.ts` vs `protection.ts`; one file per composable |
| C-07 | Duplicated catalogs and formulas | Live overlays in `liveUnits.ts`, `battle/live.ts`, `flight/ships.ts`, `gen-costs.mjs`; this week adds own id sets per module (`NON_COMBAT` in `farm.ts`, `NOT_RAIDING` in `threats.ts`, `NOT_FLYING`, `HARMLESS`) | Medium | Medium | Medium | One live overlay; unit roles (civil, probe, satellite, missile) as catalog flags |
| C-08 | Validation is ad-hoc | Each new endpoint has its own validator (`parseOptimizeRequest`, `parseFarmSim`, `parseGoalSettings`, `pngOf`); they are thorough, but four styles of the same thing | Medium | Medium | Medium | Schemas on the token surface (A-01) |
| C-09 | Tools UI is a second, untyped stack | `tsc` never sees `main.js` / `units.js` / `i18n.js` (the auto plan adds 600 + 190 lines); `t()` interpolates raw; `kpi()` copied again in `auto-plan/main.js` | High (velocity, XSS footgun) | Medium | Low (type `TEXTS`, share `kpi`) / High (migrate) | JSDoc + `checkJs` on `shared/*.js` first; `Object.keys(de)` equals `Object.keys(en)` per tool; `kpi` into `shared/` |
| C-10f | Two short-name tables in the parser | Catalog `unit.short` vs `tech.json` `deShort`; parsers use tech.json first, catalog second | Medium | Medium | Low | One source for shorts (catalog), tech.json as the fallback only |
| C-10g | Folder `parser` / package `@pr0hub/core` | see A-08 | Low | Low | Low | document |
| C-11 | Test structure: two characterization dumps, thin UI coverage | `api.test.ts` 2004 lines; `parse.test.ts` 1332; the new domain suites follow the right pattern; web has 31 suites, the heaviest views (Overview, Admin, Loot, Messages, Health) untested | High (confidence) | Medium | Medium | Split `api.test.ts` by domain; `store/*.test.ts` on parsed fixtures; Overview/Admin smoke tests; `noUncheckedIndexedAccess` on `loot` |

### Improvements

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| I-03 | DX: packages must be built first, tools JS outside `tsc` | web/server import `dist/` of workspace packages (the planner now ships the optimizer, so a stale `dist` is easier to miss); `optimize-worker.mjs` imports the built planner | Medium | Low–Medium | Low–Medium | Workspace "source" condition or `dev` watch; `checkJs` for tools `shared/*.js` |

### XSS posture (unchanged)

Hub: no `v-html` / `innerHTML` in `apps/web/src`; the new components (`HealthRecap`, `BuildOrderAutoPlan`,
`SyncImpact`, `FleetSlots`, `BadgeIcon`) interpolate with `{{ }}`. Tools: `innerHTML` plus `esc()`; the auto plan
escapes every value. `t()` still does not escape interpolations (C-09).

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

- **Read only in samples in this pass:** most web views and components, the tools' `main.js` and `shared/*.js`, the
  page parsers other than galaxy and spy/battle messages, `@pr0hub/loot`, `@pr0hub/battle` and `@pr0hub/planner`
  (beyond their tests), and the server repos for farm, inactivity, threats, defense and colonization.
- **Ports of game code:** whether `@pr0hub/flight` (distance, speed, duration, consumption, missiles) and the battle
  input are still second-exact with the game was not checked against the game's source; the code matches its own
  comments and the tests pass.
- Browser flows (source-only review): the auto plan in the hub and the tool with several workers, the recap image
  on phones, the build order conflict dialog, the farm simulation.
- Runtime of a sync with impact and credits, `/goals` and `/recap` on a group with a full round of data; the
  optimizer's memory on the server under several jobs.
- Delivery of the notifications and the weekly recap to real push services and Discord (fake senders in the tests).
- Deployment, hosts, backup schedule: out of this repository by design (F-06 is only about the script).

---

## Recommended order

### Now

Nothing open from this pass: F-01 to F-06 and F-T1 to F-T5 are fixed.

### When the files are touched (Wave 3 of the 2026-11-04 review)

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | A-01 / C-02 | Remaining schemas; generated types instead of inline ones in the views | Low |
| 2 | A-05 / C-01 | Split `store.ts`, `plans.ts`, AdminView, locales | High |
| 3 | A-03 | `GroupDb` | High |
| 4 | A-06 | `universe.json` off the event loop | High |
| 5 | A-08 / A-10 / C-09 | Slimmer core exports; tools TS incrementally; typed tool i18n; shared `kpi` | High |
| 6 | C-03 / C-04 / C-06 / C-08 | Typed rows, camelCase on the wire, split `format.ts`, schemas | Medium |
| 7 | C-05 / C-07 / C-10f-g | Shared compact numbers; one live-unit overlay with unit roles; one shorts table | Medium |
| 8 | C-11 / I-03 | Split `api.test.ts`, Store tests, source condition for workspace packages | Medium |

### What not to do

- Do not rewrite the SPA or the tools in a new framework.
- Do not add Postgres or a multi-instance event bus until the product needs more than one Node process (optimize jobs
  and their results living in memory are fine for one process; persist them only if restarts start to hurt).
- Do not generate Fastify from OpenAPI; a path-drift check plus hand-written schemas on the token surface is enough.
- Do not rename `packages/parser` → `packages/core` in the same breath as other work.
- Do not add a foreign key from `notify_held` to `push_subscriptions` by a table rebuild; the triggers of migration 088
  (N-01) are enough and keep the Discord targets (`u:<user id>`) in the same table. A rebuild of `push_subscriptions`
  or `users` must recreate them (`test/schema.test.ts` checks they exist).
- Do not bump the build order's revision when a sync only stores steps seen done (R-T3): it would turn every paste
  into a conflict for open tabs and scripts.

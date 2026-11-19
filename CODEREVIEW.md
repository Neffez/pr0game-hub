# Code Review: pr0game-hub

**Date:** 2026-11-19
**Scope:** The changes since the last review (`a0a3e30..bdbaf37`, 2026-11-16 to 2026-11-19, 75 commits: build order
by hand with transports, ships, planned colonies, production steps and ETag / If-Match; write tokens; the auto plan
optimizer in `@pr0hub/planner` with the optimize job API, the hub UI and the public tool; shipyard pages; sync
feedback (impact, contributors, stale data notes); freshness score, alliance goals, sync credits, badges, streaks,
ranking and the recap with its Discord post; farm finder risk and simulation; raid risk from battle reports;
colonization candidates from player planets; fleet and expedition slots with the expedition notification; player
renames and vacation in the activity log), plus the findings of the earlier reviews that are still open.
**Method:** Diff review of every server, parser and planner change and of the new tool, with the surrounding code
where the diff touches a contract (auth and tokens, tenancy, notifications, migrations, the ingest path); the web
app only where it talks to a new contract (build order conflicts, recap image). Findings are evidence-based;
theoretical items are marked as such.

**Closed findings are not listed.** N-01 to N-11 and N-T2 of the 2026-11-15 review and the parts of C-02, C-03, C-07,
C-08, C-10e, I-03 and I-05 fixed that day are out of this file; the history is in git (`git log -- CODEREVIEW.md`).

**Verification run (this tree, `bdbaf37`, Battlerust WASM present):** `pnpm install`, `pnpm --filter "./packages/*"
build`, `pnpm typecheck`, `pnpm test`.

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `apps/server` tests | 403 passed (59 files) |
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

The four days added a lot of surface (about 19k lines, 5 migrations, some 20 endpoints) and kept to the hub's rules:
every new endpoint is in `openapi.yaml` and answers are checked against it, the new tables carry `group_id` (the
group-scope test passes), each new server module has its own suite (`optimize`, `goals`, `achievements`, `recap`,
`syncImpact`, `expeditionSlots`, `buildOrders`, `players`), and the hand-written API types went down from 102 to 82.
Write access for tokens is opt-in per token and limited to the build order by an explicit route flag, and those writes
need a revision (`If-Match`), so scripts cannot overwrite a newer copy without noticing.

The new findings are mostly about the sync incentives and cost. One is a fairness bug: a universe.json upload gives
the uploader a galaxy credit for every system it refreshes, so one upload is worth more than weeks of galaxy pastes
(R-01). Optimize jobs stay in memory without a cap per member (R-02). Every sync now computes the freshness of the
whole group to read one member (R-03), and the progress page computes the whole farm finder and the badge history
twice per request (R-04). The rest is small.

---

## What is in good shape (this week)

- **Token writes:** `can_write` defaults to 0 (old tokens stay read-only), the web asks for write access explicitly,
  and only routes with `tokenWrite` (the build order) accept such a token; token management still needs a session.
- **Optimistic concurrency of the build order:** the revision goes up on client writes and when a planned planet is
  assigned, not when a sync stores steps seen done; writes are conditional (`WHERE revision = ?`) inside a
  transaction; the 412 answer carries the current build order and the web client rebuilds the change on it
  (`changeBuildOrder`, with a test for a move applied twice).
- **Optimize jobs** run in a worker thread with a budget, a hard stop after it, one running job per member and at
  most cores−1 at once; the input is checked before a worker starts (`checkOptimizeInput`); jobs belong to member
  and group.
- **Sync feedback never fails a sync:** `probeImpact` and the credits run in `try/catch` outside the ingest
  transaction.
- **Player renames from plain-text statistics** match by rank and points within one snapshot, ties decide nothing,
  and doubles are merged only when both held the same rank and points in one snapshot; `mergePlayers` is now one
  function for the admin route and the store.
- **Shipyard parser** reads the queue from the page script and reconciles it with the cancel list of a running tab;
  a copy without scripts says "queue unknown" (`null`) instead of "empty".
- **Expedition slots** follow the game's `FleetFunctions` (missiles take no slot, `⌊√astrophysics⌋`), and expedition
  reports correct black holes and fast/slow returns.
- **The auto plan tool** escapes everything it puts into `innerHTML` (`esc()` in `kpi()` and the tables).

---

## 1. New findings (changes of 2026-11-16 to 2026-11-19)

| ID | Finding | Evidence | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| R-01 | A universe.json upload credits every refreshed system to the uploader | `routes/ingest.ts` (`/universe-json`, any member) → `ingest` → `probeImpact` (`syncImpact.ts`): each system with a newer `seenAt` (the file's `timepoint`) becomes a `{ kind: 'galaxy', key: 'g:s' }` credit. A file with fresh timepoints gives thousands of credits in one go: 3 ranking points each (`POINTS.galaxy`), and the cartographer badge (top level 12 000 credits) in a few days of uploads. Nothing in `syncImpact` or `addCredits` looks at `parsed.source` | Medium (ranking and badges lose their meaning) | Medium (any member, one click) | Low | Give no galaxy credits for `parsed.source === 'json'` (or one credit of its own kind); keep the impact feedback. Test with the universe.json fixture |
| R-02 | Optimize jobs are kept an hour without a cap per member | `optimize.ts` `OptimizeJobs`: only *running* jobs are limited (one per member, cores−1 in all); ended jobs stay in the `Map` for `keepMs` (1 h) with their full result (`best.steps`, `timeline`, `goals`). With `minBudget` 5 s one member (also with a read-only token, `allowToken`) can leave about 700 results an hour in the server's memory | Medium (memory of the one process) | Low (members and their tokens only) | Low | Keep the last few ended jobs per member (e.g. 3) and drop older ones on `start`; or drop the timeline from a stored result and recompute it on GET |
| R-03 | Each sync computes the freshness of the whole group to credit one member | `ingest.ts` after the transaction: `freshnessOf(db, ctx, [target.userId])` for the `fresh` credit. `freshnessOf` (`repo/freshness.ts`) loads every galaxy view of the group, parses the newest empire page of *every* member (`latestEmpires`), and groups all building and research snapshots and the raw message syncs of the group, then reads one member. `probeImpact` also runs `syncHints` twice (before and after). This is on every paste, including the universe.json upload | Medium (latency of every sync grows with the group) | Medium | Low | Scope the queries to `userIds` when given (`WHERE user_id IN …`, `latestEmpire` per member); skip freshness and hints for `source === 'json'`. Measure with the u8 test data |
| R-04 | Goals and recap recompute expensive data per request | `allianceGoals` (`/goals`, `/recap`, `/recap/text`, the weekly Discord recap) runs the full `farmTargets` (all spy reports of 7 days, projections, strengths, own fleet) for the spy goal's count; `recap` runs `achievements` twice (400 days of report hours, the status log per member) and `allianceGoals` again. The progress page loads several of them at once | Low–Medium | Medium (grows with group and round) | Low–Medium | A small count query for the spy goal (targets with a fresh report and an inactivity level) instead of `farmTargets`; cache the recap per group and period for a minute |
| R-05 | The spy goal depends on who looks | `farmTargets` leaves out the viewer's in-game alliance. The Discord recap uses `channelContext` with user id 0 (no player), so members of the in-game alliance who are not in the hub can count as farm targets there but not on the page; "goals reached" in the post can differ from the page | Low | Low | Low | Exclude the group's alliance (its members' players' alliances) in the goal, not the viewer's |
| R-06 | The miner badge check simulates the build order on every write | `routes/buildOrders.ts` `changed()` → `creditMiner()`: until a member has the badge, every PUT/PATCH/assign (each step moved in the UI) runs `buildOrderTimeline` (with flights of transports) a second time, synchronously | Low | Low–Medium (members who never plan 5 days ahead pay it forever) | Low | Credit from the timeline the client already asks for (`GET /timeline` does it), or only on PUT and assign |
| R-07 | Battle-report fleet lookup scans per candidate | `repo/threats.ts` `battleFleet`: `fleets LIKE '%"name"%'` over 14 days of `combat_reports` and a `JSON.parse` of each hit, per candidate; `threatsOf` calls it for every listed player with planets and no spy report, without the memo `defenseThreats` has. `_` and `%` in names are LIKE wildcards (more rows, filtered after; correct but slower) | Low | Low–Medium (battle hall imports make the table large) | Low | Memo in `threatsOf` as in `defenseThreats`; `ESCAPE` for the LIKE pattern; one query for all candidates |
| R-08 | Recap image limit and body limit disagree | `routes/discord.ts`: `MAX_IMAGE` 8 MB decoded, but the base64 JSON body is capped by `bodyLimit` (8 MB, `config.ts`), so the real limit is about 6 MB and a larger image gets Fastify's 413 instead of `recap_image_invalid` | Low | Low (canvas PNGs are small) | Low | Route `bodyLimit` of 12 MB, or `MAX_IMAGE` of 5 MB with the same error |
| R-09 | Weekly recap is skipped on a missed Monday | `discord.ts` `weeklyRecaps`: sends only on Mondays from 9:00 and only while the universe runs. A server down all Monday, or a round that ended on the weekend, gets no recap for that week | Low | Low | Low | Send "last week" on any day of the week until it was sent (`discord_sent` already dedupes); allow a final recap within a week after the end |

### Theoretical (this week)

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

- Browser flows (source-only review): the auto plan in the hub and the tool with several workers, the recap image
  on phones, the build order conflict dialog, the farm simulation.
- Runtime of a sync with impact and credits, `/goals` and `/recap` on a group with a full round of data (R-03, R-04);
  the optimizer's memory on the server under several jobs (R-02).
- Delivery of the expedition notification and the weekly recap to real push services and Discord (fake senders in
  the tests).
- The planner's simulation changes (transports with flights, colonizations, production steps) beyond their tests:
  second-exactness with the game was not re-checked here.
- Deployment, hosts, backup schedule: out of this repository by design.

---

## Recommended order

### Now

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | R-01 | No galaxy credits from universe.json uploads | Low |
| 2 | R-02 | Cap the ended optimize jobs per member | Low |
| 3 | R-03 | Freshness and hints of one member scoped to that member; skip them for universe.json | Low |

### Soon

| Order | ID | What | Effort |
|---|---|---|---|
| 4 | R-04 / R-05 | Light spy goal query for the group's alliance; recap cache | Low–Medium |
| 5 | R-06 / R-07 | Miner credit off the write path; `battleFleet` memo and escaped LIKE | Low |
| 6 | R-08 / R-09 | Recap image limit; weekly recap catch-up | Low |

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

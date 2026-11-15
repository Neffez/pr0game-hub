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
B-01 to B-30 except the theoretical table, A-02, A-04, A-07, A-09, I-01, I-02, I-04, I-06, I-07, C-10a to C-10d) and
all of `CODEREVIEW_NEW_FEATURES.md` (B-1 to B-12, U-1 to U-10, shipped 2026-11-09/10) are out of this file; the
history is in git (`git log -- CODEREVIEW.md`).

**Verification run (this tree, 2026-11-15):** `pnpm install`, `pnpm --filter "./packages/*" build`.

| Check | Result |
|---|---|
| `pnpm typecheck` | server, web, packages pass; `apps/tools` fails on `test/battle-simulator.test.ts` (`@pr0hub/battle/wasm` missing, see N-10) |
| `apps/server` tests | 328 passed, 3 skipped, 2 failed: both in `test/battle.test.ts` (500 without the WASM engine) |
| `apps/web` tests | 116 passed |
| `packages/flight`, `parser`, `planner`, `loot` | 49 / 159 / 26 / 52 passed |
| `packages/battle`, `apps/tools` | the suites that import `wasm/battlerust.js` cannot load without `pnpm build:battle` (Docker) |

The red checks are the WASM build, not the week's changes.

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

What the review found:

1. **Held notifications are keyed by the push subscription id and are not cleaned up with it** (N-01): a browser
   re-registered by another user, or a deleted subscription whose id SQLite hands out again, can receive another
   member's held notifications. Small window, real data of another user.
2. **Migration 086 reintroduces the duplicate index** that migration 010 removed (N-02): a copy of 008 without the
   later cleanup.
3. **Held notifications are deleted before they are sent** (N-03): a failed Discord or push delivery loses them.
4. **Layering slipped**: `DISPLAY` lives in `routes/util.ts` and is now imported by `store.ts` and seven repos (N-05),
   and the display-name change left a dozen `LEFT JOIN group_members gm` that nothing reads (N-06).
5. **Typecheck depends on the Docker WASM build** (N-10): a fresh clone cannot run `pnpm typecheck` green.

None of this needs a redesign. N-01 to N-03 are hours each; the rest is cleanup to do when the files are touched.

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

### N-01 — Held notifications follow the push subscription id, not its owner

**Location:** `apps/server/migrations/085_notification_rules.sql` (`notify_held.target` = `p:<push_subscriptions.id>`,
no foreign key); `apps/server/src/routes/push.ts` subscribe upsert (`ON CONFLICT (endpoint) DO UPDATE SET user_id =
excluded.user_id … quiet = CASE WHEN push_subscriptions.user_id = excluded.user_id THEN push_subscriptions.quiet
END`), unsubscribe `DELETE`, the `MAX_SUBSCRIPTIONS` prune; `apps/server/src/push.ts` `sendSub` (`DELETE` on 404/410),
`flushHeld`.

**Evidence:** `hold()` stores a notification under `p:<id>`. The subscribe route reuses the row (same `id`) when
another user registers the same endpoint and only resets `quiet`, not the held rows. When a subscription row is
deleted (unsubscribe, prune, 404/410) its held rows stay until the next `flushHeld` finds no row and discards them;
`push_subscriptions.id` is an `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so the next insert can reuse the highest
deleted id, and a flush between the insert and that discard sends the old rows to the new subscription. Both cases
hand one member's held notifications (attack coordinates, plan links of their group) to another account; the first
case is a shared browser, the second a timing window of one tick.

| Impact | Risk | Effort |
|---|---|---|
| Medium (another member's data) | Low (shared device; id reuse within one tick) | Low |

**Fix:** Delete `notify_held WHERE target = 'p:' || id` wherever a subscription row is deleted or changes user: in the
subscribe upsert (when `user_id` differs), the unsubscribe route, the prune, `sendSub` on 404/410, and the user merge.
A `DELETE` trigger on `push_subscriptions` covers the deletes in one place; the user change still needs the route.
Test: register the endpoint as user B while A has held rows, flush, assert nothing is sent to B.

---

### N-02 — Migration 086 recreates the duplicate index that 010 dropped

**Location:** `apps/server/migrations/086_stats_units.sql` line 17 (`CREATE INDEX stat_snapshots_time ON stat_snapshots
(group_id, who, type, stat_time)`); `010_drop_duplicate_indexes.sql` (`DROP INDEX IF EXISTS stat_snapshots_time`,
"same columns as the UNIQUE constraint, which SQLite already backs with an index").

**Evidence:** 086 is a copy of 008 (the honor-points rebuild), including the index 010 later removed. Every
`stat_snapshots` insert now maintains two identical indexes.

| Impact | Risk | Effort |
|---|---|---|
| Low (write cost, disk) | High (it is already applied) | Low |

**Fix:** Migration 088 with the `DROP INDEX IF EXISTS` of 010. Leave 086 as it is (applied databases). When the next
CHECK rebuild comes, copy from 086 minus the index, or move the pattern into a helper comment in `db.ts`.

---

### N-03 — Held notifications are deleted before the delivery that sends them

**Location:** `apps/server/src/notify.ts` `takeHeld` (`SELECT … ; DELETE FROM notify_held WHERE target = ?`);
`apps/server/src/push.ts` `flushHeld` (`sendSub` per row after `takeHeld`); `apps/server/src/discord.ts` `flushHeld`
(`send` of all rows after `takeHeld`).

**Evidence:** The rows are gone before the first HTTP call. A Discord webhook that answers 5xx or a push service that
times out loses what the quiet hours collected (an attack on its way included, unless it broke the quiet hours). The
tick-based senders do not retry held rows; `push_sent` already marks them as delivered.

| Impact | Risk | Effort |
|---|---|---|
| Medium (the one notification the quiet hours were for) | Low–Medium (push services do fail; `sendSub` already handles that for live sends) | Low |

**Fix:** Delete per row after a successful send (`DELETE … WHERE id = ?`), keep the expiry check so a failed row is
dropped on the next flush once expired; or mark rows `sent_at` and prune. Keep `HELD_MAX` by selecting the newest
first.

---

### N-04 — An access request with a placeholder's username cannot be assigned to another placeholder

**Location:** `apps/server/src/routes/auth.ts` `POST /api/access-requests` (`checkUsername(db, …, 0, true)`:
usernames of placeholder accounts are allowed); `apps/server/src/routes/admin.ts` `POST
/api/admin/access-requests/:id/assign` (`checkUsername(db, request.username, userId)` without `placeholdersOk`).

**Evidence:** The request may carry the login name of placeholder B (this week's fix for "username matches
placeholder member"). Assigning it to placeholder A throws `409 username_taken` ("Username already taken"), the same
message as for a real account; the admin cannot tell why and the request can only go to B. If B is in an alliance the
admin does not administer, the request is stuck for them.

| Impact | Risk | Effort |
|---|---|---|
| Low (admins; rare) | Low | Low |

**Fix:** In `assign`, when the username belongs to another placeholder, either refuse with its own code
(`username_of_placeholder`, naming the member) so the UI can say "assign it to that member", or rename the other
placeholder's login (it has no password, nobody logs in with it) and continue. Test next to
`displayName.test.ts` "keeps matching, invites and placeholders on the in-game name".

---

### N-05 — `DISPLAY` lives in `routes/util.ts` and the data layer imports it

**Location:** `apps/server/src/routes/util.ts` (`DISPLAY`, `displayOf`); importers `store.ts`, `repo/attackAssist.ts`,
`repo/export.ts`, `repo/health.ts`, `repo/hostile.ts`, `repo/market.ts`, `repo/messages.ts`, `repo/moons.ts`,
`repo/notifications.ts`, `repo/plans.ts`, `repo/settlements.ts`.

**Evidence:** Before this week `repo/notifications.ts` had its own `DISPLAY` and the repos spelled the `COALESCE`
out; the display-name change unified them on the routes module. `routes/` is the HTTP layer; `store.ts` and `repo/`
now depend on it (`routes/util.ts` itself imports `context.ts`; the direction repo → routes is new and nothing stops
the next helper from pulling a route module into a repo).

| Impact | Risk | Effort |
|---|---|---|
| Medium (A-05 gets worse: the split is harder to untangle) | Low | Low |

**Fix:** Move `DISPLAY`/`displayOf` (and `MEMBER`) to `repo/members.ts` or a `repo/sql.ts`; `routes/util.ts` re-exports
them for the routes. One mechanical commit, no behavior change.

---

### N-06 — Dead `group_members` joins after the display-name change

**Location:** `apps/server/src/repo/market.ts` (`RATE_SELECT`, `latestMarket`), `repo/messages.ts` `visibleMessages`,
`repo/hostile.ts` phalanx pastes, `repo/export.ts` expeditions, `repo/settlements.ts` (recycled, `storedSettlement`
`gf`), `repo/plans.ts` `enemiesOf` (`gm`, `gb`), `routes/battle.ts` spy report, `routes/settlements.ts` (`gb`, members
union), `store.ts` `recycleEvent`.

**Evidence:** `DISPLAY` is now `COALESCE(NULLIF(u.display_name, ''), u.username)`; the `LEFT JOIN group_members gm ON
gm.group_id = … AND gm.user_id = …` next to it only existed for `gm.ingame_name`. The joins stay in about a dozen
repo statements (a few still read `gm.ingame_name` on purpose: `settlements.ts` `draftOf`, `health.ts`; those are
fine), and the `MEMBER(t)` helper of `routes/util.ts` adds the same dead join in ten more route statements
(`claims.ts`, `comments.ts`, `reports.ts` ×5, `settlements.ts`, `repo/activity.ts`).

| Impact | Risk | Effort |
|---|---|---|
| Low (a join per row on hot lists; misleading for the next reader) | Low | Low |

**Fix:** Remove the joins whose alias is unused; delete `MEMBER()` (every caller only needed `DISPLAY`). The group-scope test
still passes (the statements keep `group_id` through the main table).

---

### N-07 — Two identities on the server without a stated rule

**Location:** `routes/util.ts` `DISPLAY` (hub name); `apps/server/src/routes/admin.ts` line 268 (placeholders for
access requests: `COALESCE(m.ingame_name, u.username)`); `repo/health.ts` (`ingameName` as a subtitle);
`PresenceList.vue` `nameTitle` (in-game name in the tooltip); `repo/moons.ts` and `repo/settlements.ts` `draftOf`
(in-game name as a match key only).

**Evidence:** Member names in lists, notifications ("attack on <member>"), CSV `member` columns and settlements now
show the hub name; the admin's placeholder list and a few tooltips show the in-game name. Both are reasonable; the
rule ("hub name wherever a member acts in the hub, in-game name where the game is matched") is only in commit
messages.

| Impact | Risk | Effort |
|---|---|---|
| Low | Low (confusion when a member's hub name differs from the game) | Low |

**Fix:** State the rule in the `DISPLAY` comment and in README's member section; make `admin.ts` 268 follow it (hub
name, in-game name in a second column) or mark it as the match list it is.

---

### N-08 — Start resources and temperature are defined twice

**Location:** `packages/planner/src/planned.ts` (`START_RESOURCES = { 901: 5000, 902: 1500, 903: 0 }`, `START_TEMP =
50`); `packages/parser/src/universe.ts` `OPTIONAL_DEFAULTS` (`metalStart: 5000, crystalStart: 1500, deuteriumStart: 0`)
and `startResourcesOf`.

**Evidence:** The planner's constant is the fallback of `plannedPlanet` when the caller passes none; the web app passes
`startResourcesOf(settings)`. Both carry the game's defaults by hand. `@pr0hub/planner` already depends on
`@pr0hub/core` (production, buildings).

| Impact | Risk | Effort |
|---|---|---|
| Low | Low (drift if a game default changes) | Low |

**Fix:** `plannedPlanet` defaults to `startResourcesOf({})` from `@pr0hub/core/universe`; keep `START_TEMP` where the
game's `initial_temp` is modelled (core, next to `positionTemp`) and import it.

---

### N-09 — Query validation of the new endpoints is hand-rolled

**Location:** `apps/server/src/routes/defense.ts` `/api/:uni/threats` (`days`), `routes/buildings.ts`
`PUT /api/:uni/storage-alerts` (`muted`), `routes/buildOrders.ts` `POST /api/:uni/build-order/assign` (`to`),
`routes/export.ts` `filterOf`.

**Evidence:** `threats` parses `days` itself: `?days=` (empty) becomes `Number('') = 0` → `400 days_invalid`, where
every other list uses `clampInt` (empty → default). `storage-alerts` accepts any `g:s:p` within the regex, not only the
universe's range or the viewer's planets (harmless rows). `assign` accepts any valid planet key as `to`, including a
moon key or another planned planet (the UI offers planets only; the API lets a client move a planned order onto a
moon, where buildings it needs do not exist, and the next validation marks every step invalid).

| Impact | Risk | Effort |
|---|---|---|
| Low | Low | Low |

**Fix:** `clampInt(req.query.days, 30, 1, 3650)`; `to` must be a synced planet key of the viewer (`memberPlanets`) of
type `planet`; filter `muted` to the viewer's planets. This is C-08 applied to new code.

---

### N-10 — `pnpm typecheck` and the test suites depend on the Docker WASM build

**Location:** `apps/tools/test/battle-simulator.test.ts` (`import … from '@pr0hub/battle/wasm'`),
`packages/battle/test/engine.test.ts`, `test/defense.test.ts` (`../wasm/battlerust.js`), `apps/server/test/battle.test.ts`;
`packages/battle/package.json` (`build:battle` runs the `battle-wasm` Docker stage); README "build packages first".

**Evidence:** On a fresh clone (this review's container) `pnpm typecheck` fails in `apps/tools` with `TS2307: Cannot
find module '@pr0hub/battle/wasm'`, and 2 server, 2 battle and 1 tools suites fail to load. CI has the artifact; a
contributor without Docker cannot get a green typecheck, and the error does not say why.

| Impact | Risk | Effort |
|---|---|---|
| Medium (DX; I-03) | Low | Low |

**Fix:** Commit a `wasm/battlerust.d.ts` (or `types/` stub) so the typecheck passes without the binary; skip the engine
suites with a clear message when `wasm/battlerust_bg.wasm` is missing (`describe.skipIf`), and say so in README next to
`pnpm build:battle`.

---

### N-11 — The new hostile page keeps `useLoader<any>`

**Location:** `apps/web/src/views/HostileView.vue` (`useLoader<any>` for `/hostile`); `ThreatList.vue` types its
response (`Threats`) — the good example next to it.

**Evidence:** C-02 (typed responses) is the open item of the 2026-11-04 review; this week's refactor of the page into
two tabs kept the `any` for the alliance tab while typing the new one.

| Impact | Risk | Effort |
|---|---|---|
| Low | Low | Low |

**Fix:** Type the `/hostile` response when the page is next touched (C-02 list).

---

### Theoretical (this week)

| ID | Issue | Why theoretical |
|---|---|---|
| N-T1 | `Store.playerCard` overwrites a slot kept for a destroyed planet or debris field (`player_id` NULL) in a viewed system with the card's home planet | Home planets cannot be destroyed or abandoned in the game; the row is the player's own former slot |
| N-T2 | `threatsOf` reads every `combat_reports` row of the group within `days` (up to 3650) and parses its `fleets` JSON, then `spyEmpire` per candidate, on every request and live reload | Groups have hundreds, not millions of reports; the `/hostile` list already works this way. Add a `(group_id, time)` index and a cap when a group notices |
| N-T3 | `GET /api/:uni/browse/:g` loads the newest scores of every player in the galaxy per request | One `json_each` query; bounded by systems × positions |
| N-T4 | `QuietHours.vue` stores the device time zone at the last change; a device that travels keeps the old zone until the user touches the setting | Documented in the component; the shown `tz` makes it visible |

---

## 2. Carried over from the 2026-11-04 review (still open, verified 2026-11-15)

Evidence re-checked against this tree; sizes updated. Only what is still open is listed.

### Architecture

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| A-01 | OpenAPI is hand-written; no Fastify `schema:`, no typed client | Path drift and `operationId` uniqueness are tested in CI (`test/openapi-paths.test.ts`); `grep schema: routes/*.ts` finds none; responses are `object` in many places; web client is `api<T = any>` | High | Medium | Medium | JSON schemas on the token-facing GETs and `/battle`; generate types from the YAML for the web (`packages/api-types`) and use them in the heavy views (C-02) |
| A-03 | Group isolation is a convention plus a grep test, not an API | `test/groupScope.test.ts` enforces `group_id` or a key per statement (all week's statements pass); no `GroupDb` | High | Medium | High | A `GroupDb` that injects `group_id`; ban raw `db.prepare` in `routes/` except admin. Do when touching a repo anyway |
| A-05 | Route / repo / domain split is uneven | `store.ts` 995 lines, `routes/plans.ts` 823, `routes/admin.ts` 740; plan writes and catch-up live in the route; N-05 adds a repo → routes import | Medium | Medium | High (incremental) | Move plan writes next to `repo/plans.ts`; routes = auth + `groupContext` + HTTP mapping; fix N-05 first |
| A-06 | One synchronous SQLite connection; `universe.json` parses on the event loop | Pluck cache fixed; no worker for the 16 MB ingest; crawler, hall poller, SSE and push share the loop | Medium | Medium | High | Parse/store `universe.json` in a worker with its own connection, or chunk the transaction. Keep the in-memory bus |
| A-08 | `@pr0hub/core` is a kitchen-sink in a folder called `parser` | Root barrel still `export *`; apps use subpaths | Medium | Low | Low (document) / High (rename) | Do not rename; document; prefer subpath imports; stop growing the barrel |
| A-10 | Tools and hub share math, not UI or settings | Unit editor twice (Vue SFC vs `shared/units.js`), tools i18n untyped, hub 800 px vs tools 640 px, three share-hash dialects | High (velocity) | Medium | Medium–High | Shared hash module beyond the universe keys; type tool `TEXTS`; share the unit-editor field list |

### Clean code

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| C-01 | God files | `store.ts` 995, `routes/plans.ts` 823, `routes/admin.ts` 740, `AdminView.vue` 1041, `OverviewView.vue` 916, `locales/de.ts` 3189 (each), `flight-calculator/main.js` 1351, `test/api.test.ts` 1987 | High (velocity) | Medium | High (split when touching) | `store/*.ts` by ingest kind, `routes/plans` → CRUD / fleets / enemy, AdminView → Universes / Groups / Ingests / System, locales by namespace with the same `typeof de` check |
| C-02 | API client defaults to `any` | `api<T = any>` in `api.ts` line 97; five views keep `useLoader<any>` (HostileView added this week, N-11) | High | High | Medium | Make `T` required; type `/overview`, `/raids`, `/expeditions`, `/context`, `/hostile`, admin lists first |
| C-03 | SQL rows and JSON columns are untyped blobs | `SELECT *` + `as any[]` on reports/galaxy; most `JSON.parse` undefended; unknown universe setting keys are stored (`settingsError` checks known keys only) | High | High | Medium | Typed row interfaces per table; one `parseJson<T>`; reject unknown setting keys |
| C-04 | Mixed `user_id` / `userId`, snake / camel in one payload | `/raids` aggregates `userId`, raw rows `user_id`; plan types snake_case on the web, others camelCase | Medium | Medium | Medium | CamelCase at the HTTP boundary; map in the route; update OpenAPI and web types together |
| C-05 | Three text pipelines, two compact-number formats | `CHANGELOG.md` + `changelog.ts`, `push.ts` strings, locales, tools `i18n.js`; `push.ts` `short()` (Intl compact) vs hub Mio/Mrd | Medium | Low–Medium | Medium | Share compact numbers and mission labels from core; keep push strings server-side |
| C-06 | `format.ts` and `composables.ts` are kitchen sinks | unchanged | Medium | Low | Medium | `format/` (numbers, dates, labels) vs `toolLinks.ts` vs `protection.ts`; one file per composable |
| C-07 | Duplicated catalogs and formulas | `ABBR` in `format.ts` 170 still lists 200/400 ids the catalog has; `phalanxRange` in `domain/phalanx.ts` and `format.ts` 389; live overlays in `liveUnits.ts`, `battle/live.ts`, `flight/ships.ts`, `gen-costs.mjs`; N-08 adds start resources | Medium | Medium | Low–Medium | Delete 200/400 from `ABBR`; `phalanxRange` into flight or core; one live overlay for costs/combat/drives/cargo |
| C-08 | Validation and errors are ad-hoc | `clampInt` not used consistently (N-09 for the new routes); body validation per route; views swallow errors into strings | Medium | Medium | Medium | Use `clampInt` everywhere; a `readError(e)` helper; schemas on the token surface (A-01) |
| C-09 | Tools UI is a second, untyped stack | `tsc` never sees `main.js` / `units.js` / `i18n.js`; `t()` interpolates raw; `kpi()` copied per tool | High (velocity, XSS footgun) | Medium | Low (type `TEXTS`, name `kpi(label, valueHtml)`) / High (migrate) | JSDoc + `checkJs` on `shared/*.js` first; `Object.keys(de)` equals `Object.keys(en)` per tool; keep HTML out of `TEXTS` |
| C-10e | `MISSILE_TARGETS` keeps 409–411 | `packages/flight/src/missile.ts` 30–32; the catalog strips them | Low | Low | Low | Drop them or document why the flight package keeps them |
| C-10f | Two short-name tables in the parser | Catalog `unit.short` vs `tech.json` `deShort`; parsers use tech.json first, catalog second | Medium | Medium | Low | One source for shorts (catalog), tech.json as the fallback only |
| C-10g | Folder `parser` / package `@pr0hub/core` | see A-08 | Low | Low | Low | document |
| C-11 | Test structure: two characterization dumps, thin UI coverage | `api.test.ts` 1987 lines on one in-memory world; `parse.test.ts` 1332; web has 24 suites, the heaviest views (Overview, Admin, Loot, Messages) untested; `noUncheckedIndexedAccess` off | High (confidence) | Medium | Medium | Split `api.test.ts` by domain (the new suites `threats`, `notifyRules`, `displayName` show the pattern); `store/*.test.ts` on parsed fixtures; Overview/Admin smoke tests; `noUncheckedIndexedAccess` on `flight` and `loot` |

### Improvements

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| I-03 | DX: no lint, packages must be built first, tools JS outside `tsc` | No `lint` script in root `package.json`; web/server import `dist/` of workspace packages; N-10 adds the WASM dependency of the typecheck | Medium | Low–Medium | Low–Medium | Root `lint` (even `tsc --noUnusedLocals` first); workspace "source" condition or `dev` watch; `checkJs` for tools `shared/*.js` |
| I-05 | `/:uni` swallows unknown paths; no 404 | `router.ts` 28 `path: '/:uni'`; `UniverseLayout.vue` shows the API error of `/context` | Low | Medium | Low | Dedicated empty state when `/context` is 404; optional `/:uni(\\w+)` |

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
- The battle route and the engine suites (no WASM in this container, N-10).
- Deployment, hosts, backup schedule — out of this repository by design.

---

## Recommended order

### Now (hours each)

| Order | ID | What |
|---|---|---|
| 1 | N-01 | Delete held rows with their subscription (trigger + user change in the subscribe route) with a test |
| 2 | N-03 | Delete held rows after a successful send |
| 3 | N-02 | Migration 088: drop the duplicate `stat_snapshots_time` |
| 4 | N-10 | WASM type stub and `skipIf` for the engine suites; README note |
| 5 | N-04 | Own error (or rename) when a request's username is another placeholder's |
| 6 | N-05 / N-06 | `DISPLAY` into `repo/`, drop the dead `gm` joins |
| 7 | N-08 / N-09 / N-11 | Start resources from core; `clampInt` and planet-type check on the new routes; type `/hostile` |

### When the files are touched (Wave 3 of the 2026-11-04 review)

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | A-01 / C-02 | Schemas on the token surface, generated types for the web | Medium |
| 2 | A-05 / C-01 | Split `store.ts`, `plans.ts`, AdminView, locales | High |
| 3 | A-03 | `GroupDb` | High |
| 4 | A-06 | `universe.json` off the event loop | High |
| 5 | A-08 / A-10 / C-09 | Slimmer core exports; tools TS incrementally; typed tool i18n | High |
| 6 | C-03 / C-04 / C-06 / C-08 | Typed rows, camelCase on the wire, split `format.ts`, shared validation | Medium |
| 7 | C-05 / C-07 / C-10e-g | Shared compact numbers and formulas; one live-unit overlay; one shorts table | Medium |
| 8 | C-11 / I-03 | Split `api.test.ts`, Store tests, lint, `noUncheckedIndexedAccess` on packages | Medium |
| 9 | I-05 / N-07 | Dedicated 404 for unknown universes; identity rule documented | Low |

### What not to do

- Do not rewrite the SPA or the tools in a new framework.
- Do not add Postgres or a multi-instance event bus until the product needs more than one Node process.
- Do not generate Fastify from OpenAPI; a path-drift check plus hand-written schemas on the token surface is enough.
- Do not rename `packages/parser` → `packages/core` in the same breath as other work.
- Do not add a foreign key from `notify_held` to `push_subscriptions` by a table rebuild; a trigger (N-01) is enough and
  keeps the Discord targets (`u:<user id>`) in the same table.

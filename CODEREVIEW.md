# Code Review: pr0game-hub

**Date:** 2026-11-04
**Scope:** Whole monorepo — `packages/parser` (`@pr0hub/core`), `packages/flight`, `packages/loot`, `packages/battle`, `packages/planner`, `apps/server`, `apps/web`, `apps/tools`
**Method:** Four passes (architecture, clean code, bugs, improvements), then a verification pass against the current source. Findings are evidence-based. Theoretical items are marked as such. Line numbers refer to this tree at review time.

**Progress:** The suggested first commit series is **done** and on `main` (`0b8434d..045e495`, 2026-11-04). Typecheck and the full test suite passed before push. Evidence and line numbers below are the review-time snapshot; a **Status** line on a finding says what landed afterwards. The second series (Wave 1 leftovers, `0dc7539..`) landed on 2026-11-05. Remaining work starts at Wave 2 catalog / settings.

### How to read a finding

| Field | Meaning |
|---|---|
| **Impact** | How much it hurts users, operators, or future work if the issue is real |
| **Risk** | How likely it is to go wrong, times how bad that is |
| **Effort** | Implementation size: **Low** (hours), **Medium** (1–3 days), **High** (a week or a careful refactor) |

Severity of a finding is **Impact × Risk**, not Impact alone. A High-impact / Low-risk item can wait; a High/High item should not.

---

## Executive summary

The hub is a well-shaped product for its constraints: paste-only ingest, group-scoped SQLite, shared game-math packages, a Vue SPA, and static tools that run without a server. Auth fundamentals (scrypt, hashed sessions and API tokens, dummy hash for unknown users, Origin check on writes, ended-universe freeze) are deliberate. Flight, loot `steal()`, missile math, and the Battlerust worker are ported and tested against the game. Live updates (SSE + refetch, one EventSource per browser) are a sound model. Hub user content is interpolated with `{{ }}` — no `v-html` — which is the right XSS posture.

The main gaps are not “the architecture is wrong”. They are **contracts that drifted from the code**. After the first series on 2026-11-04:

1. **GET `/plans` is a pure read** (catch-up on overview/fleets paste and cookie `POST /plans/sync`). GET `/build-order` and GET `/buildings` still write.
2. **`forUser` ingest** is limited to messages and combat reports; empire, overview and fleets are only stored for the page owner.
3. **The unit catalog is still process-global** (name maps, `withUnits`, ingest without a catalog).
4. **OpenAPI paths are checked in CI** against Fastify `onRoute`; Fastify `schema:` and a typed web client are still missing.
5. **Universe settings and tool-link hashes exist in four shapes**, so new fields silently drop.

None of this requires a rewrite. The recommended order at the end does the remaining cheap fixes first, then the catalog/settings work, then the structural cleanups.

---

## What is already in good shape

- Package split for game math: `@pr0hub/flight` has no hub imports; battle WASM runs in a worker with size, rate, and timeout limits; tools can ship without the server.
- Tenancy is named (`groupContext`) and followed on the sampled list/detail routes. Live events carry table names, not row payloads.
- SQLite hygiene: WAL, foreign keys, `busy_timeout`, WAL size cap, per-file migration transactions with `foreign_key_check`, online backup on a separate readonly connection.
- Auth matches the product: scrypt off the event loop for login, dummy hash for unknown users, hashed session and API tokens, bearer cannot manage tokens, Discord webhooks allow-listed, tokens blocked on POST except `allowToken`.
- Hub i18n (`en: typeof de`) and push i18n (`EN: typeof DE`) fail the typecheck on a missing key.
- Parser fixture tests and flight/battle port tests are the right characterization style.
- Unit overrides as diffs (not full catalogs) let default data updates reach every universe.

---

## 1. Architecture

### A-01 — OpenAPI is a manual twin, not the public contract

**Location:** `apps/server/openapi.yaml`; `apps/server/src/routes/openapi.ts`; Fastify handlers (no `schema:`); `apps/web/src/api.ts`; CLAUDE.md rule “update OpenAPI with every API change”.

**Evidence:** The served spec is a cached parse of the YAML. A search of `apps/server/src` finds no Fastify `schema:`, `addSchema`, or serializer compiler. Implemented but absent from the YAML path list include `POST /api/auth/login`, `POST /api/{uni}/ingest`, `GET|POST /api/{uni}/universe-json`, plan writes, claims writes, comment writes, and most admin writes. Many documented GET responses are untyped `object`. The web client is a hand-written `fetch` wrapper (`api.ts` 59–80). The only OpenAPI tests assert a version string and `operationId === 'simulateBattle'`.

**Why it matters:** Token and agent consumers cannot trust the file that claims to describe the HTTP surface. The “update YAML in the same commit” rule cannot be checked. Clients can assume GET `/plans` is read-only (see B-01).

| Impact | Risk | Effort |
|---|---|---|
| High | Medium | Medium |

**Fix:** Decide the audience (token GETs + battle vs full HTTP). In CI, compare Fastify `printRoutes()` to YAML paths and fail on drift. Attach JSON schemas on the token-facing routes, or generate types from the YAML into a small `packages/api-types` and consume them in web + tests. Stop treating `{ type: object }` as a contract.

**Status:** Partial (`eb8ef15`). CI compares Fastify `/api` routes (via `onRoute`, `:param` → `{param}`) to YAML paths and unique `operationId`s. Missing write/admin/auth/ingest/plan ops were added to the YAML. Fastify `schema:`, typed responses, and a generated web client are still open.

---

### A-02 — The read-only token model is false: several GETs write

**Location:** `apps/server/src/app.ts` 105–121; `routes/plans.ts` 196–201; `repo/plans.ts` `syncOwnPlans` / `recallOwnPlans`; `routes/buildOrders.ts` 25–29; `routes/buildings.ts` 20–54; `auth.ts` 173–177.

**Evidence:** The global write guard only runs for non-GET methods. Token writes are refused only then (`app.ts` 107–111). GET `/api/:uni/plans` (running universe) calls `syncOwnPlans` and `recallOwnPlans`, which insert fleets, move target times and claims, withdraw fleets, and can cancel a plan and release its claim (`recallOwnPlans` 421–447). OpenAPI text documents this as “on each read”. GET `/build-order` persists auto-checked steps. GET `/buildings` deletes finished alerts. A token GET also updates `api_tokens.last_used_at`.

**Why it matters:** A polling token or a clicked link can change raid plans. Ended-universe protection skips only the plan catch-up, not build-order/buildings. This is the same root cause as B-01 / B-02.

| Impact | Risk | Effort |
|---|---|---|
| High | High | Medium (move catch-up off GET); Low (refuse tokens on those GETs as a stopgap) |

**Fix:** Keep catch-up, move it to ingest / a cookie-only POST / a background tick. GETs become pure reads. If catch-up must stay on GET, treat those routes as writes: refuse tokens, apply Origin / ended-universe checks, and say so in OpenAPI.

**Status:** Partial (`8437595`). GET `/plans` no longer writes (`persist=false` on the in-memory catch-up). `catchUpPlans` runs after an overview or fleets paste (as the stored user) and on cookie `POST /api/:uni/plans/sync`. Token POST stays 403. GET `/build-order` and GET `/buildings` still write.

---

### A-03 — Group isolation is a convention, not an API

**Location:** `context.ts` `groupContext` 85–108; ad-hoc SQL in `routes/*.ts` and `repo/*.ts`.

**Evidence:** The comment on `groupContext` is the isolation spec: every game-data query must go through it. There is no `db.forGroup(ctx)` and no query builder that injects `group_id`. Repos take a raw `DB` plus a sometimes-optional `groupId`. After a scoped lookup, some reads use the global PK only (safe if the id was just checked; easy to copy unsafely). SQLite cannot enforce “this connection is group 12.” This review did **not** confirm a live IDOR on the sampled player/comment/plan detail routes — those check `group_id` first.

**Why it matters:** Isolation is an untested social contract on every new query. The write path (`Store`) is consistent; the read path is dozens of inline SQL strings.

| Impact | Risk | Effort |
|---|---|---|
| High | Medium | High (wrapper); Low (grep test for game tables without `group_id`) |

**Fix:** A `GroupDb` that injects `group_id` (or requires `GroupContext` on every export). Ban raw `db.prepare` in `routes/` except admin. Add a test that greps route SQL for game tables without `group_id`. Do not add a framework.

---

### A-04 — Unit catalog and name maps are process-global; ingest does not use the request universe

**Location:** `packages/parser/src/units.ts` `active` / `setActiveUnits` / `withUnits` 204–224; `packages/parser/src/tech.ts` `NAME_TO_ID` / `registerUnitNames` 27–89, `idByShortName` 136–148; `apps/server/src/context.ts` `catalogOf` 51–58; `apps/server/src/app.ts` 66–67; `apps/server/src/ingest.ts` 94.

**Evidence:** Design comment: one active catalog per process; the server must pass a catalog or wrap sync work in `withUnits`. `buildApp` registers **every** universe’s names into one `NAME_TO_ID` (`app.ts` 67 + `catalogOf`). `registerUnitNames` is first-wins and never removes names. It does not update `SHORT_TO_ID`. Combat reports resolve ships with `idByShortName` (`combatReport.ts` 88–91). Known extras use shorts `Bunk` / `TL` (`units.ts` 119–123) that are absent from `tech.json` `deShort`. `ingest()` calls `parsePage` without `withUnits`, so parse-time costs use defaults.

`withUnits` is sync-only. An `await` inside `fn` would leak the catalog across requests (not done today; nothing prevents it).

**Why it matters:** Two universes with the same custom name and different ids will mis-parse for whoever registered second. Combat reports drop new/renamed units that only appear as shorts. ACS loot and battle imports undercount.

| Impact | Risk | Effort |
|---|---|---|
| Medium–High | Medium | Medium |

**Fix:** Pass `UnitCatalog` into `parsePage` / `idByName` / `idByShortName`. Register shorts from the catalog. On the server, prefer an explicit `catalog` argument over `withUnits`. Keep `setActiveUnits` for the single-universe web/tools UIs.

**Status:** Mostly done (A-04 commit, 2026-11-06). `idByName` / `idByShortName` take a catalog (default active) and look at its units first; `parsePage` takes `units`; every server parse path (ingest, reparse, undo, backfill, crawler, phalanx, plan sim, settlement from report) runs with the universe's catalog. `registerUnitNames` no longer feeds the parsers. Still open: `withUnits` is sync-only with nothing guarding an `await` inside.

---

### A-05 — Route / repo / domain split is uneven

**Location:** `apps/server/src/store.ts` (~950 lines); `routes/plans.ts` (~815); `routes/admin.ts` (~622); `domain/` (three small files); `repo/settlements.ts` and `repo/buildings.ts` as the better examples.

**Evidence:** Ingest writes go through `Store`. Raid-planner writes live in the route. Settlements split better (repo + thin route). `GET /plans` in the route also orchestrates catch-up, spy assembly, and response shaping. `domain/phalanx.ts` is a four-line helper; the phalanx HTTP API is in `plans.ts`.

**Why it matters:** A-02 and A-03 grow from this: catch-up and `group_id` are easy to miss when the next endpoint is copied from a 400-line handler.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | High (incremental; do when touching the area) |

**Fix:** Move plan writes and GET catch-up next to `repo/plans.ts`. Keep routes as auth + `groupContext` + HTTP mapping. Grow `domain/` only for rules that have no SQL.

---

### A-06 — One synchronous SQLite connection is the concurrency model

**Location:** `main.ts` (one `db` for app, crawler, hall poller, push, monitor); `db.ts` `openDb` / `cacheStatements`; `ingest.ts` 113–130 (16 MB universe.json, one transaction); `routes/events.ts` (heartbeat on the same loop).

**Evidence:** better-sqlite3 is synchronous. A universe.json ingest parses and writes thousands of systems on the event loop. Crawler, hall poller, SSE pings, and HTTP share that connection. `db.prepare` is monkey-patched to cache 1000 statements and **reset `.pluck()` on every cache hit** (`db.ts` 34–38). Callers that keep a plucked statement and later `prepare` the same SQL can see objects instead of scalars. Backup is correctly isolated and is not started from `main.ts` (deployment-side, as designed). Horizontal scale is not possible without rewriting the in-memory `EventBus`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | High (workers/queue); Low (pluck cache key) |

**Fix:** Short term: include pluck in the cache key; do not share plucked statements across a loop. Medium: parse/store universe.json in a worker with its own connection, or chunk the transaction. Keep the single-process EventBus unless you add a real bus.

---

### A-07 — Universe settings and tool links are four contracts

**Location:** `apps/server/src/config.ts` `UniverseSettings` 55–115; `apps/web/src/format.ts` 150–175 and 255–407; `apps/server/src/routes/admin.ts` `validateSettings` 635–661; `apps/web/src/views/AdminView.vue` 64–108; `apps/tools/shared/uni.js`; `apps/server/src/battle.ts` `toolsLink` 183–199.

**Evidence:** The server type stops at `inactiveDays` and omits fields the admin validator and OpenAPI already know (`fleetDebrisPercent`, `defenseDebrisPercent`, `bigShields`, `missileRangeFactor`, `phalanxRangeFactor`, noob fields). The web type is a near-copy, so callers cast (`format.ts` 287–288, 382–383). Tools use a fourth contract with snake_case game keys and hash keys (`gs`, `mg`, `fd`). Hub battle links pick units with a hardcoded id band `(id >= 202 && id < 300) || (id >= 401 && id <= 408)` (`format.ts` 384) — custom units 412–414 never enter the tool. `encodeShare` has no `uo`; tools store units separately.

`phalanxRangeFactor` is applied in galaxy coverage and known to `validateSettings`, but the admin form has no field for it.

| Impact | Risk | Effort |
|---|---|---|
| High | High | Medium |

**Fix:** One `UniverseSettings` in `@pr0hub/core` (or a tiny uni module) with defaults, validation, hash encoding, and tool-key mapping. Server `toUniverse`, Admin field list, OpenAPI schema, and tools `UNI_FIELDS` import it. Build tool links from `catalogOf` and put overrides on the hash (`uo`).

---

### A-08 — `@pr0hub/core` is a kitchen-sink; the folder is still called `parser`

**Location:** `packages/parser/package.json`; `packages/parser/src/index.ts`.

**Evidence:** The package owns HTML/text parsers, generated game data, production/build math, the unit catalog, and the expedition deck. Apps already use subpath exports (`./units`, `./tech`, `./buildings`); the root barrel still `export *`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Low | High to rename; Low to document and stop growing the barrel |

**Fix:** Do not rename now. Document “`packages/parser` is `@pr0hub/core`”. Prefer subpath imports. Keep catalog + formulas as core; leave page parsers on slimmer exports.

---

### A-09 — Two ship tables: flight defaults vs unit catalog

**Location:** `packages/flight/src/ships.ts`; `packages/parser/src/units.ts`; flight APIs default to `SHIPS` / `CAPACITY`.

**Evidence:** The catalog copies flight’s `SHIPS`/`CAPACITY` at build. `shipSpeed`, `slowestShip`, `fleetConsumption`, `retimeCandidates`, `fleetCapacity` all default to those constants. Universe overrides only apply if every caller passes `catalog.drives` / `catalog.capacity`. Core cannot import the other way (core already depends on flight). Tests assert `DEFAULT_UNITS.capacity === CAPACITY`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | High (silent wrong cargo/speed) | Medium |

**Fix:** No implicit default catalog in flight, or a single injected `ShipCatalog`. Do not keep a second handwritten table as the implicit universe.

---

### A-10 — Tools and hub share math, not UI or settings

**Location:** `apps/tools` (`shared/shell.js`, `uni.js`, `units.js`, per-tool `main.js`); `apps/web` `UnitEditor.vue`, `format.ts` link builders.

**Evidence:** Shared calculation is TypeScript (`apps/tools/src/*.ts`). The pages users edit are untyped `var` JS and are outside `tsc` (`apps/tools/tsconfig.json` only includes `src/**` and `test/**`). The unit editor is implemented twice (~430-line Vue SFC vs ~477-line DOM module). Tools i18n has no `typeof de` guard. Hub chrome breaks at 800 px; tools chrome at 640 px. Share-hash dialects differ per tool (query string, `#s=` + deflate, `uo`).

This split is **intentional** for a no-login static origin. The cost is every settings/units/hash change.

| Impact | Risk | Effort |
|---|---|---|
| High (velocity) | Medium | High to unify UI; Medium to share the hash/settings module |

**Fix:** One hash schema module imported by hub `format.ts` and each tool. Share the unit-editor field list and paste pipeline. Type tool `TEXTS` like hub locales. Do not rewrite tools in Vue unless you want a larger project.

---

## 2. Clean code

### C-01 — God files that mix persistence, HTTP, and UI

| File | ~Lines | Mix |
|---|---|---|
| `apps/server/src/store.ts` | 950 | Every ingest kind + activity side effects (`record` is a 20-way switch) |
| `apps/server/src/routes/plans.ts` | 815 | HTTP + validation + SQL + ACS/hold/sim |
| `apps/server/src/routes/admin.ts` | 622 | Universes, members, crawler, ingest undo, settings validation |
| `apps/server/src/repo/settlements.ts` | 622 | Prefill + merge + finalize |
| `apps/web/src/views/AdminView.vue` | 917 | Every admin concern |
| `apps/web/src/views/OverviewView.vue` | 840+ | Filters, deltas, planets, mobile list |
| `apps/web/src/views/LootSettlementView.vue` | 760 | Draft, battles, deliveries, edits |
| `apps/web/src/locales/de.ts` / `en.ts` | ~2300 each | One object for the whole SPA |
| `apps/tools/flight-calculator/main.js` | 1370+ | All calculator modes |
| `packages/parser/src/buildings.ts` | 531 | Costs, times, IRN, page models |
| `packages/parser/src/parsers/messages.ts` | 559 | Spy/battle/expo/PM + HTML/text; exports `_internal` |
| `apps/server/test/api.test.ts` | 1700+ | One shared in-memory world |

| Impact | Risk | Effort |
|---|---|---|
| High (velocity) | Medium | High — split when touching the area, not as a rewrite |

**Fix:** `store/stats.ts`, `store/fleets.ts`, …; `routes/plans` → CRUD / fleets / enemy+retime; AdminView → Universes / Groups / Ingests / System; locales by namespace with the same `typeof de` check.

---

### C-02 — API client defaults to `any`; heavy views never type responses

**Location:** `apps/web/src/api.ts` 59–80; `RaidStats.vue`, `ExpeditionStats.vue`, `AdminView.vue`, `SpyView.vue`, `HostileView.vue` (`useLoader<any>`).

**Evidence:** `export async function api<T = any>(...): Promise<T>` then `return data as T`. Overview defines local types; raids/expeditions/admin/spy do not. There is no shared `apps/web/src/api/` types module and no generated client.

| Impact | Risk | Effort |
|---|---|---|
| High | High | Medium (manual types); High (codegen from OpenAPI) |

**Fix:** Remove the `any` default (`T` required). Add response types next to the routes, or generate from OpenAPI. Start with `/overview`, `/raids`, `/expeditions`, `/context`, admin lists.

---

### C-03 — SQL rows and JSON columns are untyped blobs

**Location:** `routes/util.ts` `parseSections(r: any)`; overview/reports/galaxy `as any[]` + `SELECT *`; JSON columns for spy sections, fleets, empire, settlements, push prefs, universe settings, unit overrides.

**Evidence:** `parseTours` is defensive. Almost every other `JSON.parse` is not. A bad column becomes a 500 with no field name. `validateSettings` only type-checks known keys; **extra keys are stored**.

| Impact | Risk | Effort |
|---|---|---|
| High | High | Medium |

**Fix:** Typed row interfaces per table. One `parseJson<T>(raw, spec)`. Prefer named columns on endpoints that return `...row` to the client. Reject unknown setting keys.

---

### C-04 — Mixed `user_id` / `userId` (and snake/camel) in one payload

**Location:** `routes/reports.ts`; `RaidStats.vue`; `ExpeditionStats.vue`; `apps/web/src/plans.ts`; `/context` members.

**Evidence:** `/raids` aggregates use `userId`; raw report rows keep `user_id`, `loot_metal`. The Vue layer filters both in one file. Plan types on the web are snake_case while other endpoints are camelCase.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium (filter the wrong field) | Medium |

**Fix:** CamelCase at the HTTP boundary. Map in the route. Keep snake_case only in SQL. Update OpenAPI + web types together (C-02 / A-01).

---

### C-05 — Three user-facing text pipelines, two compact-number formats

**Location:** `CHANGELOG.md` + `apps/web/src/changelog.ts`; `apps/server/src/push.ts`; `apps/web/src/locales/*`; tools `*/i18n.js`.

**Evidence:** Every user-visible commit updates English `CHANGELOG.md` and bilingual `changelog.ts`. Push/Discord strings are a third bilingual module. `push.ts` `short()` uses `Intl` compact (`1.2M`); hub `format.ts` uses Mio/Mrd. Mission names exist in both.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Low–Medium | Medium |

**Fix:** Keep the typed `typeof DE` pattern. Share compact numbers and mission labels from core. Do not merge push strings into vue-i18n (the server must stay independent).

---

### C-06 — `format.ts` and `composables.ts` are kitchen sinks

**Location:** `apps/web/src/format.ts` (~575); `apps/web/src/composables.ts` (~256).

**Evidence:** `format.ts` holds number/date formatters, `UniverseSettings`, abbreviations, every tool URL builder, freshness colors, phalanx range, and noob protection. `composables.ts` holds universe injection, table sort, progressive lists, data loader, localStorage, player-dialog routing, scroll lock, media query, and mobile stacking.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Low | Medium |

**Fix:** `format/` (numbers, dates, labels) vs `toolLinks.ts` vs `protection.ts`. One file per composable. No behavior change.

---

### C-07 — Duplicated catalogs and formulas

**Location:** `packages/parser/src/units.ts` `SHORT`; `apps/web/src/format.ts` `ABBR` 194–214; `apps/server/src/domain/phalanx.ts`; `format.ts` 421–424.

**Evidence:** Ship/defense abbreviations exist in the unit catalog **and** in `ABBR`. `abbr()` already prefers `units.value.units[id].short`. Phalanx range is implemented twice. Four handwritten overlays exist for “ships install.sql does not have”: `liveUnits.ts`, `battle/src/live.ts`, `flight/src/ships.ts`, extras in `scripts/gen-costs.mjs`. A stale comment says combat values live in `battle/live.ts`; they live in `liveUnits.ts`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium (formula drift) | Low–Medium |

**Fix:** Delete 200/400 ids from `ABBR`. Move `phalanxRange` to flight or core. One live overlay for costs/combat/drives/cargo; leave only engine abilities (stun, bigshield) in `battle/live.ts`.

---

### C-08 — Validation and errors are ad-hoc

**Location:** `routes/util.ts` `clampInt`; `reports.ts` `Math.max(1, Number(req.query.page) || 1)`; `admin.ts` `validateSettings`; views `(e as Error).message`; no Fastify JSON schemas.

**Evidence:** Query clamping exists but is not used consistently. Body validation is hand-written per route. Client loaders swallow everything into a string.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Medium |

**Fix:** One settings schema (A-07) used by admin + OpenAPI. Use `clampInt` everywhere. A small `readError(e)` helper.

---

### C-09 — Tools UI is a second, untyped stack

**Location:** `apps/tools/tsconfig.json`; `shared/units.js`; `UnitEditor.vue`; per-tool `i18n.js`; `kpi()` copied in flight / IPM / battle / ACS.

**Evidence:** `tsc` never sees `main.js` / `units.js` / `i18n.js`. `t()` in `shell.js` interpolates `{vars}` raw; some translations contain HTML. IPM/battle escape `kpi` parts; flight does not (because it injects trusted HTML). `acs-loot` `amountInput` does not escape `extra`. Sampled name paths do use `esc()` — the pattern is fragile, not a live XSS in the sampled calls.

| Impact | Risk | Effort |
|---|---|---|
| High (velocity + XSS footgun) | Medium | High to migrate; Low to name `kpi(label, valueHtml, …)` and type `TEXTS` |

**Fix:** JSDoc + `checkJs` or migrate `shared/units.js` + `uni.js` first. `Object.keys(de)` equals `Object.keys(en)` test per tool. Keep HTML out of `TEXTS`.

---

### C-10 — Small consistency leftovers

| ID | Location | Evidence | Impact | Risk | Effort |
|---|---|---|---|---|---|
| C-10a | `AdminView.vue` 472, 491 | Hardcoded English “Slug”; no `admin.slug` | Low | Low | Low |
| C-10b | `AdminView.vue` / `UnitEditor.vue` `@media (max-width: 799px)` vs hub 800 px | At exactly 800 px JS is mobile, those two style blocks stay desktop | Low | Low | Low |
| C-10c | `packages/loot/src/settle.ts` vs `packages/battle/src/steal.ts` | Both comments cite `calculateSteal`; only `steal()` matches the game’s metal-first fill | Medium if treated as a port | Medium | Low |
| C-10d | `packages/planner/src/pr0plan.ts` 18–21 | Maps through `stormTransporter` (225); no 222 / 227 / 231 / 232 | Medium | Medium | Low |
| C-10e | `packages/flight/src/missile.ts` vs generator `UNUSED` | `MISSILE_TARGETS` still has 409–411; catalog strips them | Low | Low | Low |
| C-10f | `packages/parser` two short-name tables | Catalog `unit.short` (`HXer`) vs `tech.json` `deShort` (`Schwerer Kreuzer`); parsers use tech.json only | Medium | Medium | Low |
| C-10g | Folder `parser` / package `@pr0hub/core` | See A-08 | Low | Low | Low |

**Status:** C-10a/b/c done (`3795d0c`). C-10d open: pr0plan's export keys for 222/227/231/232 need checking against pr0plan.

---

### C-11 — Test structure: two characterization dumps, thin UI coverage

**Location:** `apps/server/test/api.test.ts` 17–39 (one `openDb(':memory:')` + `buildApp` at import time); `packages/parser/test/parse.test.ts` (~1193 lines); `apps/web/test/` (about a dozen suites: format, router, raid-planner, composables — not Overview/Admin/Loot/Messages).

**Evidence:** Newer server tests (`settlements.test.ts`, `plans.test.ts`) isolate better. `api.test.ts` did not. There is no `store.test.ts`; `Store` is only exercised through HTTP ingest. Web has a good raid-planner smoke test; the heaviest views are untested. `noUncheckedIndexedAccess` is off (`tsconfig.base.json`). No lint script.

| Impact | Risk | Effort |
|---|---|---|
| High (confidence) | Medium | Medium |

**Fix:** Split `api.test.ts` by domain with a per-describe DB. Add `store/*.test.ts` that call `Store.record` with parsed fixtures. Split `parse.test.ts` to match `parsers/*.ts`. Add Overview/Admin smoke tests on the raid-planner pattern. Enable `noUncheckedIndexedAccess` on `flight` and `loot` first.

---

## 3. Bugs

Confirmed unless marked **theoretical** or **hardening**.

### B-01 — GET `/api/:uni/plans` writes game data (breaks “read-only” tokens and CSRF)

**Location:** `app.ts` 105–121; `routes/plans.ts` 196–201; `repo/plans.ts` 394–505.

**Evidence:** See A-02. `recallOwnPlans` can `UPDATE` fleets to `withdrawn`, cancel the plan, and release its claim. `syncOwnPlans` can insert launched fleets and move `target_time`. CSRF Origin checks skip GET. Session cookie is `SameSite=Lax`, so a top-level GET navigation **does** send it. A link or redirect to `/hub/api/{uni}/plans` runs this as the victim. Token GET is allowed. Tests only check that POST `/ingest` is 403 for a bearer token.

This is **confirmed**. The writes are not arbitrary — they follow fleet snapshots — but they are still writes on GET, and a polling token will keep applying them.

| Impact | Risk | Effort |
|---|---|---|
| High | High | Low–Medium |

**Fix:** Do not mutate on GET. Run sync/recall from ingest or an explicit POST. Until then, refuse bearer tokens and apply the same Origin / ended-universe checks as other writes.

**Status:** Done (`8437595`). GET `/plans` is a pure read. ACS joins, recalls, a moved impact and launched fleets are applied on overview/fleets ingest and on `POST /plans/sync`. Tests: GET after a raw snapshot INSERT does not grow the list; bearer GET does not mutate; bearer POST sync is 403; cookie POST sync then lists the new fleets.

---

### B-02 — Password change does not revoke API tokens

**Location:** `routes/auth.ts` 77–85 vs recovery accept 286–289.

**Evidence:** `POST /api/auth/password` updates the hash and calls `destroyOtherSessions`. It does **not** `DELETE FROM api_tokens`. Recovery invite accept does delete tokens. Tokens stay valid until expiry or manual revoke.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low |

**Fix:** On password change, delete all `api_tokens` for that user (same as recovery).

**Status:** Done (`1e1c280`). `POST /api/auth/password` deletes `api_tokens` for that user.

---

### B-03 — No maximum password length; scrypt on huge passwords

**Location:** `auth.ts` 63–77; `routes/auth.ts` login / password / access-request / invite; `config.ts` `bodyLimit` default 8 MiB.

**Evidence:** All password paths enforce a **minimum** of 8 characters and no maximum. Login runs async `scrypt` on that string, including the dummy-hash path. Access-request, invite accept, and password change use **`hashPassword` → `scryptSync`** on the event loop. Access-request is public (IP-limited after the fact; the first requests still hash).

| Impact | Risk | Effort |
|---|---|---|
| High (CPU / event-loop) | Medium | Low |

**Fix:** Reject passwords over a small cap (128–256). Keep login scrypt async; consider async hashing on access-request/invite too.

**Status:** Done (`1e1c280`). Passwords are 8–256 characters on login, password change, access-request and invite (rejected before hashing). Access-request/invite hashing is still sync.

---

### B-04 — `forUser` ingest can overwrite another member’s private game state

**Location:** `routes/ingest.ts` 15–38; `store.ts` `empire` / `overview` / `fleets` / `linkIngameName` (474–507, 821–878).

**Evidence:** Any group member may set `forUser` to another member. There is no page-type restriction. The store writes empire, overview, and fleet snapshots for `this.t.userId` (the target) and can `UPDATE group_members.ingame_name`. The comment says “e.g. a report they sent”; the test only covers messages/recycle reports.

| Impact | Risk | Effort |
|---|---|---|
| High (fake fleets → false attack notifications; wipe empire) | Medium (needs to be in the alliance) | Medium |

**Fix:** Allow `forUser` only for message-like records (spy/combat/recycle/messages), or require group-admin / self. Never let `forUser` change `ingame_name` or replace the newest empire/overview/fleet page.

**Status:** Done (`19fb73e`). `FOR_USER_PAGES` is `messages` and `combatReport` (400 `ingest_for_user_page` otherwise, including dry-run). Store also skips empire/overview/fleets/buildings/research when `syncedBy` is set.

---

### B-05 — Player merge drops `attack_plans.player_id` (and deletes settlement comments)

**Location:** `routes/admin.ts` 467–490; `migrations/026_attack_plan_targets.sql` 9 (`ON DELETE SET NULL`); `migrations/049_settlement_comments.sql` (`ON DELETE CASCADE`).

**Evidence:** Merge remaps scores, spies, planets, comments, aliases, status log, activity log, `player_activity`, then `DELETE FROM players`. It never updates `attack_plans.player_id`. The FK then sets those plans’ `player_id` to NULL. `settlement_comments.player_id` is not remapped either and will cascade-delete. Test only checks `activity_log`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium (admin-only) | Low |

**Fix:** `UPDATE attack_plans SET player_id = ? WHERE player_id = ?` (and walk every `REFERENCES players` column) inside the same transaction. Prefer a dynamic FK walk like `mergeUser`.

**Status:** Done (`c925738`). Admin merge remaps every `players` foreign key via `playerReferences()` (including `attack_plans` and `settlement_comments`) in the same transaction.

---

### B-06 — Name-only ingest attaches to former names

**Location:** `repo/players.ts` 63–72, 118–134.

**Evidence:** Without an in-game id, `player()` / `byName()` first match current `name`, then `player_aliases`. A new player who takes a name that an older player has abandoned is merged into the old row (scores, planets, spies). Id-based matching is stricter (`ingame_id IS NULL` only). The “match text to existing ids” test covers current-name match, not the alias case.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium (common after renames) | Medium |

**Fix:** Do not resolve name-only pastes via aliases when creating/attaching a live player. Keep aliases for search/display only, or require extra signals (coords + id).

---

### B-07 — Battle worker can hang and leak the global slot

**Location:** `apps/server/src/battle.ts` 219–232.

**Evidence:**

```219:232:apps/server/src/battle.ts
export function runInWorker(...): Promise<SimSummary> {
  running++;
  return new Promise<SimSummary>((resolve, reject) => {
    const worker = new Worker(...);
    const timer = setTimeout(() => { void worker.terminate(); reject(...); }, ...);
    worker.once('message', (summary) => resolve(summary));
    worker.once('error', (err) => reject(err));
    worker.once('exit', () => clearTimeout(timer));
  }).finally(() => { running--; });
}
```

`exit` without `message`/`error` clears the 20 s timeout and leaves the Promise pending, so `finally` never runs. After two such failures, `running >= concurrent` (2) and every simulate returns 429 `battle_busy` until process restart.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low |

**Fix:** Reject on `exit` if not already settled; always `running--`. Optionally reject non-zero exit codes explicitly.

**Status:** Done (`812e450`). `runInWorker` rejects `battle_worker_exit` on `exit` if the promise is not already settled; `running--` stays in `finally`.

---

### B-08 — Push subscription endpoint is any `https://` URL (SSRF)

**Location:** `routes/push.ts` 14–17, 28–47; `push.ts` `webpush.sendNotification`.

**Evidence:** `endpointOf` only requires `^https://\S+$` and length ≤ 1000. `POST /api/push/test` and live delivery POST to that URL. Discord webhooks, by contrast, are locked to Discord’s hosts (`discord.ts` 51–55).

| Impact | Risk | Effort |
|---|---|---|
| Medium (authenticated user → server-side POST to arbitrary HTTPS, including internal hosts) | Medium | Low |

**Fix:** Allow-list known push hosts (FCM, Mozilla, Apple, Windows). Block link-local / private / metadata ranges even on HTTPS.

**Status:** Partial (`812e450`). Subscriptions must use a known push host (FCM, Mozilla, Apple, WNS). Private/link-local/metadata ranges are not blocked beyond that host list.

---

### B-09 — No ingest rate limit

**Location:** `routes/ingest.ts`; `config.ts` bodyLimit 8 MiB, universe.json 16 MiB.

**Evidence:** Login and access-request have in-memory limits. Battle has `perMinute` / `concurrent`. Ingest does not. A member can POST large HTML/JSON repeatedly; each parse + gzip + transaction is expensive. Raw HTML is kept `rawRetentionDays` (default 14).

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium (needs a group account) | Low |

**Fix:** Per-user and per-group rate limits (e.g. N pastes/min, one universe.json at a time). Cap concurrent ingests.

**Status:** Done (`812e450`). 120 pastes per user per minute, 200 per group per minute, one concurrent `universe.json`.

---

### B-10 — Logout `clearCookie` omits cookie flags

**Location:** `auth.ts` 112–124.

**Evidence:** `createSession` sets `path`, `httpOnly`, `sameSite: 'lax'`, `secure`, `maxAge`. `destroySession` deletes the DB row but `clearCookie` only passes `path`. Some browsers ignore a delete `Set-Cookie` that does not match `Secure` / `SameSite`. Server-side the session is already dead.

| Impact | Risk | Effort |
|---|---|---|
| Low–Medium | Low (browser-dependent) | Low |

**Fix:** Pass the same `path`, `httpOnly`, `sameSite`, and `secure` into `clearCookie`.

**Status:** Done (`1e1c280`). `sessionCookie` is shared by set and clear.

---

### B-11 — Placeholder accounts fail login without dummy scrypt (timing oracle)

**Location:** `auth.ts` 80–83; placeholders use `password_hash = ''`.

**Evidence:** `verifyPasswordOrDummy` uses the dummy hash only when `stored` is `undefined`. `''` is defined: `verifyPassword` returns immediately (`scheme !== 'scrypt'`). Unknown usernames pay a full scrypt; placeholder usernames (derived from in-game names) do not.

| Impact | Risk | Effort |
|---|---|---|
| Low | Low | Low |

**Fix:** Treat empty/invalid stored hashes like missing users (always run dummy scrypt).

**Status:** Done (`1e1c280`). Empty or unusable hashes take the same dummy-scrypt path as unknown usernames.

---

### B-12 — `access_requests.username` UNIQUE is case-sensitive

**Location:** `migrations/062_access_requests.sql` vs `users.username … UNIQUE COLLATE NOCASE`; `checkUsername`.

**Evidence:** Users cannot register `Admin` / `admin` twice. Access requests can hold both, then assign hits `username_taken` or a confusing 409.

| Impact | Risk | Effort |
|---|---|---|
| Low | Low | Low |

**Fix:** `UNIQUE (username COLLATE NOCASE)` on `access_requests`.

**Status:** Done (`0dc7539`). Migration 078 rebuilds `access_requests` with `UNIQUE COLLATE NOCASE` (oldest of a clash kept).

---

### B-13 — Invite tokens stored and returned in plaintext

**Location:** `migrations/001_init.sql` 45–54; `routes/admin.ts` create-invite; `routes/auth.ts` `openInvite`.

**Evidence:** Sessions and API tokens are SHA-256 hashed. Invite tokens are the raw value, primary key, and shown to group admins (placeholders) / global admins (recovery). A leaked DB or backup yields working invite/recovery URLs. Recovery links are already treated as account-takeover capable.

| Impact | Risk | Effort |
|---|---|---|
| Medium if the DB leaks | Low–Medium | Medium |

**Fix:** Store `token_hash` like sessions; look up by hash. Return the secret only once at creation.

---

### B-14 — Active claims have no uniqueness constraint

**Location:** `migrations/018_target_claims.sql`; `routes/claims.ts` 79–98.

**Evidence:** Uniqueness of an active claim is only enforced in a transaction (`SELECT` then `INSERT`). There is no `UNIQUE` on `(group_id, g, s, p, planet_type) WHERE released_at IS NULL`. Safe in one process; two Node processes on one SQLite file can insert two active claims.

**Theoretical** on the current single-process deploy.

| Impact | Risk | Effort |
|---|---|---|
| Medium (double-claim) | Low today | Low |

**Fix:** Partial unique index on active rows.

**Status:** Done (`0dc7539`). Partial unique index on unreleased claims; a new claim releases the target's unreleased claims (an expired one at its expiry).

---

### B-15 — Access-request messages are visible to every alliance admin

**Location:** `routes/admin.ts` 216–238. Test title in `test/accessRequests.test.ts` says “global admins only”.

**Evidence:** `GET /api/admin/access-requests` uses `assignableGroups` (any group admin) then `SELECT … message … FROM access_requests` with **no** group filter. Comments in code say this is intentional. Placeholders are filtered; messages are not.

Confirmed behavior; may be a product decision. The test name is wrong.

| Impact | Risk | Effort |
|---|---|---|
| Low–Medium (privacy on a multi-alliance hub) | Low if intended | Low |

**Fix:** If unintended, restrict the list to global admins. If intended, fix the test title.

**Status:** Done (`0dc7539`): intended. Alliance admins see all requests (they carry no alliance); the test title now says so.

---

### B-16 — Fleet HTML is discarded unless overview parse succeeds

**Location:** `packages/parser/src/index.ts` 140–144; `parsers/fleets.ts`; `parsers/overview.ts`.

**Evidence:** `parseFleetsHtml` is only called inside the overview branch. The result is thrown away when `parseOverviewHtml` returns null (no `#planetSelector option[selected]` with parseable coords). There is no `page=fleet` / `#hidden-div2` branch. The text path does fall through to `isFleetsText` (index.ts 185–192). Page-source fixtures always include a selected planet, so this is untested.

| Impact | Risk | Effort |
|---|---|---|
| Medium (event-list HTML stores no fleets) | Medium | Low |

**Fix:** If `parseFleetsHtml` finds timers, return `{ pageType: 'fleets', records: [fleets] }` even when overview is null. Mirror the text fallback.

**Status:** Done (`c925738`). Fleet HTML is kept when the overview has no selected planet.

---

### B-17 — Name-based parsers drop unknown units with no warning

**Location:** `parsers/combatReport.ts` 88–91; `fleets.ts`; `logistics.ts`; `messages.ts` (spy text).

**Evidence:** `idByName` / `idByShortName` → skip. `ParseResult.warnings` never gets an unmatched-name code. HTML spy uses `data-info` ids and is robust. Unit pages already collect `unknown[]`. Combat/fleets/spy text do not. Combined with A-04 (shorts never registered), new defense (412+) vanishes from reports.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low |

**Fix:** Same `unknown` list as unit pages; push e.g. `unknown_unit` on `parsePage`. Register catalog shorts (A-04).

**Status:** Done (`c925738`, A-04 commit). Unknown names become `unknown_unit`; a universe's added units resolve by their catalog short after the game's shorts.

---

### B-18 — Planner marks steps invalid when another planet will finish the prereq over several research steps

**Location:** `packages/planner/src/simulate.ts` 234–248.

**Evidence:** A missing research prereq is `never` unless it is already in `researchQueue` at the needed level, or **another planet’s head** is that research **and** `researchLevelOf(id) + 1 >= need`. Later steps on other planets are ignored. Same-planet “in this order” is tested. There is no cross-planet multi-level case.

Concrete miss: planet B list Impulse 1→2→3→4, planet A next step Cruiser (needs Impulse 4, current 0). Head on B is Impulse 1 → `0+1 >= 4` is false → A’s cruiser is `invalid`.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Medium |

**Fix:** Look ahead at remaining research steps on all planets (sum of queued + planned levels), or only set `never` when every list is stuck.

---

### B-19 — Default Optimized Recycler requirements are Universe 7 values

**Location:** `scripts/gen-costs.mjs` 77–79; `packages/parser/src/data/ships.json` id `227`.

**Evidence:** Comment: `"Optimierter Recycler (Universe 7; elsewhere 6/6/6)"`. Generated defaults are `{ 21: 8, 110: 8, 117: 9 }`. The catalog design says universes store **differences** from defaults. Non-U7 universes inherit U7 reqs unless they override.

| Impact | Risk | Effort |
|---|---|---|
| Medium (shipyard tab and planner lock/unlock ORec wrong on most universes) | Medium | Low |

**Fix:** Default 6/6/6. Put 8/8/9 on U7 overrides.

**Status:** Done (`c925738`). Generated default for ship 227 is shipyard/shields/impulse 6; Universe 7 stores 8/8/9 as an override.

---

### B-20 — Planner event-cap leftovers look like a planet-type error

**Location:** `packages/planner/src/simulate.ts` 57, 435, 488–490.

**Evidence:** Loop stops at `MAX_EVENTS` (200 000). Steps never recorded become `{ state: 'invalid', wait: 'planet' }`. Horizon uses `wait: 'horizon'`. The fallback is the missing-planet path.

| Impact | Risk | Effort |
|---|---|---|
| Low | Low | Low |

**Fix:** After the loop, mark leftover heads `horizon` or a dedicated `aborted` reason.

**Status:** Done (`3795d0c`). Leftover heads after the event cap get `wait: 'aborted'` (own DE/EN texts); `planet` stays for lists without a hub planet.

---

### B-21 — Login `next` is passed to the router unvalidated

**Location:** `apps/web/src/views/LoginView.vue` 19; `router.ts` 68.

**Evidence:** `router.replace(String(route.query.next ?? '/'))`. Arrays (`?next=a&next=b`) become `"a,b"`. Vue Router 4 treats `https://…` and `//…` as **path strings**, so this is **not** a confirmed cross-origin open redirect. It is still an unvalidated in-app redirect that can land on unexpected routes and look like an external URL in the address bar (`/hub//evil.example`).

| Impact | Risk | Effort |
|---|---|---|
| Low–Medium | Low | Low |

**Fix:** Accept only a string that starts with `/`, does not start with `//`, and does not contain `://`. Else `/`.

**Status:** Done (`99da344`). `safeNext()` is used by login and the 401 redirect.

---

### B-22 — API client never treats 401 as “session ended”

**Location:** `apps/web/src/api.ts` 59–75; `router.ts` 60–69; `live.ts` 91–95.

**Evidence:** `api()` throws `ApiError` for any non-OK status and never clears `session.me` or routes to login. The guard only runs on navigation and only if `session.me?.user` is already empty. After cookie expiry, the SPA stays “logged in”, views show raw errors, and `EventSource` retries forever.

| Impact | Risk | Effort |
|---|---|---|
| Medium | High (every authenticated flow after expiry) | Medium |

**Fix:** In `api()`, on 401 set `session.me = { user: null, groups: [] }`, redirect once to `/login?next=…`. Close live in `stopLive()`.

**Status:** Done (`99da344`). 401 clears `session.me`, calls `stopLive()`, and `router.replace`s `/login?next=` once (skips `/auth/login` and `/auth/me`).

---

### B-23 — `res.json()` failures are not `ApiError`

**Location:** `apps/web/src/api.ts` 73–74.

**Evidence:** If `content-type` contains `json` but the body is empty/HTML (proxy 502), `res.json()` throws `SyntaxError`. Views display “Unexpected token…”.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low |

**Fix:** try/catch around `res.json()`; fall back to `ApiError(status, statusText)`.

**Status:** Done (`99da344`).

---

### B-24 — Player note save has no error handling

**Location:** `apps/web/src/components/PlayerDetail.vue` 105–108.

**Evidence:** `await uniApi(...)` then `savedNote = note.value`. Failure is an unhandled rejection; the UI looks saved. `CommentThread.run` does catch.

| Impact | Risk | Effort |
|---|---|---|
| Medium (silent data loss) | Medium | Low |

**Fix:** try/catch into `error`; only then set `savedNote`.

**Status:** Done (`99da344`). Failed note save sets `noteError`.

---

### B-25 — Non-numeric `player` query still opens the dialog

**Location:** `composables.ts` 181; `PlayerDialog.vue`; `PlayerView.vue` (`:id` is not `\\d+`).

**Evidence:** `route.query.player ? Number(route.query.player) : null`. `Number('foo')` is `NaN`. `NaN != null` is true → dialog mounts, request `/players/NaN`. Messages uses `Number(...) || null`, which is safer.

| Impact | Risk | Effort |
|---|---|---|
| Low–Medium | Medium | Low |

**Fix:** `Number.isInteger(n) && n > 0 ? n : null`. Constrain `:id(\\d+)`.

**Status:** Done (`99da344`). `playerIdOf` plus `player/:id(\\d+)`; `PlayerView` mounts only with a valid id.

---

### B-26 — Live `JSON.parse` is uncaught

**Location:** `apps/web/src/live.ts` 90.

**Evidence:** `source.onmessage = (m) => emit(JSON.parse(m.data));` A malformed event throws inside the handler. The stream stays open (`onerror` only runs on CLOSED), so later events may never dispatch; no `resync`.

| Impact | Risk | Effort |
|---|---|---|
| Medium (tab stops updating) | Low (server normally emits JSON) | Low |

**Fix:** try/catch; ignore or treat as `resync`.

**Status:** Done (`99da344`). Malformed live events are ignored.

---

### B-27 — Chunk-load recovery can reload forever if `sessionStorage` is blocked

**Location:** `router.ts` 72–84.

**Evidence:** On dynamic-import failure it stores `to.fullPath` and reloads if `last !== to.fullPath`. If both get/set throw, `last` stays `null`, the inequality is always true → reload loop.

| Impact | Risk | Effort |
|---|---|---|
| Medium if it triggers | Low | Low |

**Fix:** In-memory fallback flag; cap at one reload per session even without storage.

**Status:** Done (`3795d0c`). Reload only when sessionStorage keeps the mark; without storage no reload (an in-memory flag would not survive the reload).

---

### B-28 — Overview / Alliance overlapping loads

**Location:** `OverviewView.vue` 161–179; `AllianceView.vue`; `useLoader` in `composables.ts` 130–147.

**Evidence:** `useLoader` exists so an older response cannot overwrite a newer one. Overview (live reload 3 s), Alliance, Admin, and loot settlement roll their own `load()` with no generation token.

| Impact | Risk | Effort |
|---|---|---|
| Medium (wrong rows until the next event) | Medium on a busy alliance | Low |

**Fix:** Switch those views to `useLoader`.

**Status:** Done (`3795d0c`) for Overview and Alliance. Admin and loot settlement still roll their own `load()`.

---

### B-29 — Flight `applyHash` is true for any hash keys, including `uo` only

**Location:** `apps/tools/flight-calculator/main.js` 208–278.

**Evidence:** If `Object.keys(h).length`, it always `return true` at 278, even when no flight/uni key was applied. Init then `clearHash()`, may open a new tab, toast `linkLoaded` / `linkNewTab`. IPM/moon only return true when their own keys exist.

| Impact | Risk | Effort |
|---|---|---|
| Medium (spurious tab + toast) | Medium | Low |

**Fix:** Return true only when a known flight/uni key was consumed; ignore `uo` (already handled by `initUnits`).

**Status:** Done (`3795d0c`). `applyHash` returns true only for flight, tech or universe keys; test with a `uo`-only hash.

---

### B-30 — Modal dialogs do not trap focus (a11y)

**Location:** `Sheet.vue` 31–38; `PlayerDialog.vue`; `NotificationBell.vue` 122–124; `SpyView.vue` 170.

**Evidence:** Sheet has `role="dialog" aria-modal="true"`, Esc, first-field focus, **no Tab cycle / `inert`**. Player dialog has no `aria-labelledby`. Notification panel is `role="dialog"` without Esc, without `aria-modal`. Spy recent rows: `role="button"` with Enter only (Messages handles Space).

| Impact | Risk | Effort |
|---|---|---|
| High for keyboard / SR users; Low for others | Medium | Medium (shared trap); Low (Esc on the bell) |

**Fix:** Shared focus trap; `aria-labelledby` on the player `h1`; Esc on the bell; Space on spy cards.

---

### XSS (web / tools)

Hub: **no `v-html` / `innerHTML` in `apps/web/src`**. Comments, messages, notes, and access-request text use `{{ }}`. Pasted HTML is sent as JSON and not rendered. Residual risk is only if a future view switches to `v-html`.

Tools: widespread `innerHTML` plus `esc()` on sampled name/user paths. `t()` does not escape interpolations. No live unescaped player-name path was found; the pattern is a footgun (C-09).

---

### Theoretical / hardening (not shipping bugs on a single Node process)

| ID | Issue | Why theoretical |
|---|---|---|
| B-T1 | Invite `openInvite` then later `UPDATE used_at` | Handler is sync (`scryptSync`); one process cannot interleave |
| B-T2 | Settlement `isFinal()` then PUT/finalize | Same; no `await` between check and write |
| B-T3 | Login throttle is an in-memory `Map` | Fine for one process; resets on restart / ignored if you add replicas |
| B-T4 | CSRF allows missing `Origin` | Documented for scripts; Lax blocks cross-site POST cookies. Residual GET write on `/plans` is closed (B-01); GET `/build-order` and GET `/buildings` still write |
| B-T5 | Crawler / hall poller `fetch(gameUrl + …)` | Only hub admins set `gameUrl` (`https?://`). Admin SSRF if you do not trust them |
| B-T6 | scrypt string is `scrypt$salt$hash` with no N/r/p | Node defaults are acceptable; you cannot rotate cost without a format change |
| B-T7 | `GET /api/universes` returns every universe’s settings | Any logged-in user; may be intentional for the universe picker |

---

## 4. Improvements

### I-01 — CI drift check for OpenAPI paths

**Complements A-01.** A script that fails when a registered Fastify path has no YAML path (and vice versa) is the cheapest way to stop the contract from rotting. Do this before codegen.

| Impact | Risk of leaving it | Effort |
|---|---|---|
| High | High | Medium |

**Status:** Done (`eb8ef15`). `test/openapi-paths.test.ts` is bidirectional Fastify vs YAML and unique `operationId`s (`pnpm test` already runs in CI). `printRoutes()` prefix collapse was unreliable; `onRoute` is the source.

---

### I-02 — Ingest and Store should log

**Location:** `ingest.ts` and `store.ts` (no `log`); `app.ts` request serializer is method+url only; `backup.ts` uses `console.log`.

**Evidence:** Crawler, push, hall poller, and monitor take `app.log`. Ingest — the write path that mutates all game tables — does not. Failures become HTTP 500s or a warning code in the ingest summary with no structured “group / pageType / counts / duration.”

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low |

**Fix:** Log ingest start/end (`groupId`, `pageType`, `source`, `counts`, `ms`, `warnings`). Log Store `stats_not_saved` and JSON parse failures with row id. Request serializer: status, group, uni. Use `app.log` in `backup.ts`.

**Status:** Done (`eb8ef15`, logger field rename `045e495`). Ingest logs group, user, `syncedBy`, page type, source, dry-run, counts, warnings and duration. Store logs `store_json` and `stats_not_saved` on `ingestLog` (not the activity-log `log()` helper). Request serializer adds `uni` and `x-hub-group`. Backup writes a JSON line to stderr, then still `console.log`s the file.

---

### I-03 — DX: no lint, packages must be built first, tools JS outside `tsc`

**Location:** root `package.json` (no `lint` / `openapi` / `i18n` scripts); README “build packages first”; `apps/tools/tsconfig.json`.

**Evidence:** Typecheck is the only static gate. Web/server import `dist/` of workspace packages, so a types-only change in `packages/parser` is invisible until rebuild.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Low–Medium | Low–Medium |

**Fix:** Root `lint` (even `tsc --noUnusedLocals` first). Vite/workspace “source” condition or `dev` watch for packages. `check:openapi` (I-01). Include tools `shared/*.js` via JSDoc+checkJs or migrate (C-09).

---

### I-04 — Admin UI is missing settings the server already applies

**Location:** `AdminView.vue` 64–108 (no `phalanxRangeFactor`); `validateSettings` 648; `routes/galaxy.ts`; `format.ts` `flightCalculatorUrl` casts.

**Evidence:** Phalanx coverage uses `phalanxRangeFactor` (default 1). Operators cannot set it. `flightCalculatorUrl` is still honored via casts but is not a typed setting and has no admin field.

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Low (once A-07 exists) |

**Fix:** Add the field to the admin form once settings live in one type. Drop or document `flightCalculatorUrl` (prefer `toolsUrl` only).

---

### I-05 — `/:uni` swallows unknown paths; no 404

**Location:** `apps/web/src/router.ts`; `UniverseLayout.vue`.

**Evidence:** Any segment that is not `/login` etc. becomes a universe. `/invite` without a token, typos, and stale bookmarks hit `/api/:uni/context` and show a loader or API error.

| Impact | Risk | Effort |
|---|---|---|
| Low | Medium | Low |

**Fix:** If `/context` is 404, render a dedicated empty state. Optional `/:uni(\\w+)` constraint.

---

### I-06 — Share-hash schema as a module

**Complements A-07 / A-10.** Hub builders in `format.ts` duplicate per-tool keys. Easy to add a hub key the tool ignores (already true for tools-only `ehm` / `hb`).

| Impact | Risk | Effort |
|---|---|---|
| Medium | Medium | Medium |

---

### I-07 — Characterization tests that would have caught the bugs above

Missing at review time (would lock the fixes). After the first series:

1. **Done.** Bearer GET `/api/:uni/plans` must not insert/update `attack_plan_fleets` or cancel plans. Cookie `POST /plans/sync` applies catch-up; bearer POST is 403.
2. **Done.** Password change deletes `api_tokens`.
3. **Done.** Login / access-request reject a very long password (and stay fast).
4. **Done.** Player merge remaps every `players` FK, including `attack_plans.player_id`.
5. **Open.** Name-only paste of a **former** name does not attach to the renamed player.
6. **Done.** `forUser` is rejected except messages/combat reports; Store skips empire/overview/fleets/buildings/research when `syncedBy` is set.
7. **Done.** Worker `exit` without `message` rejects and decrements `running`.
8. **Partial.** Push host allow-list (FCM/Mozilla/Apple/WNS); `https://127.0.0.1/...` is not a dedicated case beyond that list.
9. **Done.** Overview HTML without `option[selected]` still yields fleets.
10. **Open.** `registerUnitNames` collision; shorts of 412–414 in a combat report.
11. **Partial.** ORec default 6/6/6 vs U7 8/8/9 is covered; planner cross-planet multi-level research is not.
12. **Done.** `api()` 401, `next` allowlist, `playerIdOf` / non-numeric player route.
13. **Open.** Flight `uo`-only hash does not count as a flight share.
14. **Done.** OpenAPI `paths` vs Fastify `/api` routes (including `/api/auth/login` and `/api/{uni}/ingest`).

**Status:** Partial. The first-series items above have tests; leftover characterization (alias attach, catalog shorts, planner research, `uo`-only hash) is still open.

---

## Areas not verified

- No confirmed cross-group leak. This review did not execute requests or audit every SQL string for a missing `group_id`.
- OpenAPI vs every response field of `/context`, `/plans`, `/overview`.
- Battle WASM memory/CPU isolation beyond `worker_threads` + 20 s `terminate` + piece limits. No `resourceLimits` on `Worker`.
- SSE under a buffering proxy / multi-instance (the bus is in-memory by design).
- Runtime duration of a 16 MB universe.json ingest.
- Browser UI flows (this review is source-only).
- Deployment, hosts, backup schedule — out of this repository by design.
- Whether two real universes already collide on custom unit names.

---

## Conclusion and recommended order

The codebase is in better shape than a typical multi-year game-tool monorepo: the domain packages are tested against the game, tenancy is a named rule, and the XSS posture of the SPA is correct. The first series closed the cheap auth/availability/data bugs, made GET `/plans` a read, locked `forUser`, and put OpenAPI paths under CI. The work that still pays off is **the remaining contracts** (unit catalog, universe settings, GET `/build-order` / `/buildings`) and **the leftover Wave 1 items**, not a greenfield rewrite.

Order below follows **low-hanging fruit first**, then **critical contract/correctness work**, then **nice-to-have structure**.

### Wave 1 — Low-hanging fruit

Cheap, local, high confidence. Most are a few hours and a test.

| Order | ID | What | Effort | Status |
|---|---|---|---|---|
| 1 | B-03 | Cap password length (login, access-request, invite, change) | Low | Done `1e1c280` |
| 2 | B-02 | Revoke API tokens on password change | Low | Done `1e1c280` |
| 3 | B-10 | `clearCookie` with the same flags as `setCookie` | Low | Done `1e1c280` |
| 4 | B-11 | Dummy scrypt for empty/invalid hashes | Low | Done `1e1c280` |
| 5 | B-07 | Settle the battle-worker Promise on `exit` | Low | Done `812e450` |
| 6 | B-05 | Remap `attack_plans.player_id` (and other `REFERENCES players`) on merge | Low | Done `c925738` |
| 7 | B-08 | Allow-list push endpoints | Low | Partial `812e450` (hosts; not private ranges) |
| 8 | B-21 | Allowlist login `next` | Low | Done `99da344` |
| 9 | B-23 | `api()` JSON parse → `ApiError` | Low | Done `99da344` |
| 10 | B-24 | Player note try/catch | Low | Done `99da344` |
| 11 | B-25 | Integer player ids | Low | Done `99da344` |
| 12 | B-26 | Live `JSON.parse` try/catch | Low | Done `99da344` |
| 13 | B-27 | One chunk-reload even without `sessionStorage` | Low | Done `3795d0c` |
| 14 | B-28 | Overview/Alliance on `useLoader` | Low | Done `3795d0c` |
| 15 | B-29 | Flight `applyHash` only on known keys | Low | Done `3795d0c` |
| 16 | B-16 | Fleet HTML fallback when overview is null | Low | Done `c925738` |
| 17 | B-17 | `unknown_unit` warnings | Low | Partial `c925738` (warnings; catalog shorts still A-04) |
| 18 | B-19 | ORec defaults 6/6/6; 8/8/9 on U7 | Low | Done `c925738` |
| 19 | B-20 | Planner event-cap → `horizon` / `aborted` | Low | Done `3795d0c` |
| 20 | B-12 | `access_requests` `COLLATE NOCASE` | Low | Done `0dc7539` |
| 21 | C-10a / C-10b | Admin “Slug” i18n; 800 px breakpoint | Low | Done `3795d0c` |
| 22 | C-10c / C-10d | Drop the false `calculateSteal` claim; extend `PR0PLAN_SHIPS` | Low | Partial `3795d0c` (C-10c; C-10d needs pr0plan's key names) |
| 23 | I-02 | Ingest / Store structured logs | Low | Done `eb8ef15` / `045e495` |
| 24 | B-09 | Ingest rate limit | Low | Done `812e450` |
| 25 | B-14 | Partial unique index on active claims | Low | Done `0dc7539` |
| 26 | B-15 | Access-request visibility: decide and fix the test title | Low | Done `0dc7539` (intended; title fixed) |

### Wave 2 — Critical (do next)

These are the contract and correctness issues. They take more than an afternoon, but leaving them is more expensive than the work.

| Order | ID | What | Effort | Status |
|---|---|---|---|---|
| 1 | B-01 / A-02 | Stop writes on GET `/plans` (and decide for build-order / buildings). This also fixes the token story and the CSRF-via-GET case. | Medium | Partial `8437595` (`/plans` done; build-order / buildings still write) |
| 2 | B-04 | Lock down `forUser` to message-like pages | Medium | Done `19fb73e` |
| 3 | A-04 / B-17 | Pass the universe catalog into parse/name/short lookup; register shorts | Medium | Done (2026-11-06; `withUnits` await guard open) |
| 4 | B-06 | Stop attaching name-only pastes via aliases | Medium | Open |
| 5 | B-22 | Central 401 → clear session, close live, login | Medium | Done `99da344` |
| 6 | A-07 / I-04 / I-06 | One `UniverseSettings` + hash mapping; admin `phalanxRangeFactor`; tool `uo` on hub links | Medium | Open |
| 7 | A-01 / I-01 / C-02 | OpenAPI path check in CI; type the web client on the token-facing GETs | Medium | Partial `eb8ef15` (path CI done; typed client open) |
| 8 | B-18 | Planner cross-planet multi-level research | Medium | Open |
| 9 | A-09 | Kill flight’s implicit `SHIPS` default (pass the catalog) | Medium | Open |
| 10 | I-07 | Characterization tests for the Wave 1–2 fixes | Medium | Partial (landed with the first series; leftover items still open) |
| 11 | B-13 | Hash invite tokens | Medium | Open |
| 12 | B-30 | Shared focus trap + Esc on the notification panel | Medium | Open |

### Wave 3 — Nice to have (last)

Structural work. Do it when you next touch the file, not as a dedicated rewrite.

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | A-03 | `GroupDb` / grep test for `group_id` | High / Low for the grep |
| 2 | A-05 / C-01 | Split `store.ts`, `plans.ts`, AdminView, locales when touching them | High |
| 3 | A-06 | universe.json off the event loop; pluck in the statement cache key | High / Low |
| 4 | A-08 / A-10 / C-09 | Slimmer core exports; tools TS incrementally; typed tool i18n | High |
| 5 | C-03 / C-04 / C-06 / C-08 | Typed rows, camelCase on the wire, split `format.ts`, shared validation | Medium |
| 6 | C-05 / C-07 | Shared compact numbers and phalanx formula; one live-unit overlay | Medium |
| 7 | C-11 / I-03 | Split `api.test.ts`, Store tests, lint, `noUncheckedIndexedAccess` on packages | Medium |
| 8 | I-05 | Dedicated 404 for unknown universes | Low |

### What not to do

- Do not rewrite the SPA or the tools in a new framework.
- Do not add Postgres or a multi-instance event bus until the product actually needs more than one Node process. GET `/plans` writes are closed; GET `/build-order` / `/buildings` and the unit catalog still exist on one process.
- Do not generate Fastify from OpenAPI unless you want a larger project. A path-drift check plus hand-written schemas on the token surface is enough.
- Do not rename `packages/parser` → `packages/core` in the same breath as the catalog work; the import blast is not worth it.

### First commit series — done 2026-11-04

Shipped on `main` as `0b8434d..045e495` (author Neffez). Typecheck and the full test suite passed before push.

| # | SHA | What landed |
|---|---|---|
| 1 | `1e1c280` | Auth: password 8–256, revoke API tokens on password change, logout cookie flags, dummy hash for empty/placeholder accounts |
| 2 | `812e450` | Availability: battle-worker `exit` settles the slot, push host allow-list, ingest rate limits |
| 3 | `c925738` | Data: merge remaps every `players` FK, ORec default 6/6/6 (U7 keeps 8/8/9), fleet HTML without a selected planet, `unknown_unit` |
| 4 | `8437595` | GET `/plans` is a pure read; catch-up on overview/fleets ingest and cookie `POST /plans/sync` |
| 5 | `19fb73e` | `forUser` only for messages and combat reports |
| 6 | `99da344` | SPA: 401 clears session/live and goes to login; `next` stays on the hub; JSON/note/player-id/live parse |
| 7 | `eb8ef15` | OpenAPI path CI (Fastify `onRoute` vs YAML); ingest/store/backup logs |
| 8 | `045e495` | Store ingest logger renamed (`ingestLog`) so it does not collide with the activity-log helper |

**Closed:** B-01 (plans GET), B-02, B-03, B-04, B-05, B-07, B-09, B-10, B-11, B-16, B-19, B-21, B-22, B-23, B-24, B-25, B-26, I-01, I-02.

**Partial:** A-01 / I-01 (path CI, not schemas or a typed client), A-02 (GET `/build-order` / `/buildings` still write), B-08 (hosts, not private ranges), B-17 (warnings, not catalog shorts), I-07 (tests for the series, not the leftover list).

### Second commit series — Wave 1 leftovers, 2026-11-05

| # | SHA | What landed |
|---|---|---|
| 1 | `0dc7539` | Server: `access_requests` NOCASE (B-12), one unreleased claim per target (B-14), B-15 decided as intended |
| 2 | `3795d0c` | Planner `aborted` (B-20), chunk reload (B-27), Overview/Alliance `useLoader` (B-28), flight `uo` hash (B-29), C-10a/b/c |

**Still open from Wave 1:** C-10d (needs pr0plan's export keys for 222/227/231/232), B-08 private ranges, B-28 for Admin / loot settlement.

**Next:** catalog/`withUnits` (A-04) and one `UniverseSettings` module (A-07) — the two refactors that prevent the next year of silent drift; then B-06 (name-only alias attach).

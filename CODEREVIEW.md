# Code Review: pr0game-hub

**Date:** 2026-11-20
**Scope:** The whole repository at `b2a0c70`, with the focus on **performance, security, bugs and architecture**, plus
improvements and new features. Server (request pipeline, auth and tokens, admin and member management, ingest and
`Store`, routes and repos, live events, push and Discord, workers, crawler, housekeeping, schema and indexes), the
shared packages (parser, flight, battle, loot, planner), the web app (API client, live reload, links), the tools
(XSS posture), Dockerfile and CI. The game (`pr0game`, PHP) served as the reference for the game math and for feature
ideas.

**Method:**

1. Source review of the modules above, structured by area (pipeline and auth → ingest and routes → notifications and
   background jobs → schema and queries → packages, web, tools, CI).
2. **Measurements** on a synthetic group of realistic size (built through the real API with `app.inject`): a
   universe.json of 4 galaxies × 499 systems with 1,999 players, 60 alliances and 7,060 planets; statistics of 30 days
   (4 updates a day × 3 categories × all players = 719,640 score rows); 3,000 spy reports. Each endpoint was timed
   (median of 3, uncompressed) and the SQL of the slow ones profiled per statement.
3. **Fuzzing** of the parser and of the ingest routes with repeated anchor phrases (`<`, `<script>`, report headers,
   coordinates, dates, …) to find super-linear regular expressions.
4. **Verification tests** (throw-away, not committed) for every finding marked *Reproduced*.
5. Comparison of the ported game math with the game's PHP source (`FleetFunctions.php`, `calculateSteal.php`,
   `CheckRebuildProtection.php`, `GeneralFunctions.php::CheckNoobProtec`, `GenerateWreckField.php`).

Each finding says how it was found: **Reproduced** (seen in a test against the real app), **Measured** (timed),
**Code** (follows from the code, not run).

**This file replaces the review of 2026-11-19.** Its findings F-01 to F-06 and F-T1 to F-T5 were fixed the same day;
the items it still listed as open are carried over in section 6 and 7 (re-checked against this tree). The history is in
git (`git log -- CODEREVIEW.md`).

### Verification run (this tree, `b2a0c70`)

`pnpm install --frozen-lockfile`, `pnpm --filter "./packages/*" build`, `pnpm typecheck`, `pnpm test`,
`pnpm audit --prod`.

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `apps/server` tests | 413 passed, 5 skipped (61 files) |
| `apps/web` tests | 142 passed (31 files) |
| `packages/flight`, `parser`, `loot`, `api-types` | 50 / 170 / 52 / 3 passed |
| `packages/planner` | 86 passed, 4 skipped (optimizer benchmark) |
| `packages/battle` | 9 passed, 15 skipped (the WebAssembly engine needs `pnpm build:battle`, i.e. Docker; not built here) |
| `apps/tools` | 59 passed, 15 skipped (same reason) |
| `pnpm audit --prod` | no known vulnerabilities |

### How to read a finding

| Field | Meaning |
|---|---|
| **Impact** | How much it hurts users, operators or future work if it happens |
| **Risk** | How likely it is to happen, times how bad that is |
| **Effort** | **Low** (hours), **Medium** (1–3 days), **High** (a week or a careful refactor) |

Severity is **Impact × Risk**, not Impact alone. IDs: **S** security, **P** performance, **B** bug, **A** architecture,
**I** improvement, **F** feature, **T** theoretical.

---

## Executive summary

The code base is in good shape for its size (≈115k lines, ≈1,050 tests, all green): group isolation, the OpenAPI
contract and the write guard are enforced centrally and tested, SSRF on outbound requests is closed by allow-lists, and
the game math matches the game. The review still found **two urgent availability problems** and one structural
performance problem:

1. **S-01 / S-02 – any member can stall the whole hub.** Two regular expressions are quadratic on crafted input. 100 KB
   of `<` sent to `/ingest` (even as `dryRun`) or `/ingest/sample` block the single Node process for 4.7 s, and the
   spy-report header regex of the parser needs 26.6 s for 640 KB of text. With the 8 MB body limit one request can
   block the server for hours; rate limits do not help because one request is enough.
2. **P-01 – the inactivity analysis is recomputed for every request and every player.** On the synthetic group,
   `/overview` takes 1.3 s (and returns 6.4 MB), `/farm` 1.1 s, `/goals` 0.9 s, `/recap` 0.7 s and even the page of a
   single player 0.7 s – all on the event loop. Live reload makes every open overview fetch it again after each
   paste (P-02).
3. **B-01 / B-02 – notifications can silently go missing or stall.** Web push has no timeout and the 30-second ticks
   are not serialized, so one hanging push service delays launch reminders and attack warnings of every group; and a
   notification is marked as sent *before* it is sent, so a transient error drops it for good.

Smaller confirmed bugs: an alliance admin can rename the hub owner or any global admin everywhere (S-04), the admin's
universe update is not atomic (B-03), `flightCalculatorUrl` accepts any value including `javascript:` (S-05). The app
sets no security headers (S-03).

The biggest architectural lever is to **move parsing off the event loop** (A-N1, solves S-01/S-02 structurally and the
carried-over A-06) and to **cache derived data per group data version** (A-N2, solves P-01/P-02 and the notification
cost P-03).

### Findings at a glance

| ID | Finding | Found | Impact | Risk | Effort |
|---|---|---|---|---|---|
| S-01 | Quadratic tag-stripping regex in ingest and parser samples: member DoS | Reproduced | High | High | Low |
| S-02 | Quadratic spy-report header regex in the parser: member DoS | Measured | High | Medium | Low |
| P-01 | `inactivities()` recomputed per request for all players | Measured | High | High | Medium |
| B-01 | Web push without timeout, ticks not serialized | Code | High | Medium | Low |
| B-02 | Notifications marked sent before sending: lost on transient errors | Code | High | Medium | Low–Medium |
| P-02 | `/overview` 6.4 MB / 1.3 s, reloaded by every open tab after each paste | Measured | Medium | High | Medium |
| S-03 | No security headers (CSP, frame-ancestors, nosniff, HSTS, Referrer-Policy) | Code | Medium | Medium | Low |
| S-04 | Alliance admins can change the global display name of any member, incl. global admins | Reproduced | Medium | Medium | Low |
| P-03 | Notifications computed per member and per channel (push and Discord twice) | Code | Medium | Medium | Medium |
| B-03 | Admin universe update not atomic (400 after part of it was saved) | Reproduced | Low | Medium | Low |
| B-04 | Settlement edits have no revision (last write wins), `done` takes any key | Code | Medium | Low | Low–Medium |
| S-05 | `flightCalculatorUrl` not validated (any type, `javascript:` accepted) | Reproduced | Low | Low | Low |
| S-06 | Login limit only per IP; `TRUST_PROXY=1` default trusts the client without a proxy | Code | Medium | Low | Low |
| S-07 | Recovery links 30 days; no session list; login keeps the old session | Code | Low | Low | Low |
| P-04 | Parse, gzip and big transactions on the event loop (A-06, now with numbers) | Measured | Medium | Medium | High |
| P-05 | Presence filter queries the DB once per connected client per event | Code | Low | Medium | Low |
| P-06 | New worker + WASM compile per simulation; workers without memory limit | Code | Low | Low | Low |
| P-07 | No lifecycle for ended universes: data kept forever, single DB file grows | Code | Medium | Low | Medium |
| B-05 | Older overview/planet/empire pages count as "new" (credits, live events, duplicates) | Code | Low | Medium | Low |
| B-06 | Changing a member's in-game name skips the uniqueness check of adding | Code | Low | Low | Low |
| B-07 | Admin list of syncs parses up to 200 stored pages synchronously on first view | Code | Low | Low | Low |

---

## What is in good shape

- **Group isolation** is enforced in one place (`groupContext` / `resolveGroup`) and guarded by a test over all SQL
  (`test/groupScope.test.ts`). The routes reviewed for IDOR (plans, fleets, enemy side, settlements, claims,
  comments, imperium, players, export, optimize jobs) all scope by `group_id` and check the actor (creator, admin,
  participant) consistently.
- **Write guard** in one `preHandler`: cross-origin writes, read-only tokens and writes to a universe that has not
  started or has ended are refused centrally; opt-outs are explicit (`allowToken`, `allowEnded`, `allowBeforeStart`,
  `tokenWrite`). Token management needs a cookie session.
- **Auth:** scrypt off the event loop for logins, equal cost for unknown users and placeholders, attempts counted from
  their start, tokens/sessions/invites stored as SHA-256, password change and recovery revoke tokens.
- **SSRF closed:** push endpoints only to an allow-list of push services (no ports, userinfo, IPs), Discord only to
  Discord's webhook URLs, the crawler only to the admin-set game URL; Discord calls have timeouts.
- **Injection:** all SQL is parameterized (dynamic column lists come from code, not input); CSV export neutralizes
  formula cells; the web app has no `v-html`/`innerHTML`, login redirects stay in-app (`safeNext` + `router.replace`).
- **Data integrity:** older galaxy views and spy reports never overwrite newer states, syncs for another member cannot
  replace their own pages, build-order writes check a revision inside the transaction.
- **Indexes:** every hot lookup of the ingest path (dedupe keys, `sameContent`, `newestAt`, score history, snapshots per
  member, crawler queue) has a fitting index; `pragma optimize` runs in the housekeeping.
- **Game ports verified:** `@pr0hub/flight`'s distance (incl. ring galaxies/systems and the "sphere" types), ship speed
  per drive, mission duration and fuel consumption are formula-identical to `FleetFunctions.php`; `@pr0hub/battle`'s
  `steal` is identical to the simulator branch of `calculateSteal.php` (see F-02 for the non-simulated branch).
- **Supply chain:** lockfile installs, Dependabot, `pnpm audit --prod` clean, Battlerust pinned to a commit, the image
  runs as `node` with a health check.

---

## 1. Security

### S-01 Quadratic tag-stripping regex: any member can block the hub (High)

**Found:** Reproduced. **Where:** `apps/server/src/ingest.ts:110` (`stripTags`), `apps/server/src/routes/ingest.ts:74`,
`apps/server/src/repo/samples.ts:19` (`anonymizePage`).

`/<[^>]+>/g` is quadratic on input with many `<` and no `>`: from every `<` the engine scans to the end of the string
before it fails. `/<(script|style)[\s\S]*?<\/\1>/gi` is quadratic on many unclosed `<script>` tags. Both run on the
main thread for a page without records (`pageType === 'unknown'`), **also with `dryRun`**, and on every parser sample.

| Payload (HTML) | `/ingest` with `dryRun` | `/ingest/sample` |
|---|---|---|
| 50 KB of `<` | 1.17 s | 1.07 s |
| 100 KB of `<` | 4.73 s | 4.40 s |
| 1 MB (extrapolated, ×100) | ≈ 8 min | ≈ 7 min |
| 8 MB body limit (extrapolated) | ≈ 8 h | (4 MB sample cap) ≈ 2 h |

`<script>` × 40,000 (320 KB) needs 2.3 s in the first regex alone. While it runs, nobody gets an answer, the event
streams stop and the notification ticks wait. The per-user rate limit (120/min) does not help: one request is enough.
Any member of any group can trigger it (cookie session; read-only tokens are refused for POST).

**Fix:**

1. Linear patterns: `/<[^<>]*>/g` (a `<` ends the attempt) and a scan with `indexOf` for `<script`/`<style` …
   `</script>` instead of the lazy backreference, or reuse the cheerio document the parser already built
   (`$('script,style').remove(); $.text()`).
2. A regression test per function: 1 MB of `<`, 1 MB of `<script>`, must finish in < 200 ms.
3. Structurally: A-N1 (parse in a worker with a time limit), so the next super-linear pattern costs one worker, not the
   hub.

### S-02 Quadratic spy-report header regex in the parser (High impact, Medium risk)

**Found:** Measured. **Where:** `packages/parser/src/parsers/messages.ts:37`.

`(?:Spionagebericht …|Spy report from …)\s*(.*?)\s*\(([^()]*)\)\s*\[(\d+):…` has an unbounded lazy `(.*?)` before
the planet name in brackets. On a text paste with many header starts and no closing pattern, every start scans the rest
of the line:

| Text of `"Spionagebericht von "` × n | Time of `parsePage` |
|---|---|
| 80 KB | 0.43 s |
| 160 KB | 1.56 s |
| 320 KB | 6.20 s |
| 640 KB | 26.6 s |

This runs in the normal `/ingest` path. The fuzzing of the other anchors (fleet, missile, recycle, marketplace, combat
report, phalanx, galaxy, statistics, messages; 10,000 repetitions each, text and HTML) found no other case above 300 ms.

**Fix:** bound the group to what a planet name can be: `([^()\n]{0,60}?)`. Add a parser fuzz test (I-01) that
repeats every anchor regex's literal prefix 10,000 times and fails above a time budget, so a new parser cannot bring it
back.

### S-03 No security headers (Medium)

**Found:** Code. **Where:** `apps/server/src/app.ts` (no `onSend` header hook; nothing in the repository sets
`Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`,
`Strict-Transport-Security`).

Whether the private deployment's proxy sets them cannot be told from here. Without them: the admin and member pages can
be framed (clickjacking of one-click actions like "remove member", "finalize settlement", "delete sync"); there is no
second line of defense if an XSS ever lands (the tools' `t()` does not escape interpolations, C-09; S-05 shows a
`javascript:` URL can reach an `href`).

**Fix:** set them in the app, so every deployment has them (the image is public): an `onSend` hook with
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`; for the SPA's HTML a CSP
such as `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (check the web
app's inline styles and the service worker); HSTS when `SECURE_COOKIES` is on. A test in `test/static.test.ts`.

### S-04 Alliance admins can rename any member everywhere, including global admins (Medium)

**Found:** Reproduced. **Where:** `apps/server/src/routes/admin.ts:490-496` (`PUT /api/admin/groups/:id/members/:userId`
with `displayName`).

The display name lives on `users` and is shown in **every** alliance of that user (online list, comments, mentions,
Discord). The route only checks that the target is a member of the admin's group. Reproduced: an alliance admin set the
display name of the hub owner (a global admin) to "Impostor" → 200. A group admin of alliance A can thereby change how a
member appears in alliance B of another universe, or make someone look like the hub admin.

**Fix:** allow it only for placeholders (no account yet) and only when the actor is admin of all the target's groups
(`adminOfAllGroups`, already used for claim links), never for global admins; members with an account set their own name.
Alternative: a per-membership display name.

### S-05 `flightCalculatorUrl` is not validated (Low)

**Found:** Reproduced. **Where:** `packages/parser/src/universe.ts:228-240` (`URLS` has `gameUrl` and `pr0planUrl`,
not `flightCalculatorUrl`; the key has no default, so its type is not checked either).

The admin form accepts an object or `javascript:alert(1)//` (both 200). The value becomes the base of tool links in the
web app (`apps/web/src/format.ts:261, 337, 415–433`, rendered as `href`) and of `toolsLink` in the battle API, where a
non-string throws (500). Admin-only, but a compromised admin account becomes stored XSS for every member.

**Fix:** add it to `URLS` and require a string; a test in the universe settings suite.

### S-06 Login throttling only per IP; proxy trust default (Low–Medium)

**Found:** Code. **Where:** `apps/server/src/routes/auth.ts:46-63`, `apps/server/src/config.ts:21`.

Failed logins count per IP+username (10) and per IP (30) in 15 minutes. A distributed guess against one username is not
limited at all (scrypt is the only brake). `TRUST_PROXY` defaults to `1`: correct behind exactly one proxy, but a hub
run **without** a proxy then takes the client's own `X-Forwarded-For` as its IP, and the client picks the key the
limit counts.

**Fix:** a per-account soft limit across IPs (growing delay, not a lockout, to avoid locking members out on purpose);
log a warning at start when `TRUST_PROXY` is a hop count and requests arrive without `X-Forwarded-For`; state in the
README that a hub without a proxy needs `TRUST_PROXY=false`.

### S-07 Session hygiene (Low)

**Found:** Code. **Where:** `apps/server/src/routes/admin.ts:81` (claim/recovery links 30 days),
`apps/server/src/auth.ts:156` (`createSession`).

Recovery links for existing accounts reset the password and stay valid 30 days. Sessions last a fixed 30 days and the
user cannot see or end their other sessions (only a password change ends them). Logging in while a session cookie is
present leaves the old session row valid until it expires.

**Fix:** recovery links 72 h (claim links for placeholders may stay long); delete the old session in `createSession`
when the request carries one; a session list with "end" in the account page (F-06).

---

## 2. Performance

### Measurements

Synthetic group (see Method), in-memory SQLite, one request at a time, median of 3, uncompressed. Endpoints under 10 ms
are left out (browse, players, ranking, inactivity-check, activity, alliance-health, notifications, threats,
free-positions, search, debris-fields, sync-hints, spy-reports, galaxy-views, context, achievements: 0–7 ms).

| Endpoint | Time | Answer | Where the time goes |
|---|---|---|---|
| `GET /overview` | **1,325 ms** | **6,450 KB** | 3 × score history (235 ms), inactivity (≈380 ms SQL + JS), stall query (138 ms), JSON |
| `GET /farm` | **1,079 ms** | 2,265 KB | inactivity (≈350 ms SQL + JS) |
| `GET /goals` | **882 ms** | < 1 KB | inactivity |
| `GET /recap` | **719 ms** | 1 KB | inactivity |
| `GET /players/:id` | **672 ms** | 21 KB | inactivity of **all** players for one |
| `GET /stats` | 175 ms | 661 KB | stall window query (127 ms) |
| `GET /colonize` | 142 ms | 360 KB | JS over all planets |
| `GET /export` (JSON) | 81 ms | 3,137 KB | — |
| `GET /universe-json` | 42 ms | 1,297 KB | — |
| `POST /universe-json` (1 MB, first / again) | 159 / 211 ms | — | parse + store (fine) |

A real server is slower than this machine and the file-backed database slower than `:memory:`; every millisecond here
blocks all other requests, because the hub is one Node process with one synchronous SQLite connection.

### P-01 Inactivity is recomputed per request, for all players (High)

**Found:** Measured. **Where:** `apps/server/src/repo/inactivity.ts:411-428` (`inactivities`, cache per
`GroupContext`, i.e. per request), `statSeries` (`:253`), `lossesSince` (`:300`); callers `routes/overview.ts:147`,
`routes/players.ts:242`, `repo/farm.ts:237`, `repo/goals.ts:149`, `repo/inactivityCheck.ts:119`.

`compute` reads the whole window of `2 × inactiveDays` (14 days by default ≈ 336k score rows in the test) twice
(`GROUP BY player_id, stat_time ORDER BY stat_time` needs a temp B-tree) and then, per update and per gaining player,
builds the median of ±25 ranks with `slice().filter().map().sort()`. The result depends only on synced data and `asOf`,
yet it is thrown away after every request; `/players/:id` computes 2,000 players to show one.

**Fix (in this order):**

1. Cache the data part per group and data version (A-N2): `statSeries`, `lossesSince`, `galaxyMarks`, `spyHistory`
   and `provenActivity` change only when statistics, spy reports, galaxy views or activity are synced; only
   `inactivityOf(…, asOf)` needs the current time. Invalidate on the data events the bus already publishes.
2. Compute the rank-window medians once per statistics update at ingest (they never change afterwards) or with a
   sliding window instead of a sort per player.
3. Add `(type, stat_time)`-ordered access: with the cache this matters less; otherwise an index
   `player_scores(type, stat_time, player_id, points, rank)` lets the window scan skip the join through `players`.

Expected: the five endpoints drop by 350–700 ms each; the benchmark of I-02 shows it.

### P-02 The overview payload and its reload storm (Medium)

**Found:** Measured (size and time), Code (reload). **Where:** `apps/server/src/routes/overview.ts:87-…`,
`apps/web/src/views/OverviewView.vue:164`.

`/overview` sends every player with their score history (6.4 MB uncompressed for 2,000 players; brotli brings it down,
but the server still builds and compresses it). Each open overview reloads it 3–4.5 s after any paste with statistics,
galaxy, spy, player or fleet data (`useLiveReload(…, 3000)` with 1.5 s jitter; hidden tabs wait, which is good). Ten
members with the overview open turn one paste into ≈13 s of blocked event loop within a few seconds.

**Fix:** P-01 first. Then an `ETag` from the group's data version (A-N2) so unchanged reloads cost a 304; split the
static part (names, alliances, planets) from the score columns; only send the score columns the table shows (the Δ
windows), and paginate or virtualize as planned in backlog G-7.

### P-03 Notifications: group-wide work per member and per channel (Medium)

**Found:** Code. **Where:** `apps/server/src/repo/notifications.ts:214-222` (`notificationsFor`),
`apps/server/src/push.ts:240-278` and `apps/server/src/discord.ts:208-261` (`deliver`), `apps/server/src/notify.ts`
(`AlertSchedule`, one per service).

`notificationsFor(ctx)` is called for every member with a device and again for every member with a webhook. Parts of it
are the same for the whole group: `attacks()` walks the fleet lists of **all** members, `settlements()` builds all
finalized settlements, `phalanxes()` reads the group's spy reports. A delivery runs after every relevant data event
(2 s debounce) and on the ticks. Both services also keep their own `AlertSchedule` and compute `plan()` (storage
watchers, next storage full, next expedition slot, next alert) twice.

**Fix:** one notification engine per delivery (A-N3) that computes the group-level lists once (memo by group and `t`)
and derives the per-member lists from them; push and Discord consume the same result and share one schedule.

### P-04 Parse and store on the event loop (Medium, carried over A-06 with numbers)

**Found:** Measured. **Where:** `apps/server/src/ingest.ts` (`parsePage`, `gzipSync` inside the transaction),
`apps/server/src/routes/admin.ts` (`/ingests` summaries, `/units/parse`, backfill), `crawler.ts`.

universe.json is not the problem it was feared to be (1 MB: 160 ms). The real risks are the super-linear cases (S-01,
S-02) and large HTML pages: every paste is parsed by cheerio and gzipped synchronously while the DB transaction is
open. **Fix:** A-N1.

### P-05 Presence filter: one query per connected client per event (Low)

**Found:** Code. **Where:** `apps/server/src/routes/events.ts:15-17`, `apps/server/src/repo/presence.ts:22-38`.

`publishPresence` calls `presenceForViewer` for every connection; each runs `SELECT … WHERE id IN (…)` with a list of
varying length (a new statement in the cache per length). The hidden/quiet sets are the same for every viewer.
**Fix:** compute the sets once per publish and filter in memory per viewer.

### P-06 Workers (Low)

**Found:** Code. **Where:** `apps/server/src/battle.ts:247-270`, `apps/server/src/optimize.ts:207`.

Every simulation starts a new worker that reads and compiles the WebAssembly module (tens of ms each); no worker has
`resourceLimits`, so a 300-second optimizer job on a huge build order can take as much heap as the main process.
**Fix:** a small pool (or pass a compiled `WebAssembly.Module` in `workerData`), and
`resourceLimits: { maxOldGenerationSizeMb }` on both kinds of workers.

### P-07 No lifecycle for ended universes (Medium impact, Low risk)

**Found:** Code. **Where:** no `DELETE FROM universes|groups` anywhere; `monitor.ts:239-246` prunes only raw syncs,
sessions, `player_activity` and `member_online`.

Score history, activity log, reports and snapshots stay forever, also for universes that ended rounds ago. One
SQLite file keeps growing; `VACUUM` blocks the hub and needs the file's size again on disk. **Fix:** F-07 (archive
as export, then purge a universe or group), plus a retention for `activity_log` of ended universes.

---

## 3. Bugs

### B-01 Web push has no timeout and the ticks overlap (High impact, Medium risk)

**Found:** Code (the `timeout` option exists in `web-push` 4.0.0 and is not passed). **Where:**
`apps/server/src/push.ts:118-125` (`webPushSender`), `push.ts:185` and `discord.ts:165` (`setInterval` without a
running flag), `push.ts:277` / `discord.ts:260` (sequential `await` per target).

A push service that accepts the connection but does not answer keeps `sendNotification` waiting until the OS gives up
(minutes). `deliver` awaits targets one by one and `tick` groups one by one, so every group after it waits: launch
reminders and attack warnings arrive late. Thirty seconds later the next tick starts anyway and runs in parallel (the
`push_sent` mark prevents duplicates, but the work piles up). Discord has timeouts (10/30 s) but can wait up to 10 s
per rate limit inside the same sequential loop.

**Fix:** `timeout: 10_000` in `sendNotification`; a `ticking` flag (skip a tick while the previous one runs); send per
group with a small concurrency (e.g. 4) instead of strictly one after another. A test with a sender that never resolves.

### B-02 Notifications are marked as sent before they are sent (High impact, Medium risk)

**Found:** Code. **Where:** `apps/server/src/push.ts:266` and `:296-307` (`sendSub` logs and returns false on errors
other than 404/410), `apps/server/src/discord.ts:235` and `:252` (`mark.run` before `send`).

The mark is written first on purpose (an event delivery and a tick must not both send). But when the send then fails
with a 5xx, a 429 beyond the one retry, a timeout or a network error, the mark stays and the notification is never tried
again. For an attack warning this is a silent miss, exactly when the push service or Discord has a hiccup.

**Fix:** keep "mark first", but remove the mark (or store the item in an outbox with a retry count) when the send fails
transiently and the notification is still current; retry on the next tick. At least for `attack`, `launch` and `fleet`.
Show the last failure per device/webhook in the account page (F-05).

### B-03 The admin's universe update is not atomic (Low)

**Found:** Reproduced. **Where:** `apps/server/src/routes/admin.ts:151-195` (deck validated at `:180`).

Settings are validated and written, `followUniverse` retimes the plans, and only then is the deck validated. A request
with valid settings and an invalid deck answers 400 – reproduced: `fleetSpeed` was saved anyway. **Fix:** validate
everything first (settings, deck, schedule, name length), then run all writes in one `db.transaction`.

### B-04 Settlements: no revision, any key can be ticked (Medium impact, Low risk)

**Found:** Code. **Where:** `apps/server/src/routes/settlements.ts:205-218` (PUT), `:281-298` (`done`).

Several participants edit the same settlement; the PUT overwrites what another member saved meanwhile (last write
wins, unlike build orders, which have revisions and a conflict dialog). `PUT …/settlement/done` adds any string up to
140 characters with a `>` as done, also keys that are no delivery of the settlement. Finalize writes in two statements
outside a transaction. **Fix:** a revision column and `WHERE revision = ?` like build orders, the web app's conflict
dialog; accept only keys of the finalized deliveries; one transaction for finalize.

### B-05 Older pages count as new (Low)

**Found:** Code. **Where:** `apps/server/src/store.ts:878` (`overview`), `:905` / `:922` (`shipyard`, `planetPage`),
`:531` (`empire`).

An overview, buildings, research or shipyard page older than the stored one is inserted, immediately deleted by the
"keep the newest" statement, and still counted as new: the member gets a sync credit (`countSync`), the others a
live event and reload, and the build order/plans are "caught up" for nothing. The same empire page pasted twice is kept
twice for a week (no dedupe). **Fix:** compare the page time with the newest stored one first and count it as
duplicate when it is not newer; skip an empire page whose `created_at` and `data` equal the newest.

### B-06 Renaming a member's in-game name skips the uniqueness check (Low)

**Found:** Code. **Where:** `apps/server/src/routes/admin.ts:482-488`. Adding a member refuses a second member with the
same in-game name; changing it does not. Two members with one name confuse `linkIngameName`, mentions and the member
↔ player mapping. **Fix:** the same check as in the POST.

### B-07 The admin's list of syncs parses stored pages synchronously (Low)

**Found:** Code. **Where:** `apps/server/src/routes/admin.ts:606-629`. On the first view, every listed sync (up to 200)
without a content description is gunzipped and parsed on the event loop; with large pages (or S-01/S-02 payloads) the
admin page blocks the hub. **Fix:** describe only a page or two per request, or move it to A-N1's worker.

---

## 4. Architecture (new)

### A-N1 Parse in a worker pool with a time limit

Parsing is pure (string in, records out) and the expensive, input-dependent part of a sync. Run `parsePage` (and the
gzip of the raw page) in a small worker pool with a per-job timeout; keep `Store` and the transaction on the main
thread (one connection). This turns any future super-linear parser case from "hub down" into "this paste failed",
removes P-04 and most of the carried-over A-06, and is a natural home for B-07 and the admin's reparse/backfill.
Prerequisite: the parser must take its unit catalog as a parameter everywhere (today `withUnits` sets a module global,
and `registerUnitNames` merges the names of all universes into one global table, see A-N5). **Effort:** Medium–High.

### A-N2 A data version per group

Today derived data has no notion of "unchanged". The event bus already sees every data event per group with its
tables. A `groupVersion(groupId, tables)` counter bumped in `events.publish` gives a cache key for P-01 (inactivity),
P-02 (`ETag` for overview, stats, farm), P-03 (notification memo) and the recap/goals. In-memory is enough for one
process (the review of 2026-11-04 decided against a multi-instance bus). **Effort:** Medium.

### A-N3 One notification engine, a reliable outbox

Push and Discord duplicate `deliver`, `tick`, `AlertSchedule`, quiet-hour holding and flushing. One engine that
computes per delivery "who gets what" once (P-03) and an outbox table (`notify_outbox`: target, item, attempts,
next_try) that both senders drain would fix B-01/B-02 in one place and make delivery observable (F-05). **Effort:**
Medium.

### A-N4 Lifecycle and retention as a concept

There is housekeeping per table, but no concept for the life of a universe (announce → running → ended → archived →
deleted) and of a group. Make "archived" a state: read-only, excluded from ticks and crawler, data exportable, then
purgeable (P-07, F-07, backlog G-5 privacy self-service). **Effort:** Medium.

### A-N5 Module-level mutable state

`withUnits`/`setActiveUnits` (active catalog), `EXTRA_NAMES` (unit names of all universes in one table; two universes
that rename the same unit id differently overwrite each other), the throttle maps and the crawler state are module
globals. Fine for one synchronous process, but they block A-N1 and make tests order-dependent. Pass the catalog
explicitly (the parsers already accept `units`) and key name tables by catalog. **Effort:** Medium (incremental).

---

## 5. Improvements and features

### Improvements

| ID | Improvement | Why | Effort |
|---|---|---|---|
| I-01 | **Parser fuzz test in CI:** every anchor regex's literal prefix × 10,000 (text and HTML), plus `<`/`<script>` floods, with a time budget | Catches S-01/S-02-type regressions; cheap | Low |
| I-02 | **Benchmark fixture:** the synthetic group of this review (universe.json generator, 30 days of statistics, spy reports) as `pnpm --filter @pr0hub/server bench`, printing the endpoint table | Makes P-01/P-02 measurable before/after; guards backlog G-7 | Low |
| I-03 | (carried over) DX: packages must be built first; tools JS outside `tsc` | see section 6 | Low–Medium |
| I-04 | **CI hardening:** pin GitHub Actions to commit SHAs and base images to digests (Dependabot can update both), add `pnpm audit --prod` as a step | The image is public and pulled by the deployment | Low |
| I-05 | **Event-loop budget alarm:** the system monitor already samples loop p99/max; log a warning (and optionally notify global admins) when p99 exceeds e.g. 200 ms in an hour, with the slowest routes | Turns P-01/S-01 kinds of problems into visible signals | Low |

### Features

Checked against the backlog in `NEW_FEATURES.md` (no duplicates of its open items C-2, C-3, C-4, D-2, D-3, D-5, F-2,
F-4, F-5, B-5, B-7, G-2, G-3, G-5, G-6, G-7). Ideas from the game's source are marked with the file they come from.

| ID | Feature | Value | Effort |
|---|---|---|---|
| F-01 | **Rebuild protection tracker** (`CheckRebuildProtection.php`, `GeneralFunctions.php::CheckNoobProtec`). A player who loses more than 70 % of their units (or 80 % of their cargo capacity) and more than `noob_protection_time × 1000` in one battle gets rebuild protection: for 48 h they count as "weak" for attackers, from 3 h after the battle for others and 6 h for the attackers of that battle; once a month. The hub derives weak/strong only from points. From the combat reports and the battle hall it can mark targets "probably protected until …" in the farm finder, raid planner and attack assistant, and tell a member about their own protection and its monthly lock. Needs a universe setting (`rebuild_protection` on/off). | High for raiders (no wasted flights) | Medium |
| F-02 | **Realistic loot outside the simulator** (`calculateSteal.php`): with the module *resource stash* the game protects up to 10 % of a day's production (1 % per storage level) from theft, and the honour points can lower the loot. The hub uses the simulator branch (neither) for the farm finder, raid risk and attack assistant. A universe setting plus the production and storage levels the hub already estimates make the expected loot honest for big producers. | Medium | Low–Medium |
| F-03 | **Repair dock / wreck fields** (`GenerateWreckField.php`, `ShowRepairdockPage.php`): with the module, destroyed defender ships go to a wreck field and can be repaired. Fleet estimates after a battle (threats, farm targets, `battleFleet`) undercount the defender for a while. Show "may repair up to …" from the report (verify what the report shows first). | Medium | Medium |
| F-04 | **Inactivity changes as a feed**: once P-01 caches per statistics update, the hub can log "now probably inactive" / "active again" transitions into the activity log and, opt-in, notify farmers. Builds directly on B-3. | Medium | Low (after P-01) |
| F-05 | **Delivery health**: per push device and webhook the last success and last failure (the column `last_ok_at` exists), a warning in the account page and the bell when a device has failed for a day, "resend test". Together with B-02's retry. | Medium (trust in warnings) | Low |
| F-06 | **Account security self-service**: list of sessions and API tokens with last use and "end", optional TOTP for global admins, and an **audit log** of admin actions (role and name changes, removals, claim links, undo of syncs, universe edits) visible to global admins and, for their group, to alliance admins. | Medium | Medium |
| F-07 | **Round lifecycle**: archive an ended universe (read-only, JSON export per group like `/export`), purge it later; carry members, roles and build-order templates over to the next universe's alliance in one step (complements G-6). | Medium (operations, privacy) | Medium |
| F-08 | **Collaborative settlement**: revision and conflict dialog (B-04), per-delivery "received" confirmation by the receiver, a reminder after N hours for open deliveries. | Medium | Low–Medium |
| F-09 | **Paste guard in the web app**: before sending, reject what cannot be a game page (size, ratio of `<` to text, no known marker), with the explanation codes of E-4; complements S-01 on the client side. | Low | Low |

Suggested order among the open backlog items, given the data the hub already has: **F-05** and **F-01** first (trust in
warnings, fewer wasted raids), then backlog **D-2 War dashboard** and **F-5 Daily digest** (both reuse recap, threats and
battle data), then **F-02/F-03** for accuracy.

---

## 6. Carried over from earlier reviews (still open, re-checked 2026-11-20)

### Architecture

| ID | Finding | Evidence now | Impact | Risk | Effort | Fix |
|---|---|---|---|---|---|---|
| A-01 | OpenAPI is hand-written | Contract test validates every 2xx JSON answer; 41 answers still `type: object` (`MAX_UNDESCRIBED` 41); spec 8.3k lines | High | Low | Low–Medium | Describe the rest when an endpoint is touched |
| A-03 | Group isolation is convention plus a grep test, not an API | `groupScope.test.ts` green; no `GroupDb` | High | Medium | High | `GroupDb` injecting `group_id` when a repo is touched anyway |
| A-05 | Route / repo / domain split uneven | `store.ts` 1,034, `routes/plans.ts` 820, `routes/admin.ts` 730 lines | Medium | Medium | High (incremental) | Writes next to their repos; routes = auth + `groupContext` + HTTP |
| A-06 | One synchronous SQLite connection, heavy work on the event loop | Now quantified: S-01/S-02, P-01, P-04; universe.json itself is fine (160 ms/MB) | High | Medium | High | A-N1 (parse worker) + A-N2 (caches); keep one connection |
| A-08 | `@pr0hub/core` is a kitchen sink in a folder called `parser` | Root barrel still `export *` | Medium | Low | Low | Prefer subpath imports; stop growing the barrel |
| A-10 | Tools and hub share math, not UI or settings | Auto plan UI twice, unit editor twice, three share-hash dialects | High (velocity) | Medium | Medium–High | Shared hash module; typed tool `TEXTS`; shared unit-editor fields |

### Clean code

| ID | Finding | Evidence now | Fix |
|---|---|---|---|
| C-01 | God files | `store.ts` 1,034, `AdminView.vue` 1,064, `OverviewView.vue` 884, `locales/de.ts` 3,596, `test/api.test.ts` 2,019 | Split when touching (store by ingest kind, AdminView by tab, locales by namespace) |
| C-02 | Hand-written API answer types | `MAX_HAND_WRITTEN` 82 | Replace when a view is touched |
| C-03 | SQL rows and JSON columns untyped | `SELECT *` + casts; `JSON.parse(...) as` | Typed row interfaces; one `parseJson<T>` (the `Store` has one privately) |
| C-04 | Mixed snake/camel case on the wire | unchanged | camelCase at the boundary when an endpoint changes |
| C-05 | Several text pipelines, two compact-number formats | `push.ts` `short()` vs. web formats | Shared compact numbers and mission labels from core |
| C-06 | `format.ts` / `composables.ts` kitchen sinks | unchanged | Split by concern |
| C-07 | Duplicated catalogs and unit-role sets | unchanged | Unit roles as catalog flags |
| C-08 | Four validation styles | unchanged; S-05 and B-03 are symptoms | Schemas on the token surface; validate-then-write helper |
| C-09 | Tools UI untyped; `t()` does not escape | unchanged (S-03 would contain it) | `checkJs` on `shared/*.js`; escape in `t()` |
| C-10f | Two short-name tables in the parser | unchanged | Catalog as the one source |
| C-11 | Test structure | `api.test.ts` 2,019 lines; heavy views without tests | Split by domain; Overview/Admin smoke tests |

### Improvement

| ID | Finding | Fix |
|---|---|---|
| I-03 | Packages must be built before web/server; tools JS outside `tsc` | Workspace "source" condition or `dev` watch; `checkJs` |

---

## 7. Theoretical and hardening items

### New in this review

| ID | Issue | Why theoretical |
|---|---|---|
| T-1 | Registering a push endpoint that already exists moves it to the caller (`ON CONFLICT (endpoint) DO UPDATE SET user_id`): whoever knows a member's endpoint URL can take over (and break) their notifications | Endpoints are unguessable capability URLs known only to the browser and the hub |
| T-2 | The public access-request form allows 100 open requests in total: an attacker rotating IPs (5 per IP and hour) can fill it and block real requests | Needs many IPs; global admins see and delete requests |
| T-3 | The login failure map only sweeps expired entries above 10,000 keys; rotating IPv6 addresses can grow it for 15 minutes at a time | Entries are tiny; bounded by the window |
| T-4 | Universe settings have no upper bounds for `galaxies`/`systems`/`positions`; loops over the whole universe (colonize, browse, free positions) grow with them | Admin-only input |
| T-5 | `GET /api/admin/groups/:id/ingests` writes summaries during a GET | Only admins; idempotent |

### Carried over (unchanged)

| ID | Issue | Why theoretical |
|---|---|---|
| R-T1 | A galaxy copy without any page time is stored as seen at the paste | Whole-page copies carry the clock |
| R-T2 | `researchState` counts a cancelled research as done until the next research/empire page | Documented; rare; self-correcting |
| R-T3 | A sync stores steps seen done without raising the revision | Deliberate (see "What not to do") |
| R-T4 | A write token can change the build order in every group of its user | Tokens are personal and opt-in |
| R-T5 | Free expedition slots scheduled only for members with an empire, buildings or research page | Slot count unknown otherwise |
| N-T1 | `Store.playerCard` may overwrite a slot kept for a destroyed planet in a viewed system | Home planets cannot be destroyed |
| N-T3 | `GET /browse/:g` loads the newest scores of every player in the galaxy | Measured 7 ms on the synthetic group |
| N-T4 | Quiet hours keep the device time zone of the last change | Visible in the UI |
| B-T1 | Invite check, then `UPDATE used_at` later | Synchronous handler, one process |
| B-T2 | Settlement `isFinal()` then write | Same |
| B-T3 | Login throttle in memory | One process; see S-06 for the real gap |
| B-T4 | CSRF allows a missing `Origin` | `SameSite=Lax`; no GET writes with effect |
| B-T5 | Crawler / hall poller fetch the admin-set game URL | Admin-only |
| B-T6 | scrypt string without N/r/p | Node defaults; rotation needs a format change |
| B-T7 | `GET /api/universes` returns every universe's settings | Intended for the picker |

---

## Areas not verified

- **Battle engine:** the WebAssembly build needs Docker (`pnpm build:battle`); the 15 battle tests and the battle
  parts of the tools were skipped, the simulator API, attack assistant, defense advisor and raid risk were reviewed as
  source only.
- **Planner and optimizer** (`packages/planner`, `optimize-worker.mjs`): tests read and green; the simulation was not
  compared with pr0plan's `GameReducer` in this pass.
- **Web app and tools in a browser:** source review only (no screenshots, no mobile check); live reload behaviour was
  read, not observed with several tabs.
- **Measurements** ran on an in-memory database on a fast machine with one request at a time; a production server
  with a file-backed database and concurrent requests will be slower. The shape (which endpoints are slow and why) is
  what matters.
- **Real push services and Discord**: delivery was reviewed in code; B-01/B-02 were not provoked against real services.
- **Deployment** (proxy headers, TLS, backups, hosts) is out of this repository by design; S-03 and S-06 depend on it.

---

## Recommended order

### Now (urgent, small)

| Order | ID | What | Effort |
|---|---|---|---|
| 1 | S-01, S-02, I-01 | Linear regexes in `stripTags`/samples and the spy header; fuzz test with a time budget | Low |
| 2 | B-01, B-02 | Push timeout, serialized ticks, un-mark on transient failure | Low–Medium |
| 3 | S-04, S-05, B-03 | Display-name permission, validate `flightCalculatorUrl`, atomic universe update | Low |
| 4 | S-03 | Security headers in the app | Low |

### Next (performance)

| Order | ID | What | Effort |
|---|---|---|---|
| 5 | I-02 | Benchmark fixture, to measure the next steps | Low |
| 6 | A-N2, P-01 | Group data version; cached inactivity data part | Medium |
| 7 | P-02 | `ETag`s, slimmer overview payload | Medium |
| 8 | A-N3, P-03, F-05 | One notification engine with an outbox; delivery health in the account page | Medium |

### Later (structure and features)

| Order | ID | What | Effort |
|---|---|---|---|
| 9 | A-N1, A-N5, P-04 | Parse worker pool; explicit unit catalogs | Medium–High |
| 10 | B-04, F-08 | Settlement revisions and receiver confirmation | Low–Medium |
| 11 | F-01, F-02, F-04 | Rebuild protection, realistic loot, inactivity feed | Medium |
| 12 | A-N4, P-07, F-07, F-06 | Universe lifecycle, archive/purge, session list and audit log | Medium |
| 13 | carried-over A/C items | When the files are touched (A-01/C-02 first) | — |

### What not to do

- Do not rewrite the SPA or the tools in a new framework.
- Do not add Postgres or a multi-instance event bus to solve P-01/P-02: the cost is recomputation, not the database;
  caches keyed by a group data version (A-N2) and a parse worker (A-N1) are enough for one process.
- Do not move `Store` (the writes) into workers: one connection that owns all writes is what keeps the ingest simple
  and consistent; only the pure parse goes off the loop.
- Do not "fix" S-01/S-02 with a smaller body limit alone: 100 KB already blocks for seconds; the patterns must be
  linear.
- Do not generate Fastify from OpenAPI; a path-drift check plus hand-written schemas on the token surface is enough.
- Do not rename `packages/parser` → `packages/core` together with other work.
- Do not add a foreign key from `notify_held` to `push_subscriptions` by a table rebuild; the triggers of migration
  088 are enough.
- Do not bump the build order's revision when a sync only stores steps seen done (R-T3).

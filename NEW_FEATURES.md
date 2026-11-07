# New Features and Improvements: Product Backlog

**Date:** 2026-11-06
**Perspective:** product management. What is missing that would give players and alliances clear value, and which
existing features could do more.
**Basis:** the hub as of `main` on 2026-11-06 (README, CHANGELOG, web views, server routes, parsers) and the game
source (`pr0game`: pages, missions, achievements, advanced stats).

## Implementation status

| Item | Status | Date | Where |
|---|---|---|---|
| E-1 What should I paste next? | Done | 2026-11-06 | sync page, overview, quick sync sheet |
| F-1 Global search (Ctrl+K) | Done | 2026-11-06 | every page of a universe (sidebar, mobile top bar) |
| B-1 Farm finder with projected resources | Done | 2026-11-06 | new menu item "Farm finder" under Combat & expeditions |
| B-3 Inactivity confidence | Done (second version) | 2026-11-06 | farm finder, overview, player details, check in the admin panel |
| A-3 Hostile phalanx exposure | Done | 2026-11-07 | My empire (section and marks), notifications (bell, push, Discord) |
| A-2 Fleet save planner | Done | 2026-11-07 | new menu item "Fleet save" under Combat & expeditions |
| A-1 Incoming attack assistant | Done | 2026-11-07 | page per attack, opened from bell, push, Discord and the raid planner |
| C-1 Upgrade advisor | Done | 2026-11-07 | Build & research: tab "Advisor", best next step in the buildings tab |
| D-1 Alliance health dashboard | Done | 2026-11-07 | new menu item "Health" under Alliance (every member) |
| F-3 Export | Done | 2026-11-07 | CSV buttons at the large tables, JSON under Account; API tokens work |

Each finished item carries a **Status** block below its description: what was built and how.

## Guardrails

Every idea below respects the project's rules:

- **Copy and paste only.** No userscripts, bookmarklets, extensions or endpoints for automated submission. Every
  proposal works with data that members paste, or with data the hub already has. Where a feature "tells the user
  what to do in the game", the user still does it by hand.
- **Group scope.** New data stays inside its group (`groupContext`), and private data (messages, fleets) keeps
  its per-member opt-in.
- **One game math.** New calculations go into the shared packages (`@pr0hub/flight`, `@pr0hub/battle`,
  `@pr0hub/loot`, `@pr0hub/planner`, `@pr0hub/core`) so the hub and the standalone tools give the same answers.

## Where the product stands

The hub is strong on **attacking and coordinating an alliance**: raid planner with second-exact ACS and retime,
loot settlement from reports, target claims, battle simulator on the game's engine, spy history, live presence,
notifications through bell, push and Discord. Economy is covered by the empire view, build/research timing and
pr0plan build orders.

The main gaps from a player's point of view:

1. **Defense is reactive.** The hub warns about an incoming attack, but does not help to answer the next question:
   *What do I do now?* (fleet save, hold by members, what can I save, will my defense hold).
2. **Farming relies on reading tables.** The overview has resources, distance and cargo counts, but no ranking by
   what a target is worth *now* (production since the report) and what it costs to hit.
3. **The economy shows the state, but gives no advice.** There is no "which upgrade pays off first".
4. **Leaders have little overview of the alliance's health** (who is falling behind, who no longer syncs, war
   balance against another alliance).
5. **Data cannot leave the hub** in a simple form (CSV, calendar), and there is no fast global search.

## How to read an item

| Field | Meaning |
|---|---|
| **Value** | High / Medium / Low: how many players benefit and how often |
| **Effort** | S (≤ 1 day), M (2–5 days), L (1–2 weeks), XL (more) |
| **Builds on** | what already exists and can be reused |

---

## A. Defense and survival

### A-1 Incoming attack assistant
**Value:** High · **Effort:** L · **Builds on:** hostile fleet notifications, phalanx paste, `@pr0hub/flight`
(recall, retime), `@pr0hub/battle`, raid planner (hold), empire page

When a hostile fleet heads for a member, the notification opens a page for this one attack:

- Countdown to impact, attacker, origin and mission (ACS included).
- **Will it hold?** A battle simulation of the expected attacking fleet (from the fleet shown in the movement,
  otherwise from the attacker's newest battle reports and spy data) against the planet from the latest empire page.
- **Fleet save options:** latest departure for a deploy or transport to the own moon or another planet, a recall
  window that brings the fleet back right after the impact, fuel per option.
- **Resources at risk:** the loot the attacker can take (cargo capacity, loot share) and how much the member should
  spend or send away.
- **Help from the alliance:** which members can reach the planet before the impact with a hold (ACS defend), with
  their latest launch time. One click creates a hold plan in the raid planner and pings those members.

Why: this is the moment where a hub decides whether a member loses a fleet. Today the member has to switch between
four tools.

**Status: done (2026-11-07).** How it was built:

- **Server:** `apps/server/src/repo/attackAssist.ts` on top of `hostileAttacks` (the attacks of the raid planner:
  members' fleet lists and phalanx results, ACS fleets as one attack). `GET /api/:uni/attack-assist` finds an attack
  by `key` (with `arrival` for waves) or by `member`, `arrival` (± 5 s) and `from` (what the bell knows), and returns:
  the attacked body from the member's newest empire page (units, resources projected to the impact with production up
  to the storages), the attacker's research (`spyEmpire`), the summed ships, the loot (`steal` of `@pr0hub/battle`),
  the member's bodies and research for the fleet save, helpers (other members' bodies whose slowest ship at 100 % lands
  1 s before the impact: latest launch, fleet points; strongest first), an open hold plan and the hostile phalanxes
  reaching the planet (A-3), and the hold fleets at the planet at the impact (`holdFleets`: per member's fleet list the
  hold flights to the body, outbound line landing before the impact and holding line ending after it; the same fleet
  in the sender's and the attacked member's list counts once; research from the owner's empire page; members' bodies
  holding are left out of the helpers). The battle runs 20 times in the battle worker (`runInWorker`, same throttle as the
  simulator API) with the attacking ships and the attacker's research against the planet's ships and defense plus the
  hold fleets; `sim=0` skips it, errors come back as `{ error }`. `getAttackAssist` in `openapi.yaml`, tests in
  `apps/server/test/attackAssist.test.ts`.
- **Web:** `AttackView.vue` at `/:uni/attack`: countdown, attacker, mission, ships and combat research; "Will it
  hold?", later renamed "Expected battle result": one line with the outcome (≥ 90 % of the runs, else uncertain) and
  the win shares, one with losses and debris, the hold fleets, and a link into the battle simulator (`battleSimLink`); resources at risk; fleet saves with
  `FleetSaveOptions.vue` (latest departure 1 s before the impact, at rest 1 s after it, incl. deploy + recall); help
  from the alliance: "Create hold plan" (`POST /plans/hold`), "Invite" per helper or all (`POST /plans/:id/fleets`,
  the member gets an invitation in the bell and by push). Cards instead of tables on mobile.
- **Entry points:** attack notifications in the bell, push and Discord open the assistant; the raid planner's
  detected attacks have "Open the attack assistant" in their menu. **Tour:** `attack`.
- **Follow-up (2026-11-07):** ships sent away from the planet after the empire page and not back by the impact are
  taken off (`sentAway`: the member's newest fleet list against the one up to the empire page; return lines matched
  by ships); when the movement shows no ships, the flying ships of the origin's newest spy report stand in
  (`attacker.estimated`).
- **Left for later:** the member's own fleet save reminder from the assistant.

### A-2 Fleet save planner (sleep and offline windows)
**Value:** High · **Effort:** M · **Builds on:** `@pr0hub/flight` (recall, duration), notifications, empire page

The member enters "I am offline from 23:30 to 07:15". Per planet the hub suggests a fleet save that lands or
returns at the wake-up time (deploy to own moon/planet, transport with resources, recycler to a debris field),
with speed setting, fuel and the exact departure. A push or Discord reminder fires a few minutes before the fleet is
back. Typical windows ("night", "work") are saved as presets.

**Status: done (2026-11-07).** How it was built:

- **Game math in `@pr0hub/flight`** (`fleetsave.ts`, shared with the attack assistant): `fleetSaveOptions` takes a
  fleet, its body, the own bodies as targets, the earliest (`now`) and latest departure and the time it must not be at
  rest before (`back`). Per target, mission (deploy: rest at arrival; transport: rest back home) and speed (10–100 %)
  it departs as late as needed to rest at `back` (never before now, never after the latest departure, timestamps
  floored like `flightTimes`) and keeps options that rest at `back` or later, sorted by lateness, then net deuterium.
  Fuel like ShowFleetStep3Page (charged once, takes cargo space); a deploy gets half back (MissionCaseStay). `recall`:
  deploy to the farthest own target at full speed and recall it (`recallFor`) so it lands home at `back`. Tests in
  `packages/flight/test/fleetsave.test.ts`.
- **Web:** `FleetSaveView.vue` at `/:uni/fleetsave` (menu "Fleet save"): offline from/until (time of day; a start up to
  6 h ago means "offline now"), presets in local storage ("Night" 23:30–07:15, "Work" 07:45–17:00 built in), deploy
  and transport switchable. Per own planet and moon with ships that can fly (newest empire page) the best three
  options of `FleetSaveOptions.vue` (more on request): mission, target, speed, departure with countdown, at rest from
  (lateness), deuterium (red above the body's projected deuterium), free cargo. Planets in reach of a hostile phalanx
  (A-3) get a hint to start from the moon. No new API: the page reads `/imperium`.
- **Reminder:** after sending, the member pastes the overview and sets the bell on the fleet in My empire (the
  existing fleet alerts, push and Discord included); the page says so.
- **Tour** `fleetsave`; **texts** `fleetsave.*`, `nav.fleetsave`; web tests in `apps/web/test/fleetsave-attack.test.ts`.
- **Follow-up (2026-11-07):** recycling as fleet save (`harvest`): with a recycler (209, optimized recycler 227) in the
  fleet, to a debris field the game lets recyclers fly to: it holds debris, or it is active (a battle left debris since
  the weekly `CleanerCronjob`, which marks all fields inactive; Saturday 02:45 by default, universe settings
  `debrisCleanup*`). Targets from `GET /api/:uni/debris-fields?g=`: `sure` when debris was created since the last
  cleaner run or seen after it; debris seen only before it is shown as unsure ("DF?"). Deduplicated by distance in the
  browser. Also in the attack assistant.
- **Left for later:** presets synced across devices,
  a reminder without pasting the overview.

### A-3 Hostile phalanx exposure
**Value:** Medium · **Effort:** S · **Builds on:** phalanx coverage in the galaxy browser, spy reports of moons

The galaxy browser shows which phalanxes reach a system. The reverse view is missing: **per own planet**, which
moons of other alliances can phalanx it, and since when that is known. Planets in reach are marked in the empire
and fleet save views ("fleet save via moon, a phalanx sees planet fleets"). A new known hostile phalanx in range
creates a notification.

**Status: done (2026-11-07).** How it was built:

- **Server:** `apps/server/src/repo/phalanx.ts`. `phalanxMoons` collects the known phalanx moons once for the galaxy
  browser and the exposure: the newest level per moon from the moon spy reports with buildings or the members' empire
  pages, with the report history; moons the galaxy shows destroyed since are left out (like the farm finder).
  `phalanxExposure` checks per planet of a member (`memberPlanets`: newest empire page, else the galaxy's planets of
  their player; moons are no phalanx targets) the moons of the same galaxy outside the own alliance (`alliance`:
  members, their players, their in-game alliances) like the game's `ShowPhalanxPage::allowPhalanx`: range
  `(level² − 1) × phalanx_range_factor`, level 1 reaches its own system, circular galaxies wrap around. **Since** is
  the oldest report of the newest run of reports whose level reaches the planet (`since`, game time; `known`: when that
  report reached the hub). The owner comes from the galaxy, else the report, with alliance tag and vacation mode (a
  player in vacation cannot use the phalanx; shown, not hidden).
- **API:** `GET /api/:uni/imperium` returns `phalanx` (planets in reach with their moons, nearest first); schemas
  `PhalanxExposure`, `PhalanxOwner`, `MemberPlanet` in `openapi.yaml`.
- **Notification** `phalanx` (`repo/notifications.ts`): one per moon with every planet of the viewer it reaches, while
  the report that brought the knowledge reached the hub within 24 hours (a report pasted late is new knowledge too);
  a later report bringing more planets in reach is a new one. Push and the personal Discord webhook send it (setting
  `phalanx`, default on; texts in `push.ts`), it opens My empire. Spy report syncs trigger the delivery now.
- **Web:** `ImperiumView.vue`: section "Hostile phalanx" (owner, moon with a link to the galaxy browser, level,
  distance of range, since), an eye with the moons as tooltip next to planets in reach (table and mobile cards); bell
  entry in `NotificationBell.vue`, the kind in the account's push and Discord settings. **Tours:** step
  `imperium.phalanx`. **Texts:** `imperium.phalanx*`, `notify.phalanx*`, `account.pushKind.phalanx`.
- **Galaxy browser:** its phalanx coverage now uses `phalanxMoons` (same data, destroyed moons left out).
- Tests in `apps/server/test/phalanx.test.ts` and `apps/web/test/imperium.test.ts`.
- **Left for later:** the marks in a fleet save view (A-2 does not exist yet); the phalanx moon's deuterium and the
  noob protection between the players (the game checks both) are unknown to the hub, so a listed phalanx may not be
  usable right now.

### A-4 Defense advisor: make a planet unprofitable
**Value:** Medium · **Effort:** L · **Builds on:** battle simulator, loot math, empire page, statistics

For a chosen planet: given the fleets of active attackers in range (from battle reports and fleet points), which
additional defense makes an attack cost more than it brings in (losses + fuel > loot + debris)? Output: a short
build list with costs and the expected profit of an attacker before and after. Also a "raid risk" score per own
planet in the empire view.

### A-5 Who threatens me
**Value:** Medium · **Effort:** M · **Builds on:** hostile spying, battle reports, statistics, flight math

A ranking per member of the players who spy on or attack them most often, with their fleet points trend, their
reachable planets (flight time to the member's planets) and the activity pattern (when they usually hit). Today the
data is spread across "Hostile spying", "Player details" and the activity log.

---

## B. Offense and farming

### B-1 Farm finder with projected resources
**Value:** High · **Effort:** M · **Builds on:** overview filters, spy reports (mines and storage visible),
`@pr0hub/core/production`, claims, battle simulator

A ranked list of targets by **expected loot now**: resources of the newest spy report plus production since then
(from the mine levels in the report, capped by the storage), minus the defense and fleet risk (quick simulation or
"no defense / no fleet" flags). Columns: loot per hour of flight, cargo ships needed, fuel, age of the report,
claim state, inactivity confidence (see B-3). Buttons: spy again, claim, open in the flight calculator or raid
planner.

Improvement over today: the overview shows the resources of the last report as they were. A report that is 10
hours old on a planet with high mines is worth far more than its numbers, and an inactive planet with full storage
is worth no more than the storage.

**Status: done (2026-11-06).** How it was built:

- **Game math in `@pr0hub/core/production`** (shared with the tools): `projectResources` adds the production since
  the report to its resources like the game's `ResourceUpdate` (mines, power plants and solar satellites with the
  energy factor, mining research, resource multiplier, basic income) and stops at the storage capacity
  (`storageCapacity` with the universe's storage factor); resources already above it stay. `positionTemp` takes the
  middle of the game's default temperature range of the position (`planet_data` in `install.sql`), since a spy report
  shows no temperature. `deriveResourceSpeed` finds the resource multiplier from the production per hour of synced
  empire pages when the universe setting is 0 (only planets with enough energy for the known levels count). Tests in
  `packages/parser/test/production.test.ts`.
- **Server:** `GET /api/:uni/farm?days=7` (`apps/server/src/repo/farm.ts`, `getFarmTargets` in `openapi.yaml`). Per
  spied planet or moon of a player outside the own alliance (members' players and the viewer's in-game alliance)
  with a report showing resources within `days` (1–30): the newest resources, the levels from the newest report with
  buildings, the player's newest research, fleet and defense from the newest reports showing them (units that fight,
  without solar satellites, spy probes and missiles, plus points), the expected resources now, production per hour,
  full storages, loot (half of each resource), the last battle and the inactivity (B-3). Moons keep the resources of
  the report (no mines); positions destroyed or owned by someone else since the report are left out. The response
  says where the resource multiplier comes from (`settings`, `empire` or `default` 1x). Tests in
  `apps/server/test/farm.test.ts`.
- **Web:** `FarmView.vue` at `/:uni/farm`, menu item "Farm finder" under Combat & expeditions. Flight time, ships
  and fuel are computed in the browser with `@pr0hub/flight` (`flightDuration`, `fleetConsumption`, the own drives
  from the empire) from the nearest own planet or a chosen start, for small or large cargo and a speed. The table is
  ranked by loot per flight hour (round trip), also sortable by loot, flight time, report age and inactivity; filters
  (remembered per device): report age, only probably inactive, without defense or fleet, vacation mode, targets
  claimed by others, minimum loot, galaxy. Tooltips show each resource, full storages, production per hour, report
  times and the risk details; the actions menu (`PlanetActions`) spies or attacks in the game by hand, opens the
  flight calculator and claims the target. Mobile: cards with a sort bar.
- **Tours:** new tour `farm` (ship and speed, report age, filters, loot, loot per hour, inactivity, risk, actions).
  **Texts:** `farm.*`, `nav.farm` and `tours.farm.*` in `de.ts`/`en.ts`.
- **Left for later:** a quick battle simulation per target instead of the defense/fleet flags, B-2 (spy priority
  list) on top of the same data, weighting the loot with the market rate.

### B-2 Spy priority list
**Value:** Medium · **Effort:** S · **Builds on:** B-1, spy history, galaxy freshness

Which targets are worth a probe now: high projected value and an old report, or a recent change in points
(defense or fleet built). Gives a member a short "spy these ten" list instead of browsing the galaxy.

### B-3 Inactivity confidence
**Value:** Medium · **Effort:** S · **Builds on:** points stall (`PointsStall`), activity pattern, galaxy
activity marks, fleet movements

The game's inactivity flags come late. Combine the signals the hub already has: points unchanged over several
statistics updates, no galaxy activity, no fleets seen, no messages. Show one score ("probably inactive since …")
in the overview, the farm finder and player details.

**Status: done (2026-11-06).** How it was built:

- **Server:** `apps/server/src/repo/inactivity.ts` with `inactivityOf` (pure scoring) and `inactivities` (one query
  for the group's players). Signals: the game's flag (`inactive` 95, `longinactive` 100, since the first inactive
  status in the status log), the points stall (no gain in total points across synced statistics updates, from
  `pointsStalls`: up to 85 after 3 days), and the newest activity the hub has seen (galaxy activity marks, fleet
  launches and recalls, reports by hand from `player_activity`, espionage on members from `hostile_spying`); activity
  after the last points gain caps the score at 15. Levels: inactive ≥ 85, likely ≥ 50, possible ≥ 20, otherwise
  active; unknown for players without current statistics. Exposed as `inactivity` (schema `Inactivity` in
  `openapi.yaml`) on `/overview` players, `/players/:id` and the farm finder's targets. Tests in
  `apps/server/test/farm.test.ts`.
- **Web:** `InactivityBadge.vue`: in lists a small badge with the score (tooltip: level, since when and the signals),
  in the player details a line of text. In the overview it replaces the points stall icon when it has something to
  say and the game does not flag the player yet; the farm finder has it as a sortable column and a filter.
- **Texts:** `inactivity.*` in `de.ts`/`en.ts`; tour step `farm.inactivity`.
- **Left for later:** fleets seen in members' overviews and messages as further activity signals (done in the second
  version below).

**Second version (2026-11-06).** The first version capped the score at 15 whenever a galaxy activity mark followed
the last points gain. The game sets that mark also when others spy on or attack the planet (`MissionCaseSpy` and
`MissionCaseAttack` call `ResourceUpdate::CalcResource` on the target, which sets `last_update`, the base of the
galaxy's activity), and the hub only filtered the members' own actions, so targets farmed by other alliances looked
active. The score was rebuilt as "latest sign of activity (`t0`), then the absence seen since":

- **Proof of activity** (`provenActivity`): the player as attacker in combat reports and the battle hall, espionage
  on members, messages a member synced (only those the viewer may see), fleet launches and recalls from members'
  overviews and phalanx scans, reports by hand; from the spy history a fleet that shrank between two reports without
  a battle at the planet (sent away; time: the earlier report).
- **Relevant points gains** (`statSeries`): per statistics update the gain of every player is compared with the median
  gain of the active players within ±25 ranks; a gain below 15 % of it is a build queue running out and doesn't count
  (`weakGains` in the reasons).
- **Absence since `t0`**: score = 94 · (1 − e^(−idle / 36 h)) (24 h ≈ 46, 48 h ≈ 69, 72 h ≈ 82); +4 per spy interval
  whose metal and crystal match the projection of the earlier report (`projectResources`, nothing else changed,
  at most +12); +5 when fleet or defense points were lost after `t0` and not rebuilt (category statistics); each
  galaxy mark after `t0` multiplies by 0.7 (down to 0.35) instead of capping. 95/100 with the game's flag.
- **Reasons**: `Inactivity.reasons` lists the signals (`flag`, `proven`, `gain`, `noGain`, `weakGains`, `galaxy`,
  `idleSpy`, `losses`); the tooltip of `InactivityBadge.vue` shows them in plain words.
- **Replay at a time** (`inactivities(db, ctx, ids, asOf)`): every query only uses data up to `asOf`, the game's status
  comes from the status log then.
- **Check in the admin panel** (`apps/server/src/repo/inactivityCheck.ts`, `GET /api/:uni/inactivity-check`, alliance
  admins, section "Check the inactivity score"): players the game flagged inactive in the last 45 days were last
  online the universe's inactive days before the flag appeared (known within 2 days from the status log); the score is
  replayed 12, 24, 48, 72 and 120 hours after that and shown as detection rate (likely, inactive) and median score.
  False alarms: the score once a day over 30 days, scores of at least likely followed by proof or a relevant gain
  within 3 days, with examples. It runs in steps (the server stays responsive) and is kept for 15 minutes. This
  replaces a backtest against the production database, which nobody can access from here: the deployment's admin
  opens the panel instead.
- **Tuning**: the weights are one object (`INACTIVITY` in `repo/inactivity.ts`), shown in the check. Change them when
  the check shows late detection (lower `tau`) or many false alarms (raise `tau`, `weakGain`).
- Tests in `apps/server/test/inactivity.test.ts` and `apps/server/test/inactivityCheck.test.ts`.

**First measurement (U7, closed, data as of 01.11.26).** 6 flagged players evaluated, 57 skipped; detection 0 % "likely"
at 12 h and 24 h (median 20 and 41, so the bare curve), 100 % at 48 h and 72 h, 50 % "inactive" at 120 h (n = 1–2,
not meaningful yet). False alarms: 343 high scores (player-days) over 8 days, 35 followed by activity (10 %); the
examples are all points gains at statistics updates in the last week before the end, when players come back to spend
before a universe closes. Conclusions and changes:

- Too few events: the flag is seen only when someone syncs the player's galaxy or statistics, so the sightings around
  it were often more than 2 days apart. The check now accepts up to 7 days when a proof of activity narrows the last
  login down to 2 days (`narrowed` in the response).
- The report now counts false alarms per player as well and names the cause (gain or the kind of proof), so the next
  measurement shows whether build queues finishing (gains) or real returns dominate.
- Weights unchanged until a running universe (U8) gives more events; a closing universe overstates false alarms.

**Second U7 run** (with causes): per player 26 of 89 high scores were followed by activity within 3 days (29 %); 28
of 35 contradictions were points gains, 4 attacks, 3 espionage. Most came 2–3 days after the high score, so the
3-day window counted players who simply came back after a real break. The check was changed accordingly:

- false alarms by horizon (12, 24, 72 hours, the earliest one with activity; the score is replayed at each), the
  24-hour share is the false alarm rate;
- per score band (50–69, 70–84, 85+), to see whether `tau` is too short (middle band) or the high scores are wrong;
- examples with the time of what disproved them first (before, the later of proof and gain was shown) and, for a
  gain, its size, its ratio to the median around the rank and the categories that grew (research or buildings: a
  queue running out; fleet or defense: a player back building);
- an ended universe counts samples whose follow-up reaches into its last 7 days apart (`endPhase`).
- **Next:** measure on U8 after 2–3 weeks of running, then tune `tau` and `weakGain`.

### B-4 Debris field tracker
**Value:** Medium · **Effort:** S · **Builds on:** galaxy parser (debris), battle reports, recycling reports

Debris is parsed but not tracked as a list. Show open debris fields of the group's galaxy data with size, age,
recyclers needed and the nearest member with recyclers. A battle of a member that leaves debris shows up here at
once; a recycling report clears it. Claims of kind "recycle" avoid double flights.

### B-5 Raid profitability over time
**Value:** Medium · **Effort:** S · **Builds on:** raid statistics, loot settlement

Raid statistics as a trend: profit per day and per member, profit per flight hour, share of losses, best targets.
Helps members see whether their farming pays off and leaders see who carries the alliance.

### B-6 Moon destruction and moon chance tracking
**Value:** Low · **Effort:** S · **Builds on:** moon destruction calculator, battle reports

Record moon chances from battle reports and the moons created by members, and link the moon destruction
calculator with the diameter from the galaxy data for a known hostile moon.

---

## C. Economy and planning

### C-1 Upgrade advisor (payback time)
**Value:** High · **Effort:** M · **Builds on:** `@pr0hub/core/production`, build/research costs, market rate,
`@pr0hub/planner`

Per planet the next upgrades ranked by **payback time**: extra production per hour (converted with the alliance's
market rate) against the cost, with energy taken into account (solar plant, fusion reactor, solar satellites) and
the plasma technology for all planets. A "next best step" per planet in the build view, and an option to add it to
the build order.

Improvement over today: the build view tells *when* a level is possible, not *which* level is worth it.

**Status: done (2026-11-07).** How it was built:

- **Game math in `@pr0hub/core/advisor`** (`upgradeAdvice`): per planet the next level of each mine; the energy for it
  when the new level would run short (solar plant or fusion reactor up to 5 levels more, or the solar satellites that
  close the gap; the combination with the shortest payback); energy alone (one level, or the satellites) only while
  the mines are short of it; account wide the mining research 131-133 (pr0game's +2 % per level instead of a plasma
  technology) and energy technology 113, summed over all planets. Gains with `productionOf` (energy factor, fusion
  deuterium use, resource multiplier), scaled per resource with `calibrate` to what the synced empire page showed
  (production settings, bonuses); costs with `buildingCost` and the catch-up bonus, satellites from the unit catalog.
  Payback = cost value / gain value per hour, both in deuterium with the market rate (default 3 : 2 : 1).
  Requirements and maximum levels like the game. Tests in `packages/parser/test/advisor.test.ts`.
- **Web:** `UpgradeAdvisor.vue` in a new tab "Advisor" of `BuildView.vue` (all planets or only the chosen one; cards
  on mobile) and as one line "best next step" in the buildings tab. Data of `/buildings` (levels after the build
  queue, research queue, resource multiplier, catch-up bonus) and the group's market rate; no new API.
- **Build order:** "Add to build order" inserts the step(s) (+1 level each, satellites as one ship step, research on the
  chosen planet) after the steps checked off (`PATCH /build-order`), or starts a build order from the current levels
  (`PUT`, `meta.source: advisor`). Tests in `apps/web/test/advisor.test.ts`.
- **Tours:** steps `build.advisor`, `build.advisorList`. **Texts:** `advisor.*`, `buildings.tabAdvisor`.
- **Left for later:** storage levels when a storage limits the production, build time as a second criterion, a
  forecast over several steps (the build order's timeline does that already).

### C-2 Resource logistics planner
**Value:** Medium · **Effort:** M · **Builds on:** build order (`transport` steps), empire page, flight math

For a goal on one planet (a build order step, a fleet to build), gather the missing resources from the other
planets: how much from where, which cargo ships, departure and arrival, so that the resources arrive when the step
is due. The member sends the transports by hand; transport reports tick them off.

### C-3 Alliance resource requests
**Value:** Medium · **Effort:** M · **Builds on:** loot settlement deliveries, transport reports, notifications

A member asks for resources ("need 2 M crystal on 3:120:8 until Sunday"), others pledge an amount, transport
reports tick deliveries off like in the loot settlement. Optional: account per member (who gave how much over time).

### C-4 Expedition planner
**Value:** Medium · **Effort:** M · **Builds on:** expedition statistics, deck, universe settings

From the deck and the group's own expedition results: the expected value per expedition depending on fleet size and
composition, the fleet size where more ships stop paying off (the cap of the universe), and the best use of the
free fleet slots. Today the statistics show what happened, not what to send.

### C-5 Colonization planner
**Value:** Low · **Effort:** S · **Builds on:** galaxy data, flight math

Free positions near the member's planets with the expected size and temperature range per position (as in the
game), distance to the main planet and to the alliance. Helps new members place colonies close to each other.

---

## D. Alliance management

### D-1 Alliance health dashboard
**Value:** High · **Effort:** M · **Builds on:** sync freshness per member, statistics, presence, raid statistics

A page for leaders: per member points and growth against the alliance median, last sync of each page type, last
seen in the hub, raids and expeditions in the last week, open deliveries. Flags: "falls behind", "no empire sync in
3 days", "no statistics in the hub". Helps to find members who need help or have quit.

**Status: done (2026-11-07).** How it was built:

- **Server:** `apps/server/src/repo/health.ts`, `GET /api/:uni/alliance-health` (alliance admins and global admins,
  `getAllianceHealth` in `openapi.yaml`). Per member: the member's player (`memberPlayers`) with the newest total points
  and rank; growth = points now minus the newest update at or before 7 days ago (else the oldest after it, `partial`);
  the alliance median of the growths. Newest sync per page type from `raw_ingests` (kept 14 days) and the snapshot
  tables (empire, overview, fleets, buildings, research, galaxy views; all of the time). Battle reports and expeditions
  the member synced in 7 days (with the loot of the reports), open deliveries of finalized loot settlements
  (`finalizedSettlements`). Flags: `behind` (below half the median growth, median above 0), `noEmpire` (3 days),
  `noStats`, `away` (no hub visit for 3 days, `group_members.last_seen_at`). Tests in `apps/server/test/health.test.ts`.
- **Web:** `HealthView.vue` at `/:uni/health`, menu item "Health" under Alliance only for admins (also in the global
  search). Summary (members, flagged, median growth, "flagged only"), a table with the flags under the name and the sync
  ages coloured by freshness; cards on mobile. **Tour** `health`; **texts** `health.*`, `nav.health`; web test
  `apps/web/test/health.test.ts`.
- **Follow-up (2026-11-07):** open to every member (no admin check, menu item for all); the last hub visit and `away`
  follow the member's online setting (`show_online`): hidden from the others unless the viewer is an admin
  (`onlineHidden`), like the player page's activity.
- **Left for later:** reminders to members (D-3 sync duties), a trend over several weeks, raids from the raid planner
  instead of synced battle reports.

### D-2 War dashboard (alliance vs alliance)
**Value:** Medium · **Effort:** M · **Builds on:** battle reports, battle hall archive, statistics

Pick an enemy alliance and a start date: battles won and lost, units and resources destroyed on both sides, debris,
points trend of both alliances, the most active players on each side, the members hit most often. Optional: share
a read-only summary with a war partner group.

### D-3 Sync coverage duties
**Value:** Medium · **Effort:** S · **Builds on:** galaxy freshness heat map, statistics coverage

Members take responsibility for a galaxy range or a statistics category ("I paste galaxy 3 every day"). The heat map
shows the owner of each range, a reminder fires when their range gets stale. Turns the freshness view into a
shared routine.

### D-4 Onboarding of new members
**Value:** Medium · **Effort:** S · **Builds on:** tours, claim links

After the claim link: a checklist of the first syncs (statistics, empire, overview, research, galaxy around the own
planets) with a tick when each page arrived, and short explanations where to find the page in the game. The
alliance admin sees who finished onboarding.

### D-5 Alliance calendar
**Value:** Medium · **Effort:** S · **Builds on:** raid plans, launch times, build completions, universe start/end

One timeline of what is coming: planned raids and their launch times, own builds and research finishing, fleets
returning, the universe end. Exported as a personal iCal feed (read-only token in the URL, like the API tokens), so
phones show launch times in the calendar.

---

## E. Sync experience (copy and paste only)

### E-1 "What should I paste next?"
**Value:** High · **Effort:** S · **Builds on:** sync freshness, statistics coverage, build view, imperium hints

A short personal list on the home page and in the sync panel: "Empire is 2 days old", "Statistics of 18:00 are
missing", "Research page never pasted (build times of research are estimates)". Each line explains in one sentence
which hub feature gets better with it. Higher data quality is the base of every other feature.

**Status: done (2026-11-06).** How it was built:

- **Server:** `GET /api/:uni/sync-hints` (`apps/server/src/repo/syncHints.ts`, documented in `openapi.yaml` as
  `getSyncHints`) returns a list of hints, most important first. Each hint has a `key`, a `level` (`high`: features
  are missing or wrong without it, `medium`: noticeably outdated, `low`: better with it), a `scope` (`me` for the
  member's own pages, `group` for shared data) and the time of the newest sync. Checked are:
  - empire page (none or older than 3 days: high, older than 1 day: medium),
  - statistics (nothing at all: high): categories missing in the newest synced update (total points: medium, others:
    low), or a newer update due after the interval learned from the synced updates (`statInterval`: the shortest gap
    seen at least twice; medium), or older than a day while no interval is known (medium). Never fixed hours or a
    fixed interval (see the fixes below),
  - overview or fleet page (none or older than 1 day: medium, older than 12 h: low),
  - galaxy systems ±2 around the own planets older than 3 days (all: medium, some: low),
  - planets and moons of the empire without a buildings page, no research page at all, no messages page in the
    last day (low),
  - the group's market rate missing or older than 3 days (low).
  All queries go through `groupContext`; tests in `apps/server/test/syncHints.test.ts`.
- **Web:** `SyncHints.vue` with the shared state in `syncHints.ts` (one request for all places). The sync page shows
  the full list with the reason and where to find the page in the game; the overview and the quick sync sheet show
  at most three high/medium hints and a link to the rest, and nothing when the data is fine. The list reloads after
  every save in the sync panel and on live data events, and is cleared when switching alliance.
- **Collapsible (follow-up, 2026-11-06):** the short list in the overview and the quick sync sheet is a `Section`
  with the number of hints as count, folded by default on mobile (just the title row; the link to all hints moves
  into the opened list) and open on desktop. The choice is remembered per device (`section.syncHints.overview`,
  `section.syncHints.sheet`). Instead of a plain count the title row shows a warning mark with the number of hints,
  red when one is important and yellow otherwise, so the list never goes unnoticed while folded.
- **Tours:** new steps `paste.hints` and `overview.syncHints`. **Texts:** `syncHints.*` in `de.ts`/`en.ts`.
- **Left for later:** the leaders' view of every member's freshness and the shared sync duties belong to D-1 and
  D-3.
- **Fix (2026-11-06):** the expected statistics update comes from the 6-hour grid of the newest synced update
  (`expectedStatUpdate`), not from 0/6/12/18 o'clock local time: servers run it at their own configured hours, and on
  U7 they moved to 23/5/11/17 o'clock with the switch to winter time (seen in the inactivity check's timestamps).
- **Fix (2026-11-06, follow-up):** no assumed interval either. The 6-hour grid is gone: the interval is learned from
  the synced updates (`statInterval`), the default hours are no fallback any more. Rule in `CLAUDE.md`: never assume
  fixed statistics hours or intervals.

### E-2 Several pages at once
**Value:** Medium · **Effort:** S · **Builds on:** sync panel file upload, ingest preview

The file upload takes one file. Accept several saved pages (multiple files or drag and drop of a folder) and show
one preview per page before saving. Also: several pages pasted one after the other into the same box before saving
("collect mode").

### E-3 Parser gaps for game pages
**Value:** Medium · **Effort:** M per page · **Builds on:** parser framework and fixtures

Pages of the game that the hub does not read yet and that would feed features above:

| Game page | Feeds |
|---|---|
| Shipyard and defense pages (queue, counts per planet without empire) | A-1, A-4, live points |
| Repair dock (repairable ships after a battle) | A-1, raid statistics |
| Records | player details, comparison |
| Advanced statistics (own) | personal statistics (F-2) |
| Achievements (own) | personal profile |
| Buddy list and alliance member list | member mapping, D-1 |

### E-4 Explain failed pastes
**Value:** Medium · **Effort:** S · **Builds on:** ingest log, preview

When a paste is not recognized, say why in plain words ("this looks like the fleet page, which is not supported" or
"the page is in a language the hub does not know") and offer to send the page anonymized to the admins as a
parser sample. Today the admin sees it in the ingest log, the member only sees that nothing happened.

---

## F. Insights, search and export

### F-1 Global search (Ctrl+K)
**Value:** High · **Effort:** S · **Builds on:** player search with former names, coordinates, alliances

One search field for players (also former names), alliances, coordinates (`3:120:8` jumps to the spy history or
the galaxy) and hub pages. On mobile behind the search icon of the header.

**Status: done (2026-11-06).** How it was built:

- **Server:** `GET /api/:uni/search?q=` (`apps/server/src/routes/players.ts`, `globalSearch` in `openapi.yaml`).
  Coordinates (`1:120:8`, with or without brackets) return only the planet there with name, moon and owner (or just
  the position when the hub does not know it). Other terms (2 characters or more) return up to 8 players by name or
  former name (`alias` names the former name that matched) and up to 5 alliances by name or tag; exact matches
  first, then names starting with the term, then the most recently seen. Scoped to the group; tests in
  `apps/server/test/search.test.ts`.
- **Web:** `GlobalSearch.vue`, a dialog opened by `Ctrl+K`/`⌘K`, `/` outside text fields, the search field in the
  sidebar or the search icon in the mobile top bar. Results are grouped (coordinates, players, alliances, pages),
  arrow keys and Enter pick one, Esc closes. Players open in the player dialog above the current page, alliances
  open the overview with the alliance filter (new query parameter `?ally=`, also while the overview is open),
  coordinates lead to the spy history of the planet or moon, the galaxy system or the owner. Pages are matched
  client-side against the menu labels in the current language.
- **Tours:** new step `overview.globalSearch` pointing at the search field. **Texts:** `search.*` in `de.ts`/`en.ts`.
- **Left for later:** search in comments and notes, recent searches.

### F-2 Personal statistics
**Value:** Medium · **Effort:** M · **Builds on:** statistics history, empire syncs, raid and expedition statistics

A member's own progress: points per category over time, production per hour over time, raid profit and expedition
yield per day, rank compared to the alliance. Motivating, and a natural reason to sync regularly.

### F-3 Export
**Value:** Medium · **Effort:** S · **Builds on:** API with read-only tokens

CSV download of every large table (overview, statistics, spy reports, loot settlements, expedition list) and a
documented JSON export of the group's own data. Many alliances keep spreadsheets; the hub should feed them instead
of competing with them.

**Status: done (2026-11-07).** How it was built:

- **Server:** `apps/server/src/repo/export.ts` builds one table per dataset (`players`, `planets`, `spy-reports`,
  `battle-reports`, `expeditions`, `settlements`) from the group's data only (no private messages or unshared fleets);
  reports, battles and expeditions of the last `days` (1-365, default 30). `GET /api/:uni/export` returns all of them
  as JSON objects, `GET /api/:uni/export/:dataset(.csv)` one as CSV (RFC 4180, UTF-8 with BOM, `sep` comma, semicolon or
  tab, times as Unix seconds, numbers unformatted); both as attachments, GET, so read-only API tokens may call them.
  `exportGroupData` and `exportDatasetCsv` in `openapi.yaml`, tests in `apps/server/test/export.test.ts`.
- **Web:** `CsvButton.vue` in the page header of the overview (players or planets by mode), statistics, spy reports,
  expeditions and the raids (settlements: deliveries, statistics: battle reports), semicolons in German for
  spreadsheets with a decimal comma; JSON links per alliance under Account → API tokens. **Texts:** `export.*`.
- **Spreadsheets:** no tokens in URLs (decided 2026-11-07: they end up in logs and in the sheet); the README has a
  Google Apps Script example that sends the token in the header and refreshes sheets on a trigger.
- **Left for later:** the filters of a view in its CSV.

### F-4 Discord commands
**Value:** Medium · **Effort:** M · **Builds on:** Discord integration, battle simulation API, player API

Read-only slash commands in the alliance's Discord: `/player name`, `/spy 3:120:8`, `/sim`, `/attacks`. Answers come
from the hub's data, nothing is sent to the game. Many alliances live in Discord during attacks.

### F-5 Daily digest
**Value:** Low · **Effort:** S · **Builds on:** notifications, push, Discord

One message per day instead of many: what happened to me (attacks, spies on me, finished builds, settlement
deliveries open), what is planned. For members who turn off single push notifications.

---

## G. Platform improvements of existing features

| # | Improvement | Value | Effort |
|---|---|---|---|
| G-1 | **Typed API client** generated from `openapi.yaml` for the web app (open item A-01 / C-02 of `CODEREVIEW.md`): fewer UI bugs after API changes | Medium | M |
| G-2 | **Offline-capable PWA**: the last loaded data of the empire, fleets and plans readable without network, launch reminders still visible | Medium | M |
| G-3 | **Table settings per user**: chosen columns, sorting and filters of overview and statistics remembered per device | Medium | S |
| G-4 | **Notification rules**: quiet hours per device, thresholds ("attacks only above X fleet points", "storage full only on the main planet") | Medium | S |
| G-5 | **Privacy self-service**: a member exports and deletes their own data (messages, fleets, notes) when leaving the alliance | Medium | S |
| G-6 | **Group self-service**: an alliance admin creates their group and invites members without the hub admin (today universes and groups are admin work) | Medium | M |
| G-7 | **Performance on large universes**: paginated or virtualized overview and statistics tables, measured on a full universe | Medium | M |
| G-8 | **Comments with mentions**: `@member` in a comment thread notifies that member, links to coordinates are clickable | Low | S |

---

## Suggested roadmap

**Now (highest value per effort):**
E-1 What to paste next · F-1 Global search · B-1 Farm finder · B-3 Inactivity confidence · A-3 Hostile phalanx
exposure (all done)

**Next:**
A-1 Incoming attack assistant (done) · A-2 Fleet save planner (done) · C-1 Upgrade advisor (done) · D-1 Alliance
health dashboard (done) · F-3 Export (done)

**Later:**
A-4 Defense advisor · C-2 Logistics planner · C-3 Resource requests · C-4 Expedition planner · D-2 War dashboard ·
D-5 Calendar · F-4 Discord commands · E-3 parser gaps · G items as capacity allows

Reasoning: the "Now" items mostly reuse data and math the hub already has and raise data quality (E-1) or daily
use (F-1, B-1). The defense items in "Next" are the biggest gap in value, but need the battle and flight packages
combined on one page and careful wording of advice.

## How to measure success

- **Sync freshness:** share of members with an empire page younger than 24 h and statistics coverage per update
  (target for E-1 and D-3).
- **Weekly active members** per group and pages opened per visit (F-1, F-2).
- **Fleets lost to attacks** on members, from battle reports, before and after A-1/A-2.
- **Raid profit per flight hour** from the loot settlements, before and after B-1.
- **Use of advice:** how often a suggestion is taken (claim from the farm finder, hold plan from the attack
  assistant, upgrade added to the build order).

## Out of scope

- Anything that reads or acts on game pages by itself (userscripts, extensions, bots that log into the game,
  endpoints for automated submission).
- Features that move data between groups without both groups agreeing.
- Deployment and hosting topics (private deployment repository).

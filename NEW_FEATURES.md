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
| B-3 Inactivity confidence | Done | 2026-11-06 | farm finder, overview, player details |

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

### A-2 Fleet save planner (sleep and offline windows)
**Value:** High · **Effort:** M · **Builds on:** `@pr0hub/flight` (recall, duration), notifications, empire page

The member enters "I am offline from 23:30 to 07:15". Per planet the hub suggests a fleet save that lands or
returns at the wake-up time (deploy to own moon/planet, transport with resources, recycler to a debris field),
with speed setting, fuel and the exact departure. A push or Discord reminder fires a few minutes before the fleet is
back. Typical windows ("night", "work") are saved as presets.

### A-3 Hostile phalanx exposure
**Value:** Medium · **Effort:** S · **Builds on:** phalanx coverage in the galaxy browser, spy reports of moons

The galaxy browser shows which phalanxes reach a system. The reverse view is missing: **per own planet**, which
moons of other alliances can phalanx it, and since when that is known. Planets in reach are marked in the empire
and fleet save views ("fleet save via moon, a phalanx sees planet fleets"). A new known hostile phalanx in range
creates a notification.

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
- **Left for later:** fleets seen in members' overviews and messages as further activity signals.

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
  - the game's latest statistics update per category (0, 6, 12, 18 o'clock in the universe's time zone, 10 minutes
    grace; nothing at all: high, total points missing: medium, other categories: low),
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
  `section.syncHints.sheet`).
- **Tours:** new steps `paste.hints` and `overview.syncHints`. **Texts:** `syncHints.*` in `de.ts`/`en.ts`.
- **Left for later:** the leaders' view of every member's freshness and the shared sync duties belong to D-1 and
  D-3.

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
exposure

**Next:**
A-1 Incoming attack assistant · A-2 Fleet save planner · C-1 Upgrade advisor · D-1 Alliance health dashboard ·
F-3 Export

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

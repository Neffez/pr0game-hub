# Feature request: retime calculation

Status: in progress. Done: flight library `@pr0hub/flight` (plan steps 2 and 3), flight calculator moved to
`apps/tools`, fleet movements parser (`8e47c56`, with gaps, see step 1). Next: parser gaps, candidates, UI.

Scope: the raid planner has two parts, **retime** (when is a hostile fleet back home, counter-attack) and
**ACS planning** (own attacks of several members, from a separate plan, see "ACS planning" below). Both share the
flight library, the live updates and the target claims.

## Request (from a player)

> Retime Zeiten berechnen wäre praktisch, also in Übersicht Strg A usw.
> Und er berechnet aus infos mögliche Retime Zeiten, es sollte Angaben über vermutete Abflug Zeit geben zum weiter
> einschränken und nachträgliches anpassen von Antrieben, für den Fall, dass sich was veränderte

## Understanding

A foreign fleet is flying to one of our planets. Its arrival time and origin are visible on the game overview. After
the arrival it flies back to its origin. Knowing when it lands there lets a player time an own attack to arrive just
after it ("retime").

1. The player copies the game overview (Ctrl+A, Ctrl+C) and pastes it into the hub. This is copy & paste only, as
   required by `CLAUDE.md`; nothing runs on game pages.
2. The hub parses the fleet events: origin, target, mission, arrival time (and ships, if present in the text).
3. For every fleet the hub lists the possible return times at the origin:
   `return = arrival (+ stay) + one-way duration`. The duration depends on distance, slowest ship, the owner's drive
   levels, the chosen speed (10–100 %) and the universe fleet speed. Unknown inputs produce a candidate list
   (one row per speed step, and per ship class when ships are unknown).
4. **Estimated departure time** narrows the list: `arrival − departure` is the outbound duration, so only candidates
   whose duration fits the departure window remain (e.g. "not on the overview at 14:05, there at 14:12").
5. **Drive levels can be edited afterwards** (combustion 115, impulse 117, hyperspace 118); the candidates recompute.
   Default source: latest known research of the owner (spy reports / hub data), otherwise manual input.

## Existing building blocks

### Flight calculator (pr0game-tools)

Two versions exist:

- **Standalone** (`pr0game.neffez.dev/flight-calculator/`, one self-contained HTML file in the private deployment
  repository). Newest version:
  - Modes as tabs: flight time, **Retime** ("when is the enemy back?"), **Recall** (fleet save: recall time for a
    wanted return, or return for a given recall), several calculations side by side.
  - Retime: arrival, origin and ships of the enemy fleet -> launch and return per speed percent; option "Attack was
    delayed (ACS)" with the original arrival; outcome "Impact" or "Recalled at ...".
  - **Counter-attack** card: own start planet, ship, drive levels and a buffer -> send times so the own fleet lands
    on the enemy origin right after its return.
  - Server-exact math: `getTargetDistance`, `getShipSpeed` (drive switch per tech level), `getMissionDuration`
    (floor, minimum 5 s), `getTimestamps`, `getDelayedTimestamps`, `abortHome`, `recallFor`,
    `getFleetConsumption`, with self-tests (incl. delayed recall).
  - State in the URL hash (route, ships, research, universe, retime inputs, counter-attack `ks/kship/kc/ki/kh/ko`).
- **In-game** (`Neffez/pr0game`, branch `feature/flight-calculator`, commit `ccb8e971`): PHP page + ES5
  `scripts/game/flightCalculator.js`, an older state (retime from arrival, no delay, no counter-attack). Contribution
  to the game itself, must stay dependency-free.

### Hub

- `apps/web/src/format.ts`: `distance()` and `flightTime()` (ports of the same server functions, but without the
  drive switch per ship and without `MIN_FLEET_TIME`), `flightCalcLink()` builds a share link into the calculator
  (used by `PlanetActions.vue`, "Flugzeit berechnen").
- `packages/parser/src/parsers/overview.ts`: parses the overview (HTML and copied text), but only the build queues and
  the server clock (`parseServerClock`), not the fleet events.
- Ship speeds/drives are **not** in `packages/parser/src/data/` (`tech.json` has names, `costs.json` costs only).
  They have to be added, either from the calculator's ship table (`speed1-3`, `tech1-3`, 202–219) or generated from
  the game's `install.sql` like `pnpm gen:tech` / `pnpm gen:costs`, so ships 220–232 are covered too.

## Decisions

Answered by the requester on 2026-10-22.

| Topic | Decision |
| --- | --- |
| Fleets | Foreign attacks (single and ACS) and espionage on own planets (overview) **and** sensor phalanx results. No own fleets, no friendly hold. |
| Ships | The copied overview text contains ship types and amounts, so the slowest ship is known (no guessing per ship class). |
| Arrival | The overview shows countdown **and** absolute arrival time; the absolute time is used. |
| Speed steps | 10-100 % in steps of 10 (`speedFactor` 1-10, as in the calculator). |
| Drive levels | Prefilled from hub data (spy reports / known research of the owner), editable by hand. Warning when the data is older than **3 days**. |
| Recall | Supported (see plan step 4). |
| Visibility | Stored per group; everyone in the group sees the retimes. |
| Computation | The hub computes and filters the candidates; link into the flight calculator (`mode=retime`) as an extra. |
| Shared code | Confirmed: shared flight library in this repo, the standalone calculator moves here (see below). |
| UI location | Menu item "Raids" is renamed to "Raid-Statistiken" / "Raid statistics"; a new item "Raid-Planer" / "Raid planner" goes above it, with the tabs "Retime" and "Verbandsangriff" / "ACS attack" (proposed, see open questions). |
| Retention | A fleet event disappears after its latest possible return. |

## Overview text format (sample from the requester, older data)

```text
13:14:00 | 27m 10s Eine Flotten(1 Spionagesonde) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Angreifen

Eine Flotten(1773 Schlachtschiff; 2 Schlachtkreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff

Eine Flotten(1322 Schwerer Kreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff
...
13:14:48 | 27m 58s Eine friedliche Flotten(1193 Zerstörer; 7 Behemoth) vom Spieler Lologolo [PN] vom Mond Ratatoskr [3:193:15] erreicht den Planet Immer Online [3:115:8]. Mission: Halten
```

- An event starts with `HH:MM:SS | <countdown>`; the following lines without time belong to the same arrival
  (ACS members). The date is not printed: arrival = copy time (server clock of the paste) + countdown, the printed
  time confirms it to the second.
- Hostile fleets: `Eine Flotten(<ships>) vom <Planet|Mond> <name> [g:s:p] erreicht den <Planet|Mond> <name> [g:s:p].
  Mission: <mission>`, no player name. The owner is looked up by origin coords in the hub's galaxy data (needed for
  the drive levels).
- Friendly fleets: `Eine friedliche Flotten(...) vom Spieler <name> [PN] vom ...`, ignored (hold missions).
- Ships: `<amount> <German name>` separated by `; `, amounts without separators in the sample (large numbers may have
  `.`). English texts still needed.
- Missions: `Angreifen` (ACS lead or single attack), `Verbandsangriff` (ACS member), `Spionage` expected for probes.

## Timing rules

Verified in the game source (`pr0game`: `src/Core/FleetFunctions.php`, `src/Pages/Game/ShowFleetStep3Page.php`) and
matching the standalone calculator (`getDelayedTimestamps`, `abortHome`, `recallFor` and their self-tests):

- Sending stores `start_time = now` (real launch), `fleet_start_time = now + duration` (arrival; for an ACS member that
  is earlier than the ACS time: the ACS time, the fleet waits), `fleet_end_time = arrival + stay + duration`.
- `setACSTime` (a slower fleet joins) adds the delay to arrival, stay end and return of all members, never to
  `start_time`.
- `sendFleetBack` (recall): `return = now + (now - start_time)`; during a hold/trade stay
  `return = now + (arrival - start_time)`. For an `Angreifen` fleet with an ACS group (`MISSION_ATTACK`,
  `fleet_group != 0`) the ACS is deleted and the *same* return, computed from the lead's `start_time`, is written to
  all fleets of the group; a `Verbandsangriff` fleet (`MISSION_ACS`) only recalls itself.


Terms per fleet: `duration` = pure one-way flight time (own slowest ship, own speed percent, drive levels),
`delay` = time the ACS arrival was pushed back after this fleet was sent, `departure = arrival - duration - delay`.

- **Return after impact** (every fleet, also ACS members): `return = arrival + duration`, the pure flight time without
  any delay. Sending sets `end = arrival + duration`; when a slower fleet joins the ACS, `setACSTime` moves arrival and
  return of all members by the same amount. So each fleet of an ACS has its own return time.
- **Delays are arbitrary**: a player can push the ACS back by adding a slower fleet (and recalling it again, the delay
  stays). Hence `delay >= 0` is unknown, and the printed arrival can still move after the paste (a new paste updates
  the event).
- **Waiting counts like a delay**: an ACS member that joined early waits for the ACS time, so its launch is earlier than
  `arrival - duration` as well. The calculator's "original arrival (first seen)" input therefore means the arrival
  that applied when *this* fleet was sent; for a member that joined early it is its own `launch + duration`, not the
  ACS time seen at that moment.
- **Departure window**: the fleet that set the current ACS time has `delay = 0`, all others may have waited. For a
  single attack (no ACS) the window filters candidates both ways; for ACS members it only rejects candidates whose
  `arrival - duration` lies before the window (`departure <= arrival - duration`).
- **Return after recall** = the total flight time so far: `return = recall + (recall - departure)`
  `= 2 * recall - arrival + duration + delay`. So it depends on speed (`duration`), departure, recall moment and
  delays.
  - Recall of the ACS lead (`Angreifen` fleet of a group): the ACS is dissolved and *all* members get the same return,
    computed once from the lead's departure (lead's duration and delay).
  - Recall of a single member: only that fleet, from its own departure.
  - Without a departure window `delay` is open, so only a lower bound (`delay = 0`) is known; with departure and recall
    windows the result is a time range per speed candidate.

## Plan

1. **Parser** (`packages/parser/src/parsers/fleets.ts`, exists since `8e47c56`: `FleetMovement` with owner, mission,
   phase, from/to, ships, seconds and clock). Gaps for the retime, found with the sample above:
   - A hostile attack in copied text comes out as `owner: 'foreign'`: the text has no "feindlich", only "Eine Flotten(...)"
     without "friedliche"/"deiner". Rule: not own, not peaceful, mission attack/ACS attack/espionage/destroy/missile
     towards an own body -> `hostile`.
   - ACS member lines have no `HH:MM:SS | countdown` prefix and are dropped (4 of 5 fleets of the sample). They belong
     to the arrival of the line above (same seconds and clock); keep them, and mark the group (same arrival + target).
   - Phalanx result (copied text of the phalanx window): same fields; outbound and return flights. For a return flight
     the phalanx shows the landing at home directly, so it is the retime itself, no computation needed.
   - Tests with real pasted texts.
2. **Ship data** (done): base speed, drive per tech level and consumption per ship in `packages/flight/src/ships.ts`.
   A hand-kept table like in the calculator, because ships 222-232 are not in the game's `install.sql`.
   Ship 222 (Schwerer Kreuzer) from the in-game ship info of universe 7.
3. **Flight math** (done): `@pr0hub/flight` with distance, ship speed with drive switch, slowest ship, duration
   (floor, minimum 5 s), consumption, timestamps (from launch, from arrival, delayed), recall and recall time.
   Replaces `distance()` / `flightTime()` in `apps/web/src/format.ts`. Unit tests ported from the calculator's
   self-tests; 20,000 random cases checked against the standalone calculator without a mismatch.
4. **Candidate engine**
   - Input: fleet event, universe settings, drive levels, optional departure window.
   - Ships known, so there is one candidate per speed step (10 rows): `{percent, outbound, departure, return}`.
   - Departure window filters the rows; usually one or two remain. A pasted event remembers the first arrival seen
     for it (earlier pastes); a later paste with a moved arrival records the delay, like the calculator's
     "original arrival".
   - Counter-attack: per candidate the send time from a chosen own planet/ship/drives so it lands after the return
     plus a buffer (calculator's counter-attack card).
   - ACS: fleets under one arrival are one group; the `Angreifen` fleet is the lead. Each member gets its own
     candidate table; the departure window is applied one-sided for members (see timing rules).
   - Recall: if a fleet vanished from the overview before arrival, the user enters the window in which it was
     recalled ("still there at 14:20, gone at 14:25") and whether the lead (whole ACS) or one member was recalled.
     Return = `2 * recall - arrival + duration + delay` per speed candidate (lead's values for the whole ACS); shown as
     a range from the recall and departure windows, or as a lower bound without a departure window.
5. **Server**: the hostile fleets come from the members' `fleet_snapshots` (migration 020, newest overview per member),
   no separate paste. A new table `retime_fleets` (own migration) keeps what members add per hostile fleet: first seen
   arrival (delay detection), departure window, recall window, drive overrides, who changed it and when; keyed by
   group, origin, target, mission and ships, so the same fleet seen by several members is one row. Rows are removed
   after the latest possible return. Changes are pushed live (see "Shared foundations").
6. **UI**: new view "Raid-Planer" (route e.g. `/raid-planner`) above the renamed "Raid-Statistiken" (`raids` route
   and `RaidsView.vue` keep their names, only the label changes). Paste box (overview or phalanx) -> list of foreign
   fleets of the group -> per fleet the candidate table with departure window, recall window, drive levels (prefilled, date of the data, warning after 3 days) and the link
   into the flight calculator. Locales in `de.ts` and `en.ts`, mobile layout below 800 px.
7. Changelog entry, `pnpm typecheck`, `pnpm test`.

## ACS planning (from a separate plan, merged here)

Own ACS attacks of several members, planned together in the hub.

- **Database** (own migration; 020 is taken by `fleet_snapshots`):
  - plans: target, planned arrival, note, status (planning, launched, done, cancelled), creator;
  - participants: start planet, ships, speed, launch time, actual arrival, status (invited, ready, launched,
    withdrawn).
- **Server**: endpoints to create, change and delete plans and the own participation. Only the creator or an admin
  edits the plan, every participant their own row. A new plan claims the target as "attack" (`target_claims`,
  migration 018) for the planned time.
- **Web**: tab "Verbandsangriff" in the raid planner with list and detail view; "Verbandsangriff planen" in the
  action menu of a target.
  - Per participant: start planet and ships prefilled from the own empire page; flight time and launch time from
    `@pr0hub/flight` (drives from the own research), countdown to the launch.
  - Late participants are marked (`now + duration > planned arrival`).
  - Buttons "TrashSim" and "Simulator im Spiel": ships and research of all participants and the newest spy report of
    the target via URL (links only, nothing runs on game pages). No own battle simulator.
- **Tests**: server tests for plans and rights, web tests for the simulator links.

ACS rules from the game source (`ShowFleetStep3Page`, `FleetFunctions::setACSTime`), checked for this plan:

- **No limit on the delay** (unlike OGame's 30 %): a fleet that would arrive later than the ACS time pushes the whole
  ACS back by the difference (arrival and return of all members), a faster one waits for the ACS time. The planner
  therefore shows the resulting arrival `max(planned arrival, latest participant's earliest arrival)` and who causes
  the delay, instead of only "too late".
- **Limits** `max_fleets_per_acs` and `max_participants_per_acs` (game config, per universe): a fleet beyond them is
  silently sent as a normal attack (mission 1, no group) and arrives on its own. The planner warns when a plan
  exceeds them; both values go into the universe settings.
- **Returns**: every participant lands back at `arrival + own duration` (pure flight time, no delay); recalling the
  lead fleet recalls the whole ACS with one return time from the lead's launch (see timing rules). The planner can
  show each participant's return for fleet saving.

## Shared foundations of retime and ACS planning

- **Flight math**: `@pr0hub/flight` for both (durations, launch from arrival, delays, recalls). The ACS rules above and
  the timing rules are one module there, with tests, so retime and ACS planning cannot disagree.
- **Live collaboration via SSE**: the existing `EventBus` (`apps/server/src/events.ts`). Changes to plans,
  participations and retime inputs send a `DataEvent` with the table names (e.g. `acs_plans`, `retime_fleets`); the
  open tabs load the data again through the normal endpoints, so no game data travels past `groupContext`. A new
  fleet snapshot (overview paste) already arrives as a data event and refreshes the hostile fleets.
- **Target claims**: an ACS plan claims its target as "attack"; the retime counter-attack can claim the enemy origin.
- **Bridge retime -> ACS**: from a retime candidate "Konter als Verbandsangriff planen" creates an ACS plan with the
  enemy origin as target and the chosen return plus buffer as planned arrival; the participants then get their send
  times there.
- **Universe settings**: fleet speed and layout exist; ACS limits are new.

Suggested order: parser gaps -> retime candidates (web only, no table) -> ACS plans with live updates -> retime inputs
shared (`retime_fleets`) -> bridge retime -> ACS.

## Proposal: shared flight library, calculator in this repo

Today the flight math exists three times:

| Where | What | Notes |
| --- | --- | --- |
| `apps/tools/flight-calculator` (moved from the private deployment repository) | Standalone calculator (`pr0game.neffez.dev/flight-calculator/`) | Calculation in `src/core.ts` on `@pr0hub/flight`; 30,000 random cases equal to the former single-file version. |
| `Neffez/pr0game`, branch `feature/flight-calculator` | In-game page (PHP + plain ES5 JS) | Contribution to the game itself; must stay dependency-free. |
| This repo, `apps/web/src/format.ts` | `distance()`, `flightTime()`, `flightCalcLink()` | Simplified (no drive switch, no minimum time); the link duplicates the calculator's hash contract. |

Proposal:

- `packages/flight` (`@pr0hub/flight`, or a module in `@pr0hub/core`): distance, ship speed with drive switch, fleet
  speed, duration, timestamps, consumption, recall, retime candidates; ship data generated from `install.sql`.
  Pure TypeScript, no DOM, fully unit tested.
- `apps/tools`: the standalone calculator (and the tools landing page) as a static Vite build that imports the
  library. Its share-link hash format is defined once in the library, so `flightCalcLink()` and the calculator cannot
  drift apart.
- The hub's raid planner uses the same library; later it can embed calculator parts instead of only linking.
- The in-game version in the pr0game fork stays a separate ES5 port; shared test values (exported from the library's
  tests) keep it equal to the second.
- Build: CI builds the static calculator as a second artifact/image (or the hub image serves it under its own path).
  How it is deployed stays in the private deployment repository; the `pr0game-tools` folder there is replaced by the
  build output.

Costs: the single HTML file has to be split into library + page (it can stay plain TS/HTML without Vue); one migration
of the hosting in the private deployment repository. The rule "copy & paste only" is not affected, the calculator does
not touch game pages.

## Still open

1. **Test data**: still needed: the full Ctrl+A copy (with server clock line) of an overview with an attack, a foreign
   espionage probe, the English version of the texts, and a copied phalanx result (incl. a return flight).
2. **Phalanx in the hub data**: is the phalanx window copyable as one text (popup), and does it show the ships?
3. **Raid planner layout**: one menu item "Raid-Planer" with the tabs "Retime" and "Verbandsangriff", or two menu
   items (the separate plan had its own page "Verbandsangriff")?
4. **ACS limits**: values of `max_fleets_per_acs` and `max_participants_per_acs` in the universes used.

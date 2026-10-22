# Feature request: raid planner (attack plans and retime)

Status: in progress. Done: flight library `@pr0hub/flight`, flight calculator as `apps/tools`, fleet movements parser
incl. hostile attacks and ACS grouping, ACS and timing rules (`planAttack`, `retimeCandidates`). Next: the attack
plans (see "Order").

The raid planner plans own attacks, solo or as ACS, and lands them at the right second. A plan starts empty or from a
pasted hostile attack ("retime": land on the enemy origin right after the enemy fleet is back).

## Requests

From a player:

> Retime Zeiten berechnen wäre praktisch, also in Übersicht Strg A usw.
> Und er berechnet aus infos mögliche Retime Zeiten, es sollte Angaben über vermutete Abflug Zeit geben zum weiter
> einschränken und nachträgliches anpassen von Antrieben, für den Fall, dass sich was veränderte

From a separate plan (ACS planning, merged here): plans with target, planned arrival, note and status; participants
with start planet, ships, speed, launch time and status; live updates for everyone; the target is claimed as
"attack"; prefilled from the own empire page; TrashSim / in-game simulator links.

## Concept: one attack plan, two ways in

An **attack plan** says: own fleets of one or more members land on one target at one target time.

- **One participant** = solo attack, **several** = ACS. There is no separate plan type.
- **From scratch**: target from the action menu of a planet/moon ("Angriff planen") or typed in, target time by hand.
- **From a hostile attack (retime)**: the raid planner lists the hostile fleets from the members' overview pastes;
  "Retime planen" opens a plan prefilled with the enemy origin as target and the enemy fleet's return plus a buffer
  as target time. The enemy fleet is kept with the plan ("enemy fleet", see data model).

## Decisions

Answered by the requester on 2026-10-22/23.

| Topic | Decision |
| --- | --- |
| Menu | One menu item "Raid-Planer" / "Raid planner" above "Raids", which is renamed to "Raid-Statistiken" / "Raid statistics" (`raids` route and `RaidsView.vue` keep their names). No tabs: hostile fleets on top, plans below. |
| Plan model | One attack plan for solo and ACS, started from scratch or from a parsed hostile attack. |
| Hostile fleets | Attacks (single and ACS) and espionage on own planets from the overview, later also phalanx results. No own fleets, no friendly hold. |
| Ships | The copied overview text contains ship types and amounts, so the slowest ship is known. |
| Arrival | The overview shows countdown and absolute arrival time; the absolute time is used. |
| Speed steps | 10-100 % in steps of 10. |
| Drive levels | Prefilled from hub data (spy reports / known research of the owner), editable. Warning when older than 3 days. |
| Recall | Supported for the enemy fleet (see timing rules). |
| Visibility | Per group, live for everyone. |
| Computation | In the hub with `@pr0hub/flight`; link into the flight calculator as an extra. |
| Shared code | Flight library in this repository, the standalone calculator lives in `apps/tools`. |
| Retention | Hostile fleets disappear after their latest possible return; plans stay (past ones in their own list). |
| ACS limits | `max_fleets_per_acs` = 16, `max_participants_per_acs` = 5 (lead + 4), as defaults in the universe settings. |
| Enemy inputs | All participants of a plan may change drive levels, windows and the chosen candidate. |

## Data model

One migration (next free number; 020 is `fleet_snapshots`), all rows per group (`groupContext`).

- **attack_plans**: target (g, s, p, planet/moon), target time mode (`fixed` or `enemy`), target time (fixed mode),
  buffer in seconds (enemy mode), note, status (planning, launched, done, cancelled), creator, created/updated.
- **attack_plan_participants**: member, start planet/moon, ships, speed percent, status (invited, ready, launched,
  withdrawn), actual arrival (when launched, from the member's overview paste or by hand). Launch time and arrival
  are computed, not stored.
- **attack_plan_enemy** (0 or 1 per plan): the enemy fleet as seen when the plan was created, copied from the snapshot
  so the plan outlives it: origin (= plan target), target, mission, ships, arrival as seen, first seen arrival
  (delay detection), the other fleets of its ACS (each with ships), owner drive levels and their source/date,
  departure window, recall window and whether the lead or one member was recalled, chosen speed candidate. Newer
  pastes of the same fleet (same origin, target, mission, ships) update the arrival as seen.

Rights: the creator or an admin edits the plan (target, target time, note, status), every participant their own row;
all participants may change the enemy fleet inputs (drive levels, windows, candidate).

## Target time

- **Fixed**: a time typed in (or picked in the calculator).
- **Enemy**: return of the enemy fleet for the chosen speed candidate plus the buffer. When someone changes the drive
  levels, the departure or recall window or picks another candidate, the target time and every participant's launch
  time move live. When the candidates still spread (several speeds possible), the plan shows the spread and the
  chosen one; when the enemy fleet was recalled, the target time becomes the recall return (a range) and the plan
  shows a warning.
- The window is short: the counter must land after the return but before the enemy can send the fleet away again.
  The buffer is part of the plan, and a participant who delays the ACS beyond it is flagged at once.

## Participants and ACS rules

From the game source (`ShowFleetStep3Page`, `FleetFunctions::setACSTime`):

- **Launch time** per participant = target time - own duration (`@pr0hub/flight`: distance, slowest ship, drives from
  the member's research, speed percent), with a countdown. Start planet and ships come prefilled from the member's
  empire page.
- **Lead**: the ACS lead sends an attack and creates the ACS in the game; the others can only join after that. The
  lead is therefore the participant with the earliest launch; anyone who would have to launch before the lead is
  flagged.
- **No limit on the delay** (unlike OGame's 30 %): a fleet that would arrive later than the ACS time pushes the whole
  ACS back by the difference (arrival and return of all members); a faster fleet waits. The plan shows the resulting
  arrival `max(target time, latest participant's earliest arrival)` and who causes the delay, instead of only
  "too late".
- **Limits** `max_fleets_per_acs` and `max_participants_per_acs` (game config, per universe): a fleet beyond them is
  sent as a normal attack (mission 1, no group) without notice and arrives on its own. The plan warns; both values
  go into the universe settings.
- **Returns**: every participant lands back at `arrival + own duration`; recalling the lead recalls the whole ACS with
  one return computed from the lead's launch. The plan shows each participant's return (fleet save).
- **Simulator links**: "TrashSim" and "Simulator im Spiel" with ships and research of all participants and the
  newest spy report of the target, via URL only (nothing runs on game pages). No own battle simulator.

## Enemy fleet analysis (retime)

- **Candidates**: ships are known, so one candidate per speed step (10 rows): outbound duration, launch, return.
- **Departure window** ("not on the overview at 14:05, there at 14:12") filters the candidates; for a single attack
  both ways, for ACS members one-sided (see timing rules).
- **Drive levels** of the owner (owner looked up by origin coords in the galaxy data), prefilled, editable.
- **ACS of the enemy**: each enemy fleet has its own return; a plan follows one of them (usually the one that matters
  for the counter: the biggest or the slowest), the others are shown.
- **Delay**: a newer paste with a later arrival than first seen records the delay; the launch stays where it was.
- **Recall**: the fleet vanished before arrival -> recall window and lead/member; return = `2 * recall - arrival +
  duration + delay` per candidate, a range from the windows, or a lower bound without a departure window.
- **Phalanx** (later): a phalanx result of a returning fleet shows the landing at home directly; that is the target
  time itself.

## Timing rules

Verified in the game source (`pr0game`: `src/Core/FleetFunctions.php`, `src/Pages/Game/ShowFleetStep3Page.php`) and
matching the flight calculator (`getDelayedTimestamps`, `abortHome`, `recallFor` and their tests):

- Sending stores `start_time = now` (real launch), `fleet_start_time = now + duration` (arrival; for an ACS member that
  would be earlier than the ACS time: the ACS time, the fleet waits), `fleet_end_time = arrival + stay + duration`.
- `setACSTime` (a slower fleet joins) adds the delay to arrival, stay end and return of all members, never to
  `start_time`.
- `sendFleetBack` (recall): `return = now + (now - start_time)`; during a hold/trade stay
  `return = now + (arrival - start_time)`. For an `Angreifen` fleet with an ACS group (`MISSION_ATTACK`,
  `fleet_group != 0`) the ACS is deleted and the *same* return, computed from the lead's `start_time`, is written to
  all fleets of the group; a `Verbandsangriff` fleet (`MISSION_ACS`) only recalls itself.

Terms per fleet: `duration` = pure one-way flight time (own slowest ship, own speed percent, drive levels),
`delay` = time the ACS arrival was pushed back after this fleet was sent, `departure = arrival - duration - delay`.

- **Return after impact** (every fleet, also ACS members): `return = arrival + duration`, without any delay.
- **Delays are arbitrary**: adding a slower fleet (and recalling it again) pushes the ACS back for good. `delay >= 0`
  is unknown, and the shown arrival can still move after a paste.
- **Waiting counts like a delay**: an ACS member that joined early waits for the ACS time, so its launch is earlier
  than `arrival - duration` as well.
- **Departure window**: the fleet that set the current ACS time has `delay = 0`, all others may have waited. For a
  single attack the window filters both ways; for ACS members it only rejects candidates whose `arrival - duration`
  lies before the window.
- **Return after recall** = the total flight time so far: `return = recall + (recall - departure)`
  `= 2 * recall - arrival + duration + delay`; it depends on speed, departure, recall moment and delays. Recall of
  the lead: all members get the lead's return; recall of a member: only that fleet.

## Sources: overview text and parser

Sample from the requester (older data):

```text
13:14:00 | 27m 10s Eine Flotten(1 Spionagesonde) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Angreifen

Eine Flotten(1773 Schlachtschiff; 2 Schlachtkreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff

Eine Flotten(1322 Schwerer Kreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff
...
13:14:48 | 27m 58s Eine friedliche Flotten(1193 Zerstörer; 7 Behemoth) vom Spieler Lologolo [PN] vom Mond Ratatoskr [3:193:15] erreicht den Planet Immer Online [3:115:8]. Mission: Halten
```

- An event starts with `HH:MM:SS | <countdown>`; following lines without time belong to the same arrival (ACS
  members). Arrival = copy time + countdown, confirmed by the printed clock.
- Hostile fleets: `Eine Flotten(<ships>) vom <Planet|Mond> <name> [g:s:p] erreicht den ...`, no player name.
- Friendly fleets: `Eine friedliche Flotten(...) vom Spieler <name> [PN] vom ...`, ignored.
- Missions: `Angreifen` (ACS lead or single attack), `Verbandsangriff` (ACS member), `Spionage` for probes.

The parser `packages/parser/src/parsers/fleets.ts` (stored in `fleet_snapshots`) follows the game's templates
(`FlyingFleetsTable::getEventData`, `INGAME.yaml` `cff_mission_*`):

- `own`: "Eine deiner …" / "One of your …".
- `hostile`: "Eine feindliche … vom Spieler …" / "A hostile … from player …" (spying, destroying, …), and an attack or
  ACS attack on the viewer, which the game writes without player name: "Eine Flotten(…)" / "A Fleets(…)".
- `foreign`: peaceful fleets, and ACS fleets attacking someone else ("Eine Verbandsflotte(…)" / "A Fleet in ACS(…)").
- ACS: one event with one timer; the game joins the fleets' sentences with `<br><br>`. In copied text the further
  fleets follow on lines without time, in the page source each fleet has its own `colorMission…` span. All fleets
  of an ACS share the number `acs` (the first is the lead), and the arrival of the lead.
- The player name drops the trailing PM link (`[PN]` / `[PM]`).
- Notifications show an ACS as one entry with the ships of all its fleets.

## Server, live updates, claims

- Endpoints to create, change and delete plans, the enemy fleet and the own participation (rights above).
- **Live via SSE**: the existing `EventBus` (`apps/server/src/events.ts`). Every change sends a `DataEvent` with the
  table names (`attack_plans`, ...); the open tabs load the data again through the normal endpoints, so no game data
  travels past `groupContext`. A new overview paste (fleet snapshot) already arrives as a data event and refreshes the
  hostile fleets and the arrivals of enemy fleets in plans.
- **Claims**: a plan claims its target as "attack" (`target_claims`, migration 018) until the target time.
- Hostile fleets list: from the newest `fleet_snapshots` of all members, merged when several members see the same
  fleet, gone after the latest possible return.

## UI

- Menu "Raid-Planer" above "Raid-Statistiken".
- Top: hostile fleets of the group (enemy ACS grouped), each with "Retime planen".
- Below: plans (current, past), button "Angriff planen"; detail view with target, target time (fixed or from the enemy
  fleet with its candidate table, windows and drive levels), participants with launch countdown, lead, delay and
  limit warnings, returns, simulator links, link into the flight calculator.
- "Angriff planen" also in the action menu of a planet/moon.
- Locales in `de.ts` and `en.ts`, mobile layout below 800 px.

## Built so far

- **`@pr0hub/flight`** (`packages/flight`): distance (linear, ring, sphere), ship speed with drive switch, slowest
  ship, duration, consumption, timestamps (from launch, from arrival, delayed), recall and recall time; custom ship
  catalogs. Ship table incl. 222-232 (not in `install.sql`; 222 from universe 7). Checked against the former
  standalone calculator on 20,000 + 30,000 random cases.
- **Flight calculator** in `apps/tools` (tools index + `flight-calculator/`), calculating with `@pr0hub/flight`;
  Docker target `tools`, deployed from this repository. The hub's `distance()` comes from the library.
- **Fleet movements parser** and `fleet_snapshots` (`8e47c56`), gaps above.

## Order

1. Parser gaps (hostile classification, ACS member lines): done; check against further real pastes when available.
2. ACS and timing rules in `@pr0hub/flight`: done. `planAttack` (launch per fleet, lead, resulting arrival with delays,
   late fleets, limits, returns; checked against a step-by-step simulation of the game's sending) and
   `retimeCandidates` (per speed step: launch range, departure window, first seen arrival, return after impact and
   after a recall; random real flights always lie in their candidate's range).
3. Attack plans from scratch: migration, endpoints, rights, live updates, claims, UI.
4. Hostile fleets list and "Retime planen": enemy fleet, candidates, windows, drive levels, target time mode `enemy`.
5. Simulator links, phalanx source.

## Still open

1. **Test data**: the full Ctrl+A copy of an overview with an attack (with server clock line), a hostile espionage
   probe, the English texts, and a copied phalanx result (incl. a return flight).
2. **Phalanx**: is the phalanx window copyable as one text, and does it show the ships?
3. **English texts**: the English templates are taken from the game's language files, not yet from a real paste.

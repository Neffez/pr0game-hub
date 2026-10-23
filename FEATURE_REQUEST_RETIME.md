# Feature request: raid planner (attack plans and retime)

Status (2026-10-23): usable. Attack plans (solo, ACS, against a player with rough times) and retime on hostile
attacks are live in the raid planner, with recall detection, launched fleets from the own overview and flight
calculator links. Open: simulator links, phalanx source, ACS limits per universe, browser check, test data (see
"Still open").

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
| Hostile fleets | Attacks (single and ACS) and destroy missions on members from the overview, later also phalanx results. Espionage is shown in the notifications, not as a retime target. No own fleets, no friendly hold. |
| Ships | The copied overview text contains ship types and amounts, so the slowest ship is known. |
| Arrival | The overview shows countdown and absolute arrival time; the absolute time is used. |
| Speed steps | 10-100 % in steps of 10. |
| Drive levels | Prefilled from hub data (spy reports / known research of the owner), editable. Warning when older than 3 days. |
| Recall | Supported for the enemy fleet (see timing rules). |
| Visibility | Per group, live for everyone. |
| Computation | In the hub with `@pr0hub/flight`; link into the flight calculator as an extra. |
| Shared code | Flight library in this repository, the standalone calculator lives in `apps/tools`. |
| Retention | Hostile fleets disappear after their latest possible return; plans stay (past ones in their own list). |
| ACS limits | `max_fleets_per_acs` = 16, `max_participants_per_acs` = 5 (lead + 4); for now constants (`ACS_LIMITS` in `@pr0hub/flight`). |
| Target and time | A plan names a player and/or coordinates (coordinates may follow); the time is a day, around an hour or the exact impact. |
| Own ships | Picked from the start planet or from all own ships (planets, moons, in flight), added with the maximum, editable. |
| Enemy inputs | All participants of a plan may change drive levels, windows and the chosen candidate. |

## Data model (as built)

All rows per group (`groupContext`).

- **attack_plans** (migration 025, rebuilt in 026): creator, target player (`player_id`, optional) and coordinates
  (optional until known, planet/moon), `target_time` with `time_precision` (`day`, `hour`, `exact`), note, status
  (planning, launched, done, cancelled), `claim_id` (the "attack" claim made for the plan). A plan needs a player or
  coordinates.
- **attack_plan_fleets** (025): one row per fleet (a member may send several): member, start planet/moon (empty while
  only invited), ships, speed percent, status (invited, ready, launched, withdrawn). Launch time, arrival and return
  are computed (`planAttack`), not stored.
- **attack_plan_enemy** (027, 0 or 1 per plan): the hostile attack the plan answers, copied when the plan was made:
  member it headed for, origin (= plan target) and target, its fleets (lead first, mission and ships), the followed
  fleet, arrival as last seen and as first seen, owner's drives with source (`spy`/`manual`) and date, departure and
  recall window, `recall_lead`, chosen speed `percent`, `buffer`, who changed it last. The attack is recognised again
  by its route and the ships of the lead fleet (`attackKey`).

Rights: creator or group admin edit the plan (target, time, note, status, invitations, deletion); every member their
own fleets; every participant (and the creator/admins) the enemy inputs.

## Target time

- **By hand**: the day, around an hour, or the exact impact. Launch times, lead and the delay/limit warnings need
  coordinates and an exact time; "around an hour" shows approximate launches.
- **Retime**: the chosen speed candidate's return home (after impact, or the earliest return after a recall) plus the
  buffer. The client derives it and saves it with the enemy inputs; every participant's launch time follows. Without
  a chosen candidate the plan keeps the return at full speed plus 1 s it started with (default buffer 1 s: 0-1 s is a good retime, 2-3 s poor, from 4 s very poor).
- The claim follows the target time (until 10 minutes after it) and the coordinates.

## Participants and ACS rules

From the game source (`ShowFleetStep3Page`, `FleetFunctions::setACSTime`), built as `planAttack`:

- **Launch time** per fleet = target time - own duration (distance, slowest ship, drives from the member's newest
  empire page, speed percent), with a countdown; drives unknown or older than 3 days are flagged.
- **Lead**: the fleet with the earliest launch (it sends the attack and creates the ACS); anyone who would have to
  launch before the lead is flagged.
- **No limit on the delay** (unlike OGame's 30 %): a late fleet pushes the whole ACS back; the plan shows the resulting
  arrival and which fleet causes it.
- **Limits** 16 fleets / 5 players: fleets beyond them (in launch order) are marked "outside the ACS" (the game sends
  them as a normal attack without notice).
- **Returns** per fleet after the resulting arrival.
- **Launched**: when the member's newest overview shows an own attack (missions 1, 2, 9) from the fleet's start to
  the plan's target, landing from an hour before the target time until an hour after its end, the fleet becomes
  "launched" and carries `seen` (real arrival, paste time; as the fleet sharing setting lets the viewer see it); the
  table shows the real arrival against the target time.
- **Flight calculator** per fleet of an exact plan ("timing" mode: start, ships, speed, drives, target time).
- **Simulator links** ("TrashSim", "Simulator im Spiel"): not built yet.

## Enemy fleet analysis (retime, as built)

- **Candidates** (`retimeCandidates`): one per speed step: duration, enemy launch (exact for a single attack, an upper
  bound / range in an ACS), return home after impact or after a recall (range); candidates that don't fit the windows
  are greyed out and cannot be picked.
- **Followed fleet**: in an ACS the one with the most ships by default (not the lead's probe); after a recall of the
  lead the lead's candidates count for all fleets.
- **Drives** of the owner (owner by the origin's galaxy data) from the newest spy report with research, editable.
- **Delay**: a newer overview paste of the same attack with a later arrival updates it; the first seen arrival stays,
  the panel shows the delay.
- **Recall**: entered as a window. When the attack vanished from the attacked member's overview before its arrival,
  the panel suggests the window from the last paste with it to the first paste without it (`recallWindow`,
  `recall_seen`); one click takes it over (as a recall of the lead).
- **Flight calculator**: link in "retime" mode with the followed fleet, drives, arrival (and the first seen one),
  recall, chosen speed, and the viewer's own fleet in the plan as the counter (start, slowest ship, drives, buffer).

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

## Server, live updates, claims (as built)

- `routes/plans.ts`: `GET`/`POST /api/:uni/plans`, `PUT`/`DELETE /api/:uni/plans/:id`, `POST /api/:uni/plans/:id/fleets`,
  `PUT`/`DELETE /api/:uni/plans/:id/fleets/:fleet`, `GET /api/:uni/hostile-attacks`, `POST /api/:uni/plans/retime`,
  `PUT /api/:uni/plans/:id/enemy`.
- `repo/hostile.ts`: hostile attacks from the newest `fleet_snapshots` of all members (incoming fleets are always
  shared), missions attack, ACS attack and destroy, an ACS as one attack, the same attack seen twice once; listed until
  the latest possible return (10 % without drive research).
- **Live via SSE**: every change publishes a `DataEvent` (`attack_plans`, with claims also `target_claims`); the page
  reloads on it and on new fleet pastes (`fleets`). Countdowns tick on their own (`Countdown`, `clock.ts`), the plan
  state only at launches, target times and plan ends, so open drop-downs are not reset.
- **Claims**: "attack" claim on the target once coordinates are known, until 10 minutes after the target time; moved
  with new coordinates, released on cancel, done or delete.

## UI (as built)

- Menu "Raid-Planer" above "Raid-Statistiken" (formerly "Raids"); "Angriff planen" in the action menu of a planet/moon.
- Top: hostile attacks on members with countdown, origin and owner, "Retime planen" (or "Retime geplant").
- Plans (current, past): target (player and/or coordinates), time by precision with countdown, delay and limit
  warnings, lead; retime panel for plans with an enemy fleet; fleets table with start, ships, speed, flight time,
  launch with countdown and flags, return, status; own fleet form; invitations; status buttons; edit target and time.
- Tests: server (`test/plans.test.ts`), web (`test/plans.test.ts`, page smoke test `test/raid-planner.test.ts` in
  happy-dom).

## Built

1. **`@pr0hub/flight`** (`packages/flight`): distance (linear, ring, sphere), ship speed with drive switch, slowest
   ship, duration, consumption, timestamps (from launch, from arrival, delayed), recall and recall time, custom ship
   catalogs, `planAttack`, `retimeCandidates`. Ship table incl. 222-232 (222 from universe 7). Checked against the
   former standalone calculator (20,000 + 30,000 random cases), a step-by-step simulation of the game's ACS sending,
   and random real flights for the retime ranges.
2. **Flight calculator** in `apps/tools`, Docker target `tools`, deployed from this repository.
3. **Fleet movements parser**: hostile attacks without player name and ACS fleets grouped (`acs`), from the game's
   templates; notifications show an ACS as one entry.
4. **Attack plans** (025, 026): solo/ACS, against a player with rough times, coordinates later, ships from the start
   planet or all own ships.
5. **Retime** (027): hostile attacks list, retime plans, shared enemy inputs, delays from new pastes.
6. **Follow-ups**: recall detection from the overview pastes, launched fleets from the own overview with the real
   arrival, flight calculator links from fleets and the retime panel.

## Still open

1. **Simulator links**: "TrashSim" and "Simulator im Spiel" with ships and research of all participants and the newest
   spy report of the target, via URL only (check the parameters both simulators accept).
2. **Phalanx as source**: a phalanx result of a returning fleet gives the landing at home directly (target time without
   candidates). Needs a copied phalanx text (also: is the window copyable as one text, does it show the ships?).
3. **ACS limits per universe**: the 16 / 5 are constants; move them into the universe settings if universes differ.
4. **Check in a real browser**, also the mobile layout (not possible here: headless Chrome does not run on this
   machine); so far only the happy-dom smoke tests.
5. **Test data**: the full Ctrl+A copy of an overview with an attack (with server clock line), the English texts
   (taken from the game's language files so far), a copied phalanx result, an own ACS fleet in the overview (to check
   the launched detection with an ACS member's mission).

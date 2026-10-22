# Feature request: retime calculation

Status: plan / open questions. Not implemented yet.

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

`codeberg.org/Neffez/pr0game`, branch `feature/flight-calculator` (commit `ccb8e971`), standalone build
`tools/flight-calculator/index.html`, hosted at `https://pr0game.neffez.dev/flight-calculator/`.

- `scripts/game/flightCalculator.js` ports the server's `FleetFunctions`: `getTargetDistance` (incl. ring
  universes), `getShipSpeed` (drive switch per tech level, e.g. small cargo / recycler / bomber), `getFleetMaxSpeed`,
  `getMissionDuration` (floor like the server, `MIN_FLEET_TIME = 5`), `getFleetConsumption`, `sendFleetBack` timing.
- It already has a **retime mode** (`mode=retime`, `arr=`): known arrival → departure and return per speed percent
  (`getTimestampsFromArrival`), table "Alle Geschwindigkeiten".
- State lives in the URL hash (start `sg/ss/sp`, target `tg/ts/tp`, research `c/i/h/fe/ex`, universe
  `mg/ms/mp/ut/gt/gdf/sdf/sd/pdf/pd/gs`, ships, mode).
- Self-tests at the end of the file (incl. retime round trips).

### Hub

- `apps/web/src/format.ts`: `distance()` and `flightTime()` (ports of the same server functions, but without the
  drive switch per ship and without `MIN_FLEET_TIME`), `flightCalcLink()` builds a share link into the calculator
  (used by `PlanetActions.vue`, "Flugzeit berechnen").
- `packages/parser/src/parsers/overview.ts`: parses the overview (HTML and copied text), but only the build queues and
  the server clock (`parseServerClock`), not the fleet events.
- Ship speeds/drives: needs checking whether `packages/parser/src/data/` already has them; otherwise take them from the
  calculator's ship table.

## Plan

1. **Parser**: extend `parseOverviewText` (and the HTML variant) with fleet events: mission, origin coords + name,
   target coords, arrival as absolute time (server clock + timer, or the printed arrival time), own/foreign/friendly,
   ships when present. Tests with real pasted overviews.
2. **Shared flight math**: move the server ports into `@pr0hub/core` (one module: distance, ship speed with drive
   switch, fleet speed, duration with floor and minimum, timestamps from arrival). Cross-check against the
   calculator's self-test values so hub and calculator agree to the second.
3. **Candidate engine**: input = fleet event + universe settings + drive levels (+ known ships, + departure window,
   + stay for hold missions); output = sorted candidates `{ship class, percent, outbound, departure, return}`,
   filtered by the departure window; identical return times merged.
4. **UI** (new view or section on the overview page): paste box → list of foreign fleets → per fleet the candidate
   table, departure window inputs, editable drive levels (prefilled), "open in flight calculator" link with
   `mode=retime` and the values filled in. Locales in `de.ts` and `en.ts`. Mobile layout below 800 px.
5. **Server (optional)**: store pasted fleet events per group (`groupContext`) so the group sees retimes; migration
   only if this is wanted (see questions).
6. Changelog entry, tests (`pnpm test`), typecheck.

## Open questions

1. **Which fleets?** Only foreign fleets arriving at own planets, or also own fleets / sensor phalanx results / ACS?
2. **Ships in the copied text:** Does the Ctrl+A text of the overview contain the ships of a foreign fleet, or only the
   tooltip in the HTML? Without ships every ship class is a candidate. Needed: a real pasted overview with a foreign
   attack (and one with espionage) as test data.
3. **Arrival time in the text:** absolute time or only the countdown? A countdown needs the server clock of the
   paste (`parseServerClock`) and is only exact to the second at copy time.
4. **Drive levels source:** spy reports in the hub, other hub data, or manual only? How old may they be before the hub
   warns?
5. **Missions with stay:** should hold (ACS defend) and expedition-like stays be supported, or attack/spy only?
6. **Recall:** account for a recalled fleet (return = recall time + elapsed outbound)? The calculator already has
   `abortHomeUnix`.
7. **Visibility:** keep the paste local in the browser, or store it for the group?
8. **Calculator vs. hub:** compute everything in the hub (shared core module), or only parse in the hub and hand off to
   the calculator via its retime link? Recommendation: compute in the hub (needed for filtering many candidates),
   keep the link for the details.
9. **Fleet speed setting:** pr0game allows 10–100 % in steps of 10 only? (Calculator assumes `speedFactor` 1–10.)
10. **Shared code with pr0game-tools:** should the calculator later import the core module, or stay a separate port
    kept in sync by test values?

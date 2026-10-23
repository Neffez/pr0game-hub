# Changelog

Every commit adds its changes here, newest first, grouped by date.

## 2026-10-23

- Combat simulator links: plans with coordinates link the simulator in the game and TrashSim (`battlesim.html` of the
  universe) with the target's newest spy report (`spy` on plans; research missing in it from the owner's newest report
  with research); the spy history links TrashSim next to the game simulator (`simLinks` in `format.ts`).

- Raid planner:
  - Fleets in flight: when a member's newest overview shows an own attack (attack, ACS attack, destroy) from a plan
    fleet's start to the plan's target, landing around the plan's time, the fleet is marked launched and the table
    shows its real arrival against the target time (`seen` on plan fleets, as the fleet sharing setting allows).
  - Recall detection: a retime attack that vanished from the attacked member's overview before its arrival suggests
    a recall window (last paste with it .. first paste without it, `recall_seen` on the plan enemy, `recallWindow` in
    `repo/hostile.ts`); one click takes it over.
  - Links into the flight calculator: every fleet of an exact plan ("timing" mode: start, ships, speed, drives, target
    time) and the retime panel ("retime" mode: followed enemy fleet, drives, arrival and delay, recall, chosen speed,
    the viewer's own fleet as the counter with the buffer). `flightCalcLink` takes extra share-link keys.

- Raid planner, retime: the default buffer after the enemy's return is 1 s instead of 5 s; the panel rates the buffer
  (up to 1 s good, 2-3 s poor, from 4 s very poor). Existing plans keep their buffer.

- Raid planner: the speed of a fleet is a drop-down right in the fleets table (like the status), saved at once, so
  speeds can be tried without opening the fleet form.

- Fleet movements and times:
  - The owner of a foreign or hostile fleet's start comes from the galaxy data when the game names none (attacks):
    served fleets carry `fromPlayer` (`withOrigins` in `repo/fleets.ts`); the fleet list links the player, the bell
    names them.
  - Fleet list: an ACS is one row "Verbandsangriff (n Flotten)" with the ships of all its fleets, opening to the single
    fleets; ship amounts in full numbers (cargo stays short).
  - Times always in 24 hours, also in English (`hourCycle: 'h23'` wherever hours are formatted); the raid planner's
    attack list used the browser's default format.

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`) brought up to date: data model, target time, ACS rules, retime,
  server and UI as built, and the open items (simulator links, phalanx, recall detection, ACS limits per universe,
  calculator link, launched fleets from the own overview, a check in a real browser, test data).

- Fleet history in the alliance view too (all members or the chosen one, newest first), below the fleets in flight.
  New sharing option "Share history" (`history` in the fleet share setting, on by default): off hides the member's
  own fleets from the others' history, fleets that headed for them stay visible. The clock helper `past` lists
  items due within a time window and changes only when one comes due or once a minute.
- Empire view: the fleet history lists the most recent arrival first.
- Raid planner, retime: hostile attacks on members are listed on top of the page (from the members' newest overview
  pastes; an ACS as one attack; until their latest possible return), each with "Retime planen".
  - A retime plan targets the attack's origin and keeps the enemy fleet: which fleet of an ACS to follow (default the
    one with the most ships), the owner's drives (newest spy report with research, or by hand; flagged after 3 days),
    departure and recall window (lead or single fleet recalled) and a buffer.
  - Per speed step the panel shows the enemy's launch (range in an ACS) and return home (after impact or a recall,
    `retimeCandidates`); the chosen candidate plus the buffer becomes the plan's target time, so all launch times
    follow. Every participant may change the inputs; a newer paste of the same attack updates its arrival (delays).
  - Server: `GET /api/:uni/hostile-attacks`, `POST /api/:uni/plans/retime`, `PUT /api/:uni/plans/:id/enemy`, plans
    carry `enemy`; migration `027` adds `attack_plan_enemy`; the server uses `@pr0hub/flight` now.

- Empire view: collapsible history of past fleet movements (last 12 hours, oldest first) below the fleets in flight.
  Fleet lists are no longer pruned to the newest per member but kept for 12 hours (plus the newest older one);
  each list contributes the fleets arriving until the next list was synced, so recalled fleets are left out.
  The history follows the member's fleet sharing setting. Test for history and retention.
- Pages with timers no longer render completely every second: empire and alliance view tick only their resources,
  countdowns and fleet timers (`<Ticker>` and `<Countdown>` share one second clock in `clock.ts`); arrived fleets,
  finished queues, expired notifications and claims change their lists only when something actually runs out
  (`upcoming`). Before, open selects, tooltips and text selections on these pages were reset every second.
  Test for the empire page.
- Admin panel:
  - Sync table restructured: sortable by time, member and content (sort control on mobile), Reparse and Delete side
    by side, one line per result count ("1 new · 0 duplicate"), source column dropped (uploads say "universe.json"
    in the content).
  - Members table sortable; nobody can remove themselves, and the hub owner (first global admin) can be neither
    removed nor demoted (`remove_self`, `owner_protected`); the owner is marked in the list.
  - Alliances can be renamed (`PUT /api/admin/groups/:id`, name unique per universe).
  - Mobile: form fields take the full width, sync cards show content and result one entry per line.
- Raid planner: open drop-down lists no longer lose their highlight every second. The page rendered again with every
  tick of the countdowns; countdowns are now their own component on one shared second clock, and the plan state
  (late, delays, current or past) only moves at the next launch, target time or end of a plan, at least every minute.
  A test counts the page's renders.

- Admin sync table: a "Content" column describes each sync per record kind with a few names or coordinates (top
  players of a statistics page with ranking and category, planet names of an empire page, systems, spy report
  targets …). Stored with the sync; syncs from before get it once from their stored page when listed.
- Universe check for the remaining page types, collected over all records of a paste: hostile espionage (spying
  player at known coordinates, target must be an own planet), own fleets (start/home must be own planets), player
  messages (one of the member's planets among sender and recipients; names are not compared because of renames),
  battle hall of a day/week/month, combat reports and other fleets' players (mostly unknown names). Battle,
  expedition and recycling reports name no players and pass on their own.
- Raid planner, own fleet: the ship list has two groups, ships on the start planet and all own ships (all planets and
  moons plus ships in flight from the empire page), so ships still to be moved to the start can be planned too.
  Picking a ship adds it at once with the maximum of its group; the amount stays editable and "max" restores it.
  Without an empire page every ship can be entered by hand.

- Universe check for spy reports and overview pages: spy reports naming mostly other players than the known owners
  and an overview page on a planet of another player than the member's are refused as `wrong_universe`.
- Admin panel: one sync table ("Synchronisationen") with Reparse and Delete per sync replaces the separate
  statistics and empire cleanup sections. Delete parses the stored page again and, after a preview, removes what it
  stored: statistics snapshots (score rows, score events, players nothing else refers to, alliances left without
  reference), empire, overview and fleet pages, spy reports, and the sync entry itself. Galaxy views are reported as
  not removable.
- Raid planner: plans against a player with coordinates and exact time following later.
  - Target: a player (search, `player_id`) and/or coordinates; coordinates can be added or changed later, picked from
    the player's known planets and moons. The "attack" claim is made once coordinates are known and moves with them.
  - Target time with a precision: day, around an hour, or the exact impact. Launch times, lead and delay warnings need
    coordinates and an exact time; around an hour shows approximate launches.
  - Own fleet: the ship list only offers ships on the chosen start planet (empire page) with their amount, "max" adds
    all of a type, amounts stay editable; the start no longer fills in every ship.
  - Times (target time, countdown, delayed arrival, launch) laid out with fixed gaps instead of relying on spaces.
  - Server: `POST`/`PUT /api/:uni/plans` take `player_id`, `time_precision` and null coordinates; migration `026`
    rebuilds `attack_plans` (coordinates nullable, `player_id`, `time_precision`).

- Empire pages of another universe are refused as `wrong_universe`: their planets belong to several other players in
  the galaxy data, or they share no planet with the member's stored empire pages. The admin panel lists the
  members' stored empire pages with their planets and deletes chosen ones (the imperium falls back to the newest
  remaining page).
- Pasted pages are also checked against the universe's own data, plain text included: statistics pages whose
  players (or alliances) are mostly unknown to the group, or galaxy views showing mostly other owners on known
  planets, are refused as `wrong_universe` (preview included). Groups that know few players and short pages are
  not judged.
- Admin panel: "Remove statistics snapshots" lists a group's snapshots (time, ranking, rows, top names) and deletes
  the chosen ones after a preview, with their score events, the players nothing else refers to and alliances left
  without players or scores; players with other data are kept and listed. Meant for statistics pasted into the
  wrong universe.
- Pages pasted into the wrong universe are rejected: the paste's game links (absolute in browser clipboard HTML) or
  the "Universe N" page title must match the universe's game URL (error `wrong_universe`). Switching universes in
  the web app drops the previous universe's context at once, so views and the sync panel can no longer send to the
  universe left behind while the new one loads.
- Raid planner (menu "Raid-Planer" above "Raids", now "Raid-Statistiken"): attack plans of one or more members on one
  target and target time, solo or ACS.
  - Per fleet: start planet and ships prefilled from the own empire page, speed, flight time, launch time with
    countdown and return; lead, late fleets and the resulting ACS delay, ACS limits (`planAttack` of `@pr0hub/flight`
    with the members' drive research; drives unknown or older than 3 days are flagged).
  - Rights: the creator or a group admin edits the plan (time, note, status, invitations), every member their own
    fleets. A new plan claims the target as "attack" until 10 minutes after the target time; cancelling or finishing
    releases it. "Angriff planen" in the action menu opens the form with the target filled in.
  - Live for the whole alliance (`DataEvent` `attack_plans`); plans stay listed a week after their target time.
  - Server: `GET`/`POST /api/:uni/plans`, `PUT`/`DELETE /api/:uni/plans/:id`, `POST /api/:uni/plans/:id/fleets`,
    `PUT`/`DELETE /api/:uni/plans/:id/fleets/:fleet`; migration `025` adds `attack_plans` and `attack_plan_fleets`.
  - Web tests can render components (happy-dom, Vue plugin in the Vitest config); the raid planner page has a smoke
    test.

- New page "What's new" (Account section of the sidebar and the start page): new features and fixes per day in plain
  words, in German and English, from `apps/web/src/changelog.ts`; filled in back to the first version. `CLAUDE.md`
  now requires an entry there with every user-facing `CHANGELOG.md` entry.

- In-game messages: a profile icon next to each known player (messages and conversation headers) opens the player
  dialog; Ctrl/middle click opens the player page in a new tab.
- In-game messages grouped into conversations: all messages with the same partner in one card (partner, number of
  messages, last message), opened as a chat with the user's (or the members') messages on the right. Switch between
  "Conversations" and "Single" on the page.
  - The parser reads the game's thread id and the partner's in-game id from the reply link (HTML only); a later HTML
    copy of a message first pasted as text adds them.
  - Partners are recognised across renames and several game threads: by name, main planet, hub player (current and
    former names) and thread; for the members also by their account.
  - The link on the player page and a click on a name filter by the hub player instead of the name only.

- Account settings: explanations moved into info tooltips next to each setting; the page now uses the full width
  with cards (general, sharing, username, password) in two columns, one column on mobile.
- In-game messages as cards instead of a table: sender → recipients and time on top, then subject and text (left
  aligned, also on mobile), below who synced it and who sees it; sorting by a selection with direction.
  - Colours: players of the own alliance (members and their in-game alliances) blue, other players orange, also as
    the card's edge by sender. A click on a name shows the conversation with that player.
  - Button per own message "Share with alliance" / "Don't share with alliance"; the choice beats the account
    setting for that message (`POST /api/:uni/messages/:id/share`).

- Player details: link "In-game messages" opens the conversations with that player (sent by or to them, former
  names included); the filter shows on the messages page and can be removed there.
- In-game messages: player messages ("Spieler Nachrichten") can be synced like the reports, by HTML, page source or
  plain text, and are listed on the new page "In-game messages" (newest first, sortable, filter by sender and
  recipient).
  - New account setting "Share in-game messages", off by default: then only the member sees their messages; others
    who share theirs are visible to everyone in the alliance. Applies at once, also to messages already synced.
  - A message synced by both sender and recipient (the game keeps one copy each) is listed once, with who synced it.
  - Reports quoted in a player message (e.g. a pasted "Feindliche Spionagesonden …") no longer count as reports.
  - Others get no live hint about new messages of a member who doesn't share them; a reparse never assigns them to
    another member.

- Overview Δ columns: a statistics update off the 6 h grid (e.g. 21:20 before 00:00) is no longer dropped when
  a closer update takes its grid point; it becomes the start of the section, so the change shows up.
- `@pr0hub/flight`: rules for the raid planner.
  - `planAttack`: launch time per fleet for a target time, lead (earliest launch or chosen), late fleets and the
    resulting ACS arrival when they push it back, ACS limits (16 fleets, 5 players), return per fleet. Checked against
    a step-by-step simulation of the game's sending and `setACSTime`.
  - `retimeCandidates`: per speed step of a hostile fleet the possible launch, whether it fits the departure window
    (exact for a single attack, one-sided in an ACS), the return after impact (also after ACS delays) and the return
    range after a recall.

- Hostile attacks in the fleet movements: the game writes an attack or ACS attack on a member without player name
  ("Eine Flotten(…)"), so it counted as a foreign fleet; it is now hostile (empire view in red, notifications).
  - ACS: the further fleets of an ACS (lines without time in copied text, own spans in the page source) were dropped;
    they are kept with the lead's arrival and share the new field `acs` (first fleet = lead).
  - Notifications show an ACS as one entry ("Verbandsangriff (n Flotten)") with the ships of all its fleets.
  - The player name of foreign fleets no longer ends in the PM link "[PN]".
  - Rules from the game's templates (`FlyingFleetsTable`, `INGAME.yaml`), English templates included.

- Fleet sharing covers the member's own fleets only: fleets of others heading for them (incoming attacks, spying)
  are always visible to the alliance, also when the member shares nothing ("own fleets not shared").
- Notifications: no alarm for "attacks" by players of the own alliance (hub members and everyone in their in-game
  alliances, by name or planet), e.g. moon attempts or shooting debris for saving; they stay in the fleet movements.
- Notification list opens above the page content (the ⓘ hint icons covered it).

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`) rebuilt around one attack plan for solo and ACS attacks, started
  from scratch or from a parsed hostile attack (retime), with data model, target time modes, lead and ACS rules, live
  updates, one menu item and the implementation order.

- Notifications: a bell next to the hub name (top bar on mobile) with the number of unseen notifications; it opens a
  list of what the alliance should notice. First kind: hostile fleets heading for a member (member, target, arrival
  with countdown, attacker and ships), taken from the synced fleet movements; a click leads to the fleet movements.
  - While hostile fleets are on their way the bell turns red and the "Fleet" menu entry shows "⚔ n".
  - Seen notifications are remembered per browser; arrived fleets drop out by themselves, new ones appear live.
  - Server: `GET /api/:uni/notifications` (respects each member's fleet sharing).

- Alliance pages (planets, fleet, research) also show members who don't sync their empire page, from the spy reports
  of the other members: per planet/moon each section (buildings, ships, defense) from the newest report showing it,
  research from the newest report with research; marked "spy" with the report time.
  - Also covers players of the members' in-game alliance who are not in the hub; positions now owned by someone else
    or destroyed are left out. New spy reports update open alliance pages live.
  - The overview already combined spy reports and empire pages (newer one wins) and needs no change.

- Alliance fleet page: fleet movements in a tab of their own, first in the order fleet movements, ships, defense.

- Fleet sharing in the account settings: each user decides whether the other members see their fleet movements and
  which missions (attack, transport, deploy, expedition …); all are shared by default.
  - Applies at once and to fleets already synced (filtered when served, not when stored); the own empire view always
    shows everything. A member who shares nothing shows "not shared" instead of "missing".
  - Server: `GET`/`POST /api/auth/fleet-share`, column `users.fleet_share`; a change updates open pages live.

- Fleet movements laid out as a table (cards on mobile): arrival time with seconds, remaining time, member, mission,
  start, target, ships (short names, full list as tooltip) and cargo. Missions in the game's colours (own, foreign,
  return), hostile fleets highlighted; the alliance list can be filtered by member.

- Fleet movements in the alliance: the fleet page lists the fleets in flight of all members (next arrival first,
  with the member and when they last synced), above the ship table.
  - Syncing fleet movements now updates open empire and alliance pages live and shows a hint to the others.
  - Copied event lines are also read when the clock and the timer end up on lines of their own.

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`): ACS planning merged with the retime plan (shared flight math, live
  updates via SSE, target claims, "counter-attack as ACS"), ACS rules from the game source (no delay limit, fleet and
  participant limits), and the gaps of the new fleet movements parser for hostile ACS attacks.

- Fleet movements: the events of the game overview are synced with the whole overview page (text or page source) or on
  their own (select and copy only the event lines). The empire view shows the member's fleets in flight with a
  countdown, mission, route, ships and cargo; hostile fleets in red, arrived fleets drop out by themselves.
  - Arrivals: page time plus remaining seconds (page source: matches the game's arrival timestamp to the second);
    copied lines use the shown arrival clock, so a late paste doesn't shift them.
  - A copied overview with the events shown ("Ausblenden") and none listed clears the list; hidden events keep it.
  - Server: table `fleet_snapshots` (newest per member), `fleets` in `GET /api/:uni/imperium`, page type `fleets`.

## 2026-10-22

- Flight calculator moved into this repository as `apps/tools` (static pages: tools index and
  `flight-calculator/`), now calculating with `@pr0hub/flight`:
  - Same results as before (30,000 random cases compared, incl. custom ships, sphere universes, recalls and ACS
    delays); new: the Heavy Cruiser in the ship list.
  - `@pr0hub/flight` takes custom ship catalogs and sphere layouts ("all galaxies/systems equally far").
  - Tests: the former in-page self-test as unit tests plus a page smoke test (share link -> ships, speeds, results).
  - Docker: `docker build --target tools` builds an nginx image with the tools; the hub image stays the default target.

- Live updates also after saving a player note (the ✎ in the overview, the note in open player details unless it is
  being typed there) and after adding or deleting an expedition result by hand in the deck; before, only syncs,
  claims and comments were pushed.

- Ship data from universe 7: the Schwerer Kreuzer (hyperspace drive, speed 7,500, 500 deuterium) is part of the
  flight library, and the Schwerer Jäger costs 6,500 metal / 3,500 crystal as in the game (install.sql still has
  6,000 / 4,000; the points stay the same).

- Comments: the alliance discusses a player (player details) or a planet/moon (spy history, also without spy
  reports) in a thread, oldest first. Members edit and delete their own comments, alliance admins can delete any.
  - Planets and moons with comments show "💬 n" next to their action menu (galaxy, player details, overview, targets),
    linked to the thread; the menu entry reads "Spy history & comments (n)".
  - New comments appear live and as a hint ("X commented on 1:234:5"), linked to the thread. The single player
    note stays as it is.
  - Merging players moves their comments along.
  - Server: `GET`/`POST /api/:uni/comments`, `GET /api/:uni/comments/counts`, `PUT`/`DELETE /api/:uni/comments/:id`;
    migration `019` adds `comments`.

- Flight library `@pr0hub/flight` (first step of the raid planner, see `FEATURE_REQUEST_RETIME.md`):
  - Distance, ship speed with the drive switch per research level, slowest ship, flight duration, deuterium, launch /
    arrival / return times (also for delayed ACS) and recall, ported from the game's `FleetFunctions` and second-exact
    with the standalone flight calculator.
  - The hub's distance (best start planet in the planet menu, overview) now comes from the library; the unused
    `flightTime()` helper is gone.
  - Developers: build all packages with `pnpm --filter "./packages/*" build` (CI and Docker image do the same).
- Retime feature request: decisions, overview text format and the verified return/recall rules for ACS delays.

- Points of the newer ships: Schwerer Kreuzer, Sturmtransporter, Optimierter Recycler, Behemoth and Void Titan had no
  costs (they are missing in the game's install.sql) and counted 0 points, e.g. in the live points, spy reports and
  fleet values. Their costs are now part of the element data (kept by `pnpm gen:costs`).

- Target claims: a member claims a planet or moon for 30 minutes up to 24 hours (farming, attack or espionage, with
  an optional note) in its action menu, so nobody of the alliance farms or attacks it twice.
  - The claim shows as "🎯 name" next to the target's action menu everywhere (galaxy, player details, overview,
    spy reports, now with an action menu too); the menu shows who claimed it, for what and how long, and lets the
    member extend or release it. Claims run out by themselves; alliance admins can take a claim over.
  - New page "Targets" (section Combat) with all active claims, the own ones first.
  - Updated live in all open tabs; on a phone the action menu stays open while typing the note.
  - Server: `GET`/`POST /api/:uni/claims`, `PUT`/`DELETE /api/:uni/claims/:id`; migration `018` adds
    `target_claims`.

- Imperium live points: ships in flight count in the fleet. The empire page now shows them (✈ in the total column);
  the parser reads them and the live fleet adds them directly instead of estimating from the last statistics update,
  which went wrong when the fleet had been at home at that update and is flying now. Older synced pages keep the estimate.

- Overview: clearing the points or point delta filter now really turns it off. A cleared number field was kept as an
  empty string, counted as 0 and (being stored) kept hiding players after a reload, e.g. everyone without a delta.

- Presence: the sidebar lists, below the menu, the alliance members who have the hub open (the viewer first, counted too), with the page, galaxy system or player
  they are looking at (linked) and a dot for active/in the background; the others below with "last online". The
  galaxy browser and the player page show "👁 name" when another member looks at the same system or player.
  - Server: `GET`/`POST /api/:uni/presence`, `presence` live events; migration `017` adds
    `group_members.last_seen_at`, written when a member's last connection ends.
  - Shutting the server down also closes the sockets of open live streams.

- Live updates: data a member syncs appears in the open hub tabs of the alliance without F5. The server pushes a short
  "what changed" event per group (Server-Sent Events, `GET /api/:uni/events`); the pages load their data again,
  debounced, and a hidden tab only once it is shown again.
  - Galaxy browser: only when the shown system or galaxy was synced; overview, statistics, player details, spy
    history, activity, raids, expeditions, deck, hostile spying, battle hall, empire and alliance pages when their
    data changed. Lists keep their scroll position, a player note being typed and the deck settings stay.
  - A hint shows who synced what (e.g. "X synced: galaxy 3:120, 4 spy reports"), linked to the page; it can be turned
    off in the account settings.
  - All tabs of a browser share one connection. Events never carry game data, every member loads it through the
    normal group-scoped endpoints; logged out or removed members' streams end at the next heartbeat.
  - Developers: `events.ts` (server, `EventBus`), `live.ts` (web, `useLive`/`useLiveReload`); `useProgressive` takes
    an optional `resetOn` source.

- Developers: the web app has unit tests (`apps/web/test`, Vitest in Node with a minimal `document`/`localStorage`
  stand-in): number and date formatting per language, `useSort`, `useLoader` (only the newest answer applies),
  `useProgressive` and the alliance fallback of `selectedGroup`.
- Developers: `@pr0hub/core/tech` exports `METAL`, `CRYSTAL`, `DEUTERIUM`, `RESOURCES` and `STORAGE` (storage building
  per resource); the web app uses them instead of the ids 901–903 in its calculations and resource lists.
- Developers: empire pages stored before moon detection get their planet types once (migration `016`) instead of
  on every read; `withMoonTypes` is gone. The parser marks moons by `MOON_BASE` from `@pr0hub/core/tech`.
- Empire, live points: the fleet keeps counting fleets in flight right after a statistics sync. It is based on the
  newest fleet or total statistics update that has an empire page synced after it, instead of only the newest update
  (which dropped back to the ships on the planets until the next empire sync). The remaining warning, when no such
  pair exists, is just a ⚠ with a tooltip.
- Overview: the filters at the top have their spacing back, and on mobile the lists also render more rows while
  scrolling when the filters are folded away (the end-of-list marker shared a class name with the filters).
- Overview: the planet and player lists render 150 rows at first and the next ones while scrolling (no pages, the
  row count stays the full one). Opening, sorting and filtering large lists only cost the rendered rows; sorting or
  filtering starts the table at the top again. On mobile the browser also skips layout and painting of cards out of
  sight.
  - Developers: `useProgressive(list)` (`composables.ts`) returns the rendered part and a sentinel ref for the end of
    the list.
- Admin and user settings open inside the universe from its sidebar (`/<uni>/admin`, `/<uni>/account`): the menu stays,
  there is no back link, and the admin page preselects the universe's current alliance. From the start page they
  still open as standalone pages.
- Empire, live points: the header no longer repeats the Δ in parentheses behind the live points (it is in the table).
  A category whose statistics come from an older update than the total points shows that date, with a tooltip
  explaining why its Δ differs from the total's (the total is synced more often and already contains the changes).
- Developers: the overview's Δ calculation is a pure function (`scoreEntry` in `domain/stats.ts`, with a unit test),
  and context, imperium and alliance read a member's newest empire page through `latestEmpire` (`repo/empire.ts`)
  instead of their own queries.
- The own player of an alliance member is found the same way everywhere (own row and alliance in the statistics,
  imperium, own planets in the overview, comparison in the player details): the owner of a planet on the member's
  newest empire page, otherwise the player with their in-game name (also a former name), without one their hub
  username. Before, statistics and imperium only looked at the in-game name.
  - Developers: `memberPlayers`/`memberPlayer` (`repo/members.ts`) and `latestScores` (`repo/stats.ts`, newest score
    per player and category) replace four and three separate lookups.
- Empire live points:
  - The live fleet is anchored on the newest fleet or total statistics update. The total is synced far more often
    than the fleet category; its fleet is the total minus the other points of the first empire page after it. Before,
    ships built between an old fleet update and the next empire page were missing, so the live sum could fall below
    the statistics.
  - Live catch-up bonus: the maximum bonus (100 − the universe's `catchup_percent`) is at least the overview value
    when it cannot be derived, instead of falling back to 50 %. Universes with a higher maximum showed about half the
    real bonus.
- Developers: the server routes are split by topic (`routes/overview.ts`, `players.ts`, `spy.ts`, `galaxy.ts`,
  `reports.ts`, `deck.ts`, `imperium.ts`, shared helpers in `routes/util.ts`); statistics windows and the 6 h grid
  live in `domain/stats.ts`, the phalanx range in `domain/phalanx.ts` and the members' newest empire pages in
  `repo/empire.ts`.
- Developers: the sync is split up: `ingest.ts` (entry points: ingest, reparse, activity backfill), `store.ts`
  (writes the parsed records) and `repo/players.ts` (`Players`: finding and creating players and alliances by id or
  current/former name, shared with the routes).
- Battle report archive: reports of attackers shot down in the first round (the game shows "Contact with the attacking
  fleet was lost" instead of a report) are marked "no report" in the battle hall and the admin counts; before, the
  worker took this page for maintenance and paused the whole universe again and again.
- Developers: player status parsing is shared: `statusFromSpans` reads the status spans of statistics and galaxy
  pages, `UNIVERSE_JSON_STATUS` (`@pr0hub/core`) is the one table of universe.json status letters for import and
  export, and the activity mark behind planet names is one regular expression.
- Developers: spy report sections are recognized with `json_extract` instead of a text search, element ids and
  sections use the constants of `@pr0hub/core/tech` (new: `MOON_BASE`, `PHALANX`), and the battle hall query is
  written with its table alias instead of rewriting the SQL with a regular expression (which contained control
  characters and never matched).
- Admin: universe settings are validated: sizes (galaxies, systems, positions, fleet speed) must be whole numbers ≥ 1,
  distance factors numbers ≥ 0 and the circular options yes/no, so a typo no longer breaks distance, flight time and
  phalanx calculations.
- Large tables render faster: number and date formatters are created once per language instead of for every value,
  and sorting the overview by building, fleet or defense points no longer builds the tooltip texts for each comparison.
- Faster queries: "inactive since" in the overview no longer compares every status entry with every other, raids,
  recycling and expeditions use an index for their time range (migration `015`), and the session is only loaded for
  API requests, not for the static files.
- A player's spy reports are also found when the name in the report differs in upper/lower case, and are looked up
  through indexes instead of scanning all reports of the alliance.
- Sync: a pasted HTML page is loaded and turned into text once instead of up to four times.
- Galaxy browser, overview, raids and player details read the members' empire pages once per request instead of up
  to three times.
- Battle report archive: a report in the hall of several alliances of the same universe is fetched from the game once
  and archived for each of them. The search for the next report uses an index instead of scanning the whole hall
  every few seconds. Migration `014` turns the old status "no game URL" into pending.
- An older spy report synced later no longer changes the planet: owner, name and moon only follow a report that is
  newer than the system's galaxy view and the other reports of the position. Spy reports also find the player by a
  former name.
- Players only known by id from a universe.json ("Spieler #123") get their real name with the next statistics or
  galaxy paste, also from older data, and the placeholder no longer shows up as a former name or in the search.
  Migration `013` fixes players stored before; the universe.json download leaves placeholder alliance names out too.
- Synced game overview pages keep only the newest per member, empire pages the newest plus those of the last 7 days
  (the live fleet in the imperium needs the first empire page after the last fleet statistics update). Older pages
  were never read; migration `012` removes the ones stored so far.
- Login hardening: failed logins are also limited per IP (30 per 15 minutes, across all usernames), and passwords are
  checked asynchronously, so many login attempts no longer block the server.
- Pasted pages (raw data for reparsing) are deleted after 14 days (`RAW_RETENTION_DAYS`); uploaded universe.json files
  are no longer stored at all, only their result in the sync log. Synced data and statistics stay. The admin's sync
  log offers "Reparse" only for entries that still have their page.
- Fast navigation shows the data that was asked for last: stepping through the galaxy, switching the member in the
  imperium or deck, the category in the statistics, the player in the details or the universe no longer lets an older,
  slower answer overwrite the current one. Loading errors in the deck, expeditions, raids, hostile spying and the
  galaxy page are shown instead of failing silently.
  - Developers: `useLoader(fetch)` (`composables.ts`) gives `data`, `error` and `load()` and applies only the newest
    answer.
- Battle reports, expeditions, recycling and hostile spying synced once as HTML and once as text are stored once:
  the sync recognizes the copy by its content (two messages with different message ids still count twice, e.g.
  expeditions with the same result in the same second) and fills in the message/report id the text lacks. Migration
  `011` removes such copies stored before, so the expedition deck and raid totals no longer count them twice.
- The overview loads faster and no longer slows down as the round goes on: it reads only the last week of statistics
  (plus each player's newest score before it) instead of the whole history, and per position only the newest spy
  report per section instead of all reports. Players without statistics in the last week keep their latest points
  but get no Δ values.
- Overview: the planet view only warns about outdated total points; older fleet, research, building or defense
  statistics are still marked in the coverage tooltip, and the player view still warns about every category.
- Fixes from the code review:
  - A stored alliance the user is no longer a member of (removed, deleted, other account in the same browser) no
    longer locks the universe; the hub falls back to the first alliance.
  - Merging players keeps their activity log entries.
  - Raids, recycling and expeditions are summed per member instead of per display name (members with the same name
    or deleted users no longer fall together).
  - Hostile spying without a parsed time is listed again.
  - Alliance admins can't remove or demote the last admin of their alliance.
  - Player notes (max. 5000 characters) and deck settings are validated; negative limits no longer lift the limit of
    the spy report lists.
  - The planet action menu no longer leaves its listeners behind when closed right after opening.
  - Faster sync: SQL statements are compiled once and reused (a universe.json import prepared them per planet),
    time zone formatters are cached, and a galaxy view reads the system's planets once.
  - Developers: migration `010` drops two indexes that duplicated the tables' `UNIQUE` constraints.
- The battle report archive pauses per universe: a universe whose game is unreachable (e.g. maintenance) no longer
  blocks the others. The admin page lists each paused or stopped universe with its error.
- The remaining wide tables become cards on mobile: statistics, battle hall, raids, expeditions, expedition deck,
  hostile activity, the planets in the player details and the admin tables. Each row shows its title (e.g. player or
  time and target) and below it "label … value" pairs in two columns.
  - Developers: `v-stack` (`composables.ts`) on a `table.data` copies the column headers into the cells; `v-stack="n"`
    puts the first n cells into the title line, `m-wide` cells take a whole line and `m-hide` cells are left out.
- Planets, fleet and research on mobile show one card per planet or member with the levels/counts as a grid
  (fleets with full names in two columns) and a sort selection instead of the wide tables.
- Spy reports on mobile: the recent reports are a two-line list, the spy history shows one block per report with
  name and value (and the change) per entry, like the report in the game; also in the player details.
- Overview on mobile shows a two-line list instead of the wide tables: player, alliance, coordinates and actions,
  below them points, Δ6h, spy age and resource sum plus the value the list is sorted by. Sorting is a selection
  above the list, tapping the values shows all of them. The player view shows the five categories with their Δ,
  and the filters beyond the player search fold away behind a "Filters" button. The desktop tables are unchanged.
- Imperium on mobile shows cards instead of the wide planet table: totals first, then one card per planet (moons
  marked blue), with the queues and their countdowns as lines and each resource as value and storage with a fill
  bar and "full in …" instead of a tooltip. The desktop table is unchanged.
- Imperium: the live points table no longer runs past the screen edge on mobile; the "without fleets in flight" note
  wraps and the table scrolls inside its card if needed.
- Sync: the galaxy view can be pasted as copied text. The copy has no galaxy/system, so the sync form asks for
  them ("1:234") and counts the system up after saving, for the next system. Players are matched by name; the same
  input also completes copied galaxy HTML without its form.
- Sync: the game overview can be pasted as copied text (no HTML needed, e.g. on mobile browsers); queues, the
  current planet or moon, the server time and the catch-up bonus are read from the text. Remaining times of the
  other planets are rounded as shown in game.
- Sync: the preview button is gone; the preview also follows typed or edited text automatically (after a short pause),
  as it already did for pasting and file uploads.
- Overview galaxy filter is a selection of the universe's galaxies and hidden in universes with a single galaxy;
  a stored galaxy that does not exist in the universe no longer hides all planets.
- The overview table is always shown, like in the FF-Hub: every known player (also only from galaxy views or spy
  reports) is listed with the latest points available, missing statistics just leave their columns empty.
- Overview Δ columns follow the 6 h statistics grid like the FF-Hub: each column is one section (0, 6, 12, 18 o'clock)
  back from the newest synced update. A missed update no longer shifts the older columns; the change across the gap
  shows in the newer column and the spanned column stays empty. Updates off the grid (test server) count for the
  section they fall into.
- Empire live points show the catch-up bonus: the value from the synced game overview next to a live value computed
  from the live points against the player with the most weighted points (buildings ×1, research ×0.8, fleet ×0.6),
  like the game's formula. The overview parser now reads the bonus line.
- Docs: `CONTRIBUTING.md` (pull request workflow, guidelines) and `CODEOWNERS` requiring the maintainer's review.
- Docs: README gets a tech stack overview and more development notes (commands, parsers, migrations, group context, locales).
- Docs: personal rules (such as the commit author) move from `CLAUDE.md` to a gitignored `CLAUDE.local.md`.
- Docs: README in English with an updated feature list and a link to the pr0game source on Codeberg; this changelog; `CLAUDE.md` with the repository rules.
- Add the MIT license.
- CI: after green tests on `main`, trigger the deployment via `repository_dispatch` (target repository and token are secrets) instead of deploying from this repository.
- Ingest API: drop the unused `url` field.
- Quick sync: series mode – after saving, "next page" reads the clipboard again.
- Mobile tab bar: my empire and activity instead of galaxy and spy reports.
- Mobile UI:
  - Top bar and bottom tab bar below 800 px; the sidebar becomes a flyout drawer behind "More".
  - Quick sync bottom sheet with paste from clipboard; the sync logic is shared with the sync page.
  - Galaxy browser: position cards instead of the wide table, swipe and a step bar to change systems, the system strip as a drag scrubber, collapsible phalanx list.
  - Touch fixes: tooltips as a sheet, larger menu targets, 16 px inputs, scrollable tabs and admin tables.
- Battle report crawler: backs off while the game is unreachable and pauses after `CRAWLER_GIVE_UP_HOURS`; the admin page shows the archive state and can resume the worker.
- Localization: web app in German and English, language per user; server errors carry stable codes. The galaxy freshness map moved to the bottom of the galaxy page.
- Live points on the empire page, overview deltas per statistics update, pirate language ("pi") of the SetSail theme, element costs for shield domes, special defenses and missiles.

## 2026-10-21

- Accounts and admin: users can change their username, admins can rename users, universe settings and the expedition deck are edited with form fields.
- New menu structure with SVG icons; "Paste" renamed to "Sync" with the universe.json upload on that page.
- Parser: English date format and battle summaries, honor points ranking, alliance rankings with member counts, moon names.
- universe.json download, statistics page, expedition deck reset and manual events, expedition yields per member.
- Code review fixes: login rate limit and hardening, input validation in the admin API, reparse without uploader, deck regeneration, robust URL parsing, escaped search wildcards.
- Commit the generated element data.
- Initial version: parser package (DE/EN, HTML/source/plain text), Fastify + SQLite server and Vue SPA; sync of statistics, messages, galaxy, empire, overview and battle hall; overview, empire, galaxy browser, activity, alliance, spy history, raids, expeditions and expedition deck; battle hall archive with crawler; invite-based accounts and admin tools; Dockerfile and CI.

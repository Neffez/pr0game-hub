# Changelog

Every commit adds its changes here, newest first, grouped by date.

## 2026-10-22

- Presence: the sidebar lists the alliance members who have the hub open, with the page, galaxy system or player
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

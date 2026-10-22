# Changelog

Every commit adds its changes here, newest first, grouped by date.

## 2026-10-22

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

# Changelog

Every commit adds its changes here, newest first, grouped by date.

## 2026-10-22

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

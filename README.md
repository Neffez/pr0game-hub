# pr0game Hub

External analysis tool for [pr0game](https://codeberg.org/pr0game/pr0game) based on **manually copied pages**: open a page in the game,
`Ctrl+A`, `Ctrl+C`, paste it into the hub. Data is collected per universe and group (alliance) and is only visible to members of that group.

## Features

- **Sync**: plain text, HTML from the clipboard, page source (`Ctrl+U`) or a saved page, with a preview before saving.
  - Statistics (players/alliances, all categories incl. honor points)
  - Messages: spy, battle, expedition and recycling reports, hostile spying
  - Galaxy, empire, game overview (build queues), battle hall
  - universe.json import and export
- **Overview**: points per category with deltas per statistics update, rank changes, status, filters
- **My empire**: live points from the latest empire page plus finished builds and research
- **Statistics**: rankings with rank moves, change since the previous update and sync coverage
- **Player details**: points history (chart), planets, status history, notes
- **Galaxy browser** with phalanx coverage and a freshness heat map
- **Spy history** with a diff per coordinate, **hostile spying**, **activity log**
- **Alliance**: planets, fleets and research of all members
- **Raids** (incl. recycling), **expeditions**, **expedition deck** (card counting), **battle hall** archive
- **Admin**: universes (size, distance factors, fleet speed, time zone, deck), groups, invite links, ingest log with reparse, player merge
- **Live**: what a member syncs shows up in the open hub tabs of the alliance without reloading, with a short hint
  who synced what (can be turned off in the account settings); who of the alliance is online and where (page, galaxy
  system, player), and when the others were last online
- German and English UI, per user; mobile layout with a bottom tab bar and quick sync from the clipboard

Player IDs, alliance IDs and rank changes are only available in HTML/page source. With plain text, players are matched by name.

## Tech stack

| Area | Technology |
|---|---|
| Language | TypeScript (strict) throughout, ES modules |
| Runtime / tooling | Node.js 22, pnpm workspaces (monorepo) |
| Parser | [cheerio](https://cheerio.js.org/) for HTML, own plain-text parsers; game element names and costs generated from the game source |
| Server | [Fastify 5](https://fastify.dev/) with `@fastify/cookie` and `@fastify/static`; [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (SQLite) with numbered SQL migrations; session cookies, scrypt password hashes |
| Web app | [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`), [Vue Router 4](https://router.vuejs.org/), [vue-i18n](https://vue-i18n.intlify.dev/) (German/English), [Chart.js](https://www.chartjs.org/); plain CSS with custom properties, no UI framework |
| Build | [Vite 5](https://vitejs.dev/) and `vue-tsc` for the web app, `tsc` for parser and server, `tsx` for the server in development |
| Tests | [Vitest](https://vitest.dev/): parser tests against saved game pages (`packages/parser/test/fixtures`), API tests with Fastify's `inject` against an in-memory database, web unit tests for formatting and composables |
| Delivery | Multi-stage Docker image (`node:22-bookworm-slim`), the server serves the built SPA; GitHub Actions for typecheck, tests and build |

## Structure

```
packages/parser   @pr0hub/core – page parsers, deck calculation, element data (DE/EN)
apps/server       Fastify + SQLite: auth, ingest, data APIs, battle report crawler; serves the SPA
apps/web          Vue 3 SPA (base path /hub/)
scripts           generators for the element data (gen:tech, gen:costs)
```

## Development

Requires Node.js 22 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm --filter @pr0hub/core build   # web and server import the built parser package

# server (port 3000) + Vite (port 5173, proxies /hub/api)
ADMIN_BOOTSTRAP_USER=admin ADMIN_BOOTSTRAP_PASSWORD=changeme pnpm --filter @pr0hub/server dev
pnpm --filter @pr0hub/web dev
# -> http://localhost:5173/hub/
```

```bash
pnpm typecheck   # tsc / vue-tsc in all packages
pnpm test        # vitest in parser, server and web
pnpm build       # parser, server and web app
```

- New game pages are supported by adding a parser in `packages/parser/src/parsers/` and a fixture with a test.
- Schema changes go into a new numbered file in `apps/server/migrations/`; migrations run on startup.
- Every game-data query goes through the group context (`apps/server/src/context.ts`), so data never leaves its group.
- UI texts live in `apps/web/src/locales/` (`de.ts`, `en.ts`); the mobile layout starts below 800 px.

Element names and costs are generated from the game source ([codeberg.org/pr0game/pr0game](https://codeberg.org/pr0game/pr0game))
checked out next to this repository: `pnpm gen:tech` and `pnpm gen:costs`.

First start: log in with the bootstrap admin and create a universe (e.g. `u8`) and a group under **Admin**, then create invite links.

Changes are recorded in [CHANGELOG.md](CHANGELOG.md). Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration (env)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `BASE_PATH` | `/hub` | path prefix behind the proxy |
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite database `hub.db` |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | – | creates the first admin while no user exists |
| `SECURE_COOKIES` | `true` in production | |
| `SESSION_DAYS` | `30` | |
| `BODY_LIMIT_MB` | `8` | |
| `RAW_RETENTION_DAYS` | `14` | pasted pages are kept this long for reparsing (universe.json uploads are not kept) |
| `CRAWLER_ENABLED` | `true` | background archiving of public battle reports |
| `CRAWLER_INTERVAL_MS` | `5000` | |
| `CRAWLER_GIVE_UP_HOURS` | `6` | pause the crawler after the game was unreachable this long |

## Deployment

Docker image (`Dockerfile`, port 3000, volume `/data`), configured with the environment variables above.

Live updates use Server-Sent Events (`GET /hub/api/:uni/events`): a reverse proxy in front of the hub must not buffer
that response (the hub sends `X-Accel-Buffering: no` for nginx) and should allow idle connections longer than the
25 s heartbeat.

CI (`.github/workflows/ci.yml`): typecheck, tests and build on every push and pull request. After green tests on `main` it can
send a `repository_dispatch` to a deployment repository (secrets `DISPATCH_REPO` = `owner/name` and `DISPATCH_TOKEN` = a token
with write access to its contents); without the secrets this step is skipped.

## License

MIT, see [LICENSE](LICENSE).

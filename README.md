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
- German and English UI, per user; mobile layout with a bottom tab bar and quick sync from the clipboard

Player IDs, alliance IDs and rank changes are only available in HTML/page source. With plain text, players are matched by name.

## Structure

```
packages/parser   @pr0hub/core – parser (cheerio), deck calculation, element names (DE/EN)
apps/server       Fastify + SQLite (better-sqlite3), auth, ingest, APIs, serves the SPA
apps/web          Vue 3 SPA (base path /hub/)
```

## Development

```bash
pnpm install
pnpm --filter @pr0hub/core build
pnpm test

# server (port 3000) + Vite (port 5173, proxies /hub/api)
ADMIN_BOOTSTRAP_USER=admin ADMIN_BOOTSTRAP_PASSWORD=changeme pnpm --filter @pr0hub/server dev
pnpm --filter @pr0hub/web dev
# -> http://localhost:5173/hub/
```

Element names and costs are generated from the game source ([codeberg.org/pr0game/pr0game](https://codeberg.org/pr0game/pr0game))
checked out next to this repository: `pnpm gen:tech` and `pnpm gen:costs`.

First start: log in with the bootstrap admin and create a universe (e.g. `u8`) and a group under **Admin**, then create invite links.

Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

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
| `CRAWLER_ENABLED` | `true` | background archiving of public battle reports |
| `CRAWLER_INTERVAL_MS` | `5000` | |
| `CRAWLER_GIVE_UP_HOURS` | `6` | pause the crawler after the game was unreachable this long |

## Deployment

Docker image (`Dockerfile`, port 3000, volume `/data`), configured with the environment variables above.

CI (`.github/workflows/ci.yml`): typecheck, tests and build on every push and pull request. After green tests on `main` it can
send a `repository_dispatch` to a deployment repository (secrets `DISPATCH_REPO` = `owner/name` and `DISPATCH_TOKEN` = a token
with write access to its contents); without the secrets this step is skipped.

## License

MIT, see [LICENSE](LICENSE).

# pr0game Hub

External analysis tool for [pr0game](https://codeberg.org/pr0game/pr0game) based on **manually copied pages**: open a page in the game,
`Ctrl+A`, `Ctrl+C`, paste it into the hub. Data is collected per universe and group (alliance) and is only visible to members of that group.

## Features

- **Sync**: plain text, HTML from the clipboard, page source (`Ctrl+U`) or a saved page, with a preview before saving.
  - Statistics (players/alliances, all categories incl. honor points)
  - Messages: spy, battle, expedition and recycling reports, fleet returns, hostile spying, player messages
  - Galaxy, empire, game overview (build queues, fleet movements), buildings and research pages, fleet movements on their own, battle hall
  - universe.json import and export
- **Overview**: points per category with deltas per statistics update, rank changes, status, filters
- **My empire**: live points from the latest empire page plus finished builds and research, fleets in flight
- **Build & research**: per own planet/moon like the game's buildings and research pages (two tabs): level,
  requirements, cost of the next level, missing resources and when they are there (production up to the storage plus
  resources of landing fleets), build and research time (catch-up bonus, robot/nanite factories, labs with the research
  network, TechnoDome), locks like the game; a bell per element notifies (hub bell, push, Discord) once the next level is
  possible
- **Statistics**: rankings with rank moves, change since the previous update and sync coverage
- **Player details**: points history (chart), planets, status history, notes
- **Comments**: the alliance discusses a player or a planet/moon in a thread (player details, spy history), with a
  💬 count next to the planet
- **Galaxy browser** with phalanx coverage and a freshness heat map
- **Spy history** with a diff per coordinate, **hostile spying**, **activity log**
- **In-game messages**: synced player messages as conversations per partner (chat view) or single, sortable and
  filterable by sender and recipient; private unless the member shares them (account setting or per message)
- **Alliance**: planets, fleets, fleet movements and research of all members (each member chooses which fleet
  missions they share)
- **Targets**: members claim a planet or moon for a while (farming, attack, espionage) so nobody hits it twice;
  the claim shows next to the target everywhere and runs out by itself
- **Raid planner**: own attacks, solo or ACS, landing at the second, also as retime on hostile attacks (return
  candidates per speed with departure and recall windows): launch times, lead, delays and ACS limits per
  member fleet, live for the whole alliance; the target is claimed as "attack"
- **Raid statistics** (incl. recycling), **expeditions**, **expedition deck** (card counting), **battle hall** archive
- **Admin**: universes (size, distance factors, fleet speed, time zone, deck), groups, members (including placeholders by in-game name with claim links), ingest log with reparse, player merge
- **Notifications**: bell with hostile fleets heading for members (from the synced fleet movements), raid planner
  invitations, new comments in your threads, your launch times and full storages on your planets (by the production
  and landing fleets since the last synced page); also as **push notifications** on desktop and phone
  (switched on per device under Account, each kind can be chosen) and to **Discord**: a personal webhook per user
  (own settings) and an alliance channel set by the alliance admins (attacks on members, new raid plans, launch
  reminders, members mentioned by their Discord user ID)
- **Live**: what a member syncs shows up in the open hub tabs of the alliance without reloading, with a short hint
  who synced what (can be turned off in the account settings); who of the alliance is online and where (page, galaxy
  system, player), and when the others were last online
- German and English UI, per user; mobile layout with a bottom tab bar and quick sync from the clipboard

Player IDs, alliance IDs and rank changes are only available in HTML/page source. With plain text, players are matched by name.

## Standalone tools

Next to the hub, the deployment ships static pr0game tools (`apps/tools`) that work **without the hub**: no login,
no server, everything is calculated in the browser. The tools index at `/` links them and the hub. All tools are in
German and English, keep their input locally in the browser and put it into share links (URL hash).

- **Flight calculator** (`/flight-calculator/`): second-exact with the game's `FleetFunctions` (the same code as the
  hub's raid planner, `@pr0hub/flight`)
  - **Flight time**: departure → arrival and return, distance and fuel consumption
  - **Timing**: arrival → departure, when to send a fleet to land at a given second
  - **Retime**: when a hostile fleet is back home, including ACS delays
  - **Recall**: fleet save and recall times
  - **Counter-attack**: send times for your own fleet to land on the enemy home planet right after their fleet returns
  - Universe settings (galaxies, systems, distance factors, fleet speed) and drive research levels
- **ACS loot calculator** (`/acs-loot/`): shares the loot and debris of an ACS among up to 5 participants over
  several battles; a pasted battle report fills in participants, ships, losses and loot, recycling reports the
  debris. Covers losses and deuterium first, splits the profit equally or by investment and suggests deliveries
  with as few flights as possible.
- **IPM calculator** (`/ipm-calculator/`): interplanetary missiles against a planet's defense: destroyed and
  remaining defense per type (interceptors, primary target, weapons and armour as in the game), missiles needed,
  range, flight time and the cost against the value destroyed; a pasted spy report fills in the target.
- **Battle simulator** (`/battle-simulator/`): runs a battle many times on the game's own battle engine (Battlerust,
  with stun of ion cannons and shield domes): win chance, losses per unit (average and range), rebuilt defense, debris
  field and recyclers, loot and moon chance, flight time and fuel per attacker, and the rounds of a typical battle.
  ACS with several attacking and holding fleets; a pasted spy report fills in the planet; debris percentages and moon
  chance are universe settings.

The hub links into the tools with prefilled values (e.g. from spy reports and the raid planner), but every tool can
be used on its own.

## Tech stack

| Area | Technology |
|---|---|
| Language | TypeScript (strict) throughout, ES modules |
| Runtime / tooling | Node.js 24 (LTS), pnpm workspaces (monorepo) |
| Parser | [cheerio](https://cheerio.js.org/) for HTML, own plain-text parsers; game element names and costs generated from the game source |
| Server | [Fastify 5](https://fastify.dev/) with `@fastify/cookie` and `@fastify/static`; [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (SQLite) with numbered SQL migrations; session cookies, scrypt password hashes |
| Web app | [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`), [Vue Router 4](https://router.vuejs.org/), [vue-i18n](https://vue-i18n.intlify.dev/) (German/English), [Chart.js](https://www.chartjs.org/); plain CSS with custom properties, no UI framework |
| Build | [Vite 5](https://vitejs.dev/) and `vue-tsc` for the web app, `tsc` for parser and server, `tsx` for the server in development |
| Tests | [Vitest](https://vitest.dev/): parser tests against saved game pages (`packages/parser/test/fixtures`), flight math tests, API tests with Fastify's `inject` against an in-memory database, web unit tests for formatting and composables |
| Delivery | Multi-stage Docker image (`node:24-trixie-slim`), the server serves the built SPA; GitHub Actions for typecheck, tests and build, and on `main` publishing the images to `ghcr.io/neffez/pr0game-hub` and `ghcr.io/neffez/pr0game-tools` |

## Structure

```
packages/parser   @pr0hub/core – page parsers, deck calculation, element data (DE/EN)
packages/flight   @pr0hub/flight – flight times, recall and fuel like the game's FleetFunctions
packages/loot     @pr0hub/loot – ACS loot settlement: loot shares, covering losses, profit split, transfers
packages/battle   @pr0hub/battle – battle simulation on the game's Rust engine (Battlerust as WebAssembly)
apps/server       Fastify + SQLite: auth, ingest, data APIs, battle report crawler; serves the SPA
apps/web          Vue 3 SPA (base path /hub/)
apps/tools        static pr0game tools next to the hub: tools index, flight, ACS loot and IPM calculator, battle simulator
scripts           generators for the element data (gen:tech, gen:costs)
```

## Development

Requires Node.js 24 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm --filter "./packages/*" build   # web and server import the built packages

# server (port 3000) + Vite (port 5173, proxies /hub/api)
ADMIN_BOOTSTRAP_USER=admin ADMIN_BOOTSTRAP_PASSWORD=changeme pnpm --filter @pr0hub/server dev
pnpm --filter @pr0hub/web dev
# -> http://localhost:5173/hub/

# tools (flight calculator), no server needed
pnpm --filter @pr0hub/tools dev
# -> http://localhost:5174/flight-calculator/, /acs-loot/, /ipm-calculator/ and /battle-simulator/
```

```bash
pnpm typecheck   # tsc / vue-tsc in all packages
pnpm test        # vitest in all packages
pnpm build       # all packages and apps
```

- New game pages are supported by adding a parser in `packages/parser/src/parsers/` and a fixture with a test.
- Schema changes go into a new numbered file in `apps/server/migrations/`; migrations run on startup.
- Every game-data query goes through the group context (`apps/server/src/context.ts`), so data never leaves its group.
- UI texts live in `apps/web/src/locales/` (`de.ts`, `en.ts`); the mobile layout starts below 800 px.

Element names and costs are generated from the game source ([codeberg.org/pr0game/pr0game](https://codeberg.org/pr0game/pr0game))
checked out next to this repository: `pnpm gen:tech` and `pnpm gen:costs`. Combat values of units missing in the game's
`install.sql` (later ships, stun, ship shields) live in `packages/battle/src/live.ts`.

The battle simulator uses the game's battle engine [Battlerust](https://github.com/Tsaranoga/Battlerust) (Rust, by
Tsaranoga, used with permission), built to WebAssembly at a pinned commit in the `battle-wasm` stage of the
`Dockerfile`. `pnpm build:battle` exports it to `packages/battle/wasm/` (needs Docker, no Rust toolchain); the battle
package's tests and the tools build need it.

First start: log in with the bootstrap admin and create a universe (e.g. `u8`) and a group under **Admin**, then add members (claim links appear in the members table).

## API (read-only tokens)

The hub exposes the same JSON the web app uses under `{BASE_PATH}/api` (default `/hub/api`). Under **Account** you can create personal **read-only** API tokens (`hubpat_…`). Send `Authorization: Bearer …` and, for universe routes, the alliance group id as `X-Hub-Group` (or `group` query parameter).

OpenAPI 3.1: `GET /hub/api/openapi.json` (also `.yaml`). Token management requires a browser session cookie; data endpoints accept Bearer tokens for GET requests only.

The one exception is the battle simulator for scripts and AI agents, `POST /hub/api/{uni}/battle/simulate`: it fights a
battle many times on the game's engine (in a worker thread with a time limit) and returns win chances, losses, debris,
loot, moon chance, flight times and a link to the battle simulator page. Without a planet in the request it takes the
group's newest spy report of the target. It writes nothing, so read-only tokens may call it; see the OpenAPI spec
(`simulateBattle`) for the request and the limits.

```bash
curl -H "Authorization: Bearer hubpat_…" -H 'X-Hub-Group: 1' -H 'Content-Type: application/json' \n  -d '{"attackers":[{"units":{"207":200,"203":50},"research":{"109":12,"110":12,"111":12}}],"target":"1:110:8"}' \n  https://hub.example/hub/api/u8/battle/simulate
```

Changes are recorded in [CHANGELOG.md](CHANGELOG.md). Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration (env)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `BASE_PATH` | `/hub` | path prefix behind the proxy |
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite database `hub.db` |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | – | creates the first admin while no user exists |
| `TRUST_PROXY` | `1` | proxies trusted for `X-Forwarded-For` (Fastify `trustProxy`): hop count, `true`/`false` or comma-separated IPs/CIDRs; the login limit counts per client IP |
| `SECURE_COOKIES` | `true` in production | |
| `SESSION_DAYS` | `30` | |
| `BODY_LIMIT_MB` | `8` | |
| `RAW_RETENTION_DAYS` | `14` | pasted pages are kept this long for reparsing (universe.json uploads are not kept) |
| `CRAWLER_ENABLED` | `true` | background archiving of public battle reports |
| `CRAWLER_INTERVAL_MS` | `5000` | |
| `CRAWLER_GIVE_UP_HOURS` | `6` | pause the crawler after the game was unreachable this long |
| `PUBLIC_URL` | – | public origin of the hub (e.g. `https://hub.example.org`); Discord messages link to the hub's pages only when it is set |
| `PUSH_CONTACT` | – | contact for the push services (`mailto:…` or `https://…`); push notifications are off without it. The VAPID keys are created on the first start and kept in the database |

## Deployment

Docker image (`Dockerfile`, port 3000, volume `/data`), configured with the environment variables above.

The static tools are a second target of the same Dockerfile: `docker build --target tools .` gives an nginx image
with the tools index at `/`, the flight calculator at `/flight-calculator/` (the hub links there), the ACS loot calculator at
`/acs-loot/`, the interplanetary missile calculator at `/ipm-calculator/` (the hub links there from spy reports) and the
battle simulator at `/battle-simulator/`.

Push notifications need outbound HTTPS from the hub to the browsers' push services (Google, Mozilla, Apple, Microsoft),
Discord notifications to `discord.com`.

Live updates use Server-Sent Events (`GET /hub/api/:uni/events`): a reverse proxy in front of the hub must not buffer
that response (the hub sends `X-Accel-Buffering: no` for nginx) and should allow idle connections longer than the
25 s heartbeat.

CI (`.github/workflows/ci.yml`): typecheck, tests and build on every push and pull request. After green tests on `main` it can
send a `repository_dispatch` to a deployment repository (secrets `DISPATCH_REPO` = `owner/name` and `DISPATCH_TOKEN` = a token
with write access to its contents); without the secrets this step is skipped.

## License

Copyright (c) 2026 Neffez. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
You may use, modify and fork the hub, but if you run a modified version as a network service or distribute it, you must
offer its complete source code to its users under the same license. Versions up to 2026-10-25 were published under the
MIT license; copies obtained under it stay MIT.

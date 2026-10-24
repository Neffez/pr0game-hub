# Changelog

Every commit adds its changes here, newest first, grouped by date.

## 2026-10-24

- Battle reports copied as text: the parser recognises them in pasted text (not only in HTML), reads the attacked
  planet or moon from the first defender (`CombatReportRecord.target`, null on public pages) and is tested against a
  real German ACS report (`combat-report-de.txt`: three rounds, two fleets per player, the new damage analysis).
  - `battleFromReport` and `localEpoch` moved into `@pr0hub/loot` for the loot calculator and the hub.
  - Loot calculator: report times are read as the player's local time (the game shows that when logged in), so the
    24 h deadline is no longer off by one or two hours.

- Raid planner, loot settlement page (`/:uni/raid-planner/:id/loot`, link "Settle loot" on launched and done attack
  plans): shows the draft from the hub's data or the saved settlement with the source of each value (battle report,
  plan fleet, returning fleet, recycling report), lets participants, the creator and admins change the settings,
  costs, loot and helper shares, save it, refill it from the hub's data or take over a share link of the loot
  calculator; result and deliveries are computed live with `@pr0hub/loot`, senders and receivers tick off their
  deliveries. "Open in the loot calculator" passes the settlement to the public tool (`lootCalcLink`, next to the
  universe's flight calculator URL).
  - `GET /plans/:id/settlement` also returns the plan's target and time (`plan`) and whether the caller may save
    (`can_edit`).

- Raid planner, loot settlement API: `GET /plans/:id/settlement` returns the saved settlement of an attack plan and
  a draft prefilled from the hub's data (participants from the plan's fleets and guest fleets, battles at the target
  around the plan's time with fleets and losses from the archived battle report, loot of returning fleets in the
  overviews, recycling reports at the target within 24 hours with members outside the plan as helpers, deuterium of
  the attack flights), each with the result of `@pr0hub/loot`. `PUT` saves it (participants, creator, admins),
  `PUT …/settlement/done` marks a delivery done, `DELETE` removes it (`raid_settlements`, migration 044).
  - Archived battle reports keep the loot (`combat_reports.loot_*`, also in `GET /combat-reports/:id`).

- New public tool: ACS loot calculator (`apps/tools/acs-loot/`, served at `/acs-loot/`, card on the tools index).
  Up to 5 participants, several battles (waves), recycling by participants and helpers; pasting the battle report
  fills in participants, ships, losses and loot. Shows what everyone holds, costs, covered, gets and the balance,
  suggests deliveries (editable, with what is still open and a copyable text), the 24 h sharing deadline and rates
  outside 75-125 % of the market. German and English, state in localStorage and in share links (`#s=…`, also
  readable by the hub via `encodeShare`/`decodeShare` and `cleanState` of `@pr0hub/loot`).

- New package `@pr0hub/loot`: settles an ACS for the standalone loot calculator and the hub. It shares a battle's
  loot by the free cargo space of the surviving fleets like the game, covers the participants' costs (lost ships,
  missiles, flight and recycler deuterium) and the recycling helpers' part (kept percentage plus their deuterium),
  makes up for a missing resource at market rates, covers the same share of everyone's costs when the pot is too
  small, splits the profit equally or by the value of the ships sent and suggests transfers with few flights.

- Groundwork for the ACS loot calculator: the battle report parser reads the captured resources
  (`CombatReportRecord.loot`, German and English wording), `@pr0hub/core/combat` exports the battle report parser
  without the HTML parsers (no cheerio, for the static tools), and `@pr0hub/flight` knows the cargo capacity of every
  ship (`CAPACITY`, `fleetCapacity`, spy probes left out on raids as in the game).

- Fleet alerts: a bell on each own fleet in flight in the Imperium (own view) notifies at its arrival or 1–10 minutes
  before (bell, web push, the member's Discord webhook), e.g. when recyclers are back.
  - New table `fleet_alerts` (migration 043) with the movement as last seen; matched again against each newer fleet
    list by mission, phase, start, target and an arrival within 5 seconds. Alerts whose fleet is missing from a newer
    list before its arrival (recalled) and alerts arrived more than 10 minutes ago are removed.
  - `PUT /fleets/alerts`, `DELETE /fleets/alerts/{id}`, `fleetAlerts` on `GET /imperium`, notification kind `fleet`,
    push/Discord setting `fleets` (default on); the push and Discord ticks look at a group at its next reminder time.
  - Push texts name more missions (transport, deploy, hold, colonize, harvest, expedition) in the user's language.

- Sync for another member: the sync page and the quick sync sheet have a "For" drop-down with the group's members
  (default: oneself), e.g. for a recycling report a member sent. The data counts for the chosen member
  (`forUser` on `POST /ingest`, must be a member of the group, otherwise `member_not_found`); the member who pasted
  it is kept in `raw_ingests.synced_by` (migration 042) and shown in the admin sync list.
- Raid planner, own attacks in flight: attacks, ACS attacks and destroy missions on the members' newest overviews
  without a plan on the target (within an hour of the arrival) are listed at the top (`GET /own-attacks`), only for
  their participants (own fleet, or a joined ACS fleet from the member's planet by the galaxy data). "Plan"
  (`POST /plans/own`) creates a launched plan with the exact arrival, one launched fleet per member with the ships
  flying (speed 100 %) and the target claim; from then on everyone sees it.
  - ACS fleets of non-members are kept with the plan as guest fleets (`attack_plans.guests`, migration 041) and go
    into the combat simulators with their player's research from spy reports.

- Raid planner, fleets seen in flight:
  - A plan fleet that flies with other ships than planned shows them, with a button to take them into the plan (any
    member who may edit that fleet); `seen` of a plan fleet now carries the `ships` flying.
  - A foreign ACS fleet in another participant's overview only counts for a member when the galaxy data does not
    name another player as the owner of its start; among equal matches the one with the planned ships wins.

- Raid planner, fleets in flight:
  - A plan fleet missing from its member's overview counts as launched when another participant's overview shows it
    as a foreign fleet on the same route (same ACS), with that arrival; a lead that has not synced is no longer taken
    as not launched.
  - The return home of a launched fleet follows from the arrival its overview shows, no longer from the planned ACS
    arrival (which moved on with the clock while the lead counted as not launched).
  - The launch column of a launched fleet says that it shows the arrival.

- Raid planner: hostile attacks stay in the list after their impact, until their latest possible return, so a retime
  can still be planned while the enemy flies home. They come from the member's older fleet lists once a newer overview
  no longer shows them (so they no longer vanish, and a retime plan on them no longer reads as recalled); marked
  "arrived", without the hold button (`POST /plans/hold` answers `attack_arrived`).

- Research checked against a real research page (now a parser fixture): every cost (exact catch-up bonus 10.5058 %
  behind the shown 10.51 %) and research time (research speed 5000, own lab plus three network labs) matches the game.
  - The research page's requirement lines ("Forschungslabor (Stufe 10/5)") are read (`ResearchRecord.known`): the
    planet's lab level at page time, and the levels of research the page leaves out with the game's "hide useless"
    setting (they kept an older level before). The research speed is derived with that lab level.

- Build & Research review fixes:
  - A newer overview merges into the queue of a buildings page by the running entry: entries before it count as
    finished (their levels rise), the ones after it stay queued, also when a research page is newer than the buildings
    page (the waiting entries were dropped, so a queued level could show as buildable and notify).
  - Opening the page from a notification no longer resets the selected planet on every tab switch.
  - A synced research page delivers research alerts right away (not only on the next tick); alerts removed while
    loading the page update the bell on other tabs; the universe setting `universityFactor` is limited to 100.
  - The research speed derived from a research page uses the lab levels of the empire page synced closest to it (a
    later lab upgrade made it wrong) and the research network level shown on the page.
  - The push and Discord ticks look at a group's building alerts only when one may be ready (`AlertSchedule`: the
    earliest ready time, re-checked at least every 15 minutes, planned anew by every delivery) instead of recomputing
    every member's notifications every 30 seconds.

- **Build & Research** (renamed from Buildings, route `/build`, `/buildings` redirects; Start menu now Overview,
  Statistics, My Empire, Build & Research) with a buildings tab and a new research tab:
  - Research per planet like the game's research page: next level (account wide queue counted), requirements (labs and
    research), cost with the catch-up bonus, missing resources, ready time with production and landing fleets, research
    time like `getBuildingTime` (lab levels with the intergalactic research network like `getNetworkLevel`, TechnoDome
    with the new universe setting `universityFactor`, research speed derived from a research page or the new setting
    `researchSpeed`), the game's filter groups and "not useful" past `max_useful_level`. Planets without a lab show it;
    a research lab or TechnoDome in any build queue blocks research (`busy.lab`).
  - The research page is a new sync type (`research_snapshots`, newest per planet): research levels, the whole queue
    with its ends, the lab lock, the planet's resource bar, exact costs and times (and the catch-up bonus behind them).
  - Research levels and queue come from the newest of research page, overview and empire page; finished entries raise
    the levels. The buildings' research lock now lasts until the last queued research ends.
  - Alerts, hidden list and notifications cover research (`🔬 … erforschbar`, links to the research tab).
  - `gen:costs` also writes `research.json` (max level, last useful level, requirements).

- Buildings page, catch-up bonus checked against a real buildings page (now a parser fixture):
  - Costs and build times use the exact bonus behind the page's costs (the page prints it rounded to two decimals,
    which was off by tens of resources); after a newer statistics sync the bonus is calculated like the game's
    `getCatchUpFactor` (own buildings ×1 + research ×0.8 + fleet ×0.6 against the leader's, at most 50 %). The page
    shows the source.
  - Costs and missing resources rounded like the game's `pretty_number`; fields taken from the buildings page.
  - Leader query of the catch-up points shared by the Imperium and the buildings page (`catchUpLeader`).
  - Demolitions in the build queue: the game queues them with the level they take down ("Metallmine 25 Abreißen"
    leaves 24); the buildings page (next level, factories after the queue, finished builds) and the Imperium's live
    points (a finished demolition was never subtracted) now read them that way.

- Buildings page follow-ups:
  - Hidden buildings are kept in the hub account (`users.hidden_buildings`, `PUT /api/{uni}/buildings/hidden`) instead
    of the browser, so they apply on every device; a list hidden in the browser before is moved over once.
  - Locks like the game: research lab and TechnoDome while research runs (account wide), nanite factory and shipyard
    while the planet's shipyard works (state `busy`); from the empire markers, the overview queues (research with its
    end) or "Busy" on a synced buildings page, the newest wins. The ready time waits for a known end; alerts fire only
    once the building is free.
  - Build time with the robot and nanite factories after the build queue (like adding a job now); the time shown on a
    buildings page is used only while no factory is queued.

- Buildings page: buildings can be hidden and shown again (✕/👁 per building, for all planets, kept per browser;
  "show hidden" lists them dimmed), plus a free text name filter next to the group filters.

- **Buildings page** (new menu entry under Start): the own planets and moons like the game's buildings page.
  - Levels, requirements (own/needed), cost of the next level (catch-up bonus included, queued levels counted),
    missing resources, state (buildable, missing resources, requirements, max level, no free fields, storage too small,
    no production) and build time (building speed derived from a synced buildings page, else the new universe setting
    `buildingSpeed`).
  - Time until the resources are there: production per hour up to the storage plus the cargo of fleets landing on the
    planet (own transports/deployments, return flights such as recycling or raids, transports of others).
  - Source: the newest empire page, or the planet's buildings page when newer. The buildings page (HTML/page source)
    is a new sync type (`building_snapshots`, newest per planet); its resource bar gives resources, storage and
    production, its blocks the exact costs and build times.
  - Building alerts (`building_alerts`, one per building and level): a new notification kind `building` on the bell,
    for push and the personal Discord webhook (setting `buildings`, default on), checked by the reminder ticker;
    alerts whose level is built or queued are removed. API: `GET /api/{uni}/buildings`, `PUT /api/{uni}/buildings/alerts`,
    `DELETE /api/{uni}/buildings/alerts/{id}`.
  - `@pr0hub/core/buildings`: building costs, build time, requirements, resource timeline with arrivals (shared by web
    and server; the Imperium's live resources use it too); `gen:costs` also writes `buildings.json` (planet types, max
    level, requirements from install.sql).

- Raid planner hold plans show the fleet on the attacked planet, filled in from the member's empire page (else the
  planet's newest spy report) and editable, e.g. when ships are sent away before the impact; the combat simulator
  links use it in place of the planet's ships. Stored in `attack_plan_enemy.planet_ships` (migration `037`, null takes
  the source again), set with `planet_ships` on `PUT /api/{uni}/plans/{id}/enemy`, returned as `enemy.planet_ships`
  (OpenAPI description of `GET /api/{uni}/plans` updated). On hold plans the attacked member may change the enemy
  inputs too, also without a fleet in the plan.

- Raid planner hold plans get the combat simulator links too (game simulator and TrashSim), with the sides swapped:
  the enemy fleets attack with the attacking player's research from the newest spy report showing it (drives as in
  the plan), the defended planet (fleet, defense, resources, research from the attacked member's empire page, else
  its newest spy report) and the plan's hold fleets defend (game simulator: one defender slot per fleet from the
  second slot on; TrashSim: one defender row per fleet). `GET /api/{uni}/plans` now returns `spy` for hold plans and
  `enemy.research`/`enemy.research_time` (OpenAPI description updated). The link "Simulator im Spiel" is now called
  "Kampfsimulator" ("Combat simulator").

- Fleet parser: the return of a harvest to a moon ("zurück zum Planeten Mond Ra [3:200:1]") is read as the moon
  "Ra" instead of a planet named "Mond Ra"; tests cover an own ACS attack with friendly fleets ("Verbandsflotte")
  as copied text and as page source (new fixture `overview-acs.html`).

- Universe settings: changing distances or fleet speed recalculates the target time of open retime plans (planning or
  launched, still ahead): it moves by the change of the enemy's return home under the new settings, so a target set by
  hand keeps its offset; the claim's expiry follows and the alliances get a live update. A phalanx return and holds are
  unaffected. Before, the plan kept the target time from the old settings while launch times and the retime panel
  used the new ones.

- Retime plans: launch times no longer run on an outdated target time while the retime panel shows another one.
  - A delayed (or otherwise moved) impact of the enemy now moves the plan's target time along with the return home,
    like holds already did (not with a phalanx return or a recall window, which do not depend on the impact); the
    claim's expiry follows. Launch notifications pick it up too.
  - Editing a plan's target ("Ziel/Zeit ändern") only sends the time when it was changed in the form, so an edit
    opened before a retime save no longer resets the target time.
  - The retime panel warns when the plan's target time differs from the one the analysis gives and lets saving
    apply it.

- Account settings on phones: the page no longer gets wider than the screen (the API token table forced a minimum
  width, so the browser zoomed out and the bottom tab bar looked shifted and larger); the token table now scrolls
  inside its card.

## 2026-10-23

- Overview on narrow screens: a Mobile/Desktop switch next to the heading shows the wide desktop tables instead of
  the compact list; remembered per device (`overview.desktopView`), not shown on wide screens.

- Discord alliance channel: meant for a channel only the alliance's members can see (admin hint says so); the
  misleading note about fleet sharing is gone, the channel gets what every member sees in the hub.

- **Discord notifications** via webhooks (no bot): a personal webhook per user and a channel webhook per alliance.
  - Personal: the bell's notifications like push, with their own settings (`users.discord_prefs`, same kinds and lead
    time); set under Account together with an optional Discord user ID used for mentions in the alliance channel.
  - Channel: alliance admins set the webhook, the kinds (attacks on members, new raid planner plans, the members'
    launch reminders), lead time and language on the admin page. Attacks are seen as by a non-member, so the members'
    fleet sharing applies; the attacked or launching member is mentioned (`allowed_mentions` limited to that user).
  - Server: `DiscordService` (`discord.ts`) delivers like push (debounced data events, 30 s ticker), each
    notification once per webhook (`discord_sent`, migration `036`), up to 10 embeds per message, waits once for a
    short rate limit and removes webhooks Discord answers 401/404 for. Only `discord.com` webhook URLs are accepted
    and the API only returns their start. New `PUBLIC_URL` gives the messages links to the hub.
  - API: `GET/POST /api/auth/discord`, `POST /api/auth/discord/test`, `GET/PUT /api/admin/groups/{id}/discord`,
    `POST /api/admin/groups/{id}/discord/test` (OpenAPI updated).
  - Refactor: debounce, ticker constants and the group's universe lookup shared by push and Discord (`notify.ts`);
    the alliance admin check of the admin routes is exported for reuse.

- Push notification texts: the English texts are typed against the German ones (a missing text fails the typecheck);
  `CLAUDE.md` notes that these texts live in the server's `push.ts`, not in the web app's locales.

- **Push notifications (Web Push).** Members get the bell's notifications on their devices even with the hub
  closed; the browser asks for permission only when switched on under Account.
  - Server: `push.ts` sends with VAPID (`web-push`); the key pair is created on the first start and stored in the
    database (migration `035`), push is on once `PUSH_CONTACT` (`mailto:` or `https:`) is set. Data events of a group
    (`fleets`, `attack_plans`, `comments`, `group_members`, debounced 2 s) deliver for that group, a 30 s ticker
    delivers launch reminders. Every member gets what the bell lists for them (same group context and fleet sharing),
    filtered by their settings, each notification once (`push_sent`); comments and invitations are not pushed while
    the member has a hub tab of the group in front. Subscriptions the push service no longer knows are removed.
  - API: `GET /api/push/key`, `POST`/`DELETE /api/push/subscriptions`, `POST /api/push/test`,
    `GET`/`POST /api/auth/push-settings` (per kind: attacks on me, on other members, invitations, comments, launch
    reminders with a lead time of 1–30 minutes).
  - Web app: service worker `sw.js` (push and click only, no caching), web app manifest and icons (iOS needs the hub
    on the home screen), push section under Account, the subscription is removed before logging out, `?group=` in a
    link selects the alliance.
- **Bell: comments and launches.** New kinds `comment` (comments of others in a thread you wrote in, since your last
  comment there, for 48 hours) and `launch` (your fleets of a plan to the second launching within the next hour, with
  countdown). The logic moved to `repo/notifications.ts`; drive lookup, launch detection and hold tracking of the raid
  planner to `repo/plans.ts`.
- Fix: static files got `Cache-Control: public, max-age=0` because `@fastify/static` overwrote the header; hashed
  assets are now cached for a year, everything else (index, service worker, manifest, icons) is revalidated.

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`): planning for others (fleets of other members, spy-report fleet
  data, drives by hand, invitations by everyone) under "Built", browser checks and new known limits under "Still open".

- **Raid planner: fleets of members without an empire page, invitations by everyone.**
  - Drive levels per plan fleet by hand (`attack_plan_fleets.drives`/`drives_time`, migration `034`, `drives` in the
    fleet `PUT`, `null` drops them). A fleet's research comes from the member's empire page, without one from the
    newest spy report of their player showing research; levels by hand count until a newer page or report arrives.
    `GET /plans` returns the source (`empire`, `spy`, `manual`) with the drives.
  - `GET /imperium` returns `spy`: the empire put together from the spy reports when the member has no empire page.
    The fleet form offers those planets and ships, any ship by hand, and "other coordinates" for a typed start.
  - Every member may invite others to a plan (was: creator and admins); the bell names who invited
    (`attack_plan_fleets.invited_by`).

- **Raid planner: participants edit every fleet of a plan.** Every member with a fleet in a plan may now change the
  other fleets (start, ships, speed, status), so a plan can be completed for members who are away or are placeholders
  without an account; removing a fleet stays with its member, the creator and admins. The fleet form loads the
  empire page of the fleet's member (`/imperium?user=`); without one the start planet is typed in as `g:s:p`.

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`): status, phalanx texts, invitations in the bell and the date picker
  under "Built", open items split into input from the requester and known limits.

- **Date and time fields** on desktop use a date picker (`@vuepic/vue-datepicker`, new `DateTimeInput` component)
  instead of the native inputs, whose format followed the browser locale (e.g. mm/dd/yyyy). Below 800 px the native
  inputs stay (system pickers). Same string values as before, so the plan/retime/deck conversions are unchanged.
  - New account setting **Date format**, stored on the account like the language (`users.date_format`, migration
    `033`, `POST /api/auth/date-format`): automatic by language (de `DD.MM.YYYY`, en `DD/MM/YYYY`), or fixed
    `DD.MM.YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`.
  - Shown dates follow it too: `dateTime()`, raid planner target times, activity day headers, the retime drive date
    and the player chart axis (`numDate`, `clockTime`, `weekday` in `format.ts`).

- Raid planner invitations show up in the notification bell of the invited member (kind `invite` in
  `GET /api/:uni/notifications`, one per plan while it is in planning and its target time has not passed). They count
  as unseen but are calmer than attacks (blue badge, no red bell); a click opens the plan in the raid planner
  (`?plan=<id>`). The bell reloads on plan changes too.

- Phalanx texts (from a real copy): fleet lines are read without the bar between clock and countdown (the phalanx
  separates them with tabs), so "Phalanx einfügen" finds its attacks. A phalanx is recognised by its head
  ("Scan Position [g:s:p]" / "Investigate position", `isPhalanxText`, `phalanxPosition`): the sync no longer stores it
  as the member's own fleet list (page type `phalanx`, warning `phalanx_use_raid_planner`), and the raid planner
  accepts only phalanx texts (`phalanx_not_phalanx`), so an own overview cannot list the member's attacks as hostile.

- Raid planner plan (`FEATURE_REQUEST_RETIME.md`) brought up to date: three ways into a plan (from scratch, retime,
  hold), data model with migrations 028/029, phalanx as a source, endpoints, claims, UI, and the remaining open items.

- **Read-only API tokens** under Account: personal `hubpat_…` tokens (GET only, same group scoping and privacy as the
  web app). OpenAPI 3.1 at `/api/openapi.json` and `/api/openapi.yaml`; `GET /api/catalog` exposes element names and
  costs. Migration `032_api_tokens`. Document OpenAPI upkeep in `CLAUDE.md`.

- Alliance admins can create a **password recovery link** for members who already have a hub account (same table as
  claim links; the invite page asks for a new password only). Unused links can be renewed with the refresh control next
  to the copy field.

- Account setting **Show online status** (on by default): when turned off, other members see the user as offline in
  the presence list and “viewing …” badges. Server filters presence per viewer (`users.show_online`, migration `031`;
  `GET`/`POST /api/auth/show-online`).

- Alliance members without a hub account: alliance admins add them by in-game name (placeholder user, no login).
  A claim invite link sets username and password on the placeholder or merges it into an existing account (raid plans,
  claims and other data follow). Migration `030` adds `invites.user_id`; removing a placeholder deletes the user row.
  Claim links are created only for these members (on add, shown in the members table); generic alliance invite links
  are removed.

- Raid planner overview:
  - Plans collapse to a summary line (target time with countdown, number of fleets, the viewer's own next launch or
    "too late"); the choice is kept per plan in the browser (`raidPlanner.open.<uni>`), by default current plans are
    open while there are at most two, past ones closed; new plans open.
  - Explanations moved into info icons: hold rule, phalanx, creating a plan, rough times and missing coordinates,
    adding ships, coordinates later; the retime panel explains its table.
  - Mobile: in the fleet cards the launch comes right below the member and takes the whole line, ships too; panel
    labels sit above their inputs, the time window inputs share a line, the candidates table is denser.

- Roles: alliance admins are labelled "Allianz-Admin"/"Alliance admin", and the online list colours names by role
  (global admin light blue, alliance admin green; `/api/:uni/context` members carry `global_admin`). Technical
  administration is global admins only: sync history (list, reparse, undo), player merge and activity backfill now
  answer `admin_only` to alliance admins, and the admin panel hides these sections for them. Alliance admins keep
  managing their alliance (name, members, invites) and other members' claims, comments and raid plans.

- Tests: the empire page smoke test waits until the initial loads have rendered before it counts page renders
  (it failed under load in the full parallel run).

- Raid planner, phalanx as a source of attacks (replaces the phalanx field of the retime panel): a phalanx shows the
  fleets starting from or heading for the scanned planet, returns only of the scanned player's own fleets
  (`FlyingFleetsTable` in phalanx mode). "Phalanx einfügen" on the raid planner (`POST /api/:uni/phalanx`, migration
  `029` `phalanx_snapshots`, kept a day) adds its attacks to the hostile attacks list (`source` `phalanx`, the
  attacked player from the galaxy data, the member who pasted it): attacks on the scanned planet with their arrival
  (the retime computes the return as usual), the scanned player's own attacks from it with the return shown, which a
  retime then takes directly (`home`). `POST /api/:uni/plans/:id/phalanx` is gone; `DELETE` drops a taken-over return.

- Raid planner, hold and phalanx:
  - Hold plans: next to "Retime planen" every hostile attack offers "Halten planen" (`POST /api/:uni/plans/hold`): a
    plan on the attacked planet (`mission` `hold`, migration `028`, no claim) whose fleets land on their own
    `hold_offset` seconds from the impact (default -1 s; later only works if the enemy delays). The target time
    follows the impact, also after a delay; holds form no ACS and cannot be delayed (`computePlan`), own hold fleets
    in the overview (mission 5) count as launched. The hostile attack list carries `holdPlanId`.
  - Phalanx: the retime panel takes a pasted phalanx of the origin (`POST`/`DELETE /api/:uni/plans/:id/phalanx`); the
    game writes the phalanxed player's fleets as "yours", the one returning from the attacked planet with the
    followed fleet's ships (else the latest on that route) gives the landing home, and the retime lands its buffer
    after it (`phalanx` on the plan enemy). `parseFleetsText` is exported from `@pr0hub/core`.

- Menu: the raid planner shows the number of current plans, grey for those in planning and green for running ones
  (plan launched or a fleet launched); the layout loads the plans and reloads them on plan and fleet changes
  (`planCounts` in `plans.ts`).

- Raid planner: "Coordinates not known yet" is clickable for the creator, admins and every participant (also only
  invited) and opens a form with the target alone; participants may change a plan's coordinates and type
  (`PUT /api/:uni/plans/:id` with only `g`/`s`/`p`/`type`), the attack claim is then held by the plan's creator.
  The plan's edit button reads "Ziel/Zeit ändern" / "Change target/time".

- Raid planner: the TrashSim link carries the plan's fleets too, as TrashSim's own export string (`sim=`, LZString via
  the new web dependency `lz-string`): target resources, one row per fleet with research, start and speed, the
  defender with the spy report's ships, solar satellites and defense (`trashSimExport` in `format.ts`, checked against
  a real TrashSim export).

- Raid planner: the link to the simulator in the game also carries the plan's fleets, one ACS slot per fleet with
  ships and weapons/shields/armour from the member's empire page (`slots`, `battleinput[slot][0][ID]`); plan fleets
  now carry research 109-111 too. TrashSim still gets the target alone (it takes attackers only from its compressed
  export string `sim=`, which replaces the `im[]` values).

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

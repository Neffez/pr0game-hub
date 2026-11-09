# Code Review: New Features of the Backlog

**Date:** 2026-11-09
**Scope:** The 20 items marked "Done" in [`NEW_FEATURES.md`](NEW_FEATURES.md) (commits `a386d34..9ae64eb`, 2026-11-06 to
2026-11-08).
**Focus:** Bugs, display errors and consistent UX.
**Method:** Reading the server repos, web views and shared packages of each feature, an automatic comparison of the
German and English texts, and a local instance with test data viewed in a browser (desktop 1280 px, mobile 390 px).

Each finding names how it was found:

| Mark | Meaning |
|---|---|
| **Reproduced** | Seen in the running app |
| **Code** | Follows from the code, not run |
| **Screenshot** | Seen in a screenshot of the running app |

The earlier review of the whole repository is [`CODEREVIEW.md`](CODEREVIEW.md).

## Not covered

- The result displays of the battle simulation (attack assistant, defense advisor, raid risk): the WebAssembly module
  needs Docker to build and was not available. Their server logic (`apps/server/src/repo/defense.ts`,
  `packages/battle/src/defense.ts`, `risk.ts`) was not read.
- Not read in detail: inactivity score (`inactivity.ts`, `inactivityCheck.ts`), the phalanx display in My empire,
  notifications (bell, push, Discord) and the tour texts.

---

## 1. Bugs

### B-1 Admin panel shows raw keys for "Parser samples" (E-4)

**Found:** Reproduced. **Where:** `apps/web/src/locales/de.ts:772`, `en.ts:771`, `apps/web/src/views/AdminView.vue:861-883`

The `samples` texts sit inside `tours.admin` instead of `admin`. The section shows `admin.samples.title` and the other
keys as text.

**Fix:** Move the whole `samples: { … }` block in both locale files out of `tours.admin` into the top-level `admin`
object. Add a test that walks `apps/web/src` for static `t('…')` keys and fails on a key missing in `de.ts`, so a
misplaced block is caught in CI.

### B-2 Farm finder shows 30-day data while "7 days" is selected (B-1, B-2)

**Found:** Reproduced (spy priority → debris finder → targets: "8 of 9 targets" instead of "6 of 7").
**Where:** `apps/web/src/views/FarmView.vue:333-338`

On the debris tab the loader returns the data it already has, and the tab watcher only loads when there is no data at
all. Coming from the spy tab (30 days), the targets tab keeps the 30-day list.

**Fix:** Remember the days the data was loaded for and reload when they differ:

```ts
watch(tab, (v) => v !== 'debris' && (!data.value || data.value.days !== days.value) && load());
```

`FarmResponse.days` already carries the value. Add a component test for the tab sequence.

### B-3 Colonization filter "at most members" acts as 0 after clearing the field (C-5)

**Found:** Reproduced (13 of 472 positions left, chip without a number).
**Where:** `apps/web/src/components/ColonizePlanner.vue:102`, `:135`

`v-model.number` yields `''` for an empty field; the filter and the chip only check `!= null`.

**Fix:** Treat everything that is not a number as "no filter" in both places:

```ts
const maxMembers = computed(() => (typeof filter.value.maxMembers === 'number' ? filter.value.maxMembers : null));
```

Use `maxMembers.value` in `filtered` and `chips`. The farm and debris finders already check `> 0` for their fields.

### B-4 Defense advisor can show the result of another planet (A-4)

**Found:** Code. **Where:** `apps/web/src/components/DefenseAdvisor.vue:79-117`

`load()` and `calculate()` do not drop outdated answers. Changing the planet or an option during the long calculation
lets the old result overwrite the new data.

**Fix:** Count the requests like `useLoader` does: one counter for both functions, incremented at the start, and the
answer is only applied when the counter is unchanged. Also disable the planet select and the options while `running`
is set, or cancel the calculation with an `AbortController` when they change.

### B-5 Attack assistant: simulator link without attackers for an estimated fleet (A-1)

**Found:** Code. **Where:** `apps/web/src/views/AttackView.vue:90`

The link is built from `attack.fleets`. When the movement shows no ships and they are estimated from a spy report, that
list is empty: the link opens the simulator without attackers although the page shows a result.

**Fix:** Build the attackers from what the server simulated. When `d.attack.fleets` has no ships, use one attacker with
`d.attacker.ships`:

```ts
const fleets = d.attack.fleets.filter((f) => Object.values(f.ships).some((n) => n > 0));
const list = fleets.length ? fleets.map((f) => f.ships) : [d.attacker.ships];
```

### B-6 Attack assistant uses two different fleets of the defender (A-1)

**Found:** Code. **Where:** `apps/server/src/repo/attackAssist.ts:185-187`, `:255`,
`apps/web/src/views/AttackView.vue:88`, `:250`

The simulation takes off the ships sent away since the empire page; the fleet save options and the simulator link use
the values of the empire page. The link can show another result than the page, and the options suggest saving ships
that are gone.

**Fix:** Return the reduced values as well (`target.present`, the `values` after subtracting `away.ships`) and use them
for `FleetSaveOptions :values` and for `simLink`. Keep `target.values` for what the empire page showed.

### B-7 Hard-coded "/ 7 T" in the mobile alliance health (D-1)

**Found:** Code, Screenshot. **Where:** `apps/web/src/views/HealthView.vue:103`

**Fix:** Replace the literal by a text, e.g. `health.perWeek` (`/ 7 T`, `/ 7 d`) in `de.ts` and `en.ts`, or reuse the
text of the desktop column `health.growth`.

### B-8 "incoming · just now" for an attack that lands in hours (A-4)

**Found:** Screenshot. **Where:** `apps/web/src/components/DefenseAdvisor.vue:124`

`reasonText` passes the arrival of an incoming attack to `ago()`, which is made for the past.

**Fix:** For `kind === 'incoming'` show the time left: `t('defense.reason.incomingIn', { time: duration(r.last - now) })`
with the clock of `useClock()`, and `ago()` only for the other kinds. Add the text to both locale files.

### B-9 CSV export does not neutralize formulas (F-3)

**Found:** Code. **Where:** `apps/server/src/repo/export.ts:138-145`

Player, planet and alliance names come from other players. A name such as `=HYPERLINK(…)` becomes a formula when the
file is opened in a spreadsheet.

**Fix:** In `toCsv`, prefix string cells that start with `=`, `+`, `-`, `@`, tab or carriage return with `'` before
quoting. Numbers stay as they are (only `typeof v === 'string'`). Add a case to `apps/server/test/export.test.ts`.

### B-10 Upgrade advisor calibrates against the wrong levels (C-1)

**Found:** Code. **Where:** `apps/web/src/components/UpgradeAdvisor.vue:54`, `packages/parser/src/advisor.ts:101-104`

The advisor gets the levels after the build queue, but the production per hour of the synced page, which is from before
the queue. With a mine in the queue the factor is too low and the gains of that planet are underrated.

**Fix:** Pass both to `upgradeAdvice`: `levels` (after the queue, base of the advice) and `syncedLevels` (as the page
showed them). Compute the calibration from `productionOf(syncedLevels)` against `perHour`, the advice from `levels`.
Add a test in `packages/parser/test/advisor.test.ts` with a mine in the queue.

### B-11 Upgrade advisor forgets "added" on a live reload (C-1)

**Found:** Code. **Where:** `apps/web/src/components/UpgradeAdvisor.vue:76-106`

`added` and `busy` hold `Advice` objects of a computed list. A reload creates new objects, the mark is gone and the
same step can be added a second time.

**Fix:** Key the state by a string: `` `${a.key ?? 'account'}:${a.step.kind}:${a.step.element}:${a.step.level}` ``.
Use the same key as `:key` of the rows instead of the index.

### B-12 Stored start planet of the farm finder applies to every universe (B-1)

**Found:** Code. **Where:** `apps/web/src/views/FarmView.vue:310`, `:350`

`farm.filter.from` stores coordinates without the universe. In a second universe no own planet matches: every flight
time shows "–" and the select is empty.

**Fix:** When `filter.from` matches none of `ownPlanets`, fall back to the nearest planet (treat it as `''`) in
`startFor`, and reset the stored value once the own planets are loaded. Alternatively store the filter per universe
(`useStored(`farm.filter.${uni}`)`); the same then applies to `debris.filter` and `colonize.filter` (galaxy).

---

## 2. Display and UX consistency

### U-1 Important columns are outside the visible area at 1280 px

**Found:** Screenshot. **Where:** `apps/web/src/views/FarmView.vue:676-719`,
`apps/web/src/components/DefenseAdvisor.vue:256-311`

In the farm finder "Risk" and the actions are cut off; in the defense advisor "Flight" and "Profit" are, and the profit
is where the result of the calculation appears.

**Fix:** Farm finder: merge "Ships" and "Fuel" into one column (as on mobile) and limit the player cell
(`max-width` with `text-overflow: ellipsis`, full name as `title`). Defense advisor: move "Profit" directly after
"Attacker" and let the fleet cell wrap (`white-space: normal`, `max-width`).

### U-2 Fleet save suggestions repeat the same target

**Found:** Screenshot. **Where:** `packages/flight/src/fleetsave.ts:144`,
`apps/web/src/components/FleetSaveOptions.vue:129`

The three options shown are mostly the same target at 60/70/80 % speed; other targets and missions hide behind "38
more".

**Fix:** In `FleetSaveOptions`, show the best option per mission and target first (the first of each
`` `${kind}:${target.coords}:${target.type}` `` in the sorted list), then the rest behind "more". The sorting in
`fleetSaveOptions` stays.

### U-3 The risk of a colony save is only in a tooltip

**Found:** Code. **Where:** `apps/web/src/components/FleetSaveOptions.vue:142`, `:170`,
`apps/web/src/views/FleetSaveView.vue:199`

Below the planet limit the colony ship founds a colony. The warning is a `title`, which touch devices do not show.

**Fix:** Show a visible warning line under the options when one of the shown options is `colonize`
(`<p class="warn small">`, text `fleetsave.colonizeTitle`). Better: compute the planet limit from astrophysics
(`research[124]`) and the number of own planets, and offer `colonize` only at the limit.

### U-4 Player status as plain text in the defense advisor

**Found:** Screenshot ("[BAD]I" without a space). **Where:** `apps/web/src/components/DefenseAdvisor.vue:274`

**Fix:** Use `<StatusBadges :status="x.player.status" />` like the farm finder and the overview, also on the mobile
card.

### U-5 "no empire" for an outdated empire page

**Found:** Screenshot (flag next to "5 d"). **Where:** `apps/server/src/repo/health.ts:129`,
`apps/web/src/locales/*.ts` (`health.flag.noEmpire`)

**Fix:** Split the flag: `noEmpire` when `syncs.empire` is missing, `staleEmpire` when it is older than `STALE`. Add
`health.flag.staleEmpire` and `health.flagTitle.staleEmpire` to both locale files and the flag to the OpenAPI schema.

### U-6 "−0" in red for resources without loot

**Found:** Screenshot. **Where:** `apps/web/src/views/AttackView.vue:236`

**Fix:** Show the loot only when it is above zero: `v-if="data.loot && data.loot[k] > 0"`.

### U-7 Moon chances: no empty text, filters not remembered

**Found:** Code. **Where:** `apps/web/src/components/MoonChances.vue:28-29`, `:54`, `:72`

When "members only" hides every battle, only the filter row remains. Period and filter are lost on a reload, unlike on
the other pages.

**Fix:** Show `moons.empty` (or a new `moons.emptyFiltered`) when `battles.length` is 0 while `data.battles.length` is
not. Store both settings with `useStored('moons.filter', { days: 30, membersOnly: true })`.

### U-8 No loading state on four pages

**Found:** Code. **Where:** `FleetSaveView.vue:211`, `AttackView.vue:169`, `HealthView.vue:85`, `MoonChances.vue:42`

The farm finder, debris finder and colonization planner show `<Loading>`; these pages stay empty until the data is
there.

**Fix:** Add `<Loading v-else-if="!data" :lines="6" />` after the error line of each.

### U-9 Mobile cards lack information of the desktop tables

**Found:** Code. **Where:** `FleetSaveOptions.vue:141-152`, `DebrisFinder.vue:217-234`, `FarmView.vue:582-600`,
`:652-670`

Missing on mobile: the "missed" mark of fleet save options, the "battle" badge of the debris finder, the alliance tag
in the farm finder, the inactivity badge in the spy priority.

**Fix:** Add the four elements to the cards, each as on the desktop row (same condition and text).

### U-10 Small items

**Found:** Code, Screenshot.

- `ColonizePlanner.vue:261`: "(1 i)" is not explained. **Fix:** a text `colonize.inactiveShort` with a `title`, or
  the inactivity badge.
- `FleetSaveView.vue:39-42`: the built-in presets "Night"/"Work" are stored in the language active at the first
  change. **Fix:** store built-ins with a `builtin: 'night' | 'work'` mark and translate them when shown.
- `OnboardingCard.vue:33`, `:43`: a hidden card cannot be shown again. **Fix:** a "show checklist again" link on the
  sync page while steps are open and `hidden` is set.
- `UpgradeAdvisor.vue:135`, `DefenseAdvisor.vue:133`, `RaidRisk.vue:71`: the unit "D" is a literal. **Fix:** one text
  `common.deutShort` used by all three.

---

## 3. Without findings

- German and English have 3087 keys each with identical placeholders (apart from B-1, where the keys exist in the
  wrong place).
- No console errors and no horizontal overflow of the page on mobile.
- Tours exist for the new pages; the assignment of the tab tours was not checked one by one.
- Migration 082 fills the onboarding steps for existing members.

---

## Recommended order

1. B-1, B-2, B-3, B-7, U-6: small and visible, one commit each.
2. B-4, B-5, B-6, B-8: wrong or misleading results in the defense and attack pages.
3. B-9: export hardening with a test.
4. B-10, B-11, B-12, then the UX items U-1 to U-10.

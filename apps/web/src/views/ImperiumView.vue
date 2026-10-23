<script setup lang="ts">
import { classOf, elementPoints, METAL, RESOURCES, STORAGE, storageCapacity } from '@pr0hub/core/tech';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { upcoming, useClock } from '../clock';
import FleetList, { type Fleet } from '../components/FleetList.vue';
import Hint from '../components/Hint.vue';
import Ticker from '../components/Ticker.vue';
import { useLoader, useMobile, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { abbr, ago, dateTime, fmt, fmtSigned, name, short, STATS_TYPES } from '../format';

/**
 * Live view of a member's own planets (like the FF-Hub overview): resources are projected from the
 * last empire page with its production per hour (capped at the storage), queues count down from
 * the last game overview page. The page itself reads the clock only in computeds that rarely change; the ticking
 * values (resources, countdowns) are rendered in `<Ticker>`s, so the page is not rendered again every second.
 */
interface C3 {
  g: number;
  s: number;
  p: number;
}
interface EmpirePlanet {
  name: string;
  coords: C3;
  type: 'planet' | 'moon';
  values: Record<string, number>;
  temp?: number;
  resources?: Record<string, number>;
  perHour?: Record<string, number>;
  building?: { id: number; level: number } | null;
  shipyard?: Record<string, number>;
}
interface Queue {
  kind: 'building' | 'research' | 'shipyard';
  coords: C3;
  type: 'planet' | 'moon';
  id: number;
  level: number;
  destroy: boolean;
  seconds: number;
}
interface Data {
  empire: {
    time: number;
    data: {
      planets: EmpirePlanet[];
      research?: Record<string, number>;
      researchQueue?: { id: number; level: number; coords: C3 | null } | null;
      flying?: Record<string, number>;
      flyingShips?: Record<string, number>;
      active?: { coords: C3; type: 'planet' | 'moon'; storage: Record<string, number> } | null;
    };
  } | null;
  overview: { time: number; data: { queues: Queue[]; catchUp?: number | null } } | null;
  /** `private`: the member shares none of their own fleets (fleets heading for them are still listed) */
  fleets: { time: number; data: Fleet[]; private?: boolean } | null;
  /** fleets of the older lists that arrived in the last 12 hours, oldest first (shared like `fleets`) */
  fleetHistory: Fleet[];
  /** the member's player with the latest synced statistics per category (1 total … 5 defense) */
  player: { id: number; name: string; stats: Record<number, { points: number; rank: number; time: number }> } | null;
  /**
   * ships on the planets (points) in the first empire page after the newest fleet or total statistics update that has one,
   * and the statistics fleet of that update (for the total: total minus the other points of that empire page)
   */
  fleetBase: { time: number; points: number; stat: number } | null;
  /** player with the most catch-up points (buildings ×1, research ×0.8, fleet ×0.6) in the latest statistics */
  leader: { name: string; weighted: number } | null;
}

const RES = RESOURCES;

const { t } = useI18n();
const { uni, ctx } = useUni();
const mobile = useMobile();
const userId = useStored<number | null>('imperium.user', null);
const { data, error, load } = useLoader(() => {
  if (!ctx.value!.members.some((m) => m.id === userId.value)) userId.value = ctx.value!.me.id;
  return uniApi<Data>(uni.value, `/imperium?user=${userId.value}`);
});
const now = useClock();

onMounted(load);
watch(userId, load);
useLiveReload(load, tables('empire', 'overview', 'fleets', 'player_scores'));

const empire = computed(() => data.value?.empire ?? null);
const overview = computed(() => data.value?.overview ?? null);
const fleets = computed(() => data.value?.fleets ?? null);
/** fleets still in flight, next arrival first; arrived ones only count */
const flights = upcoming(computed(() => [...(fleets.value?.data ?? [])].sort((a, b) => a.arrival - b.arrival)), (f) => f.arrival, now);
const arrived = computed(() => (fleets.value?.data.length ?? 0) - flights.value.length);
const HISTORY = 12 * 3600;
/** changes once a minute, so the history drops what is older than 12 hours without rendering every second */
const minute = computed(() => Math.floor(now.value / 60));
/** past fleet movements of the last 12 hours, newest first: the older lists plus the arrived fleets of the newest */
const history = computed(() => {
  const cutoff = minute.value * 60 - HISTORY;
  const live = new Set(flights.value);
  return [...(data.value?.fleetHistory ?? []), ...(fleets.value?.data ?? []).filter((f) => !live.has(f))]
    .filter((f) => f.arrival >= cutoff)
    .sort((a, b) => b.arrival - a.arrival);
});
const same = (a: C3, b: C3) => a.g === b.g && a.s === b.s && a.p === b.p;

/**
 * Storage factor of the universe: derived from the storage shown in the resource bar of the
 * selected planet (page header), otherwise the universe setting `storageMultiplier`.
 */
const storageFactor = computed(() => {
  const active = empire.value?.data.active;
  const planet = active && empire.value!.data.planets.find((p) => same(p.coords, active.coords) && p.type === active.type);
  if (planet && active.storage[METAL]) {
    const base = storageCapacity(planet.values[STORAGE[METAL]] ?? 0);
    if (base) return active.storage[METAL] / base;
  }
  return (ctx.value!.universe.settings as { storageMultiplier?: number }).storageMultiplier ?? 1;
});

/** Live amount: production since the page time, never above the storage (but full storages stay as they are). */
function live(p: EmpirePlanet, id: number, now: number) {
  const start = p.resources?.[id] ?? 0;
  const cap = storageCapacity(p.values[STORAGE[id]] ?? 0, storageFactor.value);
  const perHour = p.perHour?.[id] ?? 0;
  const elapsed = Math.max(0, now - empire.value!.time);
  let value = start;
  // consumption (e.g. fusion plant) also empties full storages, production stops at the limit
  if (perHour < 0) value = Math.max(0, start + (perHour * elapsed) / 3600);
  else if (start < cap) value = Math.min(cap, start + (perHour * elapsed) / 3600);
  const fullIn = perHour > 0 && value < cap ? ((cap - value) / perHour) * 3600 : null;
  return { value: Math.floor(value), cap, perHour, fullIn };
}

function resClass(v: { value: number; cap: number }) {
  if (v.value >= v.cap) return 'neg';
  if (v.value >= v.cap * 0.9) return 'warn';
  return '';
}
/** fill level of the storage bar on mobile cards, in percent */
const fill = (v: { value: number; cap: number }) => (v.cap > 0 ? Math.min(100, (v.value / v.cap) * 100) : 0);

/** "1d 02:03:04" / "02:03:04" */
function countdown(sec: number) {
  if (sec <= 0) return t('imperium.done');
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d}d ${hms}` : hms;
}

/** Overview queues are newer information than the empire markers only if the overview page is not older. */
const overviewCurrent = computed(() => !!overview.value && (!empire.value || overview.value.time >= empire.value.time - 60));

function queueOf(kind: Queue['kind'], p: EmpirePlanet) {
  return overview.value?.data.queues.find((q) => q.kind === kind && same(q.coords, p.coords) && q.type === p.type) ?? null;
}
const endOf = (q: Queue) => overview.value!.time + q.seconds;

/** `end`: when the queue finishes (epoch), null when unknown */
function building(p: EmpirePlanet) {
  const q = queueOf('building', p);
  if (q) return { label: `${name(q.id)}${q.destroy ? ' ' + t('imperium.demolish') : ''} ${q.level}`, end: endOf(q) };
  if (p.building && !overviewCurrent.value) return { label: `${name(p.building.id)} ${p.building.level}`, end: null };
  return null;
}

/** Research runs account wide; it is shown at the planet where it was started (empire page marker). */
const research = computed(() => {
  const q = overview.value?.data.queues.find((x) => x.kind === 'research') ?? null;
  const marker = empire.value?.data.researchQueue ?? null;
  if (q && (!marker || marker.id === q.id || overviewCurrent.value)) {
    return { label: `${name(q.id)} ${q.level}`, end: endOf(q), coords: marker?.id === q.id ? marker.coords : q.coords };
  }
  if (marker) return { label: `${name(marker.id)} ${marker.level}`, end: null, coords: marker.coords };
  return null;
});

function shipyard(p: EmpirePlanet) {
  const q = queueOf('shipyard', p);
  const list = Object.entries(p.shipyard ?? {}).map(([id, n]) => `${fmt(n)}× ${abbr(Number(id))}`);
  if (!q && !list.length) return null;
  return { label: list.join(', ') || `${fmt(q!.level)}× ${abbr(q!.id)}`, title: Object.keys(p.shipyard ?? {}).map((id) => name(id)).join(', '), end: q ? endOf(q) : null };
}

const rows = computed(() =>
  (empire.value?.data.planets ?? []).map((p) => ({
    p,
    key: `${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`,
    energy: p.resources?.[911] ?? null,
    building: building(p),
    research: research.value?.coords && same(research.value.coords, p.coords) && p.type === 'planet' ? research.value : null,
    shipyard: shipyard(p),
  })),
);

/** live resources of a planet at `now` (rendered in a `<Ticker>`) */
const resOf = (p: EmpirePlanet, now: number) => RES.map((id) => live(p, id, now));
function totalsAt(now: number) {
  const res = rows.value.map((r) => resOf(r.p, now));
  return RES.map((_, i) => ({
    value: res.reduce((s, r) => s + r[i].value, 0),
    cap: res.reduce((s, r) => s + r[i].cap, 0),
    perHour: res.reduce((s, r) => s + r[i].perHour, 0),
  }));
}
const flying = computed(() => empire.value?.data.flying ?? {});
const missingPerHour = computed(() => rows.value.some((r) => r.p.type === 'planet' && !r.p.perHour));
const hasLiveData = computed(() => rows.value.some((r) => r.p.resources));
// ---------------------------------------------------------------- live points
/**
 * Points like the game's statistics, from the last empire page (buildings, ships, defense per planet,
 * research account wide) plus builds and research finished since then (overview queues).
 * The empire page shows the ships in flight (✈) in the total column; for older synced pages without them
 * the fleet is the statistics value plus the change of the ships on the planets since the first empire
 * page after that update.
 */
const levelPoints = (id: number, level: number) => elementPoints(id, level) - elementPoints(id, level - 1);
/** which overview queues have finished, as a key: only changes when one finishes */
const finishedKey = computed(() => (overview.value?.data.queues ?? []).map((q) => (endOf(q) <= now.value ? 1 : 0)).join(''));
const livePoints = computed(() => {
  const e = empire.value;
  if (!e) return null;
  const sum: Record<number, number> = { 0: 0, 100: 0, 200: 0, 400: 0 };
  for (const p of e.data.planets) {
    for (const [id, n] of Object.entries(p.values)) {
      const cls = classOf(Number(id));
      if (cls !== 100 && cls in sum) sum[cls] += elementPoints(id, n);
    }
  }
  for (const [id, n] of Object.entries(e.data.research ?? {})) sum[100] += elementPoints(id, n);
  const planetFleet = sum[200];
  // builds and research that finished since the empire page
  const finished: string[] = [];
  if (overview.value && overview.value.time >= e.time - 60) {
    const done = finishedKey.value;
    for (const [i, q] of overview.value.data.queues.entries()) {
      if (done[i] !== '1' || q.kind === 'shipyard') continue;
      if (q.kind === 'research') {
        if ((e.data.research?.[q.id] ?? 0) >= q.level) continue;
        sum[100] += levelPoints(q.id, q.level);
      } else {
        const p = e.data.planets.find((x) => same(x.coords, q.coords) && x.type === q.type);
        const cur = p?.values[q.id] ?? 0;
        if (q.destroy ? cur <= q.level : cur >= q.level) continue;
        sum[0] += q.destroy ? -levelPoints(q.id, q.level + 1) : levelPoints(q.id, q.level);
      }
      finished.push(`${name(q.id)} ${q.level}`);
    }
  }
  const stats = data.value?.player?.stats ?? {};
  const base = data.value?.fleetBase;
  const flyingShips = e.data.flyingShips;
  const fleetFromStats = !!flyingShips || !!base;
  let fleet = planetFleet;
  if (flyingShips) for (const [id, n] of Object.entries(flyingShips)) fleet += elementPoints(id, n);
  else if (base) fleet = base.stat + (planetFleet - base.points);
  const cats = [
    { type: 4, live: sum[0] },
    { type: 3, live: sum[100] },
    { type: 2, live: fleet },
    { type: 5, live: sum[400] },
  ].map((c) => ({ ...c, live: Math.round(c.live), stat: stats[c.type]?.points ?? null, statTime: stats[c.type]?.time ?? null }));
  const total = cats.reduce((s, c) => s + c.live, 0);
  return { cats, total, stat: stats[1]?.points ?? null, rank: stats[1]?.rank ?? null, statTime: stats[1]?.time ?? null, fleetFromStats, finished };
});

/**
 * Catch-up bonus (cost and build time reduction in percent) like the game's PlayerUtil::getCatchUpFactor:
 * factor 10 × 0.9747^(% of the leader's points), at least 1, mapped linearly onto 0 … maximum bonus.
 * The maximum bonus is 100 − the universe's catchup_percent setting (default 50), a whole number.
 */
const CATCH_UP_WEIGHT: Record<number, number> = { 4: 1, 3: 0.8, 2: 0.6 };
const catchUpRaw = (own: number, leader: number) => Math.max(1, 10 * 0.9747 ** ((Math.max(own, 1) / Math.max(leader, 1)) * 100));
const catchUp = computed(() => {
  const current = overview.value?.data.catchUp ?? null;
  const lp = livePoints.value;
  if (current == null || !lp) return null;
  const leader = data.value?.leader ?? null;
  const weighted = (points: (type: number) => number | null) => {
    let sum = 0;
    for (const [type, w] of Object.entries(CATCH_UP_WEIGHT)) {
      const v = points(Number(type));
      if (v == null) return null;
      sum += v * w;
    }
    return sum;
  };
  const statOwn = weighted((type) => lp.cats.find((c) => c.type === type)!.stat);
  const liveOwn = weighted((type) => lp.cats.find((c) => c.type === type)!.live)!;
  // maximum bonus of the universe (default 50 %): derived from the overview value when it shows the current
  // statistics, else at least the overview value (the raw factor is at most 10)
  let max = Math.max(50, Math.ceil(current - 1e-9));
  if (leader && statOwn != null && current > 0 && lp.statTime && overview.value!.time >= lp.statTime) {
    const raw = catchUpRaw(statOwn, leader.weighted);
    if (raw > 1.1) max = Math.min(100, Math.round((current * 9) / (raw - 1)));
  }
  const live = leader ? Math.round(((max / 9) * (catchUpRaw(liveOwn, leader.weighted) - 1)) * 100) / 100 : null;
  return { current, live, max, leader };
});
const deltaClass = (d: number | null) => (d == null || d === 0 ? 'faint' : d > 0 ? 'pos' : 'neg');

const memberName = (id: number | null) => ctx.value!.members.find((m) => m.id === id)?.name ?? '';
</script>

<template>
  <h1>
    {{ t('imperium.title') }}
    <Hint>
      <p>{{ t('imperium.hint1') }}</p>
      <p>{{ t('imperium.hint2') }}</p>
      <p>{{ t('imperium.hint3') }}</p>
    </Hint>
  </h1>

  <div class="card row small">
    <label>
      {{ t('common.player') }}
      <select v-model="userId">
        <option v-for="m in ctx!.members" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </label>
    <span class="muted">
      {{ t('imperium.title') }}: <template v-if="empire">{{ dateTime(empire.time) }} ({{ ago(empire.time) }})</template><span v-else class="warn">{{ t('overview.missing') }}</span>
    </span>
    <span class="muted">
      {{ t('nav.overview') }}: <template v-if="overview">{{ dateTime(overview.time) }} ({{ ago(overview.time) }})</template><span v-else class="warn">{{ t('imperium.overviewMissing') }}</span>
    </span>
    <span class="muted">
      {{ t('imperium.fleets') }}: <template v-if="fleets">{{ dateTime(fleets.time) }} ({{ ago(fleets.time) }})<span v-if="fleets.private" class="faint"> · {{ t('imperium.fleetsPrivate') }}</span></template><span v-else class="warn">{{ t('imperium.fleetsMissing') }}</span>
    </span>
    <span v-if="storageFactor !== 1" class="faint" :title="t('imperium.storageTitle')">{{ t('imperium.storage') }} ×{{ fmt(storageFactor, 1) }}</span>
    <span v-if="missingPerHour" class="warn">{{ t('imperium.perHourMissing') }}</span>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !empire" class="card muted">{{ t('imperium.noEmpire', { name: memberName(userId) }) }}</div>
  <div v-else-if="data && !hasLiveData" class="card muted">
    {{ t('imperium.noResources') }}
  </div>

  <div v-if="!error && empire && livePoints" class="card live-points">
    <div class="row">
      <h3 style="margin: 0">
        {{ t('imperium.livePoints') }}
        <Hint>
          <p>{{ t('imperium.liveHint1') }}</p>
          <p>{{ t('imperium.liveHint2') }}</p>
          <p>{{ t('imperium.liveHint3') }}</p>
          <p>{{ t('imperium.liveHint4') }}</p>
        </Hint>
      </h3>
      <span v-if="livePoints.stat != null">
        {{ t('expeditions.points') }} <b>{{ fmt(livePoints.stat) }}</b><span v-if="livePoints.rank" class="muted"> ({{ t('stats.rank') }} {{ livePoints.rank }})</span>
      </span>
      <span>
        {{ t('imperium.live') }} <b>{{ fmt(livePoints.total) }}</b>
      </span>
      <span class="grow" />
      <span class="muted small">
        <template v-if="livePoints.statTime">{{ t('nav.stats') }} {{ dateTime(livePoints.statTime) }}</template>
      </span>
    </div>
    <p v-if="!data?.player" class="warn small" style="margin: 8px 0 0">
      {{ t('imperium.noStats', { name: memberName(userId) }) }}
    </p>
    <div class="scroll-x" style="margin-top: 8px">
    <table class="data" style="width: auto">
      <thead>
        <tr><th>{{ t('imperium.category') }}</th><th class="num">{{ t('nav.stats') }}</th><th class="num">{{ t('imperium.live') }}</th><th class="num">Δ</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in livePoints.cats" :key="c.type">
          <td style="white-space: normal">
            {{ STATS_TYPES[c.type] }}
            <span v-if="c.type === 2 && !livePoints.fleetFromStats" class="warn small" :title="t('imperium.noFlyingTitle')">⚠</span>
            <!-- the total is synced more often: a category from an older update has a different Δ base -->
            <span v-if="c.statTime && livePoints.statTime && c.statTime < livePoints.statTime" class="muted small" :title="t('imperium.statOlderTitle')">
              {{ t('imperium.statOlder', { time: dateTime(c.statTime) }) }}
            </span>
          </td>
          <td class="num" :title="c.statTime ? dateTime(c.statTime) : undefined">{{ c.stat == null ? '–' : fmt(c.stat) }}</td>
          <td class="num">{{ fmt(c.live) }}</td>
          <td class="num" :class="deltaClass(c.stat == null ? null : c.live - c.stat)">{{ c.stat == null ? '' : fmtSigned(c.live - c.stat) }}</td>
        </tr>
        <tr style="font-weight: 600">
          <td>{{ t('common.total') }}</td>
          <td class="num">{{ livePoints.stat == null ? '–' : fmt(livePoints.stat) }}</td>
          <td class="num">{{ fmt(livePoints.total) }}</td>
          <td class="num" :class="deltaClass(livePoints.stat == null ? null : livePoints.total - livePoints.stat)">
            {{ livePoints.stat == null ? '' : fmtSigned(livePoints.total - livePoints.stat) }}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="catchUp" class="small" style="margin: 6px 0 0">
      {{ t('imperium.catchUp') }}
      <Hint>
        <p>{{ t('imperium.catchUpHint1') }}</p>
        <p>{{ t('imperium.catchUpHint2', { max: catchUp.max }) }}</p>
      </Hint>:
      {{ t('nav.overview') }} <b>{{ fmt(catchUp.current, 2) }} %</b>
      <template v-if="catchUp.live != null">
        · {{ t('imperium.live') }} <b>{{ fmt(catchUp.live, 2) }} %</b>
        <span :class="deltaClass(catchUp.live - catchUp.current)">({{ catchUp.live - catchUp.current > 0 ? '+' : '' }}{{ fmt(catchUp.live - catchUp.current, 2) }})</span>
        <span class="muted"> · {{ t('imperium.catchUpLeader', { name: catchUp.leader!.name }) }}</span>
      </template>
      <span v-else class="muted"> · {{ t('imperium.catchUpNoLeader') }}</span>
    </p>
    <p v-if="livePoints.finished.length" class="muted small" style="margin: 6px 0 0">{{ t('imperium.finished', { list: livePoints.finished.join(', ') }) }}</p>
  </div>

  <div v-if="!error && fleets" class="card">
    <h3 style="margin: 0 0 6px">
      {{ t('imperium.fleets') }}
      <Hint><p>{{ t('imperium.fleetsHint') }}</p></Hint>
      <span v-if="arrived" class="muted small" style="font-weight: normal"> · {{ t('imperium.fleetsArrived', { n: arrived }) }}</span>
    </h3>
    <p v-if="!flights.length" class="muted small" style="margin: 0">{{ t('imperium.fleetsNone') }}</p>
    <FleetList v-else :fleets="flights" />
    <details v-if="history.length" class="fl-history">
      <summary class="muted small">{{ t('imperium.fleetHistory', { n: history.length }) }}</summary>
      <FleetList :fleets="history" past />
    </details>
  </div>

  <!-- mobile: totals first, then one card per planet (moons below their planet) -->
  <template v-if="!error && empire && hasLiveData && mobile">
    <div class="card emp-card">
      <div class="emp-head">
        <b>{{ t('common.total') }}</b>
        <span v-if="research && !research.coords" class="small muted">
          {{ t('player.research') }}: {{ research.label }}
          <Ticker v-if="research.end != null" v-slot="{ now: n }"><span class="mono">{{ countdown(research.end - n) }}</span></Ticker>
        </span>
      </div>
      <Ticker v-slot="{ now: n }">
      <div class="emp-res">
        <div v-for="(sum, i) in totalsAt(n)" :key="i">
          <div class="small muted">{{ name(RES[i]) }}</div>
          <div class="num">{{ short(sum.value + (flying[RES[i]] ?? 0)) }}</div>
          <div class="num faint">/ {{ short(sum.cap) }}</div>
          <div class="bar"><div :class="resClass(sum)" :style="{ width: fill(sum) + '%' }" /></div>
          <div class="small faint">+{{ short(sum.perHour) }}/h</div>
          <div v-if="flying[RES[i]]" class="small muted">✈ {{ short(flying[RES[i]]) }}</div>
        </div>
      </div>
      </Ticker>
    </div>

    <div v-for="r in rows" :key="r.key" class="card emp-card" :class="{ moon: r.p.type === 'moon' }">
      <div class="emp-head">
        <span class="mono small">{{ r.p.coords.g }}:{{ r.p.coords.s }}:{{ r.p.coords.p }}</span>
        <span v-if="r.p.type === 'moon'" class="moon-tag">☾ {{ t('common.moon') }}</span>
        <b class="emp-name">{{ r.p.name }}</b>
        <span v-if="r.energy != null" class="small" :class="r.energy < 0 ? 'neg' : 'muted'">⚡ {{ fmt(r.energy) }}</span>
      </div>
      <div class="emp-queues small">
        <span class="muted">{{ name(0) }}</span>
        <span>
          <template v-if="r.building">{{ r.building.label }}</template>
          <span v-else class="faint">–</span>
        </span>
        <Ticker v-if="r.building?.end != null" v-slot="{ now: n }">
          <span class="mono" :class="r.building.end - n <= 0 ? 'pos' : 'muted'">{{ countdown(r.building.end - n) }}</span>
        </Ticker>
        <span v-else-if="r.building" class="faint" :title="t('imperium.leftUnknown')">?</span>
        <span v-else />
        <template v-if="r.research">
          <span class="muted">{{ t('player.research') }}</span>
          <span>{{ r.research.label }}</span>
          <Ticker v-if="r.research.end != null" v-slot="{ now: n }">
            <span class="mono" :class="r.research.end - n <= 0 ? 'pos' : 'muted'">{{ countdown(r.research.end - n) }}</span>
          </Ticker>
          <span v-else class="faint" :title="t('imperium.leftUnknown')">?</span>
        </template>
        <template v-if="r.shipyard">
          <span class="muted">{{ t('imperium.hangar') }}</span>
          <span>{{ r.shipyard.label }}</span>
          <Ticker v-if="r.shipyard.end != null" v-slot="{ now: n }"><span class="mono muted">{{ countdown(r.shipyard.end - n) }}</span></Ticker>
          <span v-else />
        </template>
      </div>
      <Ticker v-slot="{ now: n }">
      <div class="emp-res">
        <div v-for="(v, i) in resOf(r.p, n)" :key="i">
          <div class="small muted">{{ name(RES[i]) }}</div>
          <div class="num" :class="resClass(v)">{{ short(v.value) }}</div>
          <div class="num faint">/ {{ short(v.cap) }}</div>
          <div class="bar"><div :class="resClass(v)" :style="{ width: fill(v) + '%' }" /></div>
          <div class="small faint">
            <template v-if="v.value >= v.cap">{{ t('imperium.full') }}</template>
            <template v-else-if="v.fullIn != null">{{ t('imperium.fullIn', { time: countdown(v.fullIn) }) }}</template>
            <template v-else-if="v.perHour">{{ v.perHour > 0 ? '+' : '' }}{{ short(v.perHour) }}/h</template>
          </div>
        </div>
      </div>
      </Ticker>
    </div>
  </template>

  <div v-else-if="!error && empire && hasLiveData" class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>{{ t('common.planet') }}</th>
          <th>{{ name(0) }}</th>
          <th>{{ t('player.research') }}</th>
          <th>{{ t('imperium.hangar') }}</th>
          <th class="num">{{ name(901) }}</th>
          <th class="num">{{ name(902) }}</th>
          <th class="num">{{ name(903) }}</th>
          <th class="num">{{ name(911) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :class="{ moon: r.p.type === 'moon' }">
          <td>
            <span class="mono small">{{ r.p.coords.g }}:{{ r.p.coords.s }}:{{ r.p.coords.p }}</span>
            <span v-if="r.p.type === 'moon'" class="moon-tag" style="margin-left: 4px">☾ {{ t('common.moon') }}</span>
            {{ r.p.name }}
          </td>
          <td class="small">
            <template v-if="r.building">
              {{ r.building.label }}
              <Ticker v-if="r.building.end != null" v-slot="{ now: n }">
                <span class="mono" :class="r.building.end - n <= 0 ? 'pos' : 'muted'">{{ countdown(r.building.end - n) }}</span>
              </Ticker>
              <span v-else class="faint" :title="t('imperium.leftUnknown')">?</span>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <td class="small">
            <template v-if="r.research">
              {{ r.research.label }}
              <Ticker v-if="r.research.end != null" v-slot="{ now: n }">
                <span class="mono" :class="r.research.end - n <= 0 ? 'pos' : 'muted'">{{ countdown(r.research.end - n) }}</span>
              </Ticker>
              <span v-else class="faint" :title="t('imperium.leftUnknown')">?</span>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <td class="small" :title="r.shipyard?.title">
            <template v-if="r.shipyard">
              {{ r.shipyard.label }}
              <Ticker v-if="r.shipyard.end != null" v-slot="{ now: n }">
                <span class="mono muted" :title="t('imperium.currentJob')">{{ countdown(r.shipyard.end - n) }}</span>
              </Ticker>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <Ticker v-slot="{ now: n }">
            <td
              v-for="(v, i) in resOf(r.p, n)"
              :key="i"
              class="num"
              :class="resClass(v)"
              :title="`${fmt(v.value)} / ${fmt(v.cap)}${v.perHour ? ` · +${fmt(v.perHour)}/h` : ''}${v.fullIn != null ? ` · ${t('imperium.fullIn', { time: countdown(v.fullIn) })}` : ''}`"
            >
              {{ short(v.value) }} <span class="faint">/ {{ short(v.cap) }}</span>
            </td>
          </Ticker>
          <td class="num" :class="{ neg: (r.energy ?? 0) < 0 }">{{ r.energy == null ? '' : fmt(r.energy) }}</td>
        </tr>
        <tr v-if="Object.keys(flying).length">
          <td class="muted">{{ t('imperium.flying') }}</td>
          <td /><td /><td />
          <td v-for="id in RES" :key="id" class="num muted">{{ flying[id] ? short(flying[id]) : '0' }}</td>
          <td />
        </tr>
        <tr style="font-weight: 600">
          <td>{{ t('common.total') }}</td>
          <td colspan="3" class="small muted">
            <template v-if="research && !research.coords">
              {{ t('player.research') }}: {{ research.label }}
              <Ticker v-if="research.end != null" v-slot="{ now: n }">{{ countdown(research.end - n) }}</Ticker>
            </template>
          </td>
          <Ticker v-slot="{ now: n }">
            <td v-for="(sum, i) in totalsAt(n)" :key="i" class="num" :title="`+${fmt(sum.perHour)}/h`">
              {{ short(sum.value + (flying[RES[i]] ?? 0)) }} <span class="faint">/ {{ short(sum.cap) }}</span>
            </td>
          </Ticker>
          <td />
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.fl-history { margin-top: 10px; }
.fl-history summary { cursor: pointer; margin-bottom: 6px; }
/* mobile planet cards */
.emp-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; margin-bottom: 10px; }
.emp-card.moon { border-left: 3px solid var(--info); background: color-mix(in srgb, var(--info) 7%, var(--surface)); }
.emp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.emp-head .moon-tag { margin: 0; }
.emp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.emp-queues { display: grid; grid-template-columns: auto 1fr auto; gap: 3px 10px; align-items: baseline; }
.emp-queues > span:nth-child(3n + 2) { min-width: 0; overflow-wrap: anywhere; }
.emp-res { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.emp-res .num { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.bar { height: 4px; margin: 3px 0 2px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
.bar > div { height: 100%; background: var(--info); }
.bar > div.warn { background: var(--warn); }
.bar > div.neg { background: var(--neg); }
</style>

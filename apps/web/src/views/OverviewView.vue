<script setup lang="ts">
import PlayerLink from '../components/PlayerLink.vue';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useMobile, useSort, useStored, useUni } from '../composables';
import { ago, dateTime, distance, fmt, fmtSigned, name, short, STATS_SHORT, STATS_TYPES } from '../format';
import { intlLocale } from '../i18n';

interface Delta {
  delta: number;
  since: number;
  partial: boolean;
}
interface Score {
  points: number;
  rank: number;
  rankChange: number | null;
  time: number;
  deltas: Record<string, Delta>;
  /** FF-Hub style: change per synced statistics update (newest first), against the update before */
  slots: ({ delta: number; from: number; to: number } | null)[];
}
interface Player {
  id: number;
  ingame_id: number | null;
  name: string;
  status: string[];
  note: string | null;
  ally_name: string | null;
  ally_tag: string | null;
  inactive_since: number | null;
  scores: Record<number, Score>;
  /** former names */
  aliases: string[];
}
interface Spy {
  time: number;
  count: number;
  res?: Record<string, number>;
  resTime?: number;
  building?: number;
  buildingTime?: number;
  fleet?: number;
  fleetTime?: number;
  defense?: number;
  defenseTime?: number;
}
/** Points from the member's own empire page (alliance planets). */
interface Own {
  time: number;
  building: number | null;
  fleet: number | null;
  defense: number | null;
}
interface PlanetRow {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
  name: string | null;
  player_id: number;
  spy: Spy | null;
  own: Own | null;
  last_battle: number | null;
}
interface Row {
  key: string;
  player: Player;
  planet: PlanetRow | null;
  dist: number | null;
}

const { t } = useI18n();
/** Delta windows of the player view (server keys) */
const WINDOWS = ['prev', '6h', '12h', '18h', '24h', '48h', '7d'];
const windowLabel = (w: string) => (w === 'prev' ? t('overview.prevStand') : w === '7d' ? t('time.days', { n: 7 }) : w.replace('h', ' h'));
/**
 * Delta columns of the planet view (like FF-Hub): 6 h sections back from the newest synced statistics update.
 * A gap in the synced updates is shown in the newest section it covers, the sections in between stay empty.
 */
const PLANET_WINDOWS = ['6h', '12h', '18h', '24h'];
const slot = (p: { scores: Record<number, Score> }, w: string) => p.scores[1]?.slots?.[PLANET_WINDOWS.indexOf(w)] ?? null;
/** 6 h sections of the Δ columns (total points), newest first; null without synced updates at both ends. */
const sections = ref<({ from: number; to: number } | null)[]>([]);
const slotHeader = (w: string) => {
  const i = PLANET_WINDOWS.indexOf(w);
  const sec = sections.value[i];
  return sec ? t('overview.slotHeader', { from: dateTime(sec.from), to: dateTime(sec.to) }) : t('overview.slotHeaderMissing', { n: i + 1 });
};
const slotTitle = (sl: { from: number; to: number } | null) =>
  sl ? t('overview.slotTitle', { from: dateTime(sl.from), to: dateTime(sl.to) }) : t('overview.slotMissing');

const { uni, ctx } = useUni();
const mobile = useMobile();
const mode = useStored<'planets' | 'players'>('overview.mode', 'planets');
const win = useStored('overview.window', '24h');
const filter = useStored('overview.filter', {
  text: '',
  ally: '',
  hideInactive: false,
  hideVacation: true,
  onlyInactive: false,
  minPoints: null as number | null,
  maxPoints: null as number | null,
  minDelta: null as number | null,
  deltaType: 1,
  galaxy: null as number | null,
  from: '',
  onlySpied: false,
  hideMoons: false,
});
const players = ref<Player[]>([]);
const planets = ref<PlanetRow[]>([]);
const coverage = ref<{ type: number; stat_time: number; rows: number; min_rank: number; max_rank: number }[]>([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await uniApi(uni.value, '/overview');
    players.value = res.players;
    planets.value = res.planets;
    coverage.value = res.coverage;
    sections.value = res.slots ?? [];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const inactive = (p: Player) => p.status.includes('inactive') || p.status.includes('longinactive');
const delta = (p: Player, type: number, w = win.value) => p.scores[type]?.deltas[w];

const origin = computed<[number, number, number] | null>(() => {
  const m = filter.value.from.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
});

function playerMatches(p: Player) {
  const f = filter.value;
  const text = f.text.trim().toLowerCase();
  const ally = f.ally.trim().toLowerCase();
  if (text && !p.name.toLowerCase().includes(text) && !p.aliases.some((a) => a.toLowerCase().includes(text))) return false;
  if (ally && !`${p.ally_name ?? ''} ${p.ally_tag ?? ''}`.toLowerCase().includes(ally)) return false;
  if (f.hideInactive && inactive(p)) return false;
  if (f.onlyInactive && !inactive(p)) return false;
  if (f.hideVacation && p.status.includes('vacation')) return false;
  const total = p.scores[1]?.points ?? 0;
  if (f.minPoints != null && total < f.minPoints) return false;
  if (f.maxPoints != null && total > f.maxPoints) return false;
  if (f.minDelta != null && (delta(p, f.deltaType)?.delta ?? -Infinity) < f.minDelta) return false;
  return true;
}

const filteredPlayers = computed(() => players.value.filter(playerMatches));

/** Galaxies of the universe; a stored galaxy filter outside of them (other universe) is ignored. */
const galaxies = computed(() => ctx.value!.universe.settings.galaxies ?? 1);
const galaxy = computed({
  get: () => {
    const g = filter.value.galaxy;
    return g != null && g >= 1 && g <= galaxies.value ? g : null;
  },
  set: (g: number | null) => (filter.value.galaxy = g),
});

/** Planet view: one row per known planet/moon, players without known planets get a single row without coordinates. */
const planetRows = computed<Row[]>(() => {
  const f = filter.value;
  const u = ctx.value!.universe.settings;
  const byPlayer = new Map<number, PlanetRow[]>();
  for (const pl of planets.value) {
    const list = byPlayer.get(pl.player_id);
    if (list) list.push(pl);
    else byPlayer.set(pl.player_id, [pl]);
  }
  const rows: Row[] = [];
  for (const player of filteredPlayers.value) {
    const list = byPlayer.get(player.id);
    if (!list) {
      if (!galaxy.value && !f.onlySpied) rows.push({ key: `p${player.id}`, player, planet: null, dist: null });
      continue;
    }
    for (const planet of list) {
      if (galaxy.value && planet.g !== galaxy.value) continue;
      if (f.onlySpied && !planet.spy) continue;
      if (f.hideMoons && planet.type === 'moon') continue;
      const dist = origin.value ? distance(u, origin.value, [planet.g, planet.s, planet.p]) : null;
      rows.push({ key: `${planet.g}:${planet.s}:${planet.p}:${planet.type}`, player, planet, dist });
    }
  }
  return rows;
});

/** Planet points from the newer source: own empire page or the last spy report containing the section. */
function pts(r: Row, field: 'building' | 'fleet' | 'defense') {
  const spy = r.planet?.spy;
  const own = r.planet?.own;
  const spyTime = spy?.[`${field}Time`];
  if (own && own[field] != null && (spyTime == null || own.time >= spyTime)) return { value: own[field], title: t('overview.fromEmpire', { time: dateTime(own.time) }) };
  if (spy?.[field] != null) return { value: spy[field]!, title: t('overview.fromSpy', { time: dateTime(spyTime) }) };
  return { value: null, title: '' };
}

const resOf = (r: Row, id: number) => r.planet?.spy?.res?.[id] ?? null;
const resSum = (r: Row) => (r.planet?.spy?.res ? [901, 902, 903].reduce((s, id) => s + (resOf(r, id) ?? 0), 0) : null);

const planetSort = useSort(
  planetRows,
  (r, key) => {
    const [kind, arg] = key.split(':');
    const spy = r.planet?.spy;
    switch (kind) {
      case 'name':
        return r.player.name.toLowerCase();
      case 'ally':
        return (r.player.ally_tag ?? r.player.ally_name ?? '').toLowerCase() || null;
      case 'coords':
        return r.planet ? -(r.planet.g * 1e6 + r.planet.s * 100 + r.planet.p + (r.planet.type === 'moon' ? 0.5 : 0)) : null;
      case 'dist':
        return r.dist == null ? null : -r.dist;
      case 'p':
        return r.player.scores[Number(arg)]?.points ?? null;
      case 'd':
        return slot(r.player, arg)?.delta ?? null;
      case 'building':
        return pts(r, 'building').value;
      case 'fleet':
        return pts(r, 'fleet').value;
      case 'defense':
        return pts(r, 'defense').value;
      case 'battle':
        return r.planet?.last_battle ?? null;
      case 'spy':
        return spy?.time ?? null;
      case 'res':
        return arg ? resOf(r, Number(arg)) : resSum(r);
    }
    return null;
  },
  'p:1',
);

const playerSort = useSort(
  filteredPlayers,
  (r, key) => {
    const [kind, arg] = key.split(':');
    if (kind === 'name') return r.name.toLowerCase();
    if (kind === 'ally') return (r.ally_tag ?? r.ally_name ?? '').toLowerCase() || null;
    if (kind === 'p') return r.scores[Number(arg)]?.points ?? null;
    if (kind === 'd') return delta(r, Number(arg))?.delta ?? null;
    if (kind === 'rank') return r.scores[1] ? -r.scores[1].rank : null;
    return null;
  },
  'p:1',
);

/** Delta colour: intensity relative to the player's points; partial deltas (too little history) are italic. */
function deltaStyle(points: number | undefined, d: Delta | undefined) {
  if (!d || d.delta === 0) return {};
  const rel = Math.min(1, Math.abs(d.delta) / Math.max(1, points ?? 1) / 0.05);
  const alpha = 0.35 + rel * 0.65;
  return { color: d.delta > 0 ? `rgba(63,185,80,${alpha})` : `rgba(248,81,73,${alpha})`, fontStyle: d.partial ? 'italic' : undefined };
}
const deltaTitle = (d: Delta | undefined, w: string) =>
  d ? (d.partial ? t('overview.deltaPartial', { window: windowLabel(w) }) : '') + t('overview.since', { time: dateTime(d.since) }) : t('overview.noOlderStats');

const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
const hasGameUrl = computed(() => !!ctx.value?.universe.settings.gameUrl);
const galaxyLink = (pl: PlanetRow) => `${gameUrl.value}game.php?page=galaxy&galaxy=${pl.g}&system=${pl.s}`;
const spyLink = (pl: PlanetRow) => ({ path: `/${uni.value}/spy`, query: { c: `${pl.g}:${pl.s}:${pl.p}`, type: pl.type } });
const age = (epoch: number | undefined) => (epoch ? t('stats.asOf', { time: dateTime(epoch) }) : '');
const num = (n: number | null | undefined) => (n == null ? '' : fmt(n));
const shortOrEmpty = (n: number | null | undefined) => (n == null ? '' : short(n));

// ---------------------------------------------------------------- mobile list
/** Signed short number for the narrow mobile columns. */
const shortSigned = (n: number) => (n > 0 ? '+' : '') + short(n);
interface Metric<T> {
  key: string;
  label: string;
  cell: (r: T) => { text: string; title?: string; style?: Record<string, string | undefined> };
}
/** Values of a planet row as label/value pairs (mobile list); keys match the planet sort keys. */
const planetMetrics = computed<Metric<Row>[]>(() => [
  ...(origin.value ? [{ key: 'dist', label: t('overview.dist'), cell: (r: Row) => ({ text: num(r.dist) }) }] : []),
  { key: 'p:1', label: t('expeditions.points'), cell: (r) => ({ text: shortOrEmpty(r.player.scores[1]?.points) }) },
  ...PLANET_WINDOWS.map((w) => ({
    key: 'd:' + w,
    label: 'Δ' + w,
    cell: (r: Row) => {
      const sl = slot(r.player, w);
      return { text: sl ? shortSigned(sl.delta) : '', title: slotTitle(sl), style: deltaStyle(r.player.scores[1]?.points, sl ? { ...sl, since: 0, partial: false } : undefined) };
    },
  })),
  { key: 'building', label: t('stats.col.4'), cell: (r) => ({ text: shortOrEmpty(pts(r, 'building').value), title: pts(r, 'building').title }) },
  { key: 'p:3', label: t('stats.col.3'), cell: (r) => ({ text: shortOrEmpty(r.player.scores[3]?.points) }) },
  { key: 'fleet', label: t('stats.col.2'), cell: (r) => ({ text: shortOrEmpty(pts(r, 'fleet').value), title: pts(r, 'fleet').title }) },
  { key: 'defense', label: t('stats.col.5'), cell: (r) => ({ text: shortOrEmpty(pts(r, 'defense').value), title: pts(r, 'defense').title }) },
  { key: 'battle', label: t('overview.battle'), cell: (r) => ({ text: r.planet?.last_battle ? ago(r.planet.last_battle) : '' }) },
  { key: 'spy', label: t('player.sourceSpyShort'), cell: (r) => ({ text: r.planet?.spy ? ago(r.planet.spy.time) : '' }) },
  ...[901, 902, 903].map((id) => ({ key: 'res:' + id, label: t(`overview.resShort.${id}`), cell: (r: Row) => ({ text: shortOrEmpty(resOf(r, id)) }) })),
  { key: 'res', label: 'Σ', cell: (r) => ({ text: shortOrEmpty(resSum(r)) }) },
]);
/** Sort options of the mobile planet list (no clickable column headers there). */
const planetSortOptions = computed(() => [
  ...planetMetrics.value.map((m) => ({ key: m.key, label: m.key.startsWith('res:') ? `${t('player.sourceSpyShort')} ${name(Number(m.key.slice(4)))}` : m.key === 'res' ? t('overview.resSum') : m.label })),
  { key: 'name', label: t('common.player') },
  { key: 'ally', label: t('overview.ally') },
  { key: 'coords', label: t('common.coords') },
]);
/** Always on the second line of a planet entry, plus the metric the list is sorted by. */
const PLANET_CHIPS = ['p:1', 'd:6h', 'spy', 'res'];
const planetChips = computed(() => {
  const keys = planetMetrics.value.some((m) => m.key === planetSort.key.value) && !PLANET_CHIPS.includes(planetSort.key.value) ? [planetSort.key.value, ...PLANET_CHIPS] : PLANET_CHIPS;
  return keys.map((k) => planetMetrics.value.find((m) => m.key === k)!).filter(Boolean);
});
const playerSortOptions = computed(() => [
  { key: 'rank', label: t('stats.rank') },
  { key: 'name', label: t('common.player') },
  { key: 'ally', label: t('common.alliance') },
  ...[1, 4, 3, 2, 5].flatMap((type) => [
    { key: 'p:' + type, label: STATS_TYPES[type] },
    { key: 'd:' + type, label: `Δ ${STATS_TYPES[type]}` },
  ]),
]);
const activeSort = computed(() => (mode.value === 'planets' ? planetSort : playerSort));
const expanded = ref(new Set<string>());
const toggle = (key: string) => (expanded.value.has(key) ? expanded.value.delete(key) : expanded.value.add(key));
const filtersOpen = ref(false);

/** Former name matching the name filter (the player is listed because of it). */
function matchedAlias(p: Player) {
  const text = filter.value.text.trim().toLowerCase();
  if (!text || p.name.toLowerCase().includes(text)) return null;
  return p.aliases.find((a) => a.toLowerCase().includes(text)) ?? null;
}

/** Recently inactive players are interesting raid targets (FF-Hub shows hours < 48). */
const freshInactive = (p: Player) => {
  if (!p.inactive_since || !inactive(p)) return null;
  const h = Math.floor((Date.now() / 1000 - p.inactive_since) / 3600);
  return h < 48 ? h : null;
};

const latest = computed(() => {
  const by: Record<number, { time: number; rows: number; max: number }> = {};
  for (const c of coverage.value) {
    const cur = by[c.type];
    if (!cur || c.stat_time > cur.time) by[c.type] = { time: c.stat_time, rows: c.rows, max: c.max_rank };
    else if (c.stat_time === cur.time) {
      cur.rows += c.rows;
      cur.max = Math.max(cur.max, c.max_rank);
    }
  }
  return by;
});
/** Newest stats time over all categories; older categories are highlighted (not pasted again yet). */
const newestStat = computed(() => Math.max(0, ...Object.values(latest.value).map((l) => l.time)));
const outdated = (type: number) => !!latest.value[type] && latest.value[type].time < newestStat.value - 900;
/** Categories that are older than the newest stand or missing (shown as warnings next to the compact line). */
const staleTypes = computed(() => (newestStat.value ? [1, 2, 3, 4, 5].filter((type) => !latest.value[type] || outdated(type)) : []));
/** "12:00" today, otherwise date and time */
const time = (epoch: number) =>
  new Date(epoch * 1000).toDateString() === new Date().toDateString()
    ? new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
    : dateTime(epoch);

/** How far back the total points history reaches (oldest reference over all players). */
const history = computed(() => {
  let oldest: number | null = null;
  for (const p of players.value) for (const d of Object.values(p.scores[1]?.deltas ?? {})) if (oldest == null || d.since < oldest) oldest = d.since;
  return oldest;
});
</script>

<template>
  <h1>
    {{ t('nav.overview') }}
    <Hint>
      <p>{{ t('overview.hint1') }}</p>
      <p>{{ t('overview.hint2') }}</p>
      <p>{{ t('overview.hint3') }}</p>
      <p>{{ t('overview.hint4') }}</p>
      <p>{{ t('overview.hint5') }}</p>
      <p>{{ t('overview.hint6') }}</p>
    </Hint>
    <Hint v-if="players.length && !history" warn>{{ t('overview.needTwoStands') }}</Hint>
  </h1>

  <div class="card" :class="{ collapsed: mobile && !filtersOpen }">
    <div class="row">
      <div class="tabs" style="margin: 0">
        <button :class="{ active: mode === 'planets' }" @click="mode = 'planets'">{{ t('player.planets') }}</button>
        <button :class="{ active: mode === 'players' }" @click="mode = 'players'">{{ t('stats.players') }}</button>
      </div>
      <label v-if="mode === 'players'" class="more">
        {{ t('overview.deltaWindow') }}
        <select v-model="win">
          <option v-for="w in WINDOWS" :key="w" :value="w">{{ windowLabel(w) }}</option>
        </select>
      </label>
      <input v-model="filter.text" :placeholder="t('common.player')" style="width: 190px" />
      <button v-if="mobile" :class="{ active: filtersOpen }" @click="filtersOpen = !filtersOpen">{{ t('overview.filters') }} {{ filtersOpen ? '▴' : '▾' }}</button>
      <input v-model="filter.ally" class="more" :placeholder="t('common.alliance')" style="width: 110px" />
      <label class="more"><input v-model="filter.hideInactive" type="checkbox" /> {{ t('overview.hideInactive') }}</label>
      <label class="more"><input v-model="filter.onlyInactive" type="checkbox" /> {{ t('overview.onlyInactive') }}</label>
      <label class="more"><input v-model="filter.hideVacation" type="checkbox" /> {{ t('overview.hideVacation') }}</label>
      <label class="more">{{ t('expeditions.points') }} <input v-model.number="filter.minPoints" type="number" placeholder="min" /> – <input v-model.number="filter.maxPoints" type="number" placeholder="max" /></label>
      <label class="more">
        Δ
        <select v-model.number="filter.deltaType">
          <option v-for="(l, type) in STATS_TYPES" :key="type" :value="Number(type)">{{ l }}</option>
        </select>
        <select v-if="mode === 'planets'" v-model="win">
          <option v-for="w in WINDOWS" :key="w" :value="w">{{ windowLabel(w) }}</option>
        </select>
        ≥ <input v-model.number="filter.minDelta" type="number" />
      </label>
    </div>
    <div class="row" style="margin-top: 8px">
      <template v-if="mode === 'planets'">
        <label v-if="galaxies > 1" class="more">
          {{ t('nav.galaxy') }}
          <select v-model="galaxy">
            <option :value="null">{{ t('common.all') }}</option>
            <option v-for="g in galaxies" :key="g" :value="g">{{ g }}</option>
          </select>
        </label>
        <label class="more">{{ t('overview.distanceFrom') }} <input v-model="filter.from" placeholder="1:100:8" style="width: 90px" /></label>
        <label class="more"><input v-model="filter.onlySpied" type="checkbox" /> {{ t('overview.onlySpied') }}</label>
        <label class="more"><input v-model="filter.hideMoons" type="checkbox" /> {{ t('overview.hideMoons') }}</label>
      </template>
      <span class="grow" />
      <span class="muted small">
        <template v-if="mode === 'planets'">{{ t('overview.rows', { n: planetSort.sorted.value.length }) }} · </template>{{ t('overview.playerCount', { n: filteredPlayers.length, total: players.length }) }}
      </span>
    </div>
    <div class="row small muted" style="margin-top: 8px; gap: 6px">
      <span>
        {{ t('nav.stats') }} <b v-if="newestStat">{{ time(newestStat) }}</b><span v-else class="warn">{{ t('overview.missing') }}</span>
        <template v-if="history"> · {{ t('overview.historySince', { time: dateTime(history) }) }}</template>
      </span>
      <Hint>
        <table class="cov">
          <tr v-for="type in [1, 2, 3, 4, 5]" :key="type">
            <td>{{ STATS_TYPES[type] }}</td>
            <template v-if="latest[type]">
              <td :class="{ warn: outdated(type) }">{{ dateTime(latest[type].time) }}</td>
              <td>{{ t('overview.coveragePlayers', { n: latest[type].rows }) }}</td>
              <td>{{ t('overview.coverageRank', { n: latest[type].max }) }}</td>
            </template>
            <td v-else colspan="3" class="warn">{{ t('overview.missing') }}</td>
          </tr>
        </table>
        <p>{{ t('overview.coverageHint1') }}</p>
        <p>{{ t('overview.coverageHint2') }}</p>
      </Hint>
      <span
        v-for="type in staleTypes"
        :key="type"
        class="warn"
        :title="latest[type] ? t('overview.staleTitle', { time: dateTime(latest[type].time), newest: dateTime(newestStat) }) : t('overview.notPasted')"
      >
        ⚠ {{ STATS_TYPES[type] }} {{ latest[type] ? t('overview.older', { time: time(latest[type].time) }) : t('overview.missing') }}
      </span>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="!loading && !players.length" class="card muted">
    <i18n-t keypath="overview.empty">
      <template #sync><RouterLink :to="`/${uni}/paste`">{{ t('nav.sync') }}</RouterLink></template>
    </i18n-t>
  </div>

  <!-- Mobile: two-line list with sort selection, tap the values to see all of them -->
  <template v-else-if="mobile">
    <div class="row small m-sort">
      <label>
        {{ t('overview.sort') }}
        <select v-if="mode === 'planets'" :value="planetSort.key.value" style="max-width: 55vw" @change="planetSort.sortBy(($event.target as HTMLSelectElement).value)">
          <option v-for="o in planetSortOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
        <select v-else :value="playerSort.key.value" style="max-width: 55vw" @change="playerSort.sortBy(($event.target as HTMLSelectElement).value)">
          <option v-for="o in playerSortOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
      </label>
      <button :title="t('overview.sortDir')" @click="activeSort.descending.value = !activeSort.descending.value">{{ activeSort.descending.value ? '▾' : '▴' }}</button>
    </div>

    <div v-if="mode === 'planets'" class="m-list">
      <div v-for="(r, i) in planetSort.sorted.value" :key="r.key" class="m-item" :class="{ dim: r.player.status.includes('vacation'), moon: r.planet?.type === 'moon' }">
        <div class="m-line">
          <span class="faint small">{{ i + 1 }}</span>
          <span v-if="freshInactive(r.player) != null" class="badge" style="color: var(--neg)" :title="t('overview.inactiveSince')">{{ freshInactive(r.player) }}h</span>
          <PlayerLink :id="r.player.id" :name="r.player.name" />
          <span v-if="matchedAlias(r.player)" class="faint small">({{ t('player.aliases', { names: matchedAlias(r.player) }) }})</span>
          <StatusBadges :status="r.player.status" />
          <span v-if="r.player.note" class="faint small" :title="r.player.note">✎</span>
          <span v-if="r.player.ally_tag ?? r.player.ally_name" class="muted small">[{{ r.player.ally_tag ?? r.player.ally_name }}]</span>
          <span class="grow" />
          <template v-if="r.planet">
            <span class="mono small">
              <a v-if="hasGameUrl" :href="galaxyLink(r.planet)" target="_blank" rel="noopener">{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</a>
              <template v-else>{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</template>
            </span>
            <span v-if="r.planet.type === 'moon'" class="moon-tag" style="margin: 0">☾</span>
            <PlanetActions :g="r.planet.g" :s="r.planet.s" :p="r.planet.p" :type="r.planet.type" :from="origin" />
          </template>
          <span v-else class="faint small" :title="t('overview.noPlanets')">–</span>
        </div>
        <button class="m-chips" :aria-expanded="expanded.has(r.key)" :title="t('overview.details')" @click="toggle(r.key)">
          <span v-for="m in planetChips" :key="m.key" class="m-chip" :class="{ sorted: m.key === planetSort.key.value }">
            <span class="faint">{{ m.label }}</span> <span :style="m.cell(r).style">{{ m.cell(r).text || '–' }}</span>
          </span>
          <span class="m-toggle faint">{{ expanded.has(r.key) ? '▴' : '▾' }}</span>
        </button>
        <div v-if="expanded.has(r.key)" class="m-grid small">
          <div v-for="m in planetMetrics" :key="m.key" :class="{ sorted: m.key === planetSort.key.value }">
            <span class="faint">{{ m.label }}</span>
            <RouterLink v-if="m.key === 'spy' && r.planet?.spy" :to="spyLink(r.planet)">{{ m.cell(r).text }}</RouterLink>
            <span v-else :style="m.cell(r).style" :title="m.cell(r).title">{{ m.cell(r).text || '–' }}</span>
          </div>
          <div v-if="r.planet?.name"><span class="faint">{{ t('common.planet') }}</span> <span>{{ r.planet.name }}</span></div>
        </div>
      </div>
    </div>

    <div v-else class="m-list">
      <div v-for="r in playerSort.sorted.value" :key="r.id" class="m-item" :class="{ dim: r.status.includes('vacation') }">
        <div class="m-line">
          <span class="small muted">
            #{{ r.scores[1]?.rank ?? '–' }}
            <span v-if="r.scores[1]?.rankChange" :class="r.scores[1].rankChange > 0 ? 'pos' : 'neg'">{{ r.scores[1].rankChange > 0 ? '▲' : '▼' }}{{ Math.abs(r.scores[1].rankChange) }}</span>
          </span>
          <span v-if="freshInactive(r) != null" class="badge" style="color: var(--neg)" :title="t('overview.inactiveSince')">{{ freshInactive(r) }}h</span>
          <PlayerLink :id="r.id" :name="r.name" />
          <span v-if="matchedAlias(r)" class="faint small">({{ t('player.aliases', { names: matchedAlias(r) }) }})</span>
          <StatusBadges :status="r.status" />
          <span v-if="r.note" class="faint small" :title="r.note">✎</span>
          <span class="grow" />
          <span class="muted small">{{ r.ally_tag ?? r.ally_name ?? '' }}</span>
        </div>
        <div class="m-cats small">
          <div v-for="type in [1, 4, 3, 2, 5]" :key="type" :class="{ sorted: playerSort.key.value === 'p:' + type || playerSort.key.value === 'd:' + type }">
            <span class="faint">{{ STATS_SHORT[type] }}</span>
            <span>{{ short(r.scores[type]?.points) }}</span>
            <span :style="deltaStyle(r.scores[type]?.points, delta(r, type))">{{ delta(r, type)?.delta ? shortSigned(delta(r, type)!.delta) : '' }}</span>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- Planet view (like the FF-Hub overview) -->
  <div v-else-if="mode === 'planets'" class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th class="num">#</th>
          <th class="sortable" @click="planetSort.sortBy('ally')">{{ t('overview.ally') }}{{ planetSort.indicator('ally') }}</th>
          <th class="sortable" @click="planetSort.sortBy('name')">{{ t('common.player') }}{{ planetSort.indicator('name') }}</th>
          <th class="sortable" @click="planetSort.sortBy('coords')">{{ t('common.coords') }}{{ planetSort.indicator('coords') }}</th>
          <th />
          <th v-if="origin" class="sortable num" @click="planetSort.sortBy('dist')">{{ t('overview.dist') }}{{ planetSort.indicator('dist') }}</th>
          <th class="sortable num" :title="STATS_TYPES[1]" @click="planetSort.sortBy('p:1')">{{ t('expeditions.points') }}{{ planetSort.indicator('p:1') }}</th>
          <th v-for="w in PLANET_WINDOWS" :key="w" class="sortable num" :title="slotHeader(w)" @click="planetSort.sortBy('d:' + w)">
            Δ{{ w }}{{ planetSort.indicator('d:' + w) }}
          </th>
          <th class="sortable num" :title="t('overview.buildingTitle')" @click="planetSort.sortBy('building')">{{ t('stats.col.4') }}{{ planetSort.indicator('building') }}</th>
          <th class="sortable num" :title="t('overview.researchTitle')" @click="planetSort.sortBy('p:3')">{{ t('stats.col.3') }}{{ planetSort.indicator('p:3') }}</th>
          <th class="sortable num" :title="t('overview.fleetTitle')" @click="planetSort.sortBy('fleet')">{{ t('stats.col.2') }}{{ planetSort.indicator('fleet') }}</th>
          <th class="sortable num" :title="t('overview.defenseTitle')" @click="planetSort.sortBy('defense')">{{ t('stats.col.5') }}{{ planetSort.indicator('defense') }}</th>
          <th class="sortable" :title="t('overview.battleTitle')" @click="planetSort.sortBy('battle')">{{ t('overview.battle') }}{{ planetSort.indicator('battle') }}</th>
          <th class="sortable" :title="t('overview.spyTitle')" @click="planetSort.sortBy('spy')">{{ t('player.sourceSpyShort') }}{{ planetSort.indicator('spy') }}</th>
          <th class="sortable num" :title="t('overview.resTitle', { res: name(901) })" @click="planetSort.sortBy('res:901')">{{ t('overview.resShort.901') }}{{ planetSort.indicator('res:901') }}</th>
          <th class="sortable num" :title="t('overview.resTitle', { res: name(902) })" @click="planetSort.sortBy('res:902')">{{ t('overview.resShort.902') }}{{ planetSort.indicator('res:902') }}</th>
          <th class="sortable num" :title="t('overview.resTitle', { res: name(903) })" @click="planetSort.sortBy('res:903')">{{ t('overview.resShort.903') }}{{ planetSort.indicator('res:903') }}</th>
          <th class="sortable num" :title="t('overview.resSum')" @click="planetSort.sortBy('res')">Σ{{ planetSort.indicator('res') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in planetSort.sorted.value" :key="r.key" :class="{ dim: r.player.status.includes('vacation'), moon: r.planet?.type === 'moon' }">
          <td class="num faint">{{ i + 1 }}</td>
          <td class="muted" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis" :title="r.player.ally_name ?? ''">{{ r.player.ally_tag ?? r.player.ally_name ?? '' }}</td>
          <td>
            <span v-if="freshInactive(r.player) != null" class="badge" style="color: var(--neg)" :title="t('overview.inactiveSince')">{{ freshInactive(r.player) }}h</span>
            <PlayerLink :id="r.player.id" :name="r.player.name" />
            <span v-if="matchedAlias(r.player)" class="faint small"> ({{ t('player.aliases', { names: matchedAlias(r.player) }) }})</span>
            <StatusBadges :status="r.player.status" />
            <span v-if="r.player.note" class="faint small" :title="r.player.note"> ✎</span>
          </td>
          <td class="mono small">
            <template v-if="r.planet">
              <a v-if="hasGameUrl" :href="galaxyLink(r.planet)" target="_blank" rel="noopener" :title="r.planet.name ?? ''">{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</a>
              <span v-else :title="r.planet.name ?? ''">{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</span>
              <span v-if="r.planet.type === 'moon'" class="moon-tag" style="margin: 0 0 0 4px">☾ {{ t('common.moon') }}</span>
            </template>
            <span v-else class="faint" :title="t('overview.noPlanets')">–</span>
          </td>
          <td><PlanetActions v-if="r.planet" :g="r.planet.g" :s="r.planet.s" :p="r.planet.p" :type="r.planet.type" :from="origin" /></td>
          <td v-if="origin" class="num">{{ num(r.dist) }}</td>
          <td class="num" :title="r.player.scores[1] ? `${t('stats.rank')} ${r.player.scores[1].rank} · ${t('stats.asOf', { time: dateTime(r.player.scores[1].time) })}` : ''">
            {{ shortOrEmpty(r.player.scores[1]?.points) }}
          </td>
          <td
            v-for="w in PLANET_WINDOWS"
            :key="w"
            class="num"
            :style="deltaStyle(r.player.scores[1]?.points, slot(r.player, w) ? { ...slot(r.player, w)!, since: 0, partial: false } : undefined)"
            :title="slotTitle(slot(r.player, w))"
          >
            {{ slot(r.player, w) ? fmtSigned(slot(r.player, w)!.delta) : '' }}
          </td>
          <td class="num" :title="`${t('overview.playerTotal', { n: fmt(r.player.scores[4]?.points) })} · ${pts(r, 'building').title}`">{{ num(pts(r, 'building').value) }}</td>
          <td class="num">{{ num(r.player.scores[3]?.points) }}</td>
          <td class="num" :title="`${t('overview.playerTotal', { n: fmt(r.player.scores[2]?.points) })} · ${pts(r, 'fleet').title}`">{{ num(pts(r, 'fleet').value) }}</td>
          <td class="num" :title="`${t('overview.playerTotal', { n: fmt(r.player.scores[5]?.points) })} · ${pts(r, 'defense').title}`">{{ num(pts(r, 'defense').value) }}</td>
          <td class="small muted" :title="dateTime(r.planet?.last_battle)">{{ r.planet?.last_battle ? ago(r.planet.last_battle) : '' }}</td>
          <td class="small">
            <RouterLink v-if="r.planet?.spy" :to="spyLink(r.planet)" :title="`${t('spy.reports', r.planet.spy.count)} · ${dateTime(r.planet.spy.time)}`">{{ ago(r.planet.spy.time) }}</RouterLink>
          </td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 901)) }}</td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 902)) }}</td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 903)) }}</td>
          <td class="num" :title="resSum(r) == null ? '' : t('overview.cargoHalf', { small: Math.ceil(resSum(r)! / 2 / 5000), large: Math.ceil(resSum(r)! / 2 / 25000) })">
            {{ shortOrEmpty(resSum(r)) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Player view: all categories with the selected window -->
  <div v-else class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th class="sortable num" @click="playerSort.sortBy('rank')">#{{ playerSort.indicator('rank') }}</th>
          <th class="sortable" @click="playerSort.sortBy('name')">{{ t('common.player') }}{{ playerSort.indicator('name') }}</th>
          <th class="sortable" @click="playerSort.sortBy('ally')">{{ t('common.alliance') }}{{ playerSort.indicator('ally') }}</th>
          <template v-for="type in [1, 4, 3, 2, 5]" :key="type">
            <th class="sortable num" :title="STATS_TYPES[type]" @click="playerSort.sortBy('p:' + type)">{{ STATS_SHORT[type] }}{{ playerSort.indicator('p:' + type) }}</th>
            <th class="sortable num" :title="`Δ ${STATS_TYPES[type]} (${windowLabel(win)})`" @click="playerSort.sortBy('d:' + type)">Δ{{ playerSort.indicator('d:' + type) }}</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in playerSort.sorted.value" :key="r.id" :class="{ dim: r.status.includes('vacation') }">
          <td class="num">
            {{ r.scores[1]?.rank ?? '–' }}
            <span v-if="r.scores[1]?.rankChange" :class="r.scores[1].rankChange > 0 ? 'pos' : 'neg'" class="small">
              {{ r.scores[1].rankChange > 0 ? '▲' : '▼' }}{{ Math.abs(r.scores[1].rankChange) }}
            </span>
          </td>
          <td>
            <span v-if="freshInactive(r) != null" class="badge" style="color: var(--neg)" :title="t('overview.inactiveSince')">{{ freshInactive(r) }}h</span>
            <PlayerLink :id="r.id" :name="r.name" />
            <span v-if="matchedAlias(r)" class="faint small"> ({{ t('player.aliases', { names: matchedAlias(r) }) }})</span>
            <StatusBadges :status="r.status" />
            <span v-if="r.note" class="faint small" :title="r.note"> ✎</span>
          </td>
          <td class="muted">{{ r.ally_tag ?? r.ally_name ?? '' }}</td>
          <template v-for="type in [1, 4, 3, 2, 5]" :key="type">
            <td class="num" :title="r.scores[type] ? `${fmt(r.scores[type].points)} · ${t('stats.asOf', { time: dateTime(r.scores[type].time) })}` : ''">{{ short(r.scores[type]?.points) }}</td>
            <td class="num" :style="deltaStyle(r.scores[type]?.points, delta(r, type))" :title="deltaTitle(delta(r, type), win)">
              {{ delta(r, type) ? fmtSigned(delta(r, type)!.delta) : '' }}
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
table.cov { border-collapse: collapse; margin-bottom: 6px; }
table.cov td { padding: 1px 10px 1px 0; white-space: nowrap; }

/* mobile: filters beyond the player search fold away */
.collapsed .more { display: none; }
.m-sort { margin-bottom: 8px; }
.m-list { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.m-item { padding: 8px 12px; border-bottom: 1px solid var(--border); }
.m-item:last-child { border-bottom: 0; }
.m-item.dim > * { opacity: .55; }
.m-item.moon { background: color-mix(in srgb, var(--info) 7%, transparent); }
.m-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
.m-chips {
  position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; width: 100%; min-height: 0; margin-top: 4px; padding: 2px 18px 2px 0;
  border: 0; border-radius: 0; background: none; color: var(--text); font: 12px var(--mono); text-align: left;
}
.m-chip { white-space: nowrap; }
.m-toggle { position: absolute; top: 2px; right: 0; }
.sorted { font-weight: 700; }
.sorted .faint { color: var(--accent); }
.m-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 10px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); font-family: var(--mono); }
.m-grid > div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.m-cats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 10px; margin-top: 4px; font-family: var(--mono); }
.m-cats > div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
</style>

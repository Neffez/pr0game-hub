<script setup lang="ts">
import PlayerLink from '../components/PlayerLink.vue';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref } from 'vue';
import { uniApi } from '../api';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useSort, useStored, useUni } from '../composables';
import { ago, dateTime, distance, fmt, fmtSigned, short, STATS_SHORT, STATS_TYPES } from '../format';

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
  /** FF-Hub style 6 h slots (Δ6h, Δ12h, Δ18h, Δ24h): change within each 6 h stats interval */
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

const WINDOW_LABEL: Record<string, string> = { prev: 'letzter Stand', '6h': '6 h', '12h': '12 h', '18h': '18 h', '24h': '24 h', '48h': '48 h', '7d': '7 Tage' };
/** Delta columns of the planet view (like FF-Hub). */
const PLANET_WINDOWS = ['6h', '12h', '18h', '24h'];
/** 6 h slot of the total points for a planet-view column (Δ6h = newest interval, Δ12h = the one before, …). */
const slot = (p: { scores: Record<number, Score> }, w: string) => p.scores[1]?.slots?.[PLANET_WINDOWS.indexOf(w)] ?? null;
const slotHeader = (w: string) => {
  const i = PLANET_WINDOWS.indexOf(w);
  return `Punkteveränderung im 6-h-Abschnitt ${i ? `${i * 6}–${(i + 1) * 6} h` : 'der letzten 6 h'} vor dem neuesten Statistik-Stand`;
};
const slotTitle = (sl: { from: number; to: number } | null) =>
  sl ? `Veränderung ${dateTime(sl.from)} → ${dateTime(sl.to)}` : 'Statistik-Stand für diesen Abschnitt fehlt';

const { uni, ctx } = useUni();
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
      if (!f.galaxy && !f.onlySpied) rows.push({ key: `p${player.id}`, player, planet: null, dist: null });
      continue;
    }
    for (const planet of list) {
      if (f.galaxy && planet.g !== f.galaxy) continue;
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
  if (own && own[field] != null && (spyTime == null || own.time >= spyTime)) return { value: own[field], title: `Imperium vom ${dateTime(own.time)}` };
  if (spy?.[field] != null) return { value: spy[field]!, title: `Spionage vom ${dateTime(spyTime)}` };
  return { value: null, title: '' };
}

const resOf = (r: Row, id: number) => r.planet?.spy?.res?.[id] ?? null;
const resSum = (r: Row) => (r.planet?.spy?.res ? [901, 902, 903].reduce((s, id) => s + (resOf(r, id) ?? 0), 0) : null);

const planetSort = useSort(
  planetRows,
  (r, key) => {
    const [kind, t] = key.split(':');
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
        return r.player.scores[Number(t)]?.points ?? null;
      case 'd':
        return slot(r.player, t)?.delta ?? null;
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
        return t ? resOf(r, Number(t)) : resSum(r);
    }
    return null;
  },
  'p:1',
);

const playerSort = useSort(
  filteredPlayers,
  (r, key) => {
    const [kind, t] = key.split(':');
    if (kind === 'name') return r.name.toLowerCase();
    if (kind === 'ally') return (r.ally_tag ?? r.ally_name ?? '').toLowerCase() || null;
    if (kind === 'p') return r.scores[Number(t)]?.points ?? null;
    if (kind === 'd') return delta(r, Number(t))?.delta ?? null;
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
  d ? `${d.partial ? `Noch keine ${WINDOW_LABEL[w]} Historie – ` : ''}seit ${dateTime(d.since)}` : 'keine ältere Statistik';

const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
const hasGameUrl = computed(() => !!ctx.value?.universe.settings.gameUrl);
const galaxyLink = (pl: PlanetRow) => `${gameUrl.value}game.php?page=galaxy&galaxy=${pl.g}&system=${pl.s}`;
const spyLink = (pl: PlanetRow) => ({ path: `/${uni.value}/spy`, query: { c: `${pl.g}:${pl.s}:${pl.p}`, type: pl.type } });
const age = (t: number | undefined) => (t ? `Stand ${dateTime(t)}` : '');
const num = (n: number | null | undefined) => (n == null ? '' : fmt(n));
const shortOrEmpty = (n: number | null | undefined) => (n == null ? '' : short(n));

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
const outdated = (t: number) => !!latest.value[t] && latest.value[t].time < newestStat.value - 900;
/** "12:00" today, otherwise date and time */
const time = (epoch: number) =>
  new Date(epoch * 1000).toDateString() === new Date().toDateString()
    ? new Date(epoch * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
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
    Übersicht
    <Hint>
      <p><b>Planeten</b>: eine Zeile pro bekanntem Planet/Mond (aus Galaxie-Ansichten und Spionageberichten). Spieler ohne bekannte Planeten stehen mit „–“ da.</p>
      <p><b>Δ-Spalten</b> (wie FF-Hub): Veränderung der Gesamtpunkte je 6-h-Abschnitt. Δ6h = neuester Stand gegenüber dem Stand 6 h davor, Δ12h = der Abschnitt davor (6–12 h), usw. Leer, wenn ein Statistik-Stand fehlt – dafür die Statistik nach jedem Update einfügen.</p>
      <p><b>Geb./Flotte/Vert.</b>: Punkte auf diesem Planeten aus dem Imperium (Allianz-Mitglieder) oder der letzten Spionage, je nachdem was neuer ist (Tooltip: Quelle und Spieler gesamt). Rohstoffe aus der letzten Spionage.</p>
      <p><b>Aktionen</b>: Spionieren/Angreifen öffnen die Flottenseite im Spiel mit vorausgefülltem Ziel (Spiel-URL unter Universen eintragen). „Flugzeit berechnen“ öffnet den Flugzeitrechner mit Ziel, deinen Antriebsforschungen (Imperium) und deinem nächstgelegenen Planeten bzw. „Entfernung von“ als Start.</p>
      <p><b>Spielerfilter</b> findet auch frühere Namen.</p>
      <p><b>Spieler</b>: alle Kategorien mit wählbarem Zeitraum.</p>
    </Hint>
    <Hint v-if="players.length && !history" warn>
      Für Punkteveränderungen braucht es mindestens zwei Statistik-Stände: Statistik nach dem nächsten Update erneut einfügen.
    </Hint>
  </h1>

  <div class="card">
    <div class="row">
      <div class="tabs" style="margin: 0">
        <button :class="{ active: mode === 'planets' }" @click="mode = 'planets'">Planeten</button>
        <button :class="{ active: mode === 'players' }" @click="mode = 'players'">Spieler</button>
      </div>
      <label v-if="mode === 'players'">
        Δ-Zeitraum
        <select v-model="win">
          <option v-for="(l, w) in WINDOW_LABEL" :key="w" :value="w">{{ l }}</option>
        </select>
      </label>
      <input v-model="filter.text" placeholder="Spieler (auch frühere Namen)" style="width: 190px" />
      <input v-model="filter.ally" placeholder="Allianz" style="width: 110px" />
      <label><input v-model="filter.hideInactive" type="checkbox" /> Inaktive aus</label>
      <label><input v-model="filter.onlyInactive" type="checkbox" /> nur Inaktive</label>
      <label><input v-model="filter.hideVacation" type="checkbox" /> U-Mode aus</label>
      <label>Punkte <input v-model.number="filter.minPoints" type="number" placeholder="min" /> – <input v-model.number="filter.maxPoints" type="number" placeholder="max" /></label>
      <label>
        Δ
        <select v-model.number="filter.deltaType">
          <option v-for="(l, t) in STATS_TYPES" :key="t" :value="Number(t)">{{ l }}</option>
        </select>
        <select v-if="mode === 'planets'" v-model="win">
          <option v-for="(l, w) in WINDOW_LABEL" :key="w" :value="w">{{ l }}</option>
        </select>
        ≥ <input v-model.number="filter.minDelta" type="number" />
      </label>
    </div>
    <div class="row" style="margin-top: 8px">
      <template v-if="mode === 'planets'">
        <label>Galaxie <input v-model.number="filter.galaxy" type="number" min="1" style="width: 60px" /></label>
        <label>Entfernung von <input v-model="filter.from" placeholder="1:100:8" style="width: 90px" /></label>
        <label><input v-model="filter.onlySpied" type="checkbox" /> nur spioniert</label>
        <label><input v-model="filter.hideMoons" type="checkbox" /> Monde aus</label>
      </template>
      <span class="grow" />
      <span class="muted small">
        <template v-if="mode === 'planets'">{{ planetSort.sorted.value.length }} Zeilen · </template>{{ filteredPlayers.length }} / {{ players.length }} Spieler
      </span>
    </div>
    <div class="row small muted" style="margin-top: 8px">
      <span>Statistik-Stand:</span>
      <span
        v-for="t in [1, 2, 3, 4, 5]"
        :key="t"
        :class="{ warn: outdated(t) }"
        :title="outdated(t) ? `Älter als der neueste Stand (${dateTime(newestStat)}): Kategorie ${STATS_TYPES[t]} neu einfügen` : ''"
      >
        {{ STATS_TYPES[t] }}
        <template v-if="latest[t]"><b>{{ time(latest[t].time) }}</b> ({{ latest[t].rows }} Spieler, bis Rang {{ latest[t].max }})</template>
        <span v-else class="warn">fehlt</span>
      </span>
      <span v-if="history">
        Historie seit {{ dateTime(history) }}
        <Hint>Kursive Δ-Werte: Der Zeitraum ist noch nicht vollständig abgedeckt, die Veränderung gilt seit dem ältesten vorhandenen Stand.</Hint>
      </span>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="!loading && !players.length" class="card muted">
    Noch keine Statistik vorhanden. Unter <RouterLink :to="`/${uni}/paste`">Einfügen</RouterLink> die Statistikseiten einfügen
    (am besten jede Kategorie: Punkte, Flotte, Forschung, Gebäude, Verteidigung). Planeten kommen aus Galaxie-Ansichten und Spionageberichten.
  </div>

  <!-- Planet view (like the FF-Hub overview) -->
  <div v-else-if="mode === 'planets'" class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th class="num">#</th>
          <th class="sortable" @click="planetSort.sortBy('ally')">Ally{{ planetSort.indicator('ally') }}</th>
          <th class="sortable" @click="planetSort.sortBy('name')">Spieler{{ planetSort.indicator('name') }}</th>
          <th class="sortable" @click="planetSort.sortBy('coords')">Koord.{{ planetSort.indicator('coords') }}</th>
          <th />
          <th v-if="origin" class="sortable num" @click="planetSort.sortBy('dist')">Entf.{{ planetSort.indicator('dist') }}</th>
          <th class="sortable num" title="Gesamtpunkte" @click="planetSort.sortBy('p:1')">Punkte{{ planetSort.indicator('p:1') }}</th>
          <th v-for="w in PLANET_WINDOWS" :key="w" class="sortable num" :title="slotHeader(w)" @click="planetSort.sortBy('d:' + w)">
            Δ{{ w }}{{ planetSort.indicator('d:' + w) }}
          </th>
          <th class="sortable num" title="Gebäudepunkte des Planeten (eigenes Imperium oder letzte Spionage)" @click="planetSort.sortBy('building')">Geb.{{ planetSort.indicator('building') }}</th>
          <th class="sortable num" title="Forschungspunkte des Spielers" @click="planetSort.sortBy('p:3')">Forsch.{{ planetSort.indicator('p:3') }}</th>
          <th class="sortable num" title="Flottenpunkte auf dem Planeten (eigenes Imperium oder letzte Spionage)" @click="planetSort.sortBy('fleet')">Flotte{{ planetSort.indicator('fleet') }}</th>
          <th class="sortable num" title="Verteidigungspunkte des Planeten (eigenes Imperium oder letzte Spionage)" @click="planetSort.sortBy('defense')">Vert.{{ planetSort.indicator('defense') }}</th>
          <th class="sortable" title="Letzter Kampfbericht" @click="planetSort.sortBy('battle')">Angriff{{ planetSort.indicator('battle') }}</th>
          <th class="sortable" title="Letzte Spionage" @click="planetSort.sortBy('spy')">Spio{{ planetSort.indicator('spy') }}</th>
          <th class="sortable num" title="Metall (letzte Spionage)" @click="planetSort.sortBy('res:901')">MET{{ planetSort.indicator('res:901') }}</th>
          <th class="sortable num" title="Kristall (letzte Spionage)" @click="planetSort.sortBy('res:902')">KRI{{ planetSort.indicator('res:902') }}</th>
          <th class="sortable num" title="Deuterium (letzte Spionage)" @click="planetSort.sortBy('res:903')">DEU{{ planetSort.indicator('res:903') }}</th>
          <th class="sortable num" title="Summe Rohstoffe" @click="planetSort.sortBy('res')">Σ{{ planetSort.indicator('res') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in planetSort.sorted.value" :key="r.key" :class="{ dim: r.player.status.includes('vacation'), moon: r.planet?.type === 'moon' }">
          <td class="num faint">{{ i + 1 }}</td>
          <td class="muted" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis" :title="r.player.ally_name ?? ''">{{ r.player.ally_tag ?? r.player.ally_name ?? '' }}</td>
          <td>
            <span v-if="freshInactive(r.player) != null" class="badge" style="color: var(--neg)" title="inaktiv seit">{{ freshInactive(r.player) }}h</span>
            <PlayerLink :id="r.player.id" :name="r.player.name" />
            <span v-if="matchedAlias(r.player)" class="faint small"> (früher {{ matchedAlias(r.player) }})</span>
            <StatusBadges :status="r.player.status" />
            <span v-if="r.player.note" class="faint small" :title="r.player.note"> ✎</span>
          </td>
          <td class="mono small">
            <template v-if="r.planet">
              <a v-if="hasGameUrl" :href="galaxyLink(r.planet)" target="_blank" rel="noopener" :title="r.planet.name ?? ''">{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</a>
              <span v-else :title="r.planet.name ?? ''">{{ r.planet.g }}:{{ r.planet.s }}:{{ r.planet.p }}</span>
              <span v-if="r.planet.type === 'moon'" class="moon-tag" style="margin: 0 0 0 4px">☾ Mond</span>
            </template>
            <span v-else class="faint" title="Keine Planeten bekannt (Galaxie einfügen)">–</span>
          </td>
          <td><PlanetActions v-if="r.planet" :g="r.planet.g" :s="r.planet.s" :p="r.planet.p" :type="r.planet.type" :from="origin" /></td>
          <td v-if="origin" class="num">{{ num(r.dist) }}</td>
          <td class="num" :title="r.player.scores[1] ? `Rang ${r.player.scores[1].rank} · Stand ${dateTime(r.player.scores[1].time)}` : ''">
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
          <td class="num" :title="`Spieler gesamt: ${fmt(r.player.scores[4]?.points)} · ${pts(r, 'building').title}`">{{ num(pts(r, 'building').value) }}</td>
          <td class="num">{{ num(r.player.scores[3]?.points) }}</td>
          <td class="num" :title="`Spieler gesamt: ${fmt(r.player.scores[2]?.points)} · ${pts(r, 'fleet').title}`">{{ num(pts(r, 'fleet').value) }}</td>
          <td class="num" :title="`Spieler gesamt: ${fmt(r.player.scores[5]?.points)} · ${pts(r, 'defense').title}`">{{ num(pts(r, 'defense').value) }}</td>
          <td class="small muted" :title="dateTime(r.planet?.last_battle)">{{ r.planet?.last_battle ? ago(r.planet.last_battle) : '' }}</td>
          <td class="small">
            <RouterLink v-if="r.planet?.spy" :to="spyLink(r.planet)" :title="`${r.planet.spy.count} Berichte · ${dateTime(r.planet.spy.time)}`">{{ ago(r.planet.spy.time) }}</RouterLink>
          </td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 901)) }}</td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 902)) }}</td>
          <td class="num" :title="age(r.planet?.spy?.resTime)">{{ shortOrEmpty(resOf(r, 903)) }}</td>
          <td class="num" :title="resSum(r) == null ? '' : `${Math.ceil(resSum(r)! / 2 / 5000)} kleine / ${Math.ceil(resSum(r)! / 2 / 25000)} große Transporter für die Hälfte`">
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
          <th class="sortable" @click="playerSort.sortBy('name')">Spieler{{ playerSort.indicator('name') }}</th>
          <th class="sortable" @click="playerSort.sortBy('ally')">Allianz{{ playerSort.indicator('ally') }}</th>
          <template v-for="t in [1, 4, 3, 2, 5]" :key="t">
            <th class="sortable num" :title="STATS_TYPES[t]" @click="playerSort.sortBy('p:' + t)">{{ STATS_SHORT[t] }}{{ playerSort.indicator('p:' + t) }}</th>
            <th class="sortable num" :title="`Δ ${STATS_TYPES[t]} (${WINDOW_LABEL[win]})`" @click="playerSort.sortBy('d:' + t)">Δ{{ playerSort.indicator('d:' + t) }}</th>
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
            <span v-if="freshInactive(r) != null" class="badge" style="color: var(--neg)" title="inaktiv seit">{{ freshInactive(r) }}h</span>
            <PlayerLink :id="r.id" :name="r.name" />
            <span v-if="matchedAlias(r)" class="faint small"> (früher {{ matchedAlias(r) }})</span>
            <StatusBadges :status="r.status" />
            <span v-if="r.note" class="faint small" :title="r.note"> ✎</span>
          </td>
          <td class="muted">{{ r.ally_tag ?? r.ally_name ?? '' }}</td>
          <template v-for="t in [1, 4, 3, 2, 5]" :key="t">
            <td class="num" :title="r.scores[t] ? `${fmt(r.scores[t].points)} · Stand ${dateTime(r.scores[t].time)}` : ''">{{ short(r.scores[t]?.points) }}</td>
            <td class="num" :style="deltaStyle(r.scores[t]?.points, delta(r, t))" :title="deltaTitle(delta(r, t), win)">
              {{ delta(r, t) ? fmtSigned(delta(r, t)!.delta) : '' }}
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import PlayerLink from '../components/PlayerLink.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useStored, useUni } from '../composables';
import { ago, dateTime, fmt, freshnessColor, name, short, timeWithAge } from '../format';
import GalaxyFreshness from '../components/GalaxyFreshness.vue';

/** Galaxy view like in the game, from the synced galaxy data (no activity, no deuterium). */
/** Last spy report of a planet/moon: time and the resources it showed. */
interface Spy {
  time: number;
  res: Record<string, number> | null;
  resTime: number | null;
}
interface Row {
  p: number;
  name: string | null;
  has_moon: number;
  moon_name: string | null;
  destroyed: number;
  debris: { metal: string; crystal: string } | null;
  updated_at: number;
  player_id: number | null;
  player_name: string | null;
  status: string[];
  note: string | null;
  ally_name: string | null;
  ally_tag: string | null;
  points: number | null;
  rank: number | null;
  spy_planet: Spy | null;
  spy_moon: Spy | null;
  last_battle: number | null;
  own: boolean;
}

const { t } = useI18n();
const { uni, ctx } = useUni();
const route = useRoute();
const router = useRouter();
const settings = computed(() => ctx.value!.universe.settings);
const last = useStored('browse.pos', { g: 1, s: 1 });

const clamp = (v: number, max: number) => Math.min(max, Math.max(1, Math.floor(v) || 1));
const g = ref(clamp(Number(route.query.g ?? last.value.g), settings.value.galaxies));
const s = ref(clamp(Number(route.query.s ?? last.value.s), settings.value.systems));
const jump = ref('');

/** Moon with a sensor phalanx that reaches the shown system. */
interface Phalanx {
  g: number;
  s: number;
  p: number;
  level: number;
  range: number;
  from: number;
  to: number;
  distance: number;
  time: number;
  source: 'spy' | 'empire';
  own: boolean;
  player: { id: number | null; name: string; ally: string | null } | null;
}

const system = ref<{ view: { seen_at: number; username: string } | null; rows: Row[]; phalanx: Phalanx[] } | null>(null);
const strip = ref<{ planets: Record<string, number>; seen: Record<string, number>; own: number[] } | null>(null);
const error = ref('');
const now = Math.floor(Date.now() / 1000);

async function loadSystem() {
  error.value = '';
  last.value = { g: g.value, s: s.value };
  router.replace({ query: { ...route.query, g: g.value, s: s.value } });
  try {
    system.value = await uniApi(uni.value, `/browse/${g.value}/${s.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadStrip() {
  strip.value = await uniApi(uni.value, `/browse/${g.value}`);
}
onMounted(() => {
  loadSystem();
  loadStrip();
});
watch([g, s], loadSystem);
watch(g, loadStrip);

/** Step through systems/galaxies, wrapping around like circular universes do. */
function step(ds: number, dg = 0) {
  const { systems, galaxies } = settings.value;
  if (dg) g.value = ((g.value - 1 + dg + galaxies) % galaxies) + 1;
  if (ds) {
    let next = s.value + ds;
    if (next < 1 || next > systems) {
      next = ((next - 1 + systems) % systems) + 1;
    }
    s.value = next;
  }
}
/** System picked in the freshness heat map below: show it and scroll back up. */
function showSystem(pos: { g: number; s: number }) {
  g.value = pos.g;
  s.value = pos.s;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function goTo() {
  const m = jump.value.match(/(\d+)\D+(\d+)/);
  if (!m) return;
  g.value = clamp(Number(m[1]), settings.value.galaxies);
  s.value = clamp(Number(m[2]), settings.value.systems);
  jump.value = '';
}

/** ←/→ system, ↑/↓ galaxy, Bild↑/↓ 10 systems; ignored while typing. */
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
  // keys belong to the player dialog while it is open
  if (route.query.player) return;
  const map: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], PageUp: [10, 0], PageDown: [-10, 0],
  };
  const d = map[e.key];
  if (!d) return;
  e.preventDefault();
  step(d[0], d[1]);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** All positions 1..n, empty ones included like in the game. */
const positions = computed(() => {
  const byPos = new Map((system.value?.rows ?? []).map((r) => [r.p, r]));
  return Array.from({ length: settings.value.positions }, (_, i) => ({ p: i + 1, row: byPos.get(i + 1) ?? null }));
});
const occupied = computed(() => (system.value?.rows ?? []).filter((r) => r.player_id).length);

const stripCells = computed(() =>
  Array.from({ length: settings.value.systems }, (_, i) => {
    const sys = i + 1;
    const seen = strip.value?.seen[sys] ?? null;
    return {
      s: sys,
      planets: strip.value?.planets[sys] ?? 0,
      age: seen ? now - seen : null,
      own: strip.value?.own.includes(sys) ?? false,
    };
  }),
);

const gameUrl = computed(() => settings.value.gameUrl?.replace(/\/?$/, '/') ?? '');
const inactive = (r: Row) => r.status.includes('inactive') || r.status.includes('longinactive');
/** Spy rows of a position: planet first, then moon (one line each in the spy columns). */
function spies(row: Row | null) {
  const out: { type: 'planet' | 'moon'; spy: Spy }[] = [];
  if (row?.spy_planet) out.push({ type: 'planet', spy: row.spy_planet });
  if (row?.spy_moon) out.push({ type: 'moon', spy: row.spy_moon });
  return out;
}
const spyLink = (p: number, type: 'planet' | 'moon') => ({ path: `/${uni.value}/spy`, query: { c: `${g.value}:${s.value}:${p}`, type } });
/** Range bar segments in % of the galaxy (two segments when the range wraps around). */
function rangeSegments(ph: Phalanx) {
  const n = settings.value.systems;
  const seg = (a: number, b: number) => ({ left: ((a - 1) / n) * 100, width: ((b - a + 1) / n) * 100 });
  if (ph.range * 2 >= n) return [seg(1, n)];
  return ph.from <= ph.to ? [seg(ph.from, ph.to)] : [seg(ph.from, n), seg(1, ph.to)];
}
const debrisText = (d: Row['debris']) => (d ? `${t('browse.metalShort')} ${d.metal} · ${t('browse.crystalShort')} ${d.crystal}` : '');
</script>

<template>
  <h1>
    {{ t('browse.title') }}
    <Hint>
      <p>{{ t('browse.hint1') }}</p>
      <p>{{ t('browse.hint2') }}</p>
      <p>{{ t('browse.hint3') }}</p>
    </Hint>
  </h1>

  <div class="card">
    <div class="row">
      <div class="tabs" style="margin: 0">
        <button v-for="n in settings.galaxies" :key="n" :class="{ active: g === n }" @click="g = n">G{{ n }}</button>
      </div>
      <span class="grow" />
      <button :title="t('browse.back10')" @click="step(-10)">«</button>
      <button :title="t('browse.prev')" @click="step(-1)">‹</button>
      <label class="mono">
        {{ g }}:<input v-model.number="s" type="number" min="1" :max="settings.systems" style="width: 70px" @change="s = clamp(s, settings.systems)" />
      </label>
      <button :title="t('browse.next')" @click="step(1)">›</button>
      <button :title="t('browse.forward10')" @click="step(10)">»</button>
      <form class="row" style="gap: 4px" @submit.prevent="goTo">
        <input v-model="jump" :placeholder="t('browse.jump')" style="width: 120px" />
      </form>
    </div>

    <div class="strip" :title="`${t('nav.galaxy')} ${g}`">
      <div
        v-for="c in stripCells"
        :key="c.s"
        class="strip-cell"
        :class="{ current: c.s === s }"
        :title="`${g}:${c.s} · ${t('browse.planets', { n: c.planets })} · ${c.age == null ? t('browse.neverSeen') : t('browse.seenAgo', { ago: ago(now - c.age) })}${c.own ? ' · ' + t('common.alliance') : ''}`"
        @click="s = c.s"
      >
        <div class="bar" :style="{ height: `${Math.min(100, 15 + c.planets * 6)}%`, background: freshnessColor(c.age) }" />
        <div v-if="c.own" class="own-dot" />
      </div>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="system" class="card" style="padding: 0">
    <div class="row system-head">
      <b>{{ t('browse.system', { g, s }) }}</b>
      <span class="muted small">{{ t('browse.occupied', { n: occupied, total: settings.positions }) }}</span>
      <span v-if="system.view" class="small" :style="{ color: freshnessColor(now - system.view.seen_at) }">
        {{ t('browse.seenBy', { time: dateTime(system.view.seen_at), ago: ago(system.view.seen_at), name: system.view.username }) }}
      </span>
      <span v-else class="small warn">{{ t('browse.neverSynced') }}</span>
      <span class="grow" />
      <a v-if="gameUrl" class="small" :href="`${gameUrl}game.php?page=galaxy&galaxy=${g}&system=${s}`" target="_blank" rel="noopener">{{ t('combat.openInGame') }}</a>
    </div>
    <div class="table-wrap" style="max-height: none; border: 0; border-radius: 0">
      <table class="data">
        <thead>
          <tr>
            <th class="num">{{ t('browse.pos') }}</th>
            <th>{{ t('common.planet') }}</th>
            <th>{{ t('common.moon') }}</th>
            <th>{{ t('combat.debris') }}</th>
            <th>{{ t('common.player') }}</th>
            <th class="num">{{ t('expeditions.points') }}</th>
            <th>{{ t('common.alliance') }}</th>
            <th>{{ t('browse.lastSpy') }}</th>
            <th class="num">{{ name(901) }}</th>
            <th class="num">{{ name(902) }}</th>
            <th class="num">{{ name(903) }}</th>
            <th>{{ t('overview.battle') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ p, row } in positions"
            :key="p"
            :class="{ own: row?.own, dim: row && (row.status.includes('vacation') || inactive(row)), empty: !row?.player_id }"
          >
            <td class="num faint">{{ p }}</td>
            <td>
              <template v-if="row?.player_id">
                <PlanetActions :g="g" :s="s" :p="p" type="planet" :label="row.name || t('common.planet')" />
              </template>
              <span v-else-if="row?.destroyed" class="faint">{{ t('browse.destroyed') }}</span>
              <span v-else class="faint">–</span>
            </td>
            <td>
              <template v-if="row?.has_moon">
                <PlanetActions :g="g" :s="s" :p="p" type="moon" :label="`☾ ${row.moon_name || t('common.moon')}`" />
              </template>
            </td>
            <td class="small" :class="{ warn: row?.debris }">{{ debrisText(row?.debris ?? null) }}</td>
            <td>
              <template v-if="row?.player_id">
                <PlayerLink :id="row.player_id" :name="row.player_name ?? ''" />
                <StatusBadges :status="row.status" />
                <span v-if="row.note" class="faint small" :title="row.note"> ✎</span>
              </template>
            </td>
            <td class="num" :title="row?.rank ? `${t('stats.rank')} ${row.rank}` : ''">{{ row?.points != null ? short(row.points) : '' }}<span v-if="row?.rank" class="faint small"> #{{ fmt(row.rank) }}</span></td>
            <td class="muted" :title="row?.ally_name ?? ''">{{ row?.ally_tag ?? row?.ally_name ?? '' }}</td>
            <td class="small">
              <RouterLink v-for="sp in spies(row)" :key="sp.type" class="spy-line mono" :to="spyLink(p, sp.type)" :title="sp.type === 'moon' ? t('common.moon') : t('common.planet')">
                <span v-if="sp.type === 'moon'" class="moon-mark">☾</span>{{ timeWithAge(sp.spy.time) }}
              </RouterLink>
            </td>
            <td v-for="id in [901, 902, 903]" :key="id" class="num">
              <div v-for="sp in spies(row)" :key="sp.type" class="spy-line" :title="sp.spy.resTime ? t('stats.asOf', { time: dateTime(sp.spy.resTime) }) : ''">
                {{ sp.spy.res ? short(sp.spy.res[id] ?? 0) : '–' }}
              </div>
            </td>
            <td class="small muted" :title="dateTime(row?.last_battle)">{{ row?.last_battle ? ago(row.last_battle) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="system" class="card phalanx">
    <h3>
      {{ t('browse.phalanxTitle', { g, s }) }}
      <Hint>
        <p>{{ t('browse.phalanxHint1') }}</p>
        <p>{{ t('browse.phalanxHint2') }}</p>
      </Hint>
      <span class="muted small" style="font-weight: 400">{{ t('browse.known', { n: system.phalanx.length }) }}</span>
    </h3>
    <p v-if="!system.phalanx.length" class="muted small" style="margin: 0">{{ t('browse.noPhalanx') }}</p>
    <div v-for="ph in system.phalanx" :key="`${ph.s}:${ph.p}`" class="ph-row" :class="{ own: ph.own }">
      <div class="ph-who">
        <PlayerLink v-if="ph.player?.id" :id="ph.player.id" :name="ph.player.name" />
        <span v-else>{{ ph.player?.name ?? t('common.unknown') }}</span>
        <span v-if="ph.player?.ally" class="muted small"> [{{ ph.player.ally }}]</span>
        <span v-if="ph.own" class="badge" style="color: var(--accent)">{{ t('common.alliance') }}</span>
      </div>
      <a class="mono small" href="#" :title="t('browse.showSystem')" @click.prevent="s = ph.s">☾ {{ ph.g }}:{{ ph.s }}:{{ ph.p }}</a>
      <span class="small">{{ t('player.level') }} <b>{{ ph.level }}</b></span>
      <span class="mono small" :title="t('browse.rangeTitle', { range: ph.range, distance: ph.distance })">{{ ph.g }}:{{ ph.from }} – {{ ph.g }}:{{ ph.to }}</span>
      <div class="ph-bar" :title="t('browse.range', { from: `${ph.g}:${ph.from}`, to: `${ph.g}:${ph.to}` })">
        <div v-for="(seg, i) in rangeSegments(ph)" :key="i" class="ph-range" :style="{ left: seg.left + '%', width: seg.width + '%' }" />
        <div class="ph-moon" :style="{ left: ((ph.s - 0.5) / settings.systems) * 100 + '%' }" />
        <div class="ph-here" :style="{ left: ((s - 0.5) / settings.systems) * 100 + '%' }" />
      </div>
      <span class="small" :style="{ color: freshnessColor(now - ph.time) }" :title="dateTime(ph.time)">
        {{ t('player.sourceAgo', { source: ph.source === 'spy' ? t('player.sourceSpy') : t('player.sourceEmpire'), ago: ago(ph.time) }) }}
      </span>
    </div>
  </div>

  <GalaxyFreshness :current="{ g, s }" @select="showSystem" />
</template>

<style scoped>
.phalanx h3 { margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.ph-row { display: grid; grid-template-columns: minmax(180px, 1.4fr) 90px 70px 130px minmax(120px, 1fr) 150px; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.ph-row:nth-child(odd) { background: var(--surface-2); }
.ph-row.own { box-shadow: inset 3px 0 0 var(--accent); }
.ph-bar { position: relative; height: 8px; border-radius: 4px; background: var(--border); }
.ph-range { position: absolute; top: 0; height: 100%; border-radius: 4px; background: color-mix(in srgb, var(--info) 55%, transparent); }
.ph-moon { position: absolute; top: -2px; width: 4px; height: 12px; margin-left: -2px; border-radius: 2px; background: var(--info); }
.ph-here { position: absolute; top: -3px; width: 2px; height: 14px; margin-left: -1px; background: var(--accent); }
@media (max-width: 900px) {
  .ph-row { grid-template-columns: 1fr 1fr; }
}
.strip { display: flex; align-items: flex-end; gap: 0; height: 46px; margin-top: 12px; cursor: pointer; }
.strip-cell { position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; border-radius: 2px; }
.strip-cell:hover { background: var(--surface-2); }
.strip-cell.current { background: var(--accent-soft); outline: 1px solid var(--accent); }
.strip-cell .bar { width: 100%; border-radius: 2px 2px 0 0; }
.own-dot { position: absolute; top: 2px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--accent); }
.system-head { padding: 12px 16px; border-bottom: 1px solid var(--border); }
tr.own td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
tr.empty td { color: var(--faint); }
.spy-line { display: block; line-height: 1.5; }
.moon-mark { color: var(--info); margin-right: 4px; }
</style>

<script setup lang="ts">
import PlayerLink from '../components/PlayerLink.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useLoader, useMobile, useStored, useUni } from '../composables';
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

const now = Math.floor(Date.now() / 1000);

const { data: system, error, load: fetchSystem } = useLoader(() =>
  uniApi<{ view: { seen_at: number; username: string } | null; rows: Row[]; phalanx: Phalanx[] }>(uni.value, `/browse/${g.value}/${s.value}`),
);
const { data: strip, load: loadStrip } = useLoader(() =>
  uniApi<{ planets: Record<string, number>; seen: Record<string, number>; own: number[] }>(uni.value, `/browse/${g.value}`),
);
function loadSystem() {
  last.value = { g: g.value, s: s.value };
  router.replace({ query: { ...route.query, g: g.value, s: s.value } });
  return fetchSystem();
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

/** Mobile: positions as cards instead of the wide table, a step bar at the bottom, swipe to change the system. */
const mobile = useMobile();
type MobileItem = { kind: 'row'; p: number; row: Row } | { kind: 'empty'; from: number; to: number };
/** Occupied positions (and debris/destroyed ones), consecutive empty positions merged into one line. */
const mobileItems = computed(() => {
  const out: MobileItem[] = [];
  for (const { p, row } of positions.value) {
    if (row && (row.player_id || row.debris || row.destroyed)) out.push({ kind: 'row', p, row });
    else {
      const prev = out[out.length - 1];
      if (prev?.kind === 'empty') prev.to = p;
      else out.push({ kind: 'empty', from: p, to: p });
    }
  }
  return out;
});
const spyRes = (sp: Spy) =>
  sp.res
    ? `${t('browse.metalShort')} ${short(sp.res[901] ?? 0)} · ${t('browse.crystalShort')} ${short(sp.res[902] ?? 0)} · ${t('browse.deutShort')} ${short(sp.res[903] ?? 0)}`
    : '';

let swipe: { x: number; y: number } | null = null;
function onSwipeStart(e: TouchEvent) {
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onSwipeEnd(e: TouchEvent) {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dy = e.changedTouches[0].clientY - swipe.y;
  swipe = null;
  // mostly horizontal, so vertical scrolling never changes the system
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
}

/** Strip as a scrubber: drag across it (finger or mouse), the system is shown on release. */
const stripEl = ref<HTMLElement | null>(null);
const scrub = ref<number | null>(null);
const scrubCell = computed(() => (scrub.value != null ? stripCells.value[scrub.value - 1] : null));
function stripSystem(e: PointerEvent) {
  const r = stripEl.value!.getBoundingClientRect();
  return clamp(Math.ceil(((e.clientX - r.left) / r.width) * settings.value.systems), settings.value.systems);
}
function onStripDown(e: PointerEvent) {
  stripEl.value!.setPointerCapture(e.pointerId);
  scrub.value = stripSystem(e);
}
function onStripMove(e: PointerEvent) {
  if (scrub.value != null) scrub.value = stripSystem(e);
}
function onStripUp() {
  if (scrub.value != null) s.value = scrub.value;
  scrub.value = null;
}
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
    <div v-if="mobile" class="row">
      <select v-model.number="g" :aria-label="t('nav.galaxy')">
        <option v-for="n in settings.galaxies" :key="n" :value="n">G{{ n }}</option>
      </select>
      <form class="grow" @submit.prevent="goTo">
        <input v-model="jump" :placeholder="t('browse.jump')" style="width: 100%" />
      </form>
    </div>
    <div v-else class="row">
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

    <div
      ref="stripEl"
      class="strip"
      :title="`${t('nav.galaxy')} ${g}`"
      @pointerdown="onStripDown"
      @pointermove="onStripMove"
      @pointerup="onStripUp"
      @pointercancel="scrub = null"
    >
      <div v-if="scrubCell" class="scrub-bubble small" :style="{ left: `${((scrubCell.s - 0.5) / settings.systems) * 100}%` }">
        <b class="mono">{{ g }}:{{ scrubCell.s }}</b> · {{ t('browse.planets', { n: scrubCell.planets }) }} ·
        {{ scrubCell.age == null ? t('browse.neverSeen') : ago(now - scrubCell.age) }}
      </div>
      <div
        v-for="c in stripCells"
        :key="c.s"
        class="strip-cell"
        :class="{ current: c.s === (scrub ?? s) }"
        :title="`${g}:${c.s} · ${t('browse.planets', { n: c.planets })} · ${c.age == null ? t('browse.neverSeen') : t('browse.seenAgo', { ago: ago(now - c.age) })}${c.own ? ' · ' + t('common.alliance') : ''}`"
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
    <div v-if="mobile" class="pos-list" @touchstart.passive="onSwipeStart" @touchend="onSwipeEnd">
      <template v-for="it in mobileItems" :key="it.kind === 'row' ? it.p : `e${it.from}`">
        <div v-if="it.kind === 'empty'" class="pos-empty faint small">
          <span class="pos-n mono">{{ it.from }}</span>{{ it.from === it.to ? t('browse.empty') : t('browse.emptyRange', { from: it.from, to: it.to }) }}
        </div>
        <div v-else class="pos-card" :class="{ own: it.row.own, dim: it.row.status.includes('vacation') || inactive(it.row) }">
          <span class="pos-n mono faint">{{ it.p }}</span>
          <div class="pos-body">
            <div v-if="it.row.player_id" class="pos-line">
              <PlayerLink :id="it.row.player_id" :name="it.row.player_name ?? ''" />
              <StatusBadges :status="it.row.status" />
              <span v-if="it.row.note" class="faint small" :title="it.row.note">✎</span>
              <span v-if="it.row.ally_tag ?? it.row.ally_name" class="muted small">[{{ it.row.ally_tag ?? it.row.ally_name }}]</span>
              <span class="grow" />
              <span v-if="it.row.points != null" class="mono small">{{ short(it.row.points) }}<span v-if="it.row.rank" class="faint"> #{{ fmt(it.row.rank) }}</span></span>
            </div>
            <div class="pos-line">
              <PlanetActions v-if="it.row.player_id" :g="g" :s="s" :p="it.p" type="planet" :label="it.row.name || t('common.planet')" />
              <span v-else-if="it.row.destroyed" class="faint small">{{ t('browse.destroyed') }}</span>
              <PlanetActions v-if="it.row.has_moon" :g="g" :s="s" :p="it.p" type="moon" :label="`☾ ${it.row.moon_name || t('common.moon')}`" />
              <span v-if="it.row.debris" class="small warn">{{ t('combat.debris') }} {{ debrisText(it.row.debris) }}</span>
              <span class="grow" />
              <span v-if="it.row.last_battle" class="small muted" :title="dateTime(it.row.last_battle)">⚔ {{ ago(it.row.last_battle) }}</span>
            </div>
            <RouterLink v-for="sp in spies(it.row)" :key="sp.type" class="pos-spy small" :to="spyLink(it.p, sp.type)">
              <span v-if="sp.type === 'moon'" class="moon-mark">☾</span>
              <span class="muted">{{ t('browse.lastSpy') }} {{ ago(sp.spy.time) }}</span>
              <span v-if="sp.spy.res" class="mono"> · {{ spyRes(sp.spy) }}</span>
            </RouterLink>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="table-wrap" style="max-height: none; border: 0; border-radius: 0">
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

  <component :is="mobile ? 'details' : 'div'" v-if="system" class="card phalanx">
    <component :is="mobile ? 'summary' : 'div'">
    <h3>
      {{ t('browse.phalanxTitle', { g, s }) }}
      <Hint>
        <p>{{ t('browse.phalanxHint1') }}</p>
        <p>{{ t('browse.phalanxHint2') }}</p>
      </Hint>
      <span class="muted small" style="font-weight: 400">{{ t('browse.known', { n: system.phalanx.length }) }}</span>
    </h3>
    </component>
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
  </component>

  <GalaxyFreshness :current="{ g, s }" @select="showSystem" />

  <template v-if="mobile">
    <div class="stepper-space" />
    <div class="stepper">
      <button :aria-label="t('browse.back10')" @click="step(-10)">«</button>
      <button :aria-label="t('browse.prev')" @click="step(-1)">‹</button>
      <label class="mono">
        {{ g }}:<input v-model.number="s" type="number" inputmode="numeric" min="1" :max="settings.systems" @change="s = clamp(s, settings.systems)" />
      </label>
      <button :aria-label="t('browse.next')" @click="step(1)">›</button>
      <button :aria-label="t('browse.forward10')" @click="step(10)">»</button>
    </div>
  </template>
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
.strip { position: relative; display: flex; align-items: flex-end; gap: 0; height: 46px; margin-top: 12px; cursor: pointer; touch-action: none; user-select: none; }
.scrub-bubble {
  position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); z-index: 5; padding: 4px 8px; white-space: nowrap; pointer-events: none;
  background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, .4);
}
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

/* mobile position cards */
.pos-list { touch-action: pan-y; }
.pos-card { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.pos-card.own { box-shadow: inset 3px 0 0 var(--accent); }
.pos-card.dim .pos-body { opacity: .55; }
.pos-empty { display: flex; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.pos-n { width: 20px; flex-shrink: 0; text-align: right; }
.pos-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pos-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.pos-spy { display: block; color: var(--text); }
.phalanx summary { list-style: none; cursor: pointer; }
.phalanx summary::-webkit-details-marker { display: none; }
.phalanx summary h3::before { content: '▸'; color: var(--faint); }
.phalanx[open] summary h3::before { content: '▾'; }
details.phalanx:not([open]) h3 { margin: 0; }
/* step bar above the tab bar */
.stepper-space { height: 56px; }
.stepper {
  position: fixed; left: 0; right: 0; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); z-index: 25;
  display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px;
  background: var(--surface); border-top: 1px solid var(--border);
}
.stepper button { min-width: 48px; min-height: 40px; font-size: 18px; }
.stepper input { width: 72px; text-align: center; }
</style>

<script setup lang="ts">
import { storageCapacity } from '@pr0hub/core/tech';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useStored, useUni } from '../composables';
import { abbr, ago, dateTime, fmt, name, short } from '../format';

/**
 * Live view of a member's own planets (like the FF-Hub overview): resources are projected from the
 * last empire page with its production per hour (capped at the storage), queues count down from
 * the last game overview page.
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
      researchQueue?: { id: number; level: number; coords: C3 | null } | null;
      flying?: Record<string, number>;
      active?: { coords: C3; type: 'planet' | 'moon'; storage: Record<string, number> } | null;
    };
  } | null;
  overview: { time: number; data: { queues: Queue[] } } | null;
}

const RES = [901, 902, 903] as const;
const STORE: Record<number, number> = { 901: 22, 902: 23, 903: 24 };

const { uni, ctx } = useUni();
const userId = useStored<number | null>('imperium.user', null);
const data = ref<Data | null>(null);
const error = ref('');
const now = ref(Math.floor(Date.now() / 1000));
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  error.value = '';
  try {
    if (!ctx.value!.members.some((m) => m.id === userId.value)) userId.value = ctx.value!.me.id;
    data.value = await uniApi(uni.value, `/imperium?user=${userId.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  load();
  timer = setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000);
});
onBeforeUnmount(() => clearInterval(timer));
watch(userId, load);

const empire = computed(() => data.value?.empire ?? null);
const overview = computed(() => data.value?.overview ?? null);
const same = (a: C3, b: C3) => a.g === b.g && a.s === b.s && a.p === b.p;

/**
 * Storage factor of the universe: derived from the storage shown in the resource bar of the
 * selected planet (page header), otherwise the universe setting `storageMultiplier`.
 */
const storageFactor = computed(() => {
  const active = empire.value?.data.active;
  const planet = active && empire.value!.data.planets.find((p) => same(p.coords, active.coords) && p.type === active.type);
  if (planet && active.storage[901]) {
    const base = storageCapacity(planet.values[STORE[901]] ?? 0);
    if (base) return active.storage[901] / base;
  }
  return (ctx.value!.universe.settings as { storageMultiplier?: number }).storageMultiplier ?? 1;
});

/** Live amount: production since the page time, never above the storage (but full storages stay as they are). */
function live(p: EmpirePlanet, id: number) {
  const start = p.resources?.[id] ?? 0;
  const cap = storageCapacity(p.values[STORE[id]] ?? 0, storageFactor.value);
  const perHour = p.perHour?.[id] ?? 0;
  const elapsed = Math.max(0, now.value - empire.value!.time);
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

/** "1d 02:03:04" / "02:03:04" */
function countdown(sec: number) {
  if (sec <= 0) return 'fertig';
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

function building(p: EmpirePlanet) {
  const q = queueOf('building', p);
  if (q) return { label: `${name(q.id)}${q.destroy ? ' abreißen' : ''} ${q.level}`, left: endOf(q) - now.value };
  if (p.building && !overviewCurrent.value) return { label: `${name(p.building.id)} ${p.building.level}`, left: null };
  return null;
}

/** Research runs account wide; it is shown at the planet where it was started (empire page marker). */
const research = computed(() => {
  const q = overview.value?.data.queues.find((x) => x.kind === 'research') ?? null;
  const marker = empire.value?.data.researchQueue ?? null;
  if (q && (!marker || marker.id === q.id || overviewCurrent.value)) {
    return { label: `${name(q.id)} ${q.level}`, left: endOf(q) - now.value, coords: marker?.id === q.id ? marker.coords : q.coords };
  }
  if (marker) return { label: `${name(marker.id)} ${marker.level}`, left: null, coords: marker.coords };
  return null;
});

function shipyard(p: EmpirePlanet) {
  const q = queueOf('shipyard', p);
  const list = Object.entries(p.shipyard ?? {}).map(([id, n]) => `${fmt(n)}× ${abbr(Number(id))}`);
  if (!q && !list.length) return null;
  return { label: list.join(', ') || `${fmt(q!.level)}× ${abbr(q!.id)}`, title: Object.keys(p.shipyard ?? {}).map((id) => name(id)).join(', '), left: q ? endOf(q) - now.value : null };
}

const rows = computed(() =>
  (empire.value?.data.planets ?? []).map((p) => ({
    p,
    key: `${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`,
    res: RES.map((id) => live(p, id)),
    energy: p.resources?.[911] ?? null,
    building: building(p),
    research: research.value?.coords && same(research.value.coords, p.coords) && p.type === 'planet' ? research.value : null,
    shipyard: shipyard(p),
  })),
);

const totals = computed(() =>
  RES.map((_, i) => ({
    value: rows.value.reduce((s, r) => s + r.res[i].value, 0),
    cap: rows.value.reduce((s, r) => s + r.res[i].cap, 0),
    perHour: rows.value.reduce((s, r) => s + r.res[i].perHour, 0),
  })),
);
const flying = computed(() => empire.value?.data.flying ?? {});
const missingPerHour = computed(() => rows.value.some((r) => r.p.type === 'planet' && !r.p.perHour));
const hasLiveData = computed(() => rows.value.some((r) => r.p.resources));
const memberName = (id: number | null) => ctx.value!.members.find((m) => m.id === id)?.name ?? '';
</script>

<template>
  <h1>
    Imperium
    <Hint>
      <p>Live-Stand der eigenen Planeten aus dem zuletzt synchronisierten <b>Imperium</b> (Rohstoffe, Produktion, Speicher, Energie) und der zuletzt synchronisierten <b>Übersicht</b> im Spiel (Restzeiten von Gebäude, Forschung und Werft).</p>
      <p>Rohstoffe wachsen mit der Produktion pro Stunde bis zum Speicherlimit. Fertige Gebäude ändern Produktion und Speicher erst mit dem nächsten Imperium-Sync.</p>
      <p>Im Spiel im Imperium „Anzeigen: Produktion /h“ aktivieren, sonst fehlt die Produktion. Die Übersicht bitte als Seitenquelltext einfügen (oder per Skript), damit die Restzeiten enthalten sind.</p>
    </Hint>
  </h1>

  <div class="card row small">
    <label>
      Spieler
      <select v-model="userId">
        <option v-for="m in ctx!.members" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </label>
    <span class="muted">
      Imperium: <template v-if="empire">{{ dateTime(empire.time) }} ({{ ago(empire.time) }})</template><span v-else class="warn">fehlt</span>
    </span>
    <span class="muted">
      Übersicht: <template v-if="overview">{{ dateTime(overview.time) }} ({{ ago(overview.time) }})</template><span v-else class="warn">fehlt (keine Restzeiten)</span>
    </span>
    <span v-if="storageFactor !== 1" class="faint" title="Speicherfaktor des Universums, aus der Rohstoffleiste abgeleitet">Speicher ×{{ fmt(storageFactor, 1) }}</span>
    <span v-if="missingPerHour" class="warn">Produktion/h fehlt: im Imperium „Anzeigen: Produktion /h“ aktivieren und neu synchronisieren.</span>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !empire" class="card muted">{{ memberName(userId) }} hat noch kein Imperium eingefügt.</div>
  <div v-else-if="data && !hasLiveData" class="card muted">
    Das letzte Imperium enthält keine Rohstoffe (älterer Stand oder Plaintext). Imperium bitte als HTML/Seitenquelltext erneut einfügen.
  </div>

  <div v-else-if="empire" class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>Planet</th>
          <th>Gebäude</th>
          <th>Forschung</th>
          <th>Hangar</th>
          <th class="num">Metall</th>
          <th class="num">Kristall</th>
          <th class="num">Deuterium</th>
          <th class="num">Energie</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :class="{ moon: r.p.type === 'moon' }">
          <td>
            <span class="mono small">{{ r.p.coords.g }}:{{ r.p.coords.s }}:{{ r.p.coords.p }}</span>
            <span v-if="r.p.type === 'moon'" class="moon-tag" style="margin-left: 4px">☾ Mond</span>
            {{ r.p.name }}
          </td>
          <td class="small">
            <template v-if="r.building">
              {{ r.building.label }}
              <span v-if="r.building.left != null" class="mono" :class="r.building.left <= 0 ? 'pos' : 'muted'">{{ countdown(r.building.left) }}</span>
              <span v-else class="faint" title="Restzeit unbekannt: Übersicht im Spiel synchronisieren">?</span>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <td class="small">
            <template v-if="r.research">
              {{ r.research.label }}
              <span v-if="r.research.left != null" class="mono" :class="r.research.left <= 0 ? 'pos' : 'muted'">{{ countdown(r.research.left) }}</span>
              <span v-else class="faint" title="Restzeit unbekannt: Übersicht im Spiel synchronisieren">?</span>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <td class="small" :title="r.shipyard?.title">
            <template v-if="r.shipyard">
              {{ r.shipyard.label }}
              <span v-if="r.shipyard.left != null" class="mono muted" title="aktueller Auftrag">{{ countdown(r.shipyard.left) }}</span>
            </template>
            <span v-else class="faint">–</span>
          </td>
          <td
            v-for="(v, i) in r.res"
            :key="i"
            class="num"
            :class="resClass(v)"
            :title="`${fmt(v.value)} / ${fmt(v.cap)}${v.perHour ? ` · +${fmt(v.perHour)}/h` : ''}${v.fullIn != null ? ` · voll in ${countdown(v.fullIn)}` : ''}`"
          >
            {{ short(v.value) }} <span class="faint">/ {{ short(v.cap) }}</span>
          </td>
          <td class="num" :class="{ neg: (r.energy ?? 0) < 0 }">{{ r.energy == null ? '' : fmt(r.energy) }}</td>
        </tr>
        <tr v-if="Object.keys(flying).length">
          <td class="muted">Flotten (unterwegs)</td>
          <td /><td /><td />
          <td v-for="id in RES" :key="id" class="num muted">{{ flying[id] ? short(flying[id]) : '0' }}</td>
          <td />
        </tr>
        <tr style="font-weight: 600">
          <td>Summe</td>
          <td colspan="3" class="small muted">
            <template v-if="research && !research.coords">Forschung: {{ research.label }} {{ research.left != null ? countdown(research.left) : '' }}</template>
          </td>
          <td v-for="(t, i) in totals" :key="i" class="num" :title="`+${fmt(t.perHour)}/h`">
            {{ short(t.value + (flying[RES[i]] ?? 0)) }} <span class="faint">/ {{ short(t.cap) }}</span>
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  </div>
</template>

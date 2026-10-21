<script setup lang="ts">
import { Chart, registerables } from 'chart.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useUni } from '../composables';
import { ago, coords, dateTime, fmt, freshnessColor, name, phalanxRange, STATS_TYPES } from '../format';

Chart.register(...registerables);

const { uni, ctx } = useUni();
/** Player details (chart, note, planets, status history): page and dialog. */
const props = defineProps<{ id: number }>();
const data = ref<any>(null);
const error = ref('');
const note = ref('');
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

/** Planets with their moons as separate rows (each has its own actions). */
const planetRows = computed(() =>
  (data.value?.planets ?? []).flatMap((p: any) => [
    { ...p, type: 'planet', spy: p.last_spy },
    ...(p.has_moon ? [{ ...p, type: 'moon', name: p.moon_name, spy: p.last_spy_moon }] : []),
  ]),
);

const COLORS: Record<number, string> = { 1: '#f2683c', 2: '#58a6ff', 3: '#a371f7', 4: '#3fb950', 5: '#d29922' };

async function load() {
  error.value = '';
  try {
    data.value = await uniApi(uni.value, `/players/${props.id}`);
    note.value = data.value.player.note ?? '';
    await nextTick();
    draw();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function draw() {
  if (!canvas.value || !data.value) return;
  chart?.destroy();
  const datasets = [1, 2, 3, 4, 5].map((t) => ({
    label: STATS_TYPES[t],
    data: data.value.history.filter((h: any) => h.type === t).map((h: any) => ({ x: h.time * 1000, y: h.points })),
    borderColor: COLORS[t],
    backgroundColor: COLORS[t],
    pointRadius: 2,
    tension: 0.2,
    yAxisID: t === 1 ? 'y' : 'y2',
  }));
  // own total and fleet points as dashed lines for comparison (toggle via the legend like the others)
  for (const t of [1, 2]) {
    const points = (data.value.ownHistory ?? []).filter((h: any) => h.type === t);
    if (!points.length) continue;
    datasets.push({
      label: `Eigene: ${STATS_TYPES[t]}`,
      data: points.map((h: any) => ({ x: h.time * 1000, y: h.points })),
      borderColor: COLORS[t],
      backgroundColor: COLORS[t],
      borderDash: [6, 4],
      borderWidth: 1.5,
      // a single snapshot is only visible as a point
      pointRadius: points.length > 1 ? 0 : 3,
      tension: 0.2,
      yAxisID: t === 1 ? 'y' : 'y2',
    } as (typeof datasets)[number]);
  }
  chart = new Chart(canvas.value, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // no start animation: in the dialog the first frames can freeze mid-animation
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: { color: '#8b98a9', callback: (v) => new Date(Number(v)).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) },
          grid: { color: '#283241' },
        },
        y: { position: 'left', ticks: { color: '#8b98a9' }, grid: { color: '#283241' }, title: { display: true, text: 'Gesamt', color: '#8b98a9' } },
        y2: { position: 'right', ticks: { color: '#8b98a9' }, grid: { display: false }, title: { display: true, text: 'Kategorien', color: '#8b98a9' } },
      },
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: { callbacks: { title: (items) => dateTime((items[0].parsed.x ?? 0) / 1000), label: (i) => `${i.dataset.label}: ${fmt(i.parsed.y ?? 0)}` } },
      },
    },
  });
}

async function saveNote() {
  await uniApi(uni.value, `/players/${props.id}/note`, { method: 'PUT', body: { note: note.value } });
}

/** Research groups shown on the player page (combat, drives, others). */
const RESEARCH_GROUPS: { label: string; ids: number[] }[] = [
  { label: 'Kampf', ids: [109, 110, 111] },
  { label: 'Antriebe', ids: [115, 117, 118] },
  { label: 'Sonstige', ids: [124, 199] },
];
const sourceText = (k: { time: number; source: string }) => `${k.source === 'spy' ? 'Spionage' : 'Imperium'} vom ${dateTime(k.time)} (${ago(k.time)})`;

const latest = computed(() => {
  const out: Record<number, any> = {};
  for (const h of data.value?.history ?? []) out[h.type] = h;
  return out;
});

onMounted(load);
watch(() => props.id, load);
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <h1>
      {{ data.player.name }}
      <StatusBadges :status="data.player.status" />
      <span v-if="data.player.ally_name" class="muted"> [{{ data.player.ally_tag ?? data.player.ally_name }}]</span>
    </h1>
    <p class="muted small">
      <template v-if="data.player.ingame_id">ID {{ data.player.ingame_id }} · </template>
      zuletzt gesehen {{ dateTime(data.player.last_seen) }}
      <template v-if="data.aliases.length"> · früher: {{ data.aliases.map((a: any) => a.name).join(', ') }}</template>
    </p>

    <div class="card">
      <div class="row">
        <span v-for="t in [1, 4, 3, 2, 5]" :key="t">
          <span class="muted">{{ STATS_TYPES[t] }}:</span> <b>{{ fmt(latest[t]?.points) }}</b>
          <span v-if="latest[t]" class="faint small"> (#{{ latest[t].rank }})</span>
        </span>
      </div>
      <div style="height: 300px; margin-top: 10px"><canvas ref="canvas" /></div>
    </div>

    <div class="card">
      <h3 style="margin-top: 0">
        Forschung
        <span v-if="data.research" class="small" style="font-weight: 400" :style="{ color: freshnessColor(Date.now() / 1000 - data.research.time) }">
          · {{ sourceText(data.research) }}
        </span>
      </h3>
      <div v-if="data.research" class="research">
        <div v-for="grp in RESEARCH_GROUPS" :key="grp.label">
          <div class="faint small">{{ grp.label }}</div>
          <div v-for="id in grp.ids" :key="id" class="research-line">
            <span>{{ name(id) }}</span>
            <b class="mono">{{ data.research.values[id] ?? 0 }}</b>
          </div>
        </div>
      </div>
      <p v-else class="muted small" style="margin: 0">Unbekannt – noch kein Spionagebericht mit sichtbarer Forschung.</p>
    </div>

    <div class="card">
      <h3 style="margin-top: 0">Notiz (für die Allianz sichtbar)</h3>
      <div class="row">
        <input v-model="note" class="grow" />
        <button @click="saveNote">Speichern</button>
      </div>
    </div>

    <h2>Planeten</h2>
    <div class="table-wrap" style="max-height: none">
      <table class="data">
        <thead><tr><th>Koords</th><th>Name</th><th /><th>Phalanx</th><th>Letzter Spio</th><th>Galaxie gesehen</th></tr></thead>
        <tbody>
          <tr v-for="p in planetRows" :key="`${p.g}:${p.s}:${p.p}:${p.type}`" :class="{ moon: p.type === 'moon' }">
            <td class="mono">{{ coords(p.g, p.s, p.p) }}</td>
            <td>
              <span v-if="p.type === 'moon'" class="moon-tag">☾ Mond</span>
              {{ p.name }}
            </td>
            <td><PlanetActions :g="p.g" :s="p.s" :p="p.p" :type="p.type" /></td>
            <td class="small">
              <template v-if="p.type === 'moon' && data.phalanx[`${p.g}:${p.s}:${p.p}`]">
                <template v-for="ph in [data.phalanx[`${p.g}:${p.s}:${p.p}`]]" :key="ph.time">
                  <span v-if="ph.level">Stufe <b>{{ ph.level }}</b> <span class="muted">(±{{ phalanxRange(ph.level, ctx!.universe.settings) }} Systeme)</span></span>
                  <span v-else class="muted">keine</span>
                  <span class="faint" :title="sourceText(ph)"> · {{ ph.source === 'spy' ? 'Spio' : 'Imperium' }} vor {{ ago(ph.time) }}</span>
                </template>
              </template>
              <span v-else-if="p.type === 'moon'" class="faint" title="Kein Mondbericht mit sichtbaren Gebäuden">unbekannt</span>
            </td>
            <td class="small">
              <RouterLink v-if="p.spy" :to="{ path: `/${uni}/spy`, query: { c: `${p.g}:${p.s}:${p.p}`, type: p.type } }" :title="dateTime(p.spy)">
                {{ ago(p.spy) }}
              </RouterLink>
            </td>
            <td class="small muted">{{ ago(p.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Status-Verlauf</h2>
    <div class="small">
      <div v-for="s in data.statusLog" :key="s.seen_at">
        <span class="muted">{{ dateTime(s.seen_at) }}</span> <StatusBadges :status="JSON.parse(s.status)" />
        <span v-if="s.status === '[]'" class="faint">aktiv</span>
      </div>
      <span v-if="!data.statusLog.length" class="muted">–</span>
    </div>
  </template>
</template>

<style scoped>
.research { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px 24px; }
.research-line { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid var(--border); }
</style>

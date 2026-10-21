<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import PlayerLink from '../components/PlayerLink.vue';
import RangePicker from '../components/RangePicker.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useStored, useUni } from '../composables';
import { coords, dateTime, fmt, fmtSigned, short } from '../format';

/** Noteworthy changes detected while syncing, newest first, filterable by kind. */
interface Entry {
  id: number;
  time: number;
  kind: string;
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: string | null;
  data: Record<string, any>;
  player_id: number | null;
  player_name: string | null;
  status: string[];
  ally_tag: string | null;
  ally_name: string | null;
}

const KINDS: { kind: string; label: string; icon: string; color: string }[] = [
  { kind: 'phalanx_new', label: 'Neue Phalanx', icon: '◉', color: 'var(--info)' },
  { kind: 'phalanx_up', label: 'Phalanx ausgebaut', icon: '⇡', color: 'var(--info)' },
  { kind: 'planet_new', label: 'Neuer Planet', icon: '●', color: 'var(--pos)' },
  { kind: 'moon_new', label: 'Neuer Mond', icon: '☾', color: 'var(--pos)' },
  { kind: 'debris_new', label: 'Trümmerfeld neu', icon: '✦', color: 'var(--warn)' },
  { kind: 'debris_grown', label: 'Trümmerfeld vergrößert', icon: '✦', color: 'var(--neg)' },
  { kind: 'debris_shrunk', label: 'Trümmerfeld abgebaut', icon: '✧', color: 'var(--info)' },
  { kind: 'debris_cleared', label: 'Trümmerfeld weg', icon: '○', color: 'var(--muted)' },
  { kind: 'points_loss', label: 'Punkteverlust', icon: '▼', color: 'var(--neg)' },
  { kind: 'fleet_loss', label: 'Flottenverlust', icon: '▼', color: 'var(--neg)' },
  { kind: 'no_growth', label: 'Kein Punktezuwachs', icon: '◌', color: 'var(--muted)' },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

const { uni } = useUni();
const days = useStored('activity.days', 3);
/** hidden kinds (per viewer) */
const hidden = useStored<string[]>('activity.hidden', []);
const minHours = useStored('activity.minHours', 6);
const data = ref<{ counts: Record<string, number>; entries: Entry[] } | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const from = Math.floor(Date.now() / 1000) - days.value * 86400;
    data.value = await uniApi(uni.value, `/activity?from=${from}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(days, load);

function toggle(kind: string) {
  hidden.value = hidden.value.includes(kind) ? hidden.value.filter((k) => k !== kind) : [...hidden.value, kind];
}

const entries = computed(() =>
  (data.value?.entries ?? []).filter((e) => !hidden.value.includes(e.kind) && (e.kind !== 'no_growth' || e.data.hours >= minHours.value)),
);

/** Entries grouped by day for the timeline. */
const days_ = computed(() => {
  const out: { day: string; entries: Entry[] }[] = [];
  for (const e of entries.value) {
    const day = new Date(e.time * 1000).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (out.at(-1)?.day !== day) out.push({ day, entries: [] });
    out.at(-1)!.entries.push(e);
  }
  return out;
});

const time = (t: number) => new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const browse = (e: Entry) => ({ path: `/${uni.value}/browse`, query: { g: e.g, s: e.s } });

const res = (d: Record<string, any>) => `Metall ${short(d.metal)} · Kristall ${short(d.crystal)}`;

function text(e: Entry) {
  const d = e.data;
  switch (e.kind) {
    case 'phalanx_new':
      return d.known ? `Phalanx gebaut: Stufe ${d.level}` : `Phalanx entdeckt: Stufe ${d.level}`;
    case 'phalanx_up':
      return `Phalanx ausgebaut: Stufe ${d.before} → ${d.level}`;
    case 'planet_new':
      return d.name ? `Neuer Planet „${d.name}“` : 'Neuer Planet';
    case 'moon_new':
      return 'Neuer Mond';
    case 'debris_new':
      // older entries stored the galaxy strings
      if (d.debris) return `Trümmerfeld: Metall ${d.debris.metal} · Kristall ${d.debris.crystal}`;
      return `${d.firstSeen ? 'Trümmerfeld gesehen' : 'Neues Trümmerfeld'}: ${res(d)}`;
    case 'debris_grown':
      return `Trümmerfeld vergrößert: ${res(d)} (+${short(d.delta)})`;
    case 'debris_shrunk':
      return d.collected
        ? `${d.by ?? 'Recycler'} hat ${res(d.collected)} abgebaut, Rest ${res(d)}`
        : `Trümmerfeld abgebaut: ${res(d)} (${short(d.delta)})`;
    case 'debris_cleared':
      return d.collected
        ? `${d.by ?? 'Recycler'} hat das Trümmerfeld vollständig abgebaut (${res(d.collected)})`
        : `Trümmerfeld vollständig abgebaut (vorher ${res(d.before)})`;
    case 'points_loss':
      return `${fmtSigned(d.delta)} Punkte (${short(d.before)} → ${short(d.points)})`;
    case 'fleet_loss':
      return `${fmtSigned(d.delta)} Flottenpunkte (${short(d.before)} → ${short(d.points)})`;
    case 'no_growth':
      return `seit ${d.hours} h kein Punktezuwachs (${fmt(d.points)} Punkte seit ${dateTime(d.since)})`;
  }
  return e.kind;
}
</script>

<template>
  <h1>
    Aktivitätslog
    <Hint>
      <p>Erwähnenswerte Änderungen, die beim Synchronisieren erkannt wurden – zeitlich sortiert nach dem Zeitpunkt im Spiel.</p>
      <p><b>Phalanx:</b> aus Mond-Spionageberichten mit sichtbaren Gebäuden („entdeckt“ = erster bekannter Bericht). <b>Planet, Mond:</b> aus Galaxieansichten, nur für Systeme, die vorher schon bekannt waren. <b>Trümmerfelder:</b> neu (bzw. „gesehen“ beim ersten Sync eines Systems), vergrößert, abgebaut oder weg – aus Galaxieansichten und exakt aus Recyclerberichten (mit wer wie viel abgebaut hat). <b>Punkte/Flotte:</b> Verlust gegenüber dem vorherigen Statistik-Stand. <b>Kein Zuwachs:</b> aktive Spieler, deren Punkte seit 6/12/18/24 h nicht gestiegen sind.</p>
      <p>Die Filter gelten nur für dich und bleiben gespeichert.</p>
    </Hint>
  </h1>

  <div class="card">
    <div class="row">
      <RangePicker v-model="days" />
      <label v-if="!hidden.includes('no_growth')">
        Kein Zuwachs ab
        <select v-model.number="minHours">
          <option v-for="h in [6, 12, 18, 24]" :key="h" :value="h">{{ h }} h</option>
        </select>
      </label>
    </div>
    <div class="row chips">
      <button
        v-for="k in KINDS"
        :key="k.kind"
        class="chip"
        :class="{ off: hidden.includes(k.kind) }"
        :title="hidden.includes(k.kind) ? 'einblenden' : 'ausblenden'"
        @click="toggle(k.kind)"
      >
        <span :style="{ color: k.color }">{{ k.icon }}</span> {{ k.label }}
        <span class="faint">{{ data?.counts[k.kind] ?? 0 }}</span>
      </button>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !entries.length" class="card muted">Keine Einträge im Zeitraum.</div>

  <div v-for="d in days_" :key="d.day" class="day">
    <h3>{{ d.day }}</h3>
    <div class="card" style="padding: 4px 0">
      <div v-for="e in d.entries" :key="e.id" class="entry">
        <span class="mono small faint">{{ time(e.time) }}</span>
        <span class="icon" :style="{ color: META[e.kind]?.color }" :title="META[e.kind]?.label">{{ META[e.kind]?.icon ?? '•' }}</span>
        <span class="who">
          <template v-if="e.player_id">
            <PlayerLink :id="e.player_id" :name="e.player_name ?? '?'" />
            <StatusBadges :status="e.status" />
            <span v-if="e.ally_tag || e.ally_name" class="muted small"> [{{ e.ally_tag ?? e.ally_name }}]</span>
          </template>
          <span v-else class="faint">–</span>
        </span>
        <span class="what">{{ text(e) }}</span>
        <RouterLink v-if="e.g" class="mono small" :to="browse(e)" title="Im Galaxie-Browser anzeigen">
          {{ e.planet_type === 'moon' ? '☾ ' : '' }}{{ coords(e.g, e.s!, e.p!) }}
        </RouterLink>
        <span v-else />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chips { margin-top: 10px; gap: 6px; }
.chip { padding: 3px 10px; border-radius: 999px; font-size: 12px; }
.chip.off { opacity: 0.4; text-decoration: line-through; }
.day h3 { margin: 16px 0 6px; font-size: 13px; color: var(--muted); text-transform: capitalize; }
.entry { display: grid; grid-template-columns: 44px 20px minmax(160px, 260px) 1fr auto; align-items: center; gap: 10px; padding: 6px 16px; }
.entry + .entry { border-top: 1px solid var(--border); }
.icon { text-align: center; font-size: 14px; }
@media (max-width: 700px) {
  .entry { grid-template-columns: 44px 20px 1fr; }
  .what, .entry > a { grid-column: 3; }
}
</style>

<script setup lang="ts">
import { classOf, elementPoints } from '@pr0hub/core/tech';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useSort, useUni } from '../composables';
import { abbr, ago, dateTime, fmt, name, scaleColor } from '../format';

/** Alliance pages from the members' empire pages: planets (buildings), fleets and research, like FF-Hub. */
type Page = 'planets' | 'fleet' | 'research';

interface Member {
  user_id: number;
  username: string;
  ingame_name: string | null;
  created_at: number | null;
  data: {
    research: Record<string, number>;
    planets: { name: string; coords: { g: number; s: number; p: number }; type: 'planet' | 'moon'; values: Record<string, number> }[];
  } | null;
}
interface Row {
  key: string;
  member: Member;
  label: string;
  coords?: { g: number; s: number; p: number };
  type?: 'planet' | 'moon';
  values: Record<number, number>;
  points: number;
}

const route = useRoute();
const page = computed(() => route.meta.page as Page);
const { uni } = useUni();
const members = ref<Member[]>([]);
const error = ref('');
const fleetTab = ref<'ships' | 'defense'>('ships');

onMounted(async () => {
  try {
    members.value = await uniApi(uni.value, '/alliance');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const withData = computed(() => members.value.filter((m) => m.data));
const missing = computed(() => members.value.filter((m) => !m.data));
const memberName = (m: Member) => m.ingame_name || m.username;

const inCategory = (id: number) => {
  const cls = classOf(id);
  if (page.value === 'planets') return cls === 0;
  if (page.value === 'research') return cls === 100;
  return fleetTab.value === 'ships' ? cls === 200 : cls === 400;
};
const points = (values: Record<number, number>) =>
  Object.entries(values).reduce((s, [id, n]) => s + (inCategory(Number(id)) ? elementPoints(id, n) : 0), 0);

const rows = computed<Row[]>(() => {
  if (page.value === 'planets') {
    return withData.value.flatMap((m) =>
      m.data!.planets.map((p) => ({
        key: `${m.user_id}:${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`,
        member: m,
        label: p.name,
        coords: p.coords,
        type: p.type,
        values: p.values,
        points: points(p.values),
      })),
    );
  }
  if (page.value === 'research') {
    return withData.value.map((m) => ({ key: String(m.user_id), member: m, label: memberName(m), values: m.data!.research, points: points(m.data!.research) }));
  }
  // fleet/defense: summed over all planets and moons of a member
  return withData.value.map((m) => {
    const values: Record<number, number> = {};
    for (const p of m.data!.planets) for (const [id, n] of Object.entries(p.values)) values[Number(id)] = (values[Number(id)] ?? 0) + n;
    return { key: String(m.user_id), member: m, label: memberName(m), values, points: points(values) };
  });
});

/** Element columns of the active page that occur in any row. */
const ids = computed(() => {
  const set = new Set<number>();
  for (const r of rows.value) {
    for (const [id, n] of Object.entries(r.values)) if (inCategory(Number(id)) && (page.value !== 'fleet' || n > 0)) set.add(Number(id));
  }
  return [...set].sort((a, b) => a - b);
});

const { sorted, sortBy, indicator } = useSort(
  rows,
  (r, key) => {
    if (key === 'name') return r.label.toLowerCase();
    if (key === 'member') return memberName(r.member).toLowerCase();
    if (key === 'coords') return r.coords ? -(r.coords.g * 1e6 + r.coords.s * 100 + r.coords.p + (r.type === 'moon' ? 0.5 : 0)) : null;
    if (key === 'points') return r.points;
    return r.values[Number(key)] ?? null;
  },
  page.value === 'planets' ? 'coords' : 'points',
);

const max = computed(() => {
  const m: Record<string, number> = { points: 0 };
  for (const r of rows.value) {
    m.points = Math.max(m.points, r.points);
    for (const id of ids.value) m[id] = Math.max(m[id] ?? 0, r.values[id] ?? 0);
  }
  return m;
});

/** Sum row for fleets (the alliance's total fleet). */
const total = computed(() => {
  if (page.value !== 'fleet' || rows.value.length < 2) return null;
  const values: Record<number, number> = {};
  for (const r of rows.value) for (const id of ids.value) values[id] = (values[id] ?? 0) + (r.values[id] ?? 0);
  return { values, points: rows.value.reduce((s, r) => s + r.points, 0) };
});

const TITLE: Record<Page, string> = { planets: 'Planeten', fleet: 'Flotten', research: 'Forschung' };
</script>

<template>
  <h1>
    {{ TITLE[page] }}
    <Hint>
      <p>Aus der zuletzt eingefügten Imperium-Seite jedes Allianz-Mitglieds im Hub. Jedes Mitglied fügt dafür seine eigene Imperium-Seite ein.</p>
      <p v-if="page === 'planets'">Eine Zeile pro Planet/Mond mit Gebäudestufen. Punkte = Gebäudepunkte des Planeten.</p>
      <p v-else-if="page === 'fleet'">Schiffe bzw. Verteidigung summiert über alle Planeten und Monde. Fliegende Flotten zeigt die Imperium-Seite nicht.</p>
      <p v-else>Forschungsstufen je Mitglied. Punkte = Forschungspunkte.</p>
      <p>Spaltenköpfe sind abgekürzt, der volle Name steht im Tooltip. Farben: rot = niedrig, grün = Höchstwert der Spalte.</p>
    </Hint>
  </h1>

  <div class="card row small">
    <div v-if="page === 'fleet'" class="tabs" style="margin: 0">
      <button :class="{ active: fleetTab === 'ships' }" @click="fleetTab = 'ships'">Schiffe</button>
      <button :class="{ active: fleetTab === 'defense' }" @click="fleetTab = 'defense'">Verteidigung</button>
    </div>
    <span v-for="m in withData" :key="m.user_id" class="muted" :title="dateTime(m.created_at)">{{ memberName(m) }}: {{ ago(m.created_at) }}</span>
    <span v-if="missing.length" class="warn">Imperium fehlt: {{ missing.map(memberName).join(', ') }}</span>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="!withData.length" class="card muted">Noch keine Imperium-Seiten eingefügt.</div>

  <div v-else class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <template v-if="page === 'planets'">
            <th class="sortable" @click="sortBy('coords')">Koord.{{ indicator('coords') }}</th>
            <th class="sortable" @click="sortBy('name')">Planet{{ indicator('name') }}</th>
            <th class="sortable" @click="sortBy('member')">Spieler{{ indicator('member') }}</th>
          </template>
          <th v-else class="sortable" @click="sortBy('name')">Spieler{{ indicator('name') }}</th>
          <th class="sortable num" @click="sortBy('points')">Punkte{{ indicator('points') }}</th>
          <th v-for="id in ids" :key="id" class="sortable num" :title="name(id)" @click="sortBy(String(id))">{{ abbr(id) }}{{ indicator(String(id)) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.key" :class="{ moon: r.type === 'moon' }">
          <template v-if="page === 'planets'">
            <td class="mono small">{{ r.coords!.g }}:{{ r.coords!.s }}:{{ r.coords!.p }}</td>
            <td>
              <span v-if="r.type === 'moon'" class="moon-tag" title="Mond">☾ Mond</span>
              {{ r.label }}
            </td>
            <td class="muted">{{ memberName(r.member) }}</td>
          </template>
          <td v-else>{{ r.label }}</td>
          <td class="num" :style="{ color: scaleColor(r.points, max.points) }">{{ fmt(r.points) }}</td>
          <td v-for="id in ids" :key="id" class="num" :style="{ color: scaleColor(r.values[id], max[id]) }">{{ r.values[id] ? fmt(r.values[id]) : '' }}</td>
        </tr>
        <tr v-if="total" style="font-weight: 600">
          <td>Gesamt</td>
          <td class="num">{{ fmt(total.points) }}</td>
          <td v-for="id in ids" :key="id" class="num">{{ total.values[id] ? fmt(total.values[id]) : '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

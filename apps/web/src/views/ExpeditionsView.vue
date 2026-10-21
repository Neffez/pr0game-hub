<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useStored, useUni } from '../composables';
import { cardLabel, coords, dateTime, EVENT_LABEL, fmt, name, short, SIZE_LABEL } from '../format';

const { uni, ctx } = useUni();
const days = useStored('expos.days', 7);
/** null = whole alliance, otherwise one member */
const member = useStored<number | null>('expos.member', null);
const data = ref<any>(null);

async function load() {
  const from = Math.floor(Date.now() / 1000) - days.value * 86400;
  data.value = await uniApi(uni.value, `/expeditions?from=${from}`);
}
onMounted(load);
watch(days, load);

const keys = computed(() => Object.keys(data.value?.expected ?? {}));
const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);
/** observed share vs deck share */
function devStyle(observed: number, expected: number) {
  if (!expected) return {};
  const r = observed / expected;
  if (r > 1.3) return { color: 'var(--pos)' };
  if (r < 0.7) return { color: 'var(--neg)' };
  return {};
}
const shown = computed(() => (data.value?.perUser ?? []).filter((u: any) => member.value == null || u.userId === member.value));
/** Columns: each member, plus the alliance total when several are shown. */
const columns = computed(() => {
  const list = [...shown.value];
  if (list.length < 2) return list;
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
  };
  const total = { userId: -1, username: 'Allianz gesamt', total: 0, events: {}, resources: {}, ships: {} };
  for (const u of list) {
    total.total += u.total;
    add(total.events, u.events);
    add(total.resources, u.resources);
    add(total.ships, u.ships);
  }
  return [...list, total];
});
const list = computed(() => (data.value?.list ?? []).filter((e: any) => member.value == null || e.user_id === member.value));
const sumRes = (u: any) => Object.values(u.resources as Record<string, number>).reduce((a, b) => a + b, 0);
</script>

<template>
  <h1>
    Expeditionen
    <Hint>
      Expeditionsberichte aus den eingefügten Nachrichten aller Allianz-Mitglieder, wahlweise nur für ein Mitglied. Verteilung je Ereignis im
      Vergleich zum Deck (Erwartung = Kartenanteil): grün deutlich häufiger, rot deutlich seltener als erwartet.
    </Hint>
  </h1>
  <div class="card row">
    <RangePicker v-model="days" />
    <label>
      Spieler
      <select v-model="member">
        <option :value="null">ganze Allianz</option>
        <option :value="ctx!.me.id">nur meine</option>
        <option v-for="m in ctx!.members.filter((x) => x.id !== ctx!.me.id)" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </label>
  </div>
  <div v-if="data && !columns.length" class="card muted">Keine Expeditionen im Zeitraum.</div>
  <template v-if="data && columns.length">
    <div class="table-wrap" style="max-height: none; margin-bottom: 14px">
      <table class="data">
        <thead>
          <tr>
            <th>Ereignis</th>
            <th class="num">Deck %</th>
            <th v-for="u in columns" :key="u.username" class="num">{{ u.username }}<span v-if="u.userId === ctx!.me.id" class="faint small"> (du)</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k">
            <td>{{ cardLabel(k) }}</td>
            <td class="num muted">{{ fmt(pct(data.expected[k], data.deckSize), 1) }}</td>
            <td v-for="u in columns" :key="u.username" class="num" :style="devStyle(pct(u.events[k] ?? 0, u.total), pct(data.expected[k], data.deckSize))">
              {{ u.events[k] ?? 0 }} <span class="faint small">({{ fmt(pct(u.events[k] ?? 0, u.total), 1) }}%)</span>
            </td>
          </tr>
          <tr>
            <td><b>Gesamt</b></td>
            <td />
            <td v-for="u in columns" :key="u.username" class="num"><b>{{ u.total }}</b></td>
          </tr>
          <tr>
            <td>Ressourcen</td>
            <td />
            <td v-for="u in columns" :key="u.username" class="num" :title="Object.entries(u.resources).map(([id, n]) => `${name(id)}: ${fmt(n as number)}`).join('\n')">
              {{ short(sumRes(u)) }}
            </td>
          </tr>
          <tr>
            <td>Schiffe</td>
            <td />
            <td v-for="u in columns" :key="u.username" class="num small">
              <div v-for="(n, id) in u.ships" :key="id">{{ name(id) }}: {{ fmt(n) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Letzte Expeditionen</h2>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Zeit</th><th>Spieler</th><th>Ziel</th><th>Ereignis</th><th>Erschöpfung</th><th>Fund</th></tr></thead>
        <tbody>
          <tr v-for="e in list" :key="e.id">
            <td class="small">{{ dateTime(e.time) }}</td>
            <td>{{ e.username }}</td>
            <td class="mono">{{ e.g ? coords(e.g, e.s, e.p) : '' }}</td>
            <td>{{ EVENT_LABEL[e.event] }} {{ SIZE_LABEL[e.size] }}<span v-if="e.factor" class="faint"> ×{{ e.factor }}</span></td>
            <td class="small muted">{{ e.depletion ?? '?' }}</td>
            <td class="small">
              <span v-for="(n, id) in e.found_resources" :key="'r' + id">{{ name(id) }} {{ fmt(n) }} </span>
              <span v-for="(n, id) in e.found_ships" :key="'s' + id">{{ name(id) }} {{ fmt(n) }} </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

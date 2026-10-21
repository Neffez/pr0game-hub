<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useStored, useUni } from '../composables';
import { elementPoints } from '@pr0hub/core/tech';
import { cardLabel, coords, dateTime, DEPLETION_LABEL, EVENT_LABEL, fmt, name, short, SIZE_LABEL } from '../format';

const { uni, ctx } = useUni();
/** Default like the FF-Hub: the last 24 hours. */
const days = useStored('expos.range', 1);
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
const isManual = (e: any) => String(e.dedupe_key).startsWith('manual:');
/** Own manually counted entries (Expo-Deck) can be removed again. */
async function removeManual(e: any) {
  if (!confirm(`Nachgetragenes Ereignis „${EVENT_LABEL[e.event]} ${SIZE_LABEL[e.size]}“ vom ${dateTime(e.time)} löschen?`)) return;
  await uniApi(uni.value, `/deck/events/${e.id}`, { method: 'DELETE' });
  await load();
}
// ------------------------------------------- FF-Hub style table: one row per member
const RANGE_LABEL: Record<number, string> = { 1: 'letzte 24 h', 3: 'letzte 3 Tage', 7: 'letzte 7 Tage', 30: 'letzte 30 Tage', 3650: 'gesamte Zeit' };
interface Yield { userId: number; name: string; count: number; metal: number; crystal: number; deut: number; shipPoints: number; points: number }
const shipPoints = (ships: Record<string, number>) => Object.entries(ships).reduce((sum, [id, n]) => sum + elementPoints(id, n), 0);
const yields = computed<Yield[]>(() => {
  const byUser = new Map<number, any>((data.value?.perUser ?? []).map((u: any) => [u.userId, u]));
  return ctx
    .value!.members.map((m) => {
      const u = byUser.get(m.id);
      const metal = u?.resources['901'] ?? 0;
      const crystal = u?.resources['902'] ?? 0;
      const deut = u?.resources['903'] ?? 0;
      const sp = u ? shipPoints(u.ships) : 0;
      return { userId: m.id, name: m.name, count: u?.total ?? 0, metal, crystal, deut, shipPoints: sp, points: (metal + crystal + deut) / 1000 + sp };
    })
    .sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name));
});
const yieldTotal = computed(() =>
  yields.value.reduce(
    (t, y) => ({ count: t.count + y.count, metal: t.metal + y.metal, crystal: t.crystal + y.crystal, deut: t.deut + y.deut, shipPoints: t.shipPoints + y.shipPoints, points: t.points + y.points }),
    { count: 0, metal: 0, crystal: 0, deut: 0, shipPoints: 0, points: 0 },
  ),
);
const posClass = (n: number) => (n > 0 ? 'pos' : 'faint');

const sumRes = (u: any) => Object.values(u.resources as Record<string, number>).reduce((a, b) => a + b, 0);
</script>

<template>
  <h1>
    Expeditionen
    <Hint>
      <p>Expeditionsberichte aus den eingefügten Nachrichten aller Allianz-Mitglieder (und im Expo-Deck nachgetragene Ereignisse).</p>
      <p><b>Erträge</b> wie im FF-Hub: je Mitglied Anzahl Expos und gefundene Rohstoffe im Zeitraum. <b>Punkte</b> = Rohstoffe / 1000 plus der
      Punktwert gefundener Schiffe.</p>
      <p><b>Verteilung</b> je Ereignis im Vergleich zum Deck (Erwartung = Kartenanteil): grün deutlich häufiger, rot deutlich seltener als erwartet.
      Die Spieler-Auswahl gilt für Verteilung und Liste.</p>
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
  <template v-if="data">
    <h2>Erträge ({{ RANGE_LABEL[days] ?? `${days} Tage` }})</h2>
    <div class="table-wrap" style="max-height: none; margin-bottom: 14px">
      <table class="data yields">
        <thead>
          <tr>
            <th>Spieler</th>
            <th class="num">Expos</th>
            <th class="num">Metall</th>
            <th class="num">Kristall</th>
            <th class="num">Deuterium</th>
            <th class="num" title="Punktwert der gefundenen Schiffe">Schiffe</th>
            <th class="num" title="Rohstoffe / 1000 + Punktwert der Schiffe">Punkte</th>
            <th class="num" title="Punkte pro Expo">Ø / Expo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="y in yields" :key="y.userId" :class="{ mine: y.userId === ctx!.me.id, dim: !y.count }">
            <td><a href="#" class="plain" title="Verteilung und Liste nur für diesen Spieler" @click.prevent="member = y.userId">{{ y.name }}</a></td>
            <td class="num">{{ fmt(y.count) }}</td>
            <td class="num" :class="posClass(y.metal)">{{ fmt(y.metal) }}</td>
            <td class="num" :class="posClass(y.crystal)">{{ fmt(y.crystal) }}</td>
            <td class="num" :class="posClass(y.deut)">{{ fmt(y.deut) }}</td>
            <td class="num" :class="posClass(y.shipPoints)">{{ fmt(y.shipPoints) }}</td>
            <td class="num strong" :class="posClass(y.points)">{{ fmt(y.points) }}</td>
            <td class="num muted">{{ y.count ? fmt(y.points / y.count) : '' }}</td>
          </tr>
        </tbody>
        <tfoot v-if="yields.length > 1">
          <tr>
            <th>Allianz gesamt</th>
            <th class="num">{{ fmt(yieldTotal.count) }}</th>
            <th class="num">{{ fmt(yieldTotal.metal) }}</th>
            <th class="num">{{ fmt(yieldTotal.crystal) }}</th>
            <th class="num">{{ fmt(yieldTotal.deut) }}</th>
            <th class="num">{{ fmt(yieldTotal.shipPoints) }}</th>
            <th class="num">{{ fmt(yieldTotal.points) }}</th>
            <th class="num">{{ yieldTotal.count ? fmt(yieldTotal.points / yieldTotal.count) : '' }}</th>
          </tr>
        </tfoot>
      </table>
    </div>
    <h2>Verteilung</h2>
  </template>
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
        <thead><tr><th>Zeit</th><th>Spieler</th><th>Ziel</th><th>Ereignis</th><th>Erschöpfung</th><th>Fund</th><th /></tr></thead>
        <tbody>
          <tr v-for="e in list" :key="e.id">
            <td class="small">{{ dateTime(e.time) }}</td>
            <td>{{ e.username }}</td>
            <td class="mono">{{ e.g ? coords(e.g, e.s, e.p) : '' }}</td>
            <td>
              {{ EVENT_LABEL[e.event] }} {{ SIZE_LABEL[e.size] }}<span v-if="e.factor" class="faint"> ×{{ e.factor }}</span>
              <span v-if="isManual(e)" class="badge" title="Im Expo-Deck von Hand nachgetragen">manuell</span>
            </td>
            <td class="small muted">{{ e.depletion ? DEPLETION_LABEL[e.depletion] ?? e.depletion : '?' }}</td>
            <td class="small">
              <span v-for="(n, id) in e.found_resources" :key="'r' + id">{{ name(id) }} {{ fmt(n) }} </span>
              <span v-for="(n, id) in e.found_ships" :key="'s' + id">{{ name(id) }} {{ fmt(n) }} </span>
            </td>
            <td>
              <button v-if="isManual(e) && e.user_id === ctx!.me.id" class="small" title="Nachgetragenes Ereignis löschen" @click="removeManual(e)">Löschen</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
table.yields tr.mine td { background: var(--accent-soft); }
table.yields td.strong { font-weight: 600; }
table.yields tfoot th { border-top: 2px solid var(--border-strong); color: var(--text); }
a.plain { color: var(--text); }
a.plain:hover { color: var(--accent); }
</style>

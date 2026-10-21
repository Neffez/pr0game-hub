<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useStored, useUni } from '../composables';
import { dateTime, fmt, short } from '../format';

/** Archive of the game's battle hall (the game itself only lists the top 100). */
interface Entry {
  id: number;
  report_id: string;
  time: number | null;
  attackers: string[];
  defenders: string[];
  winner: 'attacker' | 'defender' | 'draw' | null;
  units: number;
  archived: number;
  report_status: string | null;
}

const { uni, ctx } = useUni();
const sort = useStored<'units' | 'time'>('battleHall.sort', 'units');
const q = ref('');
const page = ref(1);
const data = ref<{ total: number; page: number; pages: number; entries: Entry[] } | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), sort: sort.value });
    if (q.value.trim()) params.set('q', q.value.trim());
    data.value = await uniApi(uni.value, `/battle-hall?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(page, load);
watch(sort, () => (page.value === 1 ? load() : (page.value = 1)));
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => (page.value === 1 ? load() : (page.value = 1)), 300);
});

const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
const reportLink = (e: Entry) => `${gameUrl.value}game.php?page=raport&raport=${e.report_id}`;
/** rank across all pages for the units sort */
const rank = (i: number) => (page.value - 1) * 100 + i + 1;
</script>

<template>
  <h1>
    Battle Hall
    <Hint>
      <p>Archiv der Hall of Fame aus dem Spiel. Das Spiel zeigt nur die Top 100 – hier bleibt jeder einmal synchronisierte Kampfbericht dauerhaft erhalten.</p>
      <p>Synchronisieren: im Spiel „Battle Hall“ öffnen (Zeitfenster alle, Tag, Woche oder Monat) und die Seite einfügen bzw. per Skript senden. Am besten regelmäßig das Zeitfenster „Tag“.</p>
      <p>Grün = Gewinner, Rot = Verlierer, ohne Farbe = Unentschieden.</p>
      <p>Neue Berichte werden im Hintergrund von der öffentlichen Berichtsseite archiviert („lokal“), da das Spiel kleine Berichte nach einiger Zeit löscht. Gespeichert werden nur Teilnehmer, Flotten vorher/nachher, Ausgang, Verluste und Trümmerfeld.</p>
    </Hint>
  </h1>

  <div class="card row">
    <div class="tabs" style="margin: 0">
      <button :class="{ active: sort === 'units' }" @click="sort = 'units'">nach Units</button>
      <button :class="{ active: sort === 'time' }" @click="sort = 'time'">nach Datum</button>
    </div>
    <input v-model="q" placeholder="Spieler" style="width: 160px" />
    <span class="grow" />
    <span v-if="data" class="muted small">{{ fmt(data.total) }} Kampfberichte</span>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !data.entries.length" class="card muted">
    Noch keine Kampfberichte. Im Spiel die Battle Hall öffnen und einfügen bzw. synchronisieren.
  </div>

  <template v-else-if="data">
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th class="num">#</th><th>Angreifer</th><th /><th>Verteidiger</th><th>Datum</th><th class="num">Units</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in data.entries" :key="e.id">
            <td class="num faint">{{ sort === 'units' ? rank(i) : '' }}</td>
            <td :class="{ pos: e.winner === 'attacker', neg: e.winner === 'defender' }">{{ e.attackers.join(' & ') || '–' }}</td>
            <td class="faint small">VS</td>
            <td :class="{ pos: e.winner === 'defender', neg: e.winner === 'attacker' }">{{ e.defenders.join(' & ') || '–' }}</td>
            <td class="small">{{ dateTime(e.time) }}</td>
            <td class="num" :title="fmt(e.units)">{{ short(e.units) }}</td>
            <td class="small nowrap">
              <a v-if="gameUrl" :href="reportLink(e)" target="_blank" rel="noopener" title="Bericht im Spiel">Spiel</a>
              <template v-if="e.archived"> · <RouterLink :to="`/${uni}/battle-hall/${e.report_id}`" title="Lokal archivierter Bericht">lokal</RouterLink></template>
              <span v-else-if="e.report_status === 'gone'" class="faint" title="Vom Spiel bereits gelöscht"> · gelöscht</span>
              <span v-else class="faint" title="Wird im Hintergrund archiviert"> · ausstehend</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data.pages > 1" class="row pager">
      <button :disabled="page <= 1" @click="page = 1">«</button>
      <button :disabled="page <= 1" @click="page--">‹</button>
      <span class="small">Seite {{ page }} / {{ data.pages }}</span>
      <button :disabled="page >= data.pages" @click="page++">›</button>
      <button :disabled="page >= data.pages" @click="page = data.pages">»</button>
    </div>
  </template>
</template>

<style scoped>
.pager { justify-content: center; margin-top: 12px; }
</style>

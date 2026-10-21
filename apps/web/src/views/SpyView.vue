<script setup lang="ts">
import PlayerLink from '../components/PlayerLink.vue';
import Hint from '../components/Hint.vue';
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import SpyHistory, { type SpyReport } from '../components/SpyHistory.vue';
import { useUni } from '../composables';
import { coords, fmt, timeWithAge } from '../format';

const { uni, ctx } = useUni();
const route = useRoute();
const router = useRouter();
const target = ref(String(route.query.c ?? ''));
const type = ref(route.query.type === 'moon' ? 'moon' : 'planet');
const limit = ref(20);
const reports = ref<SpyReport[]>([]);
const total = ref(0);
const recent = ref<any[]>([]);
const error = ref('');

async function load() {
  error.value = '';
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m) {
    reports.value = [];
    return;
  }
  router.replace({ query: { ...route.query, c: `${m[1]}:${m[2]}:${m[3]}`, type: type.value } });
  try {
    const res = await uniApi(uni.value, `/spy/${m[1]}/${m[2]}/${m[3]}?type=${type.value}&limit=${limit.value}`);
    reports.value = res.reports;
    total.value = res.total;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function open(r: any) {
  target.value = `${r.g}:${r.s}:${r.p}`;
  type.value = r.planet_type;
  load();
}

onMounted(async () => {
  recent.value = await uniApi(uni.value, '/spy-reports?limit=50');
  if (target.value) load();
});
watch([type, limit], load);

const res = (r: any, id: number) => r.sections['900']?.[id] ?? 0;
</script>

<template>
  <h1>
    Spionage-Verlauf
    <Hint>Koordinate eingeben (oder unten einen Bericht wählen): Alle Spionageberichte der Allianz zu diesem Planet/Mond, mit Veränderungen zum jeweils vorherigen Bericht.</Hint>
  </h1>
  <div class="card">
    <form class="row" @submit.prevent="load">
      <input v-model="target" placeholder="1:234:5" style="width: 110px" />
      <select v-model="type">
        <option value="planet">Planet</option>
        <option value="moon">Mond</option>
      </select>
      <select v-model.number="limit">
        <option :value="5">5</option>
        <option :value="20">20</option>
        <option :value="100">100</option>
        <option :value="500">alle</option>
      </select>
      <button class="primary">Anzeigen</button>
      <span v-if="reports.length" class="muted small">{{ reports[0].player_name }} · {{ total }} Berichte</span>
    </form>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <SpyHistory v-if="reports.length" :reports="reports" :game-url="ctx!.universe.settings.gameUrl" />

  <h2>Neueste Berichte</h2>
  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr><th>Zeit</th><th>Koords</th><th>Spieler</th><th>Planet</th><th class="num">Metall</th><th class="num">Kristall</th><th class="num">Deut</th><th>von</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in recent" :key="r.id" style="cursor: pointer" @click="open(r)">
          <td class="small mono">{{ timeWithAge(r.report_time) }}</td>
          <td class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.planet_type === 'moon'" class="moon-tag" style="margin: 0 0 0 4px">☾ Mond</span></td>
          <td>
            <PlayerLink v-if="r.player_id" :id="r.player_id" :name="r.player_name" />
            <span v-else>{{ r.player_name }}</span>
          </td>
          <td class="muted">{{ r.planet_name }}</td>
          <td class="num">{{ fmt(res(r, 901)) }}</td>
          <td class="num">{{ fmt(res(r, 902)) }}</td>
          <td class="num">{{ fmt(res(r, 903)) }}</td>
          <td class="muted small">{{ r.reporter }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

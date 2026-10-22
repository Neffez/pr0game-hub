<script setup lang="ts">
import PlanetActions from '../components/PlanetActions.vue';
import PlayerLink from '../components/PlayerLink.vue';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import SpyHistory, { type SpyReport } from '../components/SpyHistory.vue';
import { useLoader, useMobile, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { coords, fmt, name, short, timeWithAge } from '../format';

const { t } = useI18n();
const { uni, ctx } = useUni();
const mobile = useMobile();
const route = useRoute();
const router = useRouter();
const target = ref(String(route.query.c ?? ''));
const type = ref(route.query.type === 'moon' ? 'moon' : 'planet');
const limit = ref(20);
const recent = ref<any[]>([]);

const { data, error, load } = useLoader(async () => {
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m) return null;
  router.replace({ query: { ...route.query, c: `${m[1]}:${m[2]}:${m[3]}`, type: type.value } });
  return uniApi<{ reports: SpyReport[]; total: number }>(uni.value, `/spy/${m[1]}/${m[2]}/${m[3]}?type=${type.value}&limit=${limit.value}`);
});
const reports = computed(() => data.value?.reports ?? []);
/** Shown target, for its action menu (claiming). */
const shown = computed(() => {
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m && reports.value.length ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]) } : null;
});
const total = computed(() => data.value?.total ?? 0);

function open(r: any) {
  target.value = `${r.g}:${r.s}:${r.p}`;
  type.value = r.planet_type;
  load();
}

async function loadRecent() {
  try {
    recent.value = await uniApi(uni.value, '/spy-reports?limit=50');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  if (target.value) load();
  loadRecent();
});
useLiveReload(() => {
  if (target.value) load();
  loadRecent();
}, tables('spy_reports'));
watch([type, limit], load);

const res = (r: any, id: number) => r.sections['900']?.[id] ?? 0;
</script>

<template>
  <h1>
    {{ t('actions.spyHistory') }}
    <Hint>{{ t('spy.hint') }}</Hint>
  </h1>
  <div class="card">
    <form class="row" @submit.prevent="load">
      <input v-model="target" placeholder="1:234:5" style="width: 110px" />
      <select v-model="type">
        <option value="planet">{{ t('common.planet') }}</option>
        <option value="moon">{{ t('common.moon') }}</option>
      </select>
      <select v-model.number="limit">
        <option :value="5">5</option>
        <option :value="20">20</option>
        <option :value="100">100</option>
        <option :value="500">{{ t('common.all') }}</option>
      </select>
      <button class="primary">{{ t('common.show') }}</button>
      <span v-if="reports.length" class="muted small">{{ reports[0].player_name }} · {{ t('spy.reports', total) }}</span>
      <PlanetActions v-if="shown" :g="shown.g" :s="shown.s" :p="shown.p" :type="type === 'moon' ? 'moon' : 'planet'" />
    </form>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <SpyHistory v-if="reports.length" :reports="reports" :game-url="ctx!.universe.settings.gameUrl" />

  <h2>{{ t('spy.recent') }}</h2>
  <div v-if="mobile" class="m-list">
    <div v-for="r in recent" :key="r.id" class="m-item" role="button" tabindex="0" @click="open(r)" @keydown.enter="open(r)">
      <span class="m-line">
        <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
        <span v-if="r.planet_type === 'moon'" class="moon-tag" style="margin: 0">☾</span>
        <PlayerLink v-if="r.player_id" :id="r.player_id" :name="r.player_name" @click.stop />
        <span v-else>{{ r.player_name }}</span>
        <span class="muted small al-ellipsis">{{ r.planet_name }}</span>
      </span>
      <span class="m-line small">
        <span class="mono"><span class="faint">{{ t('overview.resShort.901') }}</span> {{ short(res(r, 901)) }}</span>
        <span class="mono"><span class="faint">{{ t('overview.resShort.902') }}</span> {{ short(res(r, 902)) }}</span>
        <span class="mono"><span class="faint">{{ t('overview.resShort.903') }}</span> {{ short(res(r, 903)) }}</span>
        <span class="grow" />
        <span class="faint">{{ timeWithAge(r.report_time) }}<template v-if="r.reporter"> · {{ r.reporter }}</template></span>
      </span>
    </div>
  </div>
  <div v-else class="table-wrap">
    <table class="data">
      <thead>
        <tr><th>{{ t('common.time') }}</th><th>{{ t('common.coords') }}</th><th>{{ t('common.player') }}</th><th>{{ t('common.planet') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('game.deutShort') }}</th><th>{{ t('common.from') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in recent" :key="r.id" style="cursor: pointer" @click="open(r)">
          <td class="small mono">{{ timeWithAge(r.report_time) }}</td>
          <td class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.planet_type === 'moon'" class="moon-tag" style="margin: 0 0 0 4px">☾ {{ t('common.moon') }}</span></td>
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

<style scoped>
/* mobile list of recent reports */
.m-list { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.m-item {
  display: flex; flex-direction: column; gap: 4px; width: 100%; min-height: 0; padding: 8px 12px;
  border-bottom: 1px solid var(--border); cursor: pointer;
}
.m-item:last-child { border-bottom: 0; }
.m-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; }
.al-ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Icon from '../components/Icon.vue';
import CommentThread from '../components/CommentThread.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlayerLink from '../components/PlayerLink.vue';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import SpyHistory, { type SpyReport } from '../components/SpyHistory.vue';
import { useLoader, useMobile, useProgressive, useUni } from '../composables';
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
const recentDone = ref(false);
let recentLoading = false;
const RECENT_BATCH = 100;
const { shown: recentShown, more: recentMore, sentinel: recentSentinel } = useProgressive(recent, 50);
/** More rows in the DOM or more pages on the server — keep the scroll sentinel mounted for both. */
const recentScrollMore = computed(() => recentMore.value || !recentDone.value);

const { data, error, load } = useLoader(async () => {
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m) return null;
  router.replace({ query: { ...route.query, c: `${m[1]}:${m[2]}:${m[3]}`, type: type.value } });
  return uniApi<{ reports: SpyReport[]; total: number }>(uni.value, `/spy/${m[1]}/${m[2]}/${m[3]}?type=${type.value}&limit=${limit.value}`);
});
const reports = computed(() => data.value?.reports ?? []);
/** For a moon: the newest report of its planet, whose interceptors defend the moon against missiles. */
const planetReport = ref<SpyReport | null>(null);
watch(data, async () => {
  planetReport.value = null;
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m || type.value !== 'moon' || !data.value?.reports.length) return;
  try {
    const res = await uniApi<{ reports: SpyReport[] }>(uni.value, `/spy/${m[1]}/${m[2]}/${m[3]}?type=planet&limit=1`);
    planetReport.value = res.reports[0] ?? null;
  } catch {
    // the link then leaves the interceptors to the user
  }
});
/** Shown target (after loading), for its action menu and comments. */
const shown = computed(() => {
  const m = target.value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m && data.value ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]) } : null;
});
const total = computed(() => data.value?.total ?? 0);

function open(r: any) {
  target.value = `${r.g}:${r.s}:${r.p}`;
  type.value = r.planet_type;
  load();
}

/** bumped by a reload: a batch of an older request is dropped */
let recentGen = 0;

async function appendRecent() {
  if (recentLoading || recentDone.value) return;
  recentLoading = true;
  const gen = recentGen;
  const last = recent.value.at(-1);
  try {
    const before = last ? `&before=${last.report_time}:${last.id}` : '';
    const batch = await uniApi<any[]>(uni.value, `/spy-reports?limit=${RECENT_BATCH}${before}`);
    if (gen !== recentGen) return;
    const have = new Set(recent.value.map((r) => r.id));
    // push in place: replacing the array would reset useProgressive's visible count
    recent.value.push(...batch.filter((r) => !have.has(r.id)));
    if (batch.length < RECENT_BATCH) recentDone.value = true;
  } catch (e) {
    if (gen === recentGen) error.value = (e as Error).message;
  } finally {
    if (gen === recentGen) recentLoading = false;
  }
}

async function loadRecent() {
  recentGen++;
  recentLoading = false;
  recent.value = [];
  recentDone.value = false;
  await appendRecent();
}

watch(
  () => [recentShown.value.length, recent.value.length, recentDone.value] as const,
  ([shown, loaded, done]) => {
    if (done || !loaded || shown < loaded - 20) return;
    appendRecent();
  },
);
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
  <PageHeader :title="t('actions.spyHistory')">
    <template #hint><Hint>{{ t('spy.hint') }}</Hint></template>
  </PageHeader>
  <div class="card">
    <form class="spy-form" @submit.prevent="load">
      <label class="field-v">
        <span>{{ t('common.coords') }}</span>
        <input v-model="target" class="mono" placeholder="1:234:5" />
      </label>
      <label class="field-v">
        <span>{{ t('spy.body') }}</span>
        <select v-model="type">
          <option value="planet">{{ t('common.planet') }}</option>
          <option value="moon">{{ t('common.moon') }}</option>
        </select>
      </label>
      <label class="field-v">
        <span>{{ t('spy.count') }}</span>
        <select v-model.number="limit">
          <option :value="5">5</option>
          <option :value="20">20</option>
          <option :value="100">100</option>
          <option :value="500">{{ t('common.all') }}</option>
        </select>
      </label>
      <button class="primary">{{ t('common.show') }}</button>
    </form>
    <div v-if="reports.length || shown" class="row small spy-found">
      <span v-if="reports.length" class="muted">{{ reports[0].player_name }} · {{ t('spy.reports', total) }}</span>
      <PlanetActions v-if="shown" :g="shown.g" :s="shown.s" :p="shown.p" :type="type === 'moon' ? 'moon' : 'planet'" />
    </div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <SpyHistory
    v-if="reports.length"
    :reports="reports"
    :game-url="ctx!.universe.settings.gameUrl"
    :target="shown ? [shown.g, shown.s, shown.p] : null"
    :moon="type === 'moon'"
    :planet-report="planetReport"
  />

  <div v-if="shown" class="card">
    <h3 class="mt-0">{{ t('comments.title') }} {{ coords(shown.g, shown.s, shown.p) }}<template v-if="type === 'moon'"> ({{ t('common.moon') }})</template></h3>
    <CommentThread :g="shown.g" :s="shown.s" :p="shown.p" :type="type === 'moon' ? 'moon' : 'planet'" />
  </div>

  <h2>{{ t('spy.recent') }}</h2>
  <div v-if="mobile" class="m-list">
    <div v-for="r in recentShown" :key="r.id" class="m-item" role="button" tabindex="0" @click="open(r)" @keydown.enter="open(r)">
      <span class="m-line">
        <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
        <span v-if="r.planet_type === 'moon'" class="moon-tag m-0"><Icon name="moon" :size="12" :label="t('common.moon')" /></span>
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
    <div v-if="recentScrollMore" ref="recentSentinel" class="list-end" />
  </div>
  <div v-else class="table-wrap flat">
    <table class="data">
      <thead>
        <tr><th>{{ t('common.time') }}</th><th>{{ t('common.coords') }}</th><th>{{ t('common.player') }}</th><th>{{ t('common.planet') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('game.deutShort') }}</th><th>{{ t('common.from') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in recentShown" :key="r.id" style="cursor: pointer" @click="open(r)">
          <td class="small mono">{{ timeWithAge(r.report_time) }}</td>
          <td class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.planet_type === 'moon'" class="moon-tag" style="margin: 0 0 0 4px"><Icon name="moon" :size="12" :label="t('common.moon')" /></span></td>
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
    <div v-if="recentScrollMore" ref="recentSentinel" class="list-end" />
  </div>
</template>

<style scoped>
.spy-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 10px; }
.field-v { display: flex; flex-direction: column; gap: 3px; }
.field-v input { width: 120px; }
.spy-found { margin-top: 8px; }
@media (max-width: 800px) { .field-v { flex: 1 1 100px; } .field-v input, .field-v select { width: 100%; margin: 0; } }
/* mobile list of recent reports */
.m-list { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.m-item {
  display: flex; flex-direction: column; gap: 4px; width: 100%; min-height: 0; padding: 8px 12px;
  border-bottom: 1px solid var(--border); cursor: pointer;
}
.m-item:last-child { border-bottom: 0; }
.m-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; }
.al-ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-end { height: 1px; }
</style>

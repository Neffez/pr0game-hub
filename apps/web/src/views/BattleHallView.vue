<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useLoader, useStored, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
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

const { t } = useI18n();
const { uni, ctx } = useUni();
const sort = useStored<'units' | 'time'>('battleHall.sort', 'units');
const q = ref('');
const page = ref(1);
const { data, error, load } = useLoader(() => {
  const params = new URLSearchParams({ page: String(page.value), sort: sort.value });
  if (q.value.trim()) params.set('q', q.value.trim());
  return uniApi<{ total: number; page: number; pages: number; entries: Entry[] }>(uni.value, `/battle-hall?${params}`);
});
onMounted(load);
useLiveReload(load, tables('battle_hall', 'combat_reports'));
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
  <PageHeader :title="t('nav.battleHall')">
    <template #hint>
      <Hint>
        <p>{{ t('battleHall.hint1') }}</p>
        <p>{{ t('battleHall.hint2') }}</p>
        <p>{{ t('battleHall.hint3') }}</p>
        <p>{{ t('battleHall.hint4') }}</p>
      </Hint>
    </template>
  </PageHeader>

  <div class="card row">
    <div class="tabs" style="margin: 0">
      <button :class="{ active: sort === 'units' }" @click="sort = 'units'">{{ t('battleHall.byUnits') }}</button>
      <button :class="{ active: sort === 'time' }" @click="sort = 'time'">{{ t('battleHall.byDate') }}</button>
    </div>
    <input v-model="q" :placeholder="t('common.player')" style="width: 160px" />
    <span class="grow" />
    <span v-if="data" class="muted small">{{ t('battleHall.count', { n: fmt(data.total) }, data.total) }}</span>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !data.entries.length" class="card muted">
    {{ t('battleHall.empty') }}
  </div>

  <template v-else-if="data">
    <div class="table-wrap">
      <table v-stack="4" class="data">
        <thead>
          <tr><th class="num">#</th><th>{{ t('combat.attacker') }}</th><th /><th>{{ t('combat.defender') }}</th><th>{{ t('battleHall.date') }}</th><th class="num">{{ t('combat.units') }}</th><th /></tr>
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
              <a v-if="gameUrl" :href="reportLink(e)" target="_blank" rel="noopener" :title="t('battleHall.reportInGame')">{{ t('battleHall.game') }}</a>
              <template v-if="e.archived"> · <RouterLink :to="`/${uni}/battle-hall/${e.report_id}`" :title="t('battleHall.localTitle')">{{ t('battleHall.local') }}</RouterLink></template>
              <span v-else-if="e.report_status === 'gone'" class="faint" :title="t('battleHall.goneTitle')"> · {{ t('battleHall.gone') }}</span>
              <span v-else-if="e.report_status === 'lost'" class="faint" :title="t('battleHall.lostTitle')"> · {{ t('battleHall.lost') }}</span>
              <span v-else class="faint" :title="t('battleHall.pendingTitle')"> · {{ t('battleHall.pending') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data.pages > 1" class="row pager">
      <button :disabled="page <= 1" @click="page = 1">«</button>
      <button :disabled="page <= 1" @click="page--">‹</button>
      <span class="small">{{ t('battleHall.page', { page, pages: data.pages }) }}</span>
      <button :disabled="page >= data.pages" @click="page++">›</button>
      <button :disabled="page >= data.pages" @click="page = data.pages">»</button>
    </div>
  </template>
</template>

<style scoped>
.pager { justify-content: center; margin-top: 12px; }
</style>

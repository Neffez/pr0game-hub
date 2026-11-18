<script setup lang="ts">
import Icon from './Icon.vue';
import Section from './Section.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { Goal, Goals } from '../apiTypes';
import { useUni } from '../composables';
import { fmt } from '../format';
import { tables, useLiveReload } from '../live';

/**
 * Alliance goals (server: repo/goals.ts): a bar per goal with its target mark and what is counted. Nothing when the
 * admins switched all goals off; the admins get a link to change them.
 */
defineProps<{ storeKey: string }>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const goals = ref<Goal[] | null>(null);

async function load() {
  try {
    goals.value = (await uniApi<Goals>(uni.value, '/goals')).goals;
  } catch {
    goals.value = null; // a card only
  }
}
onMounted(load);
useLiveReload(load, tables('galaxy_systems', 'player_scores', 'spy_reports', 'empire', 'overview', 'fleets', 'buildings', 'research'), 5000);

const isAdmin = computed(() => ctx.value?.group.role === 'admin' || ctx.value?.me.isAdmin);
const reached = computed(() => (goals.value ?? []).filter((g) => g.value != null && g.value >= g.target).length);

function detail(g: Goal): string {
  if (g.value == null) return t(`goals.${g.key}.unknown`);
  return t(`goals.${g.key}.detail`, { done: fmt(g.done), total: fmt(g.total), days: g.days ?? 7 });
}
</script>

<template>
  <Section v-if="goals?.length" class="alliance-goals" :title="t('goals.title')" :store-key="storeKey">
    <template #hint>
      <span class="badge" :class="reached === goals.length ? 'goal-done' : 'muted'">{{ t('goals.reached', { n: reached, total: goals.length }) }}</span>
    </template>
    <template v-if="isAdmin" #actions>
      <RouterLink :to="`/${uni}/admin`" class="small">{{ t('goals.edit') }}</RouterLink>
    </template>
    <ul class="goal-list">
      <li v-for="g in goals" :key="g.key" :class="{ done: g.value != null && g.value >= g.target }">
        <div class="goal-head">
          <Icon v-if="g.value != null && g.value >= g.target" name="check" :size="14" class="goal-check" />
          <b>{{ t(`goals.${g.key}.title`) }}</b>
          <span class="grow" />
          <span class="mono small">{{ g.value != null ? `${g.value} %` : '–' }} <span class="muted">/ {{ g.target }} %</span></span>
        </div>
        <div class="goal-bar" role="progressbar" :aria-valuenow="g.value ?? 0" aria-valuemin="0" aria-valuemax="100" :aria-label="t(`goals.${g.key}.title`)">
          <div class="goal-fill" :style="{ width: `${g.value ?? 0}%` }" />
          <div class="goal-target" :style="{ left: `${g.target}%` }" :title="t('goals.target', { n: g.target })" />
        </div>
        <div class="small muted">{{ detail(g) }}</div>
      </li>
    </ul>
  </Section>
</template>

<style scoped>
.goal-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 20px; }
.goal-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.goal-check { color: var(--pos); }
.goal-bar { position: relative; height: 8px; border-radius: 4px; background: var(--border); }
.goal-fill { height: 100%; border-radius: 4px; background: var(--warn); transition: width 0.3s; }
.done .goal-fill { background: var(--pos); }
.goal-target { position: absolute; top: -3px; width: 2px; height: 14px; margin-left: -1px; background: var(--text); opacity: 0.7; }
.goal-list .small { margin-top: 4px; }
.badge.goal-done { color: var(--pos); border-color: var(--pos); }
</style>

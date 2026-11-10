<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { dateTime } from '../format';

/**
 * Onboarding of a new member (backlog D-4): the first syncs as a checklist with a tick when such a page arrived and
 * where to find it in the game (texts of the sync hints). Hidden once every step is done, or when the member hides it
 * (per device); the sync page then offers a link that shows it again while steps are open. `brief` (overview):
 * progress and the next open step with a link to the sync page.
 */
type Step = 'empire' | 'stats' | 'overview' | 'research' | 'galaxy' | 'messages' | 'buildings';
interface Onboarding { steps: { key: Step; time: number | null }[]; done: number; total: number }

const props = defineProps<{ brief?: boolean }>();
const { t } = useI18n();
const { uni } = useUni();

const data = ref<Onboarding | null>(null);
const load = async () => {
  try {
    data.value = await uniApi<Onboarding>(uni.value, '/onboarding');
  } catch {
    /* the card simply stays away */
  }
};
onMounted(load);
useLiveReload(load, tables('empire', 'player_scores', 'overview', 'fleets', 'research', 'galaxy_systems', 'spy_reports', 'battle_reports', 'expeditions', 'buildings'), 1500);

const hidden = useStored<boolean>(`onboarding.hidden.${uni.value}`, false);
const open = computed(() => !!data.value && data.value.done < data.value.total);
const show = computed(() => open.value && !hidden.value);
const next = computed(() => data.value?.steps.find((s) => s.time == null) ?? null);
const percent = computed(() => (data.value ? Math.round((100 * data.value.done) / data.value.total) : 0));
</script>

<template>
  <div v-if="show && data" class="card onboarding">
    <div class="row onb-head">
      <h3 class="mt-0 grow">{{ t('onboarding.title', { done: data.done, total: data.total }) }}</h3>
      <button class="onb-hide" :title="t('onboarding.hide')" :aria-label="t('onboarding.hide')" @click="hidden = true"><Icon name="close" :size="14" /></button>
    </div>
    <div class="onb-bar" role="progressbar" :aria-valuenow="data.done" aria-valuemin="0" :aria-valuemax="data.total"><span :style="{ width: `${percent}%` }" /></div>
    <template v-if="props.brief">
      <p v-if="next" class="small">
        {{ t('onboarding.next') }} <b>{{ t(`onboarding.steps.${next.key}`) }}</b> – {{ t(`syncHints.${next.key}.where`) }}
        <RouterLink :to="`/${uni}/paste`">{{ t('onboarding.toSync') }}</RouterLink>
      </p>
    </template>
    <template v-else>
      <p class="muted small">{{ t('onboarding.hint') }}</p>
      <ol class="onb-steps">
        <li v-for="s in data.steps" :key="s.key" :class="{ done: s.time != null }">
          <Icon :name="s.time != null ? 'check' : 'chevronRight'" :size="14" class="onb-mark" />
          <div>
            <b>{{ t(`onboarding.steps.${s.key}`) }}</b>
            <span v-if="s.time != null" class="muted small"> · {{ t('onboarding.doneAt', { time: dateTime(s.time) }) }}</span>
            <template v-else>
              <div class="small">{{ t(`syncHints.${s.key}.why`) }}</div>
              <div class="small muted">{{ t('syncHints.where') }} {{ t(`syncHints.${s.key}.where`) }}</div>
            </template>
          </div>
        </li>
      </ol>
    </template>
  </div>
  <!-- hidden with steps still open: the sync page offers the way back -->
  <p v-else-if="open && hidden && !props.brief" class="small onb-again">
    <button class="link small" @click="hidden = false">{{ t('onboarding.showAgain') }}</button>
  </p>
</template>

<style scoped>
.onboarding { border-color: var(--accent); }
.onb-head { align-items: center; }
.onb-hide { padding: 2px 6px; }
.onb-bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; margin: 4px 0 8px; }
.onb-bar span { display: block; height: 100%; background: var(--pos); }
.onb-steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.onb-steps li { display: flex; gap: 8px; align-items: flex-start; }
.onb-steps li.done { opacity: 0.7; }
.onb-steps li.done .onb-mark { color: var(--pos); }
.onb-mark { flex: none; margin-top: 2px; }
.onb-again { margin: 0 0 8px; }
</style>

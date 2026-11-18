<script setup lang="ts">
import AllianceGoals from './AllianceGoals.vue';
import FreshnessScore from './FreshnessScore.vue';
import Icon from './Icon.vue';
import OnboardingCard from './OnboardingCard.vue';
import Section from './Section.vue';
import SyncHints from './SyncHints.vue';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { goals, loadGoals, reachedGoals } from '../goals';
import { tables, useLiveReload } from '../live';
import { loadOnboarding, onboarding, onboardingHidden } from '../onboarding';
import { freshness, loadSyncHints, refreshSyncHints, syncHints } from '../syncHints';

/**
 * The overview's sync corner: first steps, "what to paste next" and the alliance goals in one section, folded by
 * default so the overview stays about the universe. Its head sums them up quietly (open first steps, freshness, the
 * important hints, goals reached); only an important hint and the freshness score are coloured.
 */
const { t } = useI18n();
const { uni } = useUni();

const loadAll = (force = false) => {
  if (force) refreshSyncHints(uni.value);
  else loadSyncHints(uni.value);
  loadGoals(uni.value, force);
  loadOnboarding(uni.value);
};
onMounted(() => loadAll());
// the head follows syncs also while the section is folded (its cards are not mounted then)
useLiveReload(() => loadAll(true), tables('empire', 'player_scores', 'overview', 'fleets', 'galaxy_systems', 'buildings', 'research', 'spy_reports', 'battle_reports', 'expeditions', 'market_rates'), 3000);

const hidden = onboardingHidden(uni.value);
const steps = computed(() => (onboarding.value && !hidden.value && onboarding.value.done < onboarding.value.total ? onboarding.value : null));
const important = computed(() => (syncHints.value ?? []).filter((h) => h.level === 'high'));
const outdated = computed(() => (syncHints.value ?? []).filter((h) => h.level === 'medium'));
const hintsTitle = computed(() => [...important.value, ...outdated.value].map((h) => t(`impact.names.${h.key}`)).join(', '));
const reached = computed(() => reachedGoals(goals.value ?? []));
</script>

<template>
  <Section class="overview-sync" :title="t('overviewSync.title')" store-key="overview.sync" :default-open="false">
    <template #hint>
      <span class="sync-summary small">
        <span v-if="steps" class="muted">{{ t('overviewSync.steps', { done: steps.done, total: steps.total }) }}</span>
        <span v-if="freshness" class="muted">{{ t('ownFresh.short') }} <FreshnessScore :freshness="freshness" /></span>
        <span v-if="important.length" class="sum-alert" :title="hintsTitle">
          <Icon name="warning" :size="12" /> {{ t('overviewSync.important', { n: important.length }, important.length) }}
        </span>
        <span v-else-if="outdated.length" class="muted" :title="hintsTitle">{{ t('overviewSync.outdated', { n: outdated.length }, outdated.length) }}</span>
        <span v-if="goals?.length" :class="reached === goals.length ? 'sum-done' : 'muted'">
          <Icon v-if="reached === goals.length" name="check" :size="12" /> {{ t('overviewSync.goals', { n: reached, total: goals.length }) }}
        </span>
      </span>
    </template>
    <OnboardingCard brief flat />
    <SyncHints data-tour="overview-sync-hints" brief flat store-key="syncHints.overview" />
    <AllianceGoals data-tour="overview-goals" flat store-key="goals.overview" />
  </Section>
</template>

<style scoped>
.sync-summary { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
.sync-summary > span { display: inline-flex; align-items: center; gap: 4px; }
.sum-alert { color: var(--warn); }
.sum-done { color: var(--pos); }
.overview-sync :deep(.section + .section) { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px; }
</style>

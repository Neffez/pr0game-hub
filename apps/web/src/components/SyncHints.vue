<script setup lang="ts">
import Icon from './Icon.vue';
import Section from './Section.vue';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, clockTime, STATS_CATEGORIES } from '../format';
import { loadSyncHints, messagesDays, refreshSyncHints, syncHints, type SyncHint } from '../syncHints';

/**
 * "What should I paste next?": the member's missing or old pages and the group's statistics and market rate, each
 * with what gets better with it and where to find it in the game. `brief` (overview, quick sync): only what matters,
 * at most three lines and a link to the sync page; nothing at all when everything is fine. The brief list folds
 * away (remembered per device under `storeKey`); on mobile it starts folded, showing only the title and the count.
 */
const props = defineProps<{ brief?: boolean; storeKey?: string }>();
const { t } = useI18n();
const { uni } = useUni();
const mobile = useMobile();

onMounted(() => loadSyncHints(uni.value));
// the member's own syncs and the group's statistics and market rate change the list
useLiveReload(
  () => refreshSyncHints(uni.value),
  tables('empire', 'player_scores', 'overview', 'fleets', 'galaxy_systems', 'buildings', 'research', 'spy_reports', 'battle_reports', 'expeditions', 'market_rates'),
  2000,
);

const BRIEF = 3;
const all = computed(() => syncHints.value ?? []);
const shown = computed(() => (props.brief ? all.value.filter((h) => h.level !== 'low').slice(0, BRIEF) : all.value));
const more = computed(() => (props.brief ? all.value.length - shown.value.length : 0));
const ICON: Record<SyncHint['key'], string> = {
  empire: 'imperium', stats: 'stats', overview: 'fleet', galaxy: 'galaxy', buildings: 'buildings', research: 'research', messages: 'messages', market: 'market',
};

/** The state in one line: what is missing or how old it is. */
function title(h: SyncHint): string {
  const k = `syncHints.${h.key}`;
  switch (h.key) {
    case 'stats':
      if (h.level === 'high') return t(`${k}.never`);
      return t(`${k}.missing`, { time: clockTime(new Date(h.update! * 1000)), categories: (h.types ?? []).map((c) => STATS_CATEGORIES[c]).join(', ') });
    case 'galaxy':
      return t(h.count === h.total ? `${k}.none` : `${k}.stale`, { n: h.count, total: h.total });
    case 'buildings':
      return t(`${k}.missing`, { n: h.count, total: h.total }, h.total ?? 0);
    case 'messages':
      return h.time == null ? t(`${k}.never`, { days: messagesDays.value }) : t(`${k}.old`, { age: ago(h.time) });
    default:
      return h.time == null ? t(`${k}.never`) : t(`${k}.old`, { age: ago(h.time) });
  }
}
</script>

<template>
  <Section
    v-if="brief && shown.length"
    class="sync-hints brief"
    :title="t('syncHints.title')"
    :count="shown.length"
    :store-key="storeKey ?? 'syncHints'"
    :default-open-mobile="false"
  >
    <template v-if="!mobile" #actions>
      <RouterLink :to="`/${uni}/paste`" class="small">{{ more ? t('syncHints.more', { n: more }, more) : t('syncHints.open') }}</RouterLink>
    </template>
    <ul class="sync-hint-list">
      <li v-for="h in shown" :key="h.key" :class="`level-${h.level}`" :title="t(`syncHints.${h.key}.why`)">
        <Icon :name="ICON[h.key]" :size="16" class="sync-hint-icon" />
        <div class="sync-hint-title">
          {{ title(h) }}
          <span class="badge" :class="`badge-${h.level}`">{{ t(`syncHints.level.${h.level}`) }}</span>
          <span v-if="h.scope === 'group'" class="badge muted">{{ t('syncHints.forAlliance') }}</span>
        </div>
      </li>
    </ul>
    <RouterLink v-if="mobile" :to="`/${uni}/paste`" class="small sync-hints-more">{{ more ? t('syncHints.more', { n: more }, more) : t('syncHints.open') }}</RouterLink>
  </Section>
  <div v-else-if="!brief" class="card sync-hints">
    <h3 class="mt-0 sync-hints-head"><Icon name="sync" :size="16" /> {{ t('syncHints.title') }}</h3>
    <p v-if="syncHints && !all.length" class="ok" style="margin: 0">{{ t('syncHints.allSet') }}</p>
    <ul v-else class="sync-hint-list">
      <li v-for="h in shown" :key="h.key" :class="`level-${h.level}`">
        <Icon :name="ICON[h.key]" :size="16" class="sync-hint-icon" />
        <div>
          <div class="sync-hint-title">
            {{ title(h) }}
            <span class="badge" :class="`badge-${h.level}`">{{ t(`syncHints.level.${h.level}`) }}</span>
            <span v-if="h.scope === 'group'" class="badge muted">{{ t('syncHints.forAlliance') }}</span>
          </div>
          <div class="small muted">{{ t(`syncHints.${h.key}.why`) }}</div>
          <div class="small"><span class="muted">{{ t('syncHints.where') }}</span> {{ t(`syncHints.${h.key}.where`) }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sync-hints-head { display: flex; align-items: center; gap: 6px; }
.sync-hint-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.sync-hint-list li { display: flex; gap: 8px; align-items: flex-start; padding-left: 8px; border-left: 3px solid var(--border); }
.sync-hint-list li.level-high { border-left-color: var(--neg); }
.sync-hint-list li.level-medium { border-left-color: var(--warn); }
.sync-hint-icon { flex: none; margin-top: 2px; }
.sync-hint-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.badge-high { color: var(--neg); }
.badge-medium { color: var(--warn); }
.brief .sync-hint-list { gap: 6px; }
.sync-hints-more { display: inline-block; margin-top: 8px; }
</style>

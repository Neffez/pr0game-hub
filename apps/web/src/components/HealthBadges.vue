<script setup lang="ts">
import BadgeIcon from './BadgeIcon.vue';
import Icon from './Icon.vue';
import Section from './Section.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { achievements, isManualBadge } from '../achievements';
import type { Badge } from '../apiTypes';
import { useUni } from '../composables';
import { fmt } from '../format';

/** Health page, tab "Streaks & badges": per member the sync streak and every badge; a legend of all badges. */
const { t } = useI18n();
const { ctx } = useUni();

const rows = computed(() =>
  [...(achievements.value ?? [])].sort(
    (a, b) => b.badges.reduce((n, x) => n + x.level, 0) - a.badges.reduce((n, x) => n + x.level, 0) || b.streak.current - a.streak.current,
  ),
);
/** every badge with its levels (the server sends them with each member's badges) */
const legend = computed(() => achievements.value?.[0]?.badges ?? []);
const sample = (b: Badge): Badge => ({ ...b, count: 0, level: 1, next: null });
</script>

<template>
  <div v-if="!achievements" class="card muted">…</div>
  <template v-else>
    <div class="hb-list" data-tour="health-badges-list">
      <div v-for="m in rows" :key="m.userId" class="card hb-member" :class="{ me: m.userId === ctx?.me.id }">
        <div class="hb-head">
          <b class="grow">{{ m.name }}</b>
          <span class="hb-streak" :class="{ on: m.streak.current > 0 }" :title="t('badges.streakTitle', { best: m.streak.best })" data-tour="health-badges-streak">
            <Icon name="bolt" :size="14" />
            {{ t('badges.streakDays', { n: m.streak.current }, m.streak.current) }}
            <span v-if="m.streak.current && !m.streak.today" class="muted small">· {{ t('badges.todayOpen') }}</span>
          </span>
        </div>
        <div class="hb-badges">
          <BadgeIcon v-for="b in m.badges" :key="b.key" :badge="b" :size="16" />
        </div>
      </div>
    </div>
    <Section :title="t('badges.legend')" store-key="health.badgesLegend" :default-open="false" data-tour="health-badges-legend">
      <ul class="hb-legend">
        <li v-for="x in legend" :key="x.key">
          <BadgeIcon :badge="sample(x)" :size="16" />
          <div>
            <b>{{ t(`badges.${x.key}.name`) }}</b> <span class="muted small">{{ t(`badges.${x.key}.how`) }}</span>
            <div v-if="!isManualBadge(x.key)" class="small muted">{{ t('badges.levels') }} {{ x.steps.map((n) => fmt(n)).join(' / ') }}</div>
          </div>
        </li>
      </ul>
    </Section>
  </template>
</template>

<style scoped>
.hb-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-bottom: 10px; }
.hb-member { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.hb-member.me { border-color: var(--accent); }
.hb-head { display: flex; align-items: center; gap: 8px; }
.hb-streak { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; }
.hb-streak.on { color: var(--warn); }
.hb-badges { display: flex; flex-wrap: wrap; gap: 8px; }
.hb-legend { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px 20px; }
.hb-legend li { display: flex; gap: 8px; align-items: flex-start; }
</style>

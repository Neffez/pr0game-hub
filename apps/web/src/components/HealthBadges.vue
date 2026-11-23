<script setup lang="ts">
import BadgeIcon from './BadgeIcon.vue';
import Hint from './Hint.vue';
import RankInsignia from './RankInsignia.vue';
import Icon from './Icon.vue';
import Section from './Section.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { achievements, isManualBadge } from '../achievements';
import type { Badge } from '../apiTypes';
import { useUni } from '../composables';
import { fmt } from '../format';
import { RANK_CONDITIONS, RANK_LEVELS, type RankCondition } from '../rank';

/**
 * Health page, tab "Streaks & badges": per member the rank, sync streak and every badge, then the rank order (who leads
 * each condition of the rank badge, explained in an info tooltip), last a legend of all badges.
 */
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

/** a condition's value as text */
const value = (k: RankCondition, v: number) =>
  k === 'profitRatio' ? fmt(v, 2) : k === 'winStreak' ? t('rank.wins', { n: fmt(v) }, v) : k === 'playersAttacked' ? t('rank.players', { n: fmt(v) }, v) : fmt(v);
/** per condition: the members holding it and the value, and the own value */
const order = computed(() => {
  const list = achievements.value ?? [];
  const me = list.find((m) => m.userId === ctx.value?.me.id);
  return RANK_CONDITIONS.map((k) => {
    const holders = list.filter((m) => m.rank.holds.includes(k));
    return { key: k, holders, value: holders[0]?.rank.values[k] ?? null, mine: me && !me.rank.holds.includes(k) ? me.rank.values[k] : null };
  });
});
const levels = Array.from({ length: RANK_LEVELS }, (_, i) => i + 1);
</script>

<template>
  <div v-if="!achievements" class="card muted">…</div>
  <template v-else>
    <div class="hb-list" data-tour="health-badges-list">
      <div v-for="m in rows" :key="m.userId" class="card hb-member" :class="{ me: m.userId === ctx?.me.id }">
        <div class="hb-head">
          <b class="grow"><RankInsignia :rank="m.rank" :size="16" />{{ m.name }}</b>
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
    <div class="card hb-rank" data-tour="health-badges-rank">
      <h3>{{ t('rank.title') }} <Hint>{{ t('rank.hint') }}</Hint></h3>
      <table class="hb-rank-table">
        <thead>
          <tr><th>{{ t('rank.condition') }}</th><th>{{ t('rank.holder') }}</th><th class="num">{{ t('rank.value') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in order" :key="c.key">
            <td :title="t(`rank.how.${c.key}`)">{{ t(`rank.conditions.${c.key}`) }}<div class="muted small">{{ t(`rank.how.${c.key}`) }}</div></td>
            <td>
              <span v-if="!c.holders.length" class="muted">{{ t('rank.nobody') }}</span>
              <span v-for="(m, i) in c.holders" :key="m.userId" class="hb-holder" :class="{ me: m.userId === ctx?.me.id }"
                >{{ i ? ', ' : '' }}<RankInsignia :rank="m.rank" :size="14" />{{ m.name }}</span
              >
              <div v-if="c.mine != null" class="muted small">{{ t('rank.you', { v: value(c.key, c.mine) }) }}</div>
            </td>
            <td class="num">{{ c.value != null ? value(c.key, c.value) : '–' }}</td>
          </tr>
        </tbody>
      </table>
      <details class="hb-ranks">
        <summary class="small">{{ t('rank.ranks') }}</summary>
        <ul>
          <li v-for="n in levels" :key="n"><RankInsignia :level="n" :size="22" /> <b>{{ t(`rank.names.${n}`) }}</b> <span class="muted small">{{ t('rank.legendLine', { n }, n) }}</span></li>
        </ul>
      </details>
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
.hb-rank { margin: 0 0 10px; }
.hb-rank h3 { margin: 0 0 4px; }
.hb-rank-table { width: 100%; border-collapse: collapse; }
.hb-rank-table th, .hb-rank-table td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--border); vertical-align: top; }
.hb-rank-table .num { text-align: right; white-space: nowrap; }
.hb-holder.me { color: var(--accent); font-weight: 600; }
.hb-ranks { margin-top: 8px; }
.hb-ranks ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 16px; }
.hb-ranks li { display: flex; align-items: center; gap: 6px; }
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

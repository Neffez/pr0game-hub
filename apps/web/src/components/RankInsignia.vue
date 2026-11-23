<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { loadAchievements } from '../achievements';
import { useLongPress, useUni } from '../composables';
import { fmt } from '../format';
import { RANK_GLYPHS, RANK_LEVELS, RANK_METALS, rankOf, type MemberRank, type RankCondition } from '../rank';

/**
 * The dynamic rank badge of a member before the name (and before the other badges): found by user id, player id or
 * display name, or given as `rank`; nothing while the member holds no condition. The tooltip names the rank and the
 * conditions held with their values; on touch devices a long press shows it as a sheet. `size` in px.
 */
const props = withDefaults(
  defineProps<{ userId?: number | null; playerId?: number | null; name?: string | null; rank?: MemberRank | null; size?: number; level?: number }>(),
  { size: 14 },
);
const { t } = useI18n();
const { uni } = useUni();
const { open, handlers } = useLongPress();

// the ranks come with the achievements (cached, reloaded at most every few minutes)
onMounted(() => uni.value && loadAchievements(uni.value));
watch(uni, (u) => u && loadAchievements(u));

const rank = computed(() => props.rank ?? rankOf(props));
/** shown level: `level` for a legend, else the member's points */
const points = computed(() => props.level ?? rank.value?.points ?? 0);
const glyph = computed(() => RANK_GLYPHS[Math.min(points.value, RANK_LEVELS) - 1]);
/** gradient id of this icon (unique in the page) */
const id = `rk${Math.random().toString(36).slice(2, 10)}`;
const body = computed(() => glyph.value?.body.replaceAll('url(#G)', `url(#${id})`) ?? '');
const stops = computed(() => (glyph.value ? RANK_METALS[glyph.value.metal] : []));

/** a condition's value as text */
const value = (k: RankCondition, v: number) => {
  if (k === 'profitRatio') return fmt(v, 2);
  if (k === 'winStreak') return t('rank.wins', { n: fmt(v) }, v);
  if (k === 'playersAttacked') return t('rank.players', { n: fmt(v) }, v);
  return fmt(v);
};
const tip = computed(() => {
  const head = `${t(`rank.names.${points.value}`)} – ${t('rank.level', { n: points.value, of: RANK_LEVELS })}`;
  const r = props.level == null ? rank.value : null;
  const lines = r ? r.holds.map((k) => `${t(`rank.conditions.${k}`)}: ${value(k, r.values[k])}`) : [t('rank.legendLine', { n: points.value }, points.value)];
  return { head, lines };
});
const title = computed(() => [tip.value.head, ...tip.value.lines].join('\n'));
</script>

<template>
  <span v-if="glyph" class="rank-insignia" :title="title" :aria-label="title" role="img" data-rank v-on="handlers">
    <svg :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient :id="id" x1="0" y1="0" :x2="glyph.metal === 'marshal' ? 1 : 0" y2="1">
          <stop offset="0" :stop-color="stops[0]" />
          <stop v-if="stops[2]" offset=".5" :stop-color="stops[2]" />
          <stop offset="1" :stop-color="stops[1]" />
        </linearGradient>
      </defs>
      <!-- static glyphs from rank.ts -->
      <g :fill="`url(#${id})`" stroke="#2a1d0a" stroke-opacity=".55" stroke-width=".7" stroke-linejoin="round" v-html="body" />
    </svg>
    <Teleport v-if="open" to="body">
      <div class="touch-tip" role="tooltip">
        <div class="touch-tip-head"><b>{{ tip.head }}</b></div>
        <div v-for="(line, i) in tip.lines" :key="i">{{ line }}</div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.rank-insignia { display: inline-flex; align-items: center; flex: none; vertical-align: -0.15em; margin-right: 3px; cursor: help; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.rank-insignia svg { display: block; overflow: visible; }
.touch-tip-head { margin-bottom: 4px; }
</style>

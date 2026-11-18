<script setup lang="ts">
import Icon from './Icon.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Schema } from '../apiTypes';
import { nowSec } from '../clock';
import { dateTime, span, STATS_CATEGORIES } from '../format';

/**
 * What a saved sync changed, in plain lines ("14 galaxy systems updated, 5 d old on average before"): galaxy, spy
 * reports, statistics, the member's own pages and the sync hints that are done now. Nothing without news.
 */
const props = defineProps<{ impact: Schema<'SyncImpact'> | null | undefined; compact?: boolean }>();
const { t } = useI18n();

const OWN_ICON = { empire: 'imperium', overview: 'fleet', buildings: 'buildings', research: 'research' } as const;

const lines = computed(() => {
  const x = props.impact;
  if (!x) return [];
  const out: { icon: string; text: string }[] = [];
  const names = (keys: string[]) => keys.map((k) => t(`impact.names.${k}`)).join(', ');
  if (x.galaxy) {
    const g = x.galaxy;
    const parts = [t('impact.galaxy', { n: g.systems }, g.systems)];
    if (g.first) parts.push(g.first < g.systems ? t('impact.galaxyFirst', { n: g.first }) : t('impact.galaxyAllFirst', g.systems));
    if (g.age != null) parts.push(t('impact.ageBefore', { age: span(g.age) }));
    out.push({ icon: 'galaxy', text: parts.join(', ') });
  }
  if (x.spy) {
    const s = x.spy;
    const parts: string[] = [];
    if (s.first) parts.push(t('impact.spyFirst', { n: s.first }, s.first));
    if (s.replaced) parts.push(t('impact.spyReplaced', { n: s.replaced }, s.replaced) + (s.age != null ? ` (${t('impact.ageBefore', { age: span(s.age) })})` : ''));
    out.push({ icon: 'spy', text: parts.join(', ') });
  }
  for (const s of x.stats ?? []) {
    const params = { time: dateTime(s.update), categories: s.types.map((c) => STATS_CATEGORIES[c] ?? c).join(', ') };
    out.push({ icon: 'stats', text: t(s.first ? 'impact.statsFirst' : 'impact.statsAdded', params) });
  }
  for (const o of x.own ?? []) {
    const page = t(`impact.names.${o.page}`);
    out.push({ icon: OWN_ICON[o.page], text: o.before == null ? t('impact.ownFirst', { page }) : t('impact.ownOld', { page, age: span(Math.max(0, nowSec() - o.before)) }) });
  }
  if (x.hintsDone?.length) out.push({ icon: 'sync', text: t('impact.hintsDone', { n: x.hintsDone.length, list: names(x.hintsDone) }, x.hintsDone.length) });
  return out;
});
</script>

<template>
  <ul v-if="lines.length" class="sync-impact" :class="{ compact }">
    <li v-for="(l, i) in lines" :key="i"><Icon :name="l.icon" :size="compact ? 12 : 14" class="impact-icon" /> {{ l.text }}</li>
  </ul>
</template>

<style scoped>
.sync-impact { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 4px; }
.sync-impact li { display: flex; align-items: flex-start; gap: 6px; }
.impact-icon { flex: none; margin-top: 2px; color: var(--pos); }
.sync-impact.compact { margin-top: 4px; font-size: 12px; gap: 2px; }
</style>

<script setup lang="ts">
import Section from './Section.vue';
import Hint from './Hint.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, dateTime, freshnessColor } from '../format';

/** Heat map of when each system was last synced (bottom of the galaxy page); a click shows the system. */
const props = defineProps<{ current?: { g: number; s: number } }>();
const emit = defineEmits<{ select: [pos: { g: number; s: number }] }>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const views = ref<{ g: number; s: number; seen_at: number; username: string | null }[]>([]);
/** systems per heatmap row */
const PER_ROW = 50;

const now = ref(Math.floor(Date.now() / 1000));
async function load() {
  try {
    views.value = await uniApi(uni.value, '/galaxy-views');
    now.value = Math.floor(Date.now() / 1000);
  } catch {
    /* only a heat map: the page shows the error of its own data */
  }
}
onMounted(load);
useLiveReload(load, tables('galaxy_systems'));

const map = computed(() => new Map(views.value.map((v) => [`${v.g}:${v.s}`, v])));
const settings = computed(() => ctx.value!.universe.settings);

const color = freshnessColor;

const rows = computed(() => {
  const out: { g: number; start: number; cells: { s: number; v: any; age: number | null }[] }[] = [];
  for (let g = 1; g <= settings.value.galaxies; g++) {
    for (let start = 1; start <= settings.value.systems; start += PER_ROW) {
      const cells = [];
      for (let s = start; s < start + PER_ROW && s <= settings.value.systems; s++) {
        const v = map.value.get(`${g}:${s}`);
        cells.push({ s, v, age: v ? now.value - v.seen_at : null });
      }
      out.push({ g, start, cells });
    }
  }
  return out;
});

const stats = computed(() => {
  const total = settings.value.galaxies * settings.value.systems;
  const day = views.value.filter((v) => now.value - v.seen_at < 86400).length;
  return { total, seen: views.value.length, day };
});
</script>

<template>
  <Section :title="t('nav.freshness')" store-key="browse.freshness" :default-open-mobile="false" class="freshness">
    <template #hint><Hint>{{ t('freshness.hint') }} {{ t('freshness.clickHint') }}</Hint></template>
    <p class="muted small known">{{ t('freshness.known', { seen: stats.seen, total: stats.total, day: stats.day }) }}</p>
    <div class="row small legend">
      <span><span class="sw" style="background: #2ea043" /> &lt; 6 h</span>
      <span><span class="sw" style="background: #3fb95099" /> &lt; 24 h</span>
      <span><span class="sw" style="background: #d2992299" /> &lt; 3 d</span>
      <span><span class="sw" style="background: #f8514966" /> &lt; 7 d</span>
      <span><span class="sw" style="background: #f8514933" /> {{ t('freshness.older') }}</span>
      <span><span class="sw" style="background: var(--surface-2)" /> {{ t('freshness.never') }}</span>
    </div>
    <div class="heatmap">
      <div v-for="r in rows" :key="`${r.g}:${r.start}`" class="hm-row">
        <span class="hm-label mono">{{ r.g }}:{{ r.start }}</span>
        <span
          v-for="c in r.cells"
          :key="c.s"
          class="hm-cell"
          :class="{ cur: props.current?.g === r.g && props.current?.s === c.s }"
          :style="{ background: color(c.age) }"
          :title="`${r.g}:${c.s} – ${c.v ? `${dateTime(c.v.seen_at)} (${ago(c.v.seen_at)}) ${t('common.from')} ${c.v.username ?? '?'}` : t('freshness.never')}`"
          @click="emit('select', { g: r.g, s: c.s })"
        />
      </div>
    </div>
  </Section>
</template>

<style scoped>
.known { margin: 0 0 6px; }
.legend { margin-bottom: 10px; }
.heatmap { overflow-x: auto; }
.hm-row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
.hm-label { width: 60px; font-size: 11px; color: var(--faint); flex-shrink: 0; }
.hm-cell { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; cursor: pointer; }
.hm-cell:hover { outline: 1px solid var(--text); }
.hm-cell.cur { outline: 2px solid var(--accent); outline-offset: 1px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; }
@media (max-width: 800px) {
  /* the 50 systems of a row share the width instead of scrolling */
  .hm-row { gap: 1px; margin-bottom: 1px; }
  .hm-label { width: 44px; font-size: 10px; }
  .hm-cell { flex: 1 1 0; width: auto; min-width: 0; height: 12px; border-radius: 1px; }
}
</style>

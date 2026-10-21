<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref } from 'vue';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { ago, dateTime, freshnessColor } from '../format';

const { uni, ctx } = useUni();
const views = ref<{ g: number; s: number; seen_at: number; username: string | null }[]>([]);
/** systems per heatmap row */
const PER_ROW = 50;

onMounted(async () => {
  views.value = await uniApi(uni.value, '/galaxy-views');
});

const map = computed(() => new Map(views.value.map((v) => [`${v.g}:${v.s}`, v])));
const settings = computed(() => ctx.value!.universe.settings);

const color = freshnessColor;

const now = Math.floor(Date.now() / 1000);
const rows = computed(() => {
  const out: { g: number; start: number; cells: { s: number; v: any; age: number | null }[] }[] = [];
  for (let g = 1; g <= settings.value.galaxies; g++) {
    for (let start = 1; start <= settings.value.systems; start += PER_ROW) {
      const cells = [];
      for (let s = start; s < start + PER_ROW && s <= settings.value.systems; s++) {
        const v = map.value.get(`${g}:${s}`);
        cells.push({ s, v, age: v ? now - v.seen_at : null });
      }
      out.push({ g, start, cells });
    }
  }
  return out;
});

const stats = computed(() => {
  const total = settings.value.galaxies * settings.value.systems;
  const day = views.value.filter((v) => now - v.seen_at < 86400).length;
  return { total, seen: views.value.length, day };
});
</script>

<template>
  <h1>Gala-Aktualität <Hint>Wann welches System zuletzt als Galaxieansicht eingefügt wurde.</Hint></h1>
  <div class="card">
    <p class="muted small" style="margin-top: 0">{{ stats.seen }} / {{ stats.total }} Systeme bekannt, {{ stats.day }} in den letzten 24 h.</p>
    <div class="row small">
      <span><span class="sw" style="background: #2ea043" /> &lt; 6 h</span>
      <span><span class="sw" style="background: #3fb95099" /> &lt; 24 h</span>
      <span><span class="sw" style="background: #d2992299" /> &lt; 3 d</span>
      <span><span class="sw" style="background: #f8514966" /> &lt; 7 d</span>
      <span><span class="sw" style="background: #f8514933" /> älter</span>
      <span><span class="sw" style="background: var(--surface-2)" /> nie</span>
    </div>
  </div>
  <div class="card" style="overflow-x: auto">
    <div v-for="r in rows" :key="`${r.g}:${r.start}`" class="hm-row">
      <span class="hm-label mono">{{ r.g }}:{{ r.start }}</span>
      <span
        v-for="c in r.cells"
        :key="c.s"
        class="hm-cell"
        :style="{ background: color(c.age) }"
        :title="`${r.g}:${c.s} – ${c.v ? `${dateTime(c.v.seen_at)} (${ago(c.v.seen_at)}) von ${c.v.username ?? '?'}` : 'nie'}`"
      />
    </div>
  </div>
</template>

<style scoped>
.hm-row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
.hm-label { width: 60px; font-size: 11px; color: var(--faint); flex-shrink: 0; }
.hm-cell { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; }
</style>

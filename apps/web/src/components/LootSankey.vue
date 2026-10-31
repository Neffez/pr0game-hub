<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { debrisSummary, type LootState, type Res, type SettlementResult } from '@pr0hub/loot';
import { fmt, name, short } from '../format';

/**
 * Where the loot went, as a Sankey diagram: collected (loot, debris field) → pot (and what was not recycled) →
 * allocated (costs covered, profit shared out, helpers' part) → what each person is entitled to. Widths are the
 * resources together, or their value in deuterium at the settlement's rates.
 */
const props = defineProps<{ state: LootState; result: SettlementResult }>();
const { t } = useI18n();

/** Categorical palette (validated for the hub's dark surface #151b23), in fixed order: participants, then helpers. */
const PERSON_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_COLOR = '#6b7686';

const W = 760;
const NODE_W = 10;
const GAP = 16;
const PAD_Y = 26;
/** x of each column; the people's names go right of the last one */
const COLS = [0, 200, 410, 620];

const byValue = ref(false);
const zero = (): Res => ({ m: 0, k: 0, d: 0 });
const add = (a: Res, b: Partial<Res>): Res => ({ m: a.m + (b.m ?? 0), k: a.k + (b.k ?? 0), d: a.d + (b.d ?? 0) });
const sizeOf = (r: Res) => {
  const rates = props.state.settings.rates;
  return byValue.value ? r.m / (rates.m || 1) + r.k / (rates.k || 1) + r.d : r.m + r.k + r.d;
};

interface Node { id: string; col: number; label: string; res: Res; color: string | null; y: number; h: number; inY: number; outY: number }
interface Link { from: string; to: string; res: Res; color: string | null; path: string; label: string }

const layout = computed(() => {
  const r = props.result;
  const debris = debrisSummary(props.state);
  const field = debris.field ? { m: Math.max(debris.field.m, r.recycled.m), k: Math.max(debris.field.k, r.recycled.k), d: 0 } : { ...r.recycled };
  const notRecycled = { m: field.m - r.recycled.m, k: field.k - r.recycled.k, d: 0 };
  const participants = r.people.filter((p) => p.role === 'participant');
  const helpers = r.people.filter((p) => p.role === 'helper');
  const covered = participants.reduce((a, p) => add(a, p.covered), zero());
  const profit = participants.reduce((a, p) => add(a, p.profit), zero());
  const helperPart = helpers.reduce((a, p) => add(a, p.entitled), zero());

  const nodes: Node[] = [];
  const node = (id: string, col: number, label: string, res: Res, color: string | null = null) => {
    if (sizeOf(res) > 0) nodes.push({ id, col, label, res, color, y: 0, h: 0, inY: 0, outY: 0 });
  };
  node('loot', 0, t('loot.flow.loot'), r.loot);
  node('field', 0, t('loot.flow.field'), field);
  node('pot', 1, t('loot.flow.pot'), r.pot);
  node('left', 1, t('loot.flow.notRecycled'), notRecycled);
  node('covered', 2, t('loot.flow.covered'), covered);
  node('profit', 2, t('loot.flow.profit'), profit);
  node('helpers', 2, t('loot.flow.helpers'), helperPart);
  r.people.forEach((p, i) => node(`p:${p.id}`, 3, p.name, p.entitled, PERSON_COLORS[i] ?? OTHER_COLOR));

  const raw: Omit<Link, 'path' | 'label'>[] = [
    { from: 'loot', to: 'pot', res: r.loot, color: null },
    { from: 'field', to: 'pot', res: r.recycled, color: null },
    { from: 'field', to: 'left', res: notRecycled, color: null },
    { from: 'pot', to: 'covered', res: covered, color: null },
    { from: 'pot', to: 'profit', res: profit, color: null },
    { from: 'pot', to: 'helpers', res: helperPart, color: null },
    ...participants.flatMap((p) => {
      const color = PERSON_COLORS[r.people.indexOf(p)] ?? OTHER_COLOR;
      return [
        { from: 'covered', to: `p:${p.id}`, res: p.covered, color },
        { from: 'profit', to: `p:${p.id}`, res: p.profit, color },
      ];
    }),
    ...helpers.map((p) => ({ from: 'helpers', to: `p:${p.id}`, res: p.entitled, color: PERSON_COLORS[r.people.indexOf(p)] ?? OTHER_COLOR })),
  ].filter((l) => sizeOf(l.res) > 0 && nodes.some((n) => n.id === l.from) && nodes.some((n) => n.id === l.to));

  // heights: the fullest column fills the chart; every node at least 2 px
  const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.col === c));
  const height = Math.max(320, 64 * Math.max(...cols.map((c) => c.length)));
  const usable = (c: Node[]) => height - 2 * PAD_Y - GAP * Math.max(0, c.length - 1);
  const scale = Math.min(...cols.filter((c) => c.length).map((c) => usable(c) / c.reduce((a, n) => a + sizeOf(n.res), 0)));
  for (const c of cols) {
    const total = c.reduce((a, n) => a + Math.max(2, sizeOf(n.res) * scale), 0) + GAP * Math.max(0, c.length - 1);
    let y = PAD_Y + (height - 2 * PAD_Y - total) / 2;
    for (const n of c) {
      n.h = Math.max(2, sizeOf(n.res) * scale);
      n.y = n.inY = n.outY = y;
      y += n.h + GAP;
    }
  }
  const find = (id: string) => nodes.find((n) => n.id === id)!;
  const links: Link[] = raw.map((l) => {
    const a = find(l.from);
    const b = find(l.to);
    const h = Math.max(1, sizeOf(l.res) * scale);
    const x0 = COLS[a.col] + NODE_W;
    const x1 = COLS[b.col];
    const y0 = a.outY;
    const y1 = b.inY;
    a.outY += h;
    b.inY += h;
    const mx = (x0 + x1) / 2;
    const path = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`;
    return { ...l, path, label: `${a.label} → ${b.label}` };
  });
  return { nodes, links, height };
});

const total = (r: Res) => short(sizeOf(r));

// ---- hover: one tooltip with the resources of the node or flow
const tip = ref<{ x: number; y: number; title: string; res: Res } | null>(null);
const hovered = ref<string | null>(null);
const wrap = ref<HTMLElement | null>(null);
function show(e: MouseEvent, key: string, title: string, res: Res) {
  const box = wrap.value?.getBoundingClientRect();
  if (!box) return;
  hovered.value = key;
  tip.value = { x: e.clientX - box.left, y: e.clientY - box.top, title, res };
}
function hide() {
  hovered.value = null;
  tip.value = null;
}
/** labels of the allocation column sit left of it (its flows to the people go right), all others right */
const labelLeft = (n: Node) => n.col === 2;
</script>

<template>
  <div class="sankey">
    <div class="row toggle" role="group" :aria-label="t('loot.flow.measure')">
      <button :class="{ primary: !byValue }" @click="byValue = false">{{ t('loot.flow.byAmount') }}</button>
      <button :class="{ primary: byValue }" @click="byValue = true">{{ t('loot.flow.byValue') }}</button>
      <span class="muted small">{{ byValue ? t('loot.flow.byValueHint') : t('loot.flow.byAmountHint') }}</span>
    </div>
    <div ref="wrap" class="chart" @mouseleave="hide">
      <svg :viewBox="`-4 0 ${W + 8} ${layout.height}`" role="img" :aria-label="t('loot.flow.aria')">
        <g class="links">
          <path
            v-for="(l, i) in layout.links" :key="`${l.from}>${l.to}`" :d="l.path"
            :fill="l.color ?? 'var(--muted)'"
            :fill-opacity="hovered === `l${i}` ? 0.75 : l.color ? 0.42 : 0.18"
            @mousemove="show($event, `l${i}`, l.label, l.res)"
          />
        </g>
        <g v-for="n in layout.nodes" :key="n.id" class="node" @mousemove="show($event, n.id, n.label, n.res)">
          <rect :x="COLS[n.col]" :y="n.y" :width="NODE_W" :height="n.h" rx="3" :fill="n.color ?? 'var(--muted)'" />
          <text
            :x="labelLeft(n) ? COLS[n.col] - 8 : COLS[n.col] + NODE_W + 8" :y="n.y + n.h / 2 - 2"
            :text-anchor="labelLeft(n) ? 'end' : 'start'" class="label"
          >{{ n.label }}</text>
          <text
            :x="labelLeft(n) ? COLS[n.col] - 8 : COLS[n.col] + NODE_W + 8" :y="n.y + n.h / 2 + 12"
            :text-anchor="labelLeft(n) ? 'end' : 'start'" class="value"
          >{{ total(n.res) }}</text>
        </g>
        <g class="heads">
          <text v-for="(h, c) in ['collected', 'pot', 'allocated', 'earned']" :key="h" :x="c === 2 ? COLS[c] + NODE_W : COLS[c]" y="12" :text-anchor="c === 2 ? 'end' : 'start'">
            {{ t(`loot.flow.col_${h}`) }}
          </text>
        </g>
      </svg>
      <div v-if="tip" class="tip" :style="{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }">
        <b>{{ tip.title }}</b>
        <div v-for="[k, id] in ([['m', 901], ['k', 902], ['d', 903]] as const)" :key="k" class="mono small">
          {{ name(id) }}: {{ fmt(tip.res[k]) }}
        </div>
        <div v-if="byValue" class="mono small muted">{{ t('loot.flow.deutValue') }}: {{ total(tip.res) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toggle { gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.chart { position: relative; overflow-x: auto; }
svg { display: block; width: 100%; min-width: 560px; height: auto; }
.label, .value { paint-order: stroke; stroke: var(--surface); stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
.label { fill: var(--text); font-size: 13px; }
.value { fill: var(--muted); font-size: 11px; font-family: var(--mono); }
.heads text { fill: var(--muted); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
.links path { cursor: default; transition: fill-opacity 0.1s; }
.node rect { stroke: var(--surface); stroke-width: 1; }
.tip {
  position: absolute; z-index: 2; pointer-events: none; min-width: 160px; padding: 6px 8px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border); box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
}
.tip b { display: block; margin-bottom: 2px; }
</style>

<script setup lang="ts">
import { upgradeAdvice, type Advice, type AdviceStep } from '@pr0hub/core/advisor';
import { levelAfter, type BuildPlanet } from '@pr0hub/core/buildings';
import { positionTemp } from '@pr0hub/core/production';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useStored, useUni } from '../composables';
import { currentMarketRate, fmt, name, short } from '../format';
import type { StoredBuildOrder } from './BuildOrder.vue';
import Hint from './Hint.vue';

/**
 * Upgrade advisor (math: `upgradeAdvice` of @pr0hub/core/advisor): the next mine, energy and production research
 * levels ranked by payback time, valued with the group's market rate. A step goes into the build order with one click.
 */
interface HubPlanet {
  key: string;
  name: string;
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon';
  planet: BuildPlanet;
  temp: number | null;
  factors?: Record<string, number> | null;
}
const props = defineProps<{
  hub: { planets: HubPlanet[]; research: Record<string, number>; researchQueue: { id: number; level: number }[]; resourceSpeed: number | null; catchUp: number | null };
  planetKey: string;
  mobile: boolean;
  /** only the best step of the planet, as one line (buildings tab) */
  compact?: boolean;
}>();
const emit = defineEmits<{ open: [] }>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const onlyPlanet = useStored('advisor.onlyPlanet', false);
const all = ref(false);
const LIMIT = 12;

/** levels after the build queue (the advice starts from what will be built anyway) */
const levelsOf = (p: HubPlanet) => {
  const levels = { ...p.planet.values };
  for (const q of p.planet.queue) levels[q.id] = Math.max(levels[q.id] ?? 0, levelAfter(q));
  return levels;
};
const research = computed(() => {
  const r = { ...props.hub.research };
  for (const q of props.hub.researchQueue) r[q.id] = Math.max(r[q.id] ?? 0, q.level);
  return r;
});
const planets = computed(() => props.hub.planets.filter((p) => p.type === 'planet'));
const advice = computed(() =>
  upgradeAdvice({
    planets: planets.value.map((p) => ({
      key: p.key, name: p.name, levels: levelsOf(p), temp: p.temp ?? positionTemp(p.coords.p), factors: p.factors ?? null, perHour: p.planet.perHour,
    })),
    research: research.value,
    resourceSpeed: (props.hub.resourceSpeed || ctx.value!.universe.settings.resourceMultiplier || 2500) / 2500,
    rate: currentMarketRate(),
    catchUp: props.hub.catchUp ?? 0,
  }),
);
const list = computed(() => advice.value.filter((a) => !onlyPlanet.value || a.key === props.planetKey || a.key == null));
const shown = computed(() => (all.value ? list.value : list.value.slice(0, LIMIT)));
/** the best step that concerns this planet (its buildings or the account's research) */
const best = computed(() => advice.value.find((a) => a.key === props.planetKey || a.key == null) ?? null);

const planetName = (key: string | null) => (key == null ? t('advisor.account') : (planets.value.find((p) => p.key === key)?.name ?? key));
const stepText = (s: AdviceStep) => (s.kind === 'satellites' ? `${fmt(s.level)}× ${name(s.element)}` : `${name(s.element)} ${s.level}`);
const title = (a: Advice) => [a.step, ...a.with].map(stepText).join(' + ');
/** hours, from two days on in days */
const payback = (h: number) => (h < 48 ? t('advisor.hours', { n: fmt(h, 1) }) : t('advisor.days', { n: fmt(h / 24, 1) }));
const costTitle = (a: Advice) => [901, 902, 903].filter((r) => a.cost[r]).map((r) => `${fmt(Math.round(a.cost[r]))} ${name(r)}`).join('\n');
const gainTitle = (a: Advice) => [901, 902, 903].filter((r) => Math.abs(a.gain[r] ?? 0) >= 1).map((r) => `${a.gain[r] > 0 ? '+' : ''}${fmt(Math.round(a.gain[r]))} ${name(r)}/h`).join('\n');

// ---- into the build order
const busy = ref<Advice | null>(null);
const added = ref(new Set<Advice>());
const message = ref<string | null>(null);
/** "+1 level" steps (several for energy that needs more levels), satellites as one ship step */
function stepsOf(a: Advice, levels: Record<string, number>) {
  const stamp = Date.now().toString(36);
  const out: { id: string; kind: 'building' | 'research' | 'ship'; element: number; count?: number }[] = [];
  for (const s of [...a.with, a.step]) {
    if (s.kind === 'satellites') out.push({ id: '', kind: 'ship', element: s.element, count: s.level });
    else {
      const from = s.kind === 'research' ? (research.value[s.element] ?? 0) : (levels[s.element] ?? 0);
      for (let l = from + 1; l <= s.level; l++) out.push({ id: '', kind: s.kind, element: s.element });
    }
  }
  return out.map((s, i) => ({ ...s, id: `adv-${stamp}-${i}` }));
}
async function addToOrder(a: Advice) {
  busy.value = a;
  message.value = null;
  // research runs on a planet: the planet chosen above
  const key = a.key ?? props.planetKey;
  const planet = planets.value.find((p) => p.key === key);
  try {
    const steps = stepsOf(a, planet ? levelsOf(planet) : {});
    const { buildOrder } = await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order');
    if (buildOrder) {
      // after the steps checked off: next in line
      const list = [...(buildOrder.order.planets[key] ?? [])];
      let at = 0;
      while (at < list.length && list[at].done) at++;
      list.splice(at, 0, ...steps);
      await uniApi(uni.value, '/build-order', { method: 'PATCH', body: { planets: { ...buildOrder.order.planets, [key]: list } } });
    } else {
      const base = { planets: Object.fromEntries(props.hub.planets.map((p) => [p.key, levelsOf(p)])), research: research.value };
      await uniApi(uni.value, '/build-order', { method: 'PUT', body: { order: { base, planets: { [key]: steps } }, meta: { source: 'advisor' } } });
    }
    added.value = new Set([...added.value, a]);
  } catch (e) {
    message.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <p v-if="compact" class="small adv-best m-0">
    <template v-if="best">
      <span class="muted">{{ t('advisor.best') }}:</span> <b>{{ title(best) }}</b>
      <span class="muted"> · {{ t('advisor.paysBack', { time: payback(best.payback) }) }}</span>
      <button class="link small adv-open" @click="emit('open')">{{ t('advisor.more') }}</button>
    </template>
  </p>
  <div v-else class="card" data-tour="build-advisor">
    <div class="row small adv-head">
      <b>{{ t('advisor.title') }}</b>
      <Hint>
        <p>{{ t('advisor.hint1') }}</p>
        <p>{{ t('advisor.hint2', { rate: currentMarketRate() ? `${fmt(currentMarketRate()!.m, 2)} : ${fmt(currentMarketRate()!.k, 2)} : 1` : '3 : 2 : 1' }) }}</p>
      </Hint>
      <span class="grow" />
      <label class="check"><input v-model="onlyPlanet" type="checkbox" /> {{ t('advisor.onlyPlanet') }}</label>
    </div>
    <p v-if="message" class="error small">{{ message }}</p>
    <p v-if="!list.length" class="muted small m-0">{{ t('advisor.none') }}</p>
    <div v-else-if="mobile" class="adv-cards">
      <div v-for="(a, i) in shown" :key="i" class="adv-card small">
        <div><b>{{ title(a) }}</b> <span class="muted">· {{ planetName(a.key) }}</span></div>
        <div class="adv-line">
          <span>
            <b>{{ payback(a.payback) }}</b>
            <span class="muted" :title="costTitle(a)"> · {{ short(a.costValue) }} D</span>
            <span class="muted" :title="gainTitle(a)"> · +{{ short(a.gainValue) }} D/h</span>
          </span>
          <span v-if="added.has(a)" class="pos">{{ t('advisor.added') }}</span>
          <button v-else class="small" :disabled="!!busy" @click="addToOrder(a)">{{ t('advisor.add') }}</button>
        </div>
      </div>
    </div>
    <div v-else class="scroll-x">
      <table class="data">
        <thead>
          <tr>
            <th>{{ t('advisor.step') }}</th>
            <th>{{ t('buildings.planet') }}</th>
            <th class="num">{{ t('advisor.cost') }}</th>
            <th class="num">{{ t('advisor.gain') }}</th>
            <th class="num">{{ t('advisor.payback') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(a, i) in shown" :key="i">
            <td><b>{{ title(a) }}</b></td>
            <td class="small">{{ planetName(a.key) }}</td>
            <td class="num" :title="costTitle(a)">{{ short(a.costValue) }} D</td>
            <td class="num" :title="gainTitle(a)">+{{ short(a.gainValue) }} D/h</td>
            <td class="num"><b>{{ payback(a.payback) }}</b></td>
            <td>
              <span v-if="added.has(a)" class="pos small">{{ t('advisor.added') }}</span>
              <button v-else class="small" :disabled="!!busy" @click="addToOrder(a)">{{ t('advisor.add') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="list.length > LIMIT" class="link small" style="margin-top: 6px" @click="all = !all">
      {{ all ? t('fleetsave.less') : t('fleetsave.more', { n: list.length - LIMIT }) }}
    </button>
  </div>
</template>

<style scoped>
.adv-head { margin-bottom: 6px; }
.adv-best { margin-top: 8px; }
.adv-open { margin-left: 8px; }
.adv-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.adv-cards { display: flex; flex-direction: column; gap: 6px; }
.adv-card { display: flex; flex-direction: column; gap: 3px; padding: 8px; border-radius: 6px; background: var(--surface-2); }
</style>

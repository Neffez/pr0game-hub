<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { readError, uniApi } from '../api';
import type { Schema } from '../apiTypes';
import { useClock } from '../clock';
import { addToBuildOrder } from '../buildOrderAdd';
import { useStored, useUni } from '../composables';
import { abbr, ago, battleSimLink, dateTime, duration, fmt, name, short } from '../format';
import Hint from './Hint.vue';
import PlayerLink from './PlayerLink.vue';
import RaidRisk from './RaidRisk.vue';
import StatusBadges from './StatusBadges.vue';

/**
 * Defense advisor (server: repo/defense.ts, search: `defenseAdvice` of @pr0hub/battle): the attackers the hub knows for
 * the planet, the expected profit of their attack (loot + debris − losses − fuel, valued with the market rate), and
 * the defense that turns every chosen attack into a loss. Building is done in the game; the units can go into the
 * build order. "Compare with research" runs the search once more per next level of the combat research and shows what
 * each option costs the planet (research share + defense still needed).
 */
type Data = Schema<'DefenseAdvice'>;
type Threat = Schema<'DefenseThreat'>;
type Outcome = Schema<'ThreatOutcome'>;
type Res = Schema<'RiskResources'>;
/** the search result (`advice` without its `{ error }` case) */
type Advice = Schema<'DefenseSearchResult'>;
type ResearchOption = Schema<'ResearchOption'>;
type ResearchStep = Schema<'ResearchStep'>;
type Comparison = Extract<NonNullable<Data['researchAdvice']>, { error: null }>;
interface HubPlanet { key: string; type: 'planet' | 'moon'; planet: { values: Record<string, number> } }

const props = defineProps<{
  hub: { planets: HubPlanet[]; research: Record<string, number> };
  planetKey: string;
  mobile: boolean;
}>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const ships = useStored('defense.ships', true);
const debris = useStored('defense.debris', true);
const loot = useStored<'now' | 'full'>('defense.loot', 'now');
const share = useStored('defense.researchShare', true);

const data = ref<Data | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const running = ref(false);
/** threats left out by the viewer (per planet while the page is open) */
const off = ref(new Set<string>());
const advice = ref<Advice | null>(null);
const adviceError = ref<string | null>(null);
/** research comparison and the option taken into the result (its research step raises the planet's research) */
const comparing = ref(false);
const comparison = ref<Comparison | null>(null);
const comparisonError = ref<string | null>(null);
const takenStep = ref<ResearchStep | null>(null);
const busy = computed(() => running.value || comparing.value);
function resetResults() {
  advice.value = null;
  adviceError.value = null;
  comparison.value = null;
  comparisonError.value = null;
  takenStep.value = null;
}

const query = (sim: boolean, research = false) => {
  const q = new URLSearchParams({ planet: props.planetKey, ships: ships.value ? '1' : '0', debris: debris.value ? '1' : '0', loot: loot.value });
  if (!sim) q.set('sim', '0');
  else q.set('threats', chosen.value.map((x) => x.key).join(','));
  if (sim && research) {
    q.set('research', '1');
    q.set('share', share.value ? '1' : '0');
  }
  return `/defense-advice?${q}`;
};
/**
 * Requests of `load` and `calculate` are counted together (like `useLoader`): only the answer to the newest one is
 * applied, so a calculation that ends after the planet or an option changed cannot overwrite the new data.
 */
let latest = 0;
async function load() {
  const id = ++latest;
  loading.value = true;
  running.value = false;
  comparing.value = false;
  error.value = null;
  resetResults();
  try {
    const d = await uniApi<Schema<'DefenseAdvice'>>(uni.value, query(false));
    if (id === latest) data.value = d;
  } catch (e) {
    if (id !== latest) return;
    error.value = readError(e);
    data.value = null;
  } finally {
    if (id === latest) loading.value = false;
  }
}
watch(() => props.planetKey, () => (off.value = new Set()));
watch([() => props.planetKey, ships, debris, loot], load, { immediate: true });

const chosen = computed(() => (data.value?.threats ?? []).filter((x) => !off.value.has(x.key)));
function toggle(key: string) {
  if (busy.value) return;
  const next = new Set(off.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  off.value = next;
  resetResults();
}
watch(share, () => {
  comparison.value = null;
  comparisonError.value = null;
});
async function calculate() {
  if (!chosen.value.length) return;
  const id = ++latest;
  running.value = true;
  error.value = null;
  added.value = false;
  try {
    const d = await uniApi<Schema<'DefenseAdvice'>>(uni.value, query(true));
    if (id !== latest) return;
    data.value = d;
    takenStep.value = null;
    advice.value = d.advice && d.advice.error === null ? d.advice : null;
    adviceError.value = d.advice && d.advice.error !== null ? d.advice.error : null;
  } catch (e) {
    if (id === latest) error.value = readError(e);
  } finally {
    if (id === latest) running.value = false;
  }
}
async function compare() {
  if (!chosen.value.length) return;
  const id = ++latest;
  comparing.value = true;
  error.value = null;
  comparisonError.value = null;
  try {
    const d = await uniApi<Schema<'DefenseAdvice'>>(uni.value, query(true, true));
    if (id !== latest) return;
    const r = d.researchAdvice;
    comparison.value = r && r.error === null ? r : null;
    comparisonError.value = r && r.error !== null ? r.error : r ? null : 'no_steps';
  } catch (e) {
    if (id === latest) error.value = readError(e);
  } finally {
    if (id === latest) comparing.value = false;
  }
}
/** shows an option of the comparison as the result (build order, simulator link) */
function take(o: ResearchOption) {
  advice.value = o.advice;
  adviceError.value = null;
  takenStep.value = o.step;
  added.value = false;
}

// ---- display
const shipsText = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`).join(' · ');
const shipsTitle = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${name(id)}`).join('\n');
const RES = [['metal', 901], ['crystal', 902], ['deuterium', 903]] as const;
const resTitle = (r: Res) => RES.filter(([k]) => r[k]).map(([k, id]) => `${fmt(Math.round(r[k]))} ${name(id)}`).join('\n');
const clock = useClock();
/** an attack on its way lands at `last` (time left); the other kinds happened then */
const reasonText = (r: Threat['reasons'][number]) => {
  if (r.kind === 'incoming') return r.last && r.last > clock.value ? t('defense.reason.incomingIn', { time: duration(r.last - clock.value) }) : t('defense.reason.incoming');
  return t(`defense.reason.${r.kind}`, { n: r.count }) + (r.last ? ` · ${ago(r.last)}` : '');
};
/** statistics show clearly more fleet points than the fleet known: it may be larger now */
const grown = (x: Threat) => !!x.fleetPoints && x.fleetPoints.points > x.fleet.points * 1.3 + 10;
const outcomeOf = (list: Outcome[] | null | undefined, key: string) => list?.find((o) => o.key === key) ?? null;
const HEAVY = ':heavy';
/** the ways a threat attacks: full fleet, and heavy ships only when it has others too */
const variants = (x: Threat) => [{ key: x.key, heavy: false }, ...(x.heavy ? [{ key: `${x.key}${HEAVY}`, heavy: true }] : [])];
/** the result shows a variant (it was calculated) */
const shown = (key: string) => !!outcomeOf(advice.value?.before, key);
const profitText = (o: Outcome | null) => (o ? `${o.profit > 0 ? '+' : ''}${short(Math.round(o.profit))} ${t('common.deutShort')}` : '–');
const profitTitle = (o: Outcome | null) =>
  o
    ? [
        `${t('defense.loot')}: ${short(o.loot.metal)} / ${short(o.loot.crystal)} / ${short(o.loot.deuterium)}`,
        `${t('defense.debris')}: ${short(o.debris.metal)} / ${short(o.debris.crystal)}${debris.value ? '' : ` (${t('defense.notCounted')})`}`,
        `${t('defense.lost')}: ${short(o.lost.metal)} / ${short(o.lost.crystal)} / ${short(o.lost.deuterium)}`,
        `${t('defense.defenderLost')}: ${short(o.defenderLost.metal)} / ${short(o.defenderLost.crystal)} / ${short(o.defenderLost.deuterium)}`,
        `${t('defense.fuel')}: ${short(o.fuel)}`,
        `${t('defense.wins')}: ${fmt(o.wins * 100)} %`,
      ].join('\n')
    : '';
const rateText = computed(() => (data.value ? `${fmt(data.value.rate.m, 2)} : ${fmt(data.value.rate.k, 2)} : 1` : ''));
const addList = computed(() => Object.entries(advice.value?.add ?? {}).filter(([, n]) => n > 0).map(([id, n]) => ({ id: Number(id), n })));
const lootSum = computed(() => (data.value ? data.value.planet.resources.metal + data.value.planet.resources.crystal + data.value.planet.resources.deuterium : 0));

/** the strongest chosen attacker against the planet with the advice, in the battle simulator */
const simLink = computed(() => {
  const d = data.value;
  if (!d || !ctx.value) return null;
  const key = [...(advice.value?.after ?? advice.value?.before ?? [])].sort((a, b) => b.profit - a.profit)[0]?.key;
  const heavy = !!key?.endsWith(HEAVY);
  const x = d.threats.find((th) => th.key === key?.replace(HEAVY, '')) ?? chosen.value[0];
  if (!x) return null;
  const ships = heavy && x.heavy ? x.heavy.units : x.fleet.units;
  const research = takenStep.value ? { ...d.planet.research, ...d.research.levels, [takenStep.value.id]: takenStep.value.level } : d.planet.research;
  const values: Record<string, number> = { ...d.planet.units, ...research, 901: d.planet.resources.metal, 902: d.planet.resources.crystal, 903: d.planet.resources.deuterium };
  for (const [id, n] of Object.entries(advice.value?.add ?? {})) values[id] = (values[id] ?? 0) + n;
  const from = x.flight?.from ?? x.fleet.from;
  return battleSimLink(
    ctx.value.universe.settings, values, [{ ships, research: x.research.values, from: from ? [from.g, from.s, from.p] : null, name: x.player.name }],
    [d.planet.coords.g, d.planet.coords.s, d.planet.coords.p], [], d.planet.name,
  );
});

const stepText = (st: ResearchStep | null) => (st ? t('defense.research.step', { name: name(st.id), level: st.level }) : t('defense.research.defenseOnly'));
const unitsText = (add: Record<string, number>) => Object.entries(add).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`).join(' · ');
const stops = (o: ResearchOption) => o.advice.status === 'safe' || o.advice.status === 'found';

// ---- into the build order (planets only: build orders are per planet)
const adding = ref(false);
const added = ref(false);
async function addToOrder() {
  if (!addList.value.length) return;
  adding.value = true;
  error.value = null;
  try {
    const base = () => ({ planets: Object.fromEntries(props.hub.planets.map((p) => [p.key, { ...p.planet.values }])), research: { ...props.hub.research } });
    await addToBuildOrder(uni.value, props.planetKey, addList.value.map((a) => ({ kind: 'ship' as const, element: a.id, count: a.n })), base, 'defense');
    added.value = true;
  } catch (e) {
    error.value = readError(e);
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div class="card" data-tour="build-defense-risk">
    <div class="row small def-head">
      <b>{{ t('risk.title') }}</b>
      <Hint><p>{{ t('risk.hint1') }}</p><p>{{ t('risk.hint2') }}</p></Hint>
    </div>
    <RaidRisk auto :ships="ships" :debris="debris" :loot="loot" :current="planetKey" />
  </div>
  <div class="card" data-tour="build-defense">
    <div class="row small def-head">
      <b>{{ t('defense.title') }}</b>
      <Hint>
        <p>{{ t('defense.hint1') }}</p>
        <p>{{ t('defense.hint2', { rate: rateText || '3 : 2 : 1' }) }}</p>
        <p>{{ t('defense.hint3') }}</p>
      </Hint>
      <span class="grow" />
      <label class="check" :title="t('defense.shipsTitle')"><input v-model="ships" type="checkbox" :disabled="busy" /> {{ t('defense.ships') }}</label>
      <label class="check" :title="t('defense.debrisTitle')"><input v-model="debris" type="checkbox" :disabled="busy" /> {{ t('defense.countDebris') }}</label>
      <label>
        {{ t('defense.resources') }}
        <select v-model="loot" :disabled="busy">
          <option value="now">{{ t('defense.lootNow') }}</option>
          <option value="full">{{ t('defense.lootFull') }}</option>
        </select>
      </label>
    </div>
    <p v-if="error" class="error small">{{ error }}</p>
    <p v-if="loading && !data" class="muted small m-0">{{ t('common.loading') }}</p>
    <template v-if="data">
      <p class="small muted def-planet">
        {{ t('defense.planetNow', { value: short(data.planet.defenseValue), res: short(lootSum) }) }}
        <span class="faint">· {{ dateTime(data.planet.time) }}</span>
      </p>
      <p v-if="!data.threats.length" class="muted small m-0">{{ t('defense.noThreats') }}</p>

      <!-- threats: cards on mobile, a table on desktop -->
      <div v-else-if="mobile" class="def-cards" data-tour="build-defense-threats">
        <div v-for="x in data.threats" :key="x.key" class="def-card small" :class="{ off: off.has(x.key) }">
          <div class="def-line">
            <label class="check">
              <input type="checkbox" :checked="!off.has(x.key)" :disabled="busy" @change="toggle(x.key)" />
              <PlayerLink v-if="x.player.id" :id="x.player.id" :name="x.player.name" /><b v-else>{{ x.player.name }}</b>
            </label>
            <span v-if="x.player.allyTag" class="faint">[{{ x.player.allyTag }}]</span>
            <StatusBadges :status="x.player.status" />
            <span class="grow" />
          </div>
          <div v-for="v in variants(x).filter((v) => shown(v.key))" :key="v.key" class="def-line">
            <span class="muted">{{ v.heavy ? t('defense.heavyOnly') : t('defense.fullFleet') }}</span>
            <b>
              <span :class="outcomeOf(advice?.before, v.key)!.profit > 0 ? 'neg' : 'pos'" :title="profitTitle(outcomeOf(advice?.before, v.key))">{{ profitText(outcomeOf(advice?.before, v.key)) }}</span>
              <template v-if="advice?.after">
                → <span :class="(outcomeOf(advice.after, v.key)?.profit ?? 0) > 0 ? 'neg' : 'pos'" :title="profitTitle(outcomeOf(advice.after, v.key))">{{ profitText(outcomeOf(advice.after, v.key)) }}</span>
              </template>
            </b>
          </div>
          <div class="muted">{{ x.reasons.map(reasonText).join(' · ') }}</div>
          <div :title="shipsTitle(x.fleet.units)">{{ shipsText(x.fleet.units) }}</div>
          <div class="faint">
            {{ t(`defense.source.${x.fleet.source}`, { time: ago(x.fleet.time) }) }} · {{ short(x.fleet.points) }} {{ t('defense.points') }}
            <span v-if="grown(x)" class="warn"> · {{ t('defense.grown', { n: short(x.fleetPoints!.points) }) }}</span>
          </div>
          <div v-if="x.heavy" class="faint" :title="shipsTitle(x.heavy.units)">
            {{ t('defense.heavyOnly') }}: {{ shipsText(x.heavy.units) }}<template v-if="x.heavy.flight"> · {{ duration(x.heavy.flight.duration) }} · {{ short(x.heavy.flight.fuel) }} {{ abbr(903) }}</template>
          </div>
          <div v-if="!x.research.known || x.flight" class="faint">
            <span v-if="!x.research.known" class="warn">{{ t('defense.researchEstimated') }}</span>
            <template v-if="!x.research.known && x.flight"> · </template>
            <template v-if="x.flight">{{ duration(x.flight.duration) }} · {{ short(x.flight.fuel) }} {{ abbr(903) }}</template>
          </div>
        </div>
      </div>
      <div v-else class="scroll-x" data-tour="build-defense-threats">
        <table class="data">
          <thead>
            <tr>
              <th />
              <th>{{ t('defense.attacker') }}</th>
              <th class="num" :title="t('defense.profitTitle')">{{ t('defense.profit') }}</th>
              <th>{{ t('defense.why') }}</th>
              <th>{{ t('defense.fleet') }}</th>
              <th class="num">{{ t('defense.flight') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in data.threats" :key="x.key" :class="{ off: off.has(x.key) }">
              <td><input type="checkbox" :checked="!off.has(x.key)" :disabled="busy" :aria-label="x.player.name" @change="toggle(x.key)" /></td>
              <td>
                <PlayerLink v-if="x.player.id" :id="x.player.id" :name="x.player.name" /><b v-else>{{ x.player.name }}</b>
                <span v-if="x.player.allyTag" class="faint small"> [{{ x.player.allyTag }}]</span>
                <StatusBadges :status="x.player.status" />
              </td>
              <td class="num">
                <template v-if="shown(x.key)">
                  <div v-for="v in variants(x).filter((v) => shown(v.key))" :key="v.key" class="def-profit">
                    <div>
                      <span v-if="x.heavy" class="faint small">{{ v.heavy ? t('defense.heavyShort') : t('defense.fullShort') }} </span>
                      <b :class="outcomeOf(advice?.before, v.key)!.profit > 0 ? 'neg' : 'pos'" :title="profitTitle(outcomeOf(advice?.before, v.key))">{{ profitText(outcomeOf(advice?.before, v.key)) }}</b>
                    </div>
                    <div v-if="advice?.after" class="small" :title="profitTitle(outcomeOf(advice.after, v.key))">
                      → <span :class="(outcomeOf(advice.after, v.key)?.profit ?? 0) > 0 ? 'neg' : 'pos'">{{ profitText(outcomeOf(advice.after, v.key)) }}</span>
                    </div>
                  </div>
                </template>
                <span v-else class="faint">–</span>
              </td>
              <td class="small muted def-why">{{ x.reasons.map(reasonText).join(' · ') }}</td>
              <td class="small def-fleet">
                <div :title="shipsTitle(x.fleet.units)">{{ shipsText(x.fleet.units) }}</div>
                <div class="faint">
                  {{ t(`defense.source.${x.fleet.source}`, { time: ago(x.fleet.time) }) }} · {{ short(x.fleet.points) }} {{ t('defense.points') }}
                  <span v-if="grown(x)" class="warn" :title="dateTime(x.fleetPoints!.time)"> · {{ t('defense.grown', { n: short(x.fleetPoints!.points) }) }}</span>
                  <span v-if="!x.research.known" class="warn"> · {{ t('defense.researchEstimated') }}</span>
                </div>
                <div v-if="x.heavy" class="faint" :title="shipsTitle(x.heavy.units)">{{ t('defense.heavyOnly') }}: {{ shipsText(x.heavy.units) }}</div>
              </td>
              <td class="num small">
                <template v-if="x.flight">
                  <span class="mono">{{ duration(x.flight.duration) }}</span>
                  <div class="faint">{{ short(x.flight.fuel) }} {{ abbr(903) }}</div>
                  <div v-if="x.heavy?.flight" class="faint" :title="`${t('defense.heavyOnly')}: ${duration(x.heavy.flight.duration)}`">{{ t('defense.heavyShort') }} {{ short(x.heavy.flight.fuel) }} {{ abbr(903) }}</div>
                </template>
                <span v-else class="faint">–</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="data.threats.length" class="row def-actions">
        <button class="primary small" :disabled="busy || !chosen.length" data-tour="build-defense-run" @click="calculate">
          {{ running ? t('defense.running') : t('defense.run', { n: chosen.length }) }}
        </button>
        <button class="small" :disabled="busy || !chosen.length || !data.research.steps.length" :title="t('defense.research.runTitle')" data-tour="build-defense-research" @click="compare">
          {{ comparing ? t('defense.running') : t('defense.research.run') }}
        </button>
        <label v-if="data.research.planets > 1" class="check small" :title="t('defense.research.shareTitle')">
          <input v-model="share" type="checkbox" :disabled="busy" /> {{ t('defense.research.share', { n: data.research.planets }) }}
        </label>
        <Hint><p>{{ t('defense.research.hint1') }}</p><p>{{ t('defense.research.hint2') }}</p></Hint>
        <span v-if="busy" class="faint small">{{ t('defense.runningHint') }}</span>
      </div>

      <!-- research against defense -->
      <div v-if="comparison || comparisonError" class="def-result" data-tour="build-defense-research-result">
        <p v-if="comparisonError === 'no_steps'" class="muted small m-0">{{ t('defense.research.noSteps') }}</p>
        <p v-else-if="comparisonError" class="error small">{{ t('defense.error', { code: comparisonError }) }}</p>
        <template v-else-if="comparison">
          <p v-if="comparison.best == null" class="warn small">{{ t('defense.research.none') }}</p>
          <div class="scroll-x">
            <table class="data small">
              <thead>
                <tr>
                  <th>{{ t('defense.research.option') }}</th>
                  <th class="num">{{ t('defense.research.researchCost') }}</th>
                  <th>{{ t('defense.research.defense') }}</th>
                  <th class="num">{{ t('defense.research.total') }}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(o, i) in comparison.options" :key="i" :class="{ 'def-best': comparison.best === i }">
                  <td>
                    <b>{{ stepText(o.step) }}</b>
                    <span v-if="comparison.best === i" class="pos"> · {{ t('defense.research.best') }}</span>
                    <span v-else-if="!stops(o)" class="warn"> · {{ t('defense.research.notEnough') }}</span>
                  </td>
                  <td class="num">
                    <template v-if="o.step">
                      <span :title="resTitle(o.step.cost)">{{ short(Math.round(o.counted)) }} {{ t('common.deutShort') }}</span>
                      <div class="faint">
                        <template v-if="comparison.share < 1">{{ t('defense.research.shared', { share: fmt(comparison.share * 100, 0) }) }} · </template>
                        <template v-if="o.step.time != null">{{ duration(o.step.time) }}</template>
                      </div>
                    </template>
                    <span v-else class="faint">–</span>
                  </td>
                  <td class="def-fleet">
                    <span v-if="unitsText(o.advice.add)">{{ unitsText(o.advice.add) }}</span>
                    <span v-else class="faint">–</span>
                    <div v-if="o.advice.costValue > 0" class="faint" :title="resTitle(o.advice.cost)">{{ short(Math.round(o.advice.costValue)) }} {{ t('common.deutShort') }}</div>
                  </td>
                  <td class="num"><b>{{ short(Math.round(o.total)) }} {{ t('common.deutShort') }}</b></td>
                  <td><button class="small" :disabled="busy" @click="take(o)">{{ t('defense.research.take') }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="faint small m-0">{{ t('defense.research.basis') }}</p>
        </template>
      </div>

      <!-- result -->
      <div v-if="advice || adviceError" class="def-result" data-tour="build-defense-result">
        <p v-if="adviceError" class="error small">{{ t('defense.error', { code: adviceError }) }}</p>
        <template v-else-if="advice">
          <p v-if="takenStep" class="small"><b>{{ stepText(takenStep) }}</b> +</p>
          <p class="small" :class="advice.status === 'safe' || advice.status === 'found' ? 'pos' : 'warn'">{{ t(`defense.status.${advice.status}`) }}</p>
          <template v-if="addList.length">
            <div class="def-build">
              <div v-for="a in addList" :key="a.id" class="def-unit">
                <b>{{ fmt(a.n) }}×</b> {{ name(a.id) }}
              </div>
            </div>
            <p class="small">
              {{ t('defense.cost') }}: <b :title="resTitle(advice.cost)">{{ short(advice.cost.metal) }} / {{ short(advice.cost.crystal) }} / {{ short(advice.cost.deuterium) }}</b>
              <span class="muted"> · {{ short(Math.round(advice.costValue)) }} {{ t('common.deutShort') }}</span>
            </p>
            <div class="row small">
              <template v-if="data.planet.type === 'planet'">
                <span v-if="added" class="pos">{{ t('advisor.added') }}</span>
                <button v-else class="small" :disabled="adding" @click="addToOrder">{{ t('advisor.add') }}</button>
              </template>
              <a v-if="simLink" :href="simLink" target="_blank" rel="noopener">{{ t('attack.openSim') }}</a>
            </div>
          </template>
          <p class="faint small m-0">{{ t('defense.basis', { battles: fmt(advice.battles), runs: advice.runs }) }}</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.def-head { margin-bottom: 6px; flex-wrap: wrap; }
.def-planet { margin: 0 0 8px; }
.def-actions { margin-top: 8px; align-items: center; }
.def-result { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
.def-build { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 4px 0 6px; }
.def-cards { display: flex; flex-direction: column; gap: 6px; }
.def-card { display: flex; flex-direction: column; gap: 3px; padding: 8px; border-radius: 6px; background: var(--surface-2); }
.def-profit { white-space: nowrap; }
/* a large fleet wraps instead of pushing the flight out of view */
table.data td.def-fleet { white-space: normal; min-width: 220px; max-width: 420px; }
table.data td.def-why { white-space: normal; min-width: 120px; max-width: 220px; }
.def-profit + .def-profit { margin-top: 4px; }
.def-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.off { opacity: 0.5; }
tr.def-best td { background: var(--surface-2); }
</style>

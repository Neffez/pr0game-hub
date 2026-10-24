<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { parseCombatReportText } from '@pr0hub/core/combat';
import { CAPACITY } from '@pr0hub/flight';
import {
  battleFromReport, cleanState, MAX_HELPER_KEEP, decodeShare, localEpoch, lootShares, settle, type LootState, type Res, type SettlementResult, type TransferInput,
} from '@pr0hub/loot';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useUni } from '../composables';
import { abbr, coords, dateTime, fmt, lootCalcLink, name, short } from '../format';
import { tables, useLiveReload } from '../live';

/** Where the hub took a value of the draft from (server `DraftSources`). */
interface Sources {
  battles: { reportId: string | null; time: number | null; fleets: 'report' | 'plan' }[];
  returnLoot: Record<string, Record<number, Res>>;
  flightDeut: Record<string, number>;
  recycling: { by: string; time: number | null }[];
}
interface Saved {
  state: LootState;
  done: string[];
  updated_at: number;
  updated_by: string | null;
}
interface Response {
  plan: { id: number; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; target_time: number; status: string };
  can_edit: boolean;
  saved: Saved | null;
  draft: { state: LootState; sources: Sources };
  me: string;
}

const RES: (keyof Res)[] = ['m', 'k', 'd'];
const RES_IDS = { m: 901, k: 902, d: 903 } as const;

const { t } = useI18n();
const route = useRoute();
const { uni, ctx } = useUni();
const data = ref<Response | null>(null);
const state = ref<LootState | null>(null);
const dirty = ref(false);
const error = ref('');
const busy = ref(false);
const notice = ref('');
const linkText = ref('');
/** battles taken from a pasted report in this view (their draft source no longer applies) */
const pasted = ref(new Set<number>());
let filling = false;

const planId = computed(() => Number(route.params.id));
const clone = (s: LootState): LootState => JSON.parse(JSON.stringify(s));

function fill(s: LootState, isDirty = false) {
  filling = true;
  pasted.value = new Set();
  state.value = clone(s);
  dirty.value = isDirty;
  queueMicrotask(() => (filling = false));
}

async function load(force = false) {
  if (dirty.value && !force) return;
  try {
    data.value = await uniApi<Response>(uni.value, `/plans/${planId.value}/settlement`);
    fill(data.value.saved?.state ?? data.value.draft.state);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => load(true));
useLiveReload(() => load(), tables('raid_settlements', 'battle_reports', 'combat_reports', 'recycle_reports'));
watch(state, () => {
  if (!filling) dirty.value = true;
}, { deep: true });

const result = computed<SettlementResult | null>(() => (state.value ? settle(state.value) : null));
const canEdit = computed(() => !!data.value?.can_edit);
const sources = computed(() => data.value?.draft.sources ?? null);
const people = computed(() => (state.value ? [...state.value.participants, ...state.value.helpers] : []));
const personName = (id: string) => people.value.find((p) => p.id === id)?.name || '?';
const cargoName = computed(() => name(state.value?.settings.cargoShip ?? 203));

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  notice.value = '';
  try {
    await fn();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(async () => {
    const saved = await uniApi<Saved>(uni.value, `/plans/${planId.value}/settlement`, { method: 'PUT', body: { state: state.value } });
    data.value = { ...data.value!, saved };
    fill(saved.state);
    notice.value = t('loot.saved');
  });

function refill() {
  if (data.value?.saved && !confirm(t('loot.fromHubConfirm'))) return;
  fill(data.value!.draft.state, true);
}

const remove = () =>
  confirm(t('loot.deleteConfirm')) &&
  run(async () => {
    await uniApi(uni.value, `/plans/${planId.value}/settlement`, { method: 'DELETE' });
    await load(true);
  });

function importLink() {
  const m = linkText.value.match(/#s=([\w-]+)/);
  const s = m ? decodeShare(m[1]) : null;
  if (!s) {
    error.value = t('loot.importFailed');
    return;
  }
  fill(cleanState(s), true);
  linkText.value = '';
  error.value = '';
}

const calcLink = computed(() => (state.value && ctx.value ? lootCalcLink(ctx.value.universe.settings, state.value) : ''));

// ---- battle reports pasted here ----
const reportText = ref('');
/** battle to replace (index), -1: add a new battle */
const reportTarget = ref(-1);
function applyReport() {
  const report = parseCombatReportText(reportText.value, null);
  if (!report || !state.value) {
    error.value = t('loot.pasteFailed');
    return;
  }
  // attackers without a hub account join as guests ("g<n>"), as on plans
  const { battle, skipped } = battleFromReport(state.value, report, localEpoch, 'g');
  const i = reportTarget.value >= 0 && reportTarget.value < state.value.battles.length ? reportTarget.value : state.value.battles.length;
  state.value.battles[i] = battle;
  pasted.value = new Set([...pasted.value, i]);
  reportText.value = '';
  reportTarget.value = -1;
  error.value = skipped.length ? t('loot.pasteSkipped', { names: skipped.join(', ') }) : '';
}

// ---- battles ----
/** Loot per participant of a battle by cargo space (or the known loot of its fleet). */
const shares = computed(() => state.value?.battles.map((b) => lootShares(b)) ?? []);
const lost = (start: Record<number, number>, end: Record<number, number>) =>
  Object.entries(start)
    .map(([id, n]) => ({ id: Number(id), n: n - (end[Number(id)] ?? 0) }))
    .filter((x) => x.n > 0);
const shipsText = (ships: Record<number, number>) =>
  Object.entries(ships)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${fmt(n)} ${name(id)}`)
    .join(', ');

// ---- deliveries ----
const transfers = computed<TransferInput[]>(() => state.value?.transfers ?? result.value?.transfers ?? []);
const keyOf = (x: TransferInput) => `${x.from}>${x.to}`;
const done = computed(() => new Set(data.value?.saved?.done ?? []));
const shipsFor = (r: Res) => {
  const cap = CAPACITY[state.value?.settings.cargoShip ?? 203] ?? 25000;
  return Math.ceil((r.m + r.k + r.d) / cap);
};
const mayTick = (x: TransferInput) => !!data.value?.saved && !dirty.value && (canEdit.value || x.from === data.value.me || x.to === data.value.me);
const tick = (x: TransferInput, checked: boolean) =>
  run(async () => {
    const res = await uniApi<{ done: string[] }>(uni.value, `/plans/${planId.value}/settlement/done`, { method: 'PUT', body: { key: keyOf(x), done: checked } });
    data.value!.saved!.done = res.done;
  });
const resText = (r: Res) =>
  RES.filter((k) => r[k] > 0)
    .map((k) => `${short(r[k])} ${name(RES_IDS[k])}`)
    .join(', ');
const transferText = computed(() =>
  transfers.value
    .filter((x) => x.res.m + x.res.k + x.res.d > 0)
    .map((x) => `${personName(x.from)} → ${personName(x.to)}: ${resText(x.res)} (${shipsFor(x.res)} ${cargoName.value})`)
    .join('\n'),
);
const copyText = () => navigator.clipboard?.writeText(transferText.value).then(() => (notice.value = t('loot.copied')));

const target = computed(() => {
  const p = data.value?.plan;
  return p && p.g != null ? coords(p.g, p.s!, p.p!) + (p.planet_type === 'moon' ? ' (M)' : '') : '';
});
const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;
</script>

<template>
  <p><RouterLink :to="`/${uni}/raid-planner`">{{ t('loot.back') }}</RouterLink></p>
  <h1>
    {{ t('loot.title') }}
    <span v-if="data" class="muted small" style="font-weight: 400">{{ target }} · {{ dateTime(data.plan.target_time) }}</span>
  </h1>
  <p class="muted small">{{ t('loot.intro') }}</p>
  <div v-if="error" class="error">{{ error }}</div>

  <template v-if="data && state && result">
    <div class="card row bar">
      <span v-if="data.saved && !dirty" class="small">{{ t('loot.savedBy', { name: data.saved.updated_by ?? '?', time: dateTime(data.saved.updated_at) }) }}</span>
      <span v-else class="small warn">{{ t('loot.draft') }}</span>
      <span v-if="notice" class="small ok">{{ notice }}</span>
      <span class="grow" />
      <template v-if="canEdit">
        <button class="primary" :disabled="busy || (!dirty && !!data.saved)" @click="save">{{ t('loot.save') }}</button>
        <button :disabled="busy" @click="refill">{{ t('loot.fromHub') }}</button>
        <button v-if="data.saved" class="danger" :disabled="busy" @click="remove">{{ t('common.delete') }}</button>
      </template>
      <a v-if="calcLink" class="small" :href="calcLink" target="_blank" rel="noopener">{{ t('loot.calculator') }} ↗</a>
    </div>
    <p v-if="!canEdit" class="muted small">{{ t('loot.readOnly') }}</p>
    <div v-else class="row small import">
      <input v-model="linkText" :placeholder="t('loot.importLink')" @keydown.enter="importLink" />
      <button :disabled="!linkText" @click="importLink">{{ t('common.apply') }}</button>
      <Hint>{{ t('loot.calculatorHint') }}</Hint>
    </div>

    <div class="cols">
      <div class="col">
        <div class="card">
          <h3>{{ t('loot.settings') }}</h3>
          <fieldset :disabled="!canEdit" class="stack">
            <label class="row">
              <span class="lbl">{{ t('loot.mode') }} <Hint>{{ t('loot.modeHint') }}</Hint></span>
              <select v-model="state.settings.mode">
                <option value="equal">{{ t('loot.modeEqual') }}</option>
                <option value="investment">{{ t('loot.modeInvest') }}</option>
              </select>
            </label>
            <div class="row">
              <span class="lbl">{{ t('loot.rates') }}</span>
              <label>{{ name(901) }} <input v-model.number="state.settings.rates.m" type="number" step="0.1" min="0.1" /></label>
              <label>{{ name(902) }} <input v-model.number="state.settings.rates.k" type="number" step="0.1" min="0.1" /></label>
            </div>
            <label class="row">
              <span class="lbl">{{ t('loot.deficit') }} <Hint>{{ t('loot.deficitHint') }}</Hint></span>
              <input
                type="number" min="0" max="100" :value="Math.round(state.settings.deficitMetalShare * 100)"
                @input="state.settings.deficitMetalShare = Math.min(100, Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)) / 100"
              />
            </label>
            <label class="row">
              <span class="lbl">{{ t('loot.cargo') }}</span>
              <select v-model.number="state.settings.cargoShip">
                <option :value="202">{{ name(202) }}</option>
                <option :value="203">{{ name(203) }}</option>
              </select>
            </label>
          </fieldset>
        </div>

        <div class="card">
          <h3>{{ t('loot.participants') }}</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>{{ t('common.name') }}</th><th class="num">{{ t('loot.flightDeut') }}</th><th class="num">{{ t('loot.recDeut') }}</th><th class="num">{{ t('loot.missiles') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in state.participants" :key="p.id">
                  <td>{{ p.name }}</td>
                  <td class="num">
                    <input v-model.number="p.flightDeut" type="number" min="0" :disabled="!canEdit" />
                    <span v-if="sources?.flightDeut[p.id] != null && sources.flightDeut[p.id] === p.flightDeut" class="src" :title="t('loot.fromPlan')">✓</span>
                  </td>
                  <td class="num"><input v-model.number="p.recDeut" type="number" min="0" :disabled="!canEdit" /></td>
                  <td class="num"><input v-model.number="p.missiles" type="number" min="0" :disabled="!canEdit" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>{{ t('loot.battles') }}</h3>
          <p v-if="!state.battles.length" class="muted small">{{ t('loot.noBattles') }}</p>
          <div v-for="(b, i) in state.battles" :key="i" class="battle">
            <div class="row small">
              <b>{{ t('loot.battle', { n: i + 1 }) }}</b>
              <span class="muted">{{ dateTime(b.time) }}</span>
              <span v-if="pasted.has(i)" class="muted">{{ t('loot.fromPasted') }}</span>
              <template v-else-if="sources?.battles[i]">
                <RouterLink v-if="sources.battles[i].reportId" :to="`/${uni}/battle-hall/${sources.battles[i].reportId}`">{{ t('loot.report') }}</RouterLink>
                <span :class="sources.battles[i].fleets === 'report' ? 'muted' : 'warn'">
                  {{ sources.battles[i].fleets === 'report' ? t('loot.fromReport') : t('loot.fromPlanShips') }}
                </span>
              </template>
            </div>
            <div class="row small">
              <span class="lbl">{{ t('loot.lootTotal') }}</span>
              <label v-for="k in RES" :key="k">{{ name(RES_IDS[k]) }} <input v-model.number="b.loot[k]" type="number" min="0" :disabled="!canEdit" /></label>
            </div>
            <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>{{ t('loot.lootShare') }}</th><th>{{ t('loot.lost') }}</th><th v-for="k in RES" :key="k" class="num">{{ name(RES_IDS[k]) }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="f in b.fleets" :key="f.participant">
                  <td :title="shipsText(f.start)">{{ personName(f.participant) }}</td>
                  <td class="small neg">{{ lost(f.start, f.end).map((x) => `${fmt(x.n)} ${name(x.id)}`).join(', ') }}</td>
                  <td v-for="k in RES" :key="k" class="num">
                    {{ fmt(shares[i]?.get(f.participant)?.[k] ?? 0) }}
                    <span v-if="f.loot && k === 'm'" class="src" :title="t('loot.fromFleet')">✓</span>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <div v-if="canEdit" class="card">
          <h3>{{ t('loot.pasteReport') }} <Hint>{{ t('loot.pasteHint') }}</Hint></h3>
          <textarea v-model="reportText" class="report" :placeholder="t('loot.pastePlaceholder')" />
          <div class="row small" style="gap: 8px; margin-top: 6px">
            <select v-model.number="reportTarget">
              <option :value="-1">{{ t('loot.newBattle') }}</option>
              <option v-for="(_, i) in state.battles" :key="i" :value="i">{{ t('loot.replaceBattle', { n: i + 1 }) }}</option>
            </select>
            <button :disabled="!reportText.trim()" @click="applyReport">{{ t('common.apply') }}</button>
          </div>
        </div>

        <div class="card">
          <h3>{{ t('loot.recycling') }}</h3>
          <p v-if="!state.recycling.length" class="muted small">{{ t('loot.noRecycling') }}</p>
          <table v-else class="data">
            <tbody>
              <tr v-for="(r, i) in state.recycling" :key="i">
                <td>{{ personName(r.by) }}</td>
                <td class="num">{{ fmt(r.m) }} {{ name(901) }}</td>
                <td class="num">{{ fmt(r.k) }} {{ name(902) }}</td>
                <td class="muted small">{{ dateTime(sources?.recycling[i]?.time) }}</td>
              </tr>
            </tbody>
          </table>
          <template v-if="state.helpers.length">
            <h3>{{ t('loot.helpers') }} <Hint>{{ t('loot.helpersHint') }}</Hint></h3>
            <table class="data">
              <thead>
                <tr><th>{{ t('common.name') }}</th><th class="num">{{ t('loot.keepPct') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="h in state.helpers" :key="h.id">
                  <td>{{ h.name }}</td>
                  <td class="num"><input v-model.number="h.keepPct" type="number" min="0" :max="MAX_HELPER_KEEP" :disabled="!canEdit" /></td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>

      <div class="col">
        <div class="card">
          <h3>{{ t('loot.result') }}</h3>
          <div class="kpis">
            <div v-for="[label, r] in ([[t('loot.pot'), result.pot], [t('loot.costs'), result.costs], [t('loot.profit'), result.profit]] as [string, Res][])" :key="label" class="kpi">
              <span class="muted small">{{ label }}</span>
              <b class="mono">{{ short(r.m + r.k + r.d) }}</b>
              <span class="faint small mono">{{ short(r.m) }} · {{ short(r.k) }} · {{ short(r.d) }}</span>
            </div>
            <div class="kpi">
              <span class="muted small">{{ t('loot.coverage') }}</span>
              <b class="mono">{{ pct(result.coverage) }}</b>
            </div>
          </div>
          <p v-if="result.coverage < 1" class="warn small">{{ t('loot.notCovered') }}</p>
          <p v-if="result.rateWarnings.length" class="warn small">{{ t('loot.rateWarning') }}</p>
          <p v-if="result.deadline" class="muted small">{{ t('loot.deadline', { time: dateTime(result.deadline) }) }}</p>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th />
                  <th />
                  <th class="num">{{ t('loot.holds') }}</th>
                  <th class="num">{{ t('loot.costs') }}</th>
                  <th class="num">{{ t('loot.covered') }}</th>
                  <th class="num">{{ t('loot.entitled') }}</th>
                  <th class="num">{{ t('loot.balance') }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="p in result.people" :key="p.id">
                  <tr v-for="(k, j) in RES" :key="k" :class="{ first: j === 0 }">
                    <td v-if="j === 0" rowspan="3">
                      <b>{{ p.name }}</b>
                      <div class="muted small">{{ p.role === 'helper' ? t('loot.helper') : `${t('loot.share')} ${pct(p.share)}` }}</div>
                    </td>
                    <td class="faint small">{{ name(RES_IDS[k]) }}</td>
                    <td class="num">{{ fmt(p.holds[k]) }}</td>
                    <td class="num">{{ fmt(p.costs[k]) }}</td>
                    <td class="num">{{ fmt(p.covered[k]) }}</td>
                    <td class="num">{{ fmt(p.entitled[k]) }}</td>
                    <td class="num" :class="{ pos: p.balance[k] > 0, neg: p.balance[k] < 0, faint: !p.balance[k] }">
                      {{ p.balance[k] > 0 ? '+' : '' }}{{ fmt(p.balance[k]) }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>{{ t('loot.transfers') }} <Hint>{{ t('loot.doneHint') }}</Hint></h3>
          <p v-if="!transfers.length" class="muted small">{{ t('loot.noTransfers') }}</p>
          <div v-else class="table-wrap">
          <table class="data">
            <tbody>
              <tr v-for="x in transfers" :key="keyOf(x)" :class="{ dim: done.has(keyOf(x)) }">
                <td>
                  <label class="tick">
                    <input type="checkbox" :checked="done.has(keyOf(x))" :disabled="busy || !mayTick(x)" @change="tick(x, ($event.target as HTMLInputElement).checked)" />
                    {{ t('loot.sends', { from: personName(x.from), to: personName(x.to) }) }}
                  </label>
                </td>
                <td v-for="k in RES" :key="k" class="num">{{ x.res[k] ? `${fmt(x.res[k])} ${name(RES_IDS[k])}` : '' }}</td>
                <td class="num faint">{{ t('loot.ships', { n: shipsFor(x.res), ship: abbr(state.settings.cargoShip) }) }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <div v-if="transfers.length" class="row" style="margin-top: 8px">
            <button @click="copyText">{{ t('loot.copy') }}</button>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.bar { gap: 10px; flex-wrap: wrap; }
.import { gap: 6px; margin: 0 0 12px; }
.import input { flex: 1; min-width: 200px; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 16px; }
@media (min-width: 1200px) { .cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } }
.col { min-width: 0; }
h3 { margin: 0 0 8px; }
fieldset { border: 0; padding: 0; margin: 0; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.lbl { min-width: 190px; color: var(--muted); font-size: 13px; }
.battle + .battle { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }
.battle .row { gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.src { color: var(--ok); margin-left: 4px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 10px; }
.kpi { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
tr.first td { border-top: 2px solid var(--border); }
textarea.report { width: 100%; min-height: 90px; font-family: var(--mono); font-size: 12px; }
.tick { display: inline-flex; align-items: center; gap: 6px; }
</style>

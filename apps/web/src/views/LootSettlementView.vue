<script setup lang="ts">
import Section from '../components/Section.vue';
import PageHeader from '../components/PageHeader.vue';
import Icon from '../components/Icon.vue';
import BackLink from '../components/BackLink.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { localToEpoch, parseCombatReportText, parseRecycleReportsText } from '@pr0hub/core/combat';
import { CAPACITY } from '@pr0hub/flight';
import {
  adoptKeys, battleFromReport, cleanState, debrisSummary, decodeShare, diffOverrides, lootShares, marketRates, MAX_HELPER_KEEP, overriddenPaths, settle,
  type Battle, type LootState, type Overrides, type Res, type SettlementResult, type StateChanges, type TransferInput,
} from '@pr0hub/loot';
import { uniApi } from '../api';
import CommentThread from '../components/CommentThread.vue';
import Hint from '../components/Hint.vue';
import { useMobile, useUni, vStack } from '../composables';
import { abbr, coords, dateTime, fmt, lootCalcLink, name, rateText, short } from '../format';
import { tables, useLiveReload } from '../live';

/** Where the hub took a value of the draft from (server `DraftSources`). */
interface Sources {
  battles: { key: string; reportId: string | null; time: number | null; fleets: 'report' | 'plan' }[];
  returnLoot: Record<string, Record<number, Res>>;
  returnSource?: Record<string, 'message' | 'overview'>;
  flightDeut: Record<string, number>;
  recycling: { by: string; time: number | null }[];
}
/** `GET /plans/:id/settlement`: the draft from the hub's data, the corrections on top, or the finalized state. */
interface Response {
  plan: { id: number; mission: 'attack' | 'hold'; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; target_time: number; status: string };
  can_edit: boolean;
  me: string;
  draft: { state: LootState; sources: Sources };
  /** what the hub's data covers, what members still have to sync */
  checks: { battle: 'report' | 'plan' | 'missing'; returns: Record<string, 'message' | 'overview' | 'missing'>; recycling: 'ok' | 'none' | 'gap' | 'n/a'; missing: number };
  overrides: Overrides | null;
  corrected: { updated_at: number; updated_by: string | null } | null;
  finalized: { at: number; by: string | null; live: LootState; changes: StateChanges } | null;
  state: LootState;
  done: string[];
}

const RES: (keyof Res)[] = ['m', 'k', 'd'];
const RES_IDS = { m: 901, k: 902, d: 903 } as const;
/** Rows of a person's result on mobile (resources as columns there). */
const RESULT_ROWS = ['holds', 'costs', 'covered', 'entitled', 'balance'] as const;
const mobile = useMobile();

const { t } = useI18n();
const route = useRoute();
const { uni, ctx } = useUni();
const data = ref<Response | null>(null);
const state = ref<LootState | null>(null);

/** The group's market rate (marketplace sync or set by hand) as the settlement's rates, also as the reference. */
const market = computed(() => ctx.value?.marketRate ?? null);
function takeMarketRate() {
  if (!state.value || !market.value) return;
  state.value.settings.refRates = { m: market.value.m, k: market.value.k, d: 1 };
  state.value.settings.rates = marketRates(state.value.settings.refRates);
}
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

/** New hub data while editing: shown, taken in once the corrections are saved or discarded. */
const stale = ref(false);
async function load(force = false) {
  if (dirty.value && !force) {
    stale.value = true;
    return;
  }
  try {
    show(await uniApi<Response>(uni.value, `/plans/${planId.value}/settlement`));
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function show(res: Response) {
  data.value = res;
  stale.value = false;
  fill(res.state);
}
onMounted(() => load(true));
useLiveReload(() => load(), tables('raid_settlements', 'battle_reports', 'combat_reports', 'recycle_reports', 'fleet_returns'));
watch(state, () => {
  if (!filling) dirty.value = true;
}, { deep: true });

const result = computed<SettlementResult | null>(() => (state.value ? settle(state.value) : null));
const canEdit = computed(() => !!data.value?.can_edit);
const finalized = computed(() => data.value?.finalized ?? null);
/** values can be corrected: by participants, creator and admins, while the settlement is not finalized */
const editing = computed(() => canEdit.value && !finalized.value);
const draftState = computed(() => data.value?.draft.state ?? null);
/** corrections made by hand (also those not saved yet), as field paths */
const manual = computed(() => (state.value && draftState.value && !finalized.value ? overriddenPaths(diffOverrides(draftState.value, state.value)) : new Set<string>()));
const hasCorrections = computed(() => manual.value.size > 0 || !!data.value?.corrected);
const checks = computed(() => data.value?.checks ?? null);
const checkName = (id: string) => draftPerson(id)?.name ?? '?';
const changeCount = computed(() => {
  const c = finalized.value?.changes;
  return c ? c.people + c.battles + c.recycling + c.settings : 0;
});
const draftPerson = (id: string) => [...(draftState.value?.participants ?? []), ...(draftState.value?.helpers ?? [])].find((p) => p.id === id);
/** A participant's or helper's value in the hub's data. */
const draftValue = (id: string, field: 'flightDeut' | 'recDeut' | 'missiles' | 'keepPct') => ((draftPerson(id) as Record<string, unknown> | undefined)?.[field] as number | undefined) ?? 0;
const draftBattle = (b: Battle) => draftState.value?.battles.find((x) => x.key && x.key === b.key);
const battleSource = (b: Battle) => (b.key ? sources.value?.battles.find((x) => x.key === b.key) : undefined);
/** Back to the hub's value of a participant's field. */
function resetPerson(id: string, field: 'flightDeut' | 'recDeut' | 'missiles' | 'keepPct') {
  const p = [...(state.value?.participants ?? []), ...(state.value?.helpers ?? [])].find((x) => x.id === id) as Record<string, unknown> | undefined;
  if (p && draftPerson(id)) p[field] = draftValue(id, field);
}
function resetLoot(b: Battle) {
  const d = draftBattle(b);
  if (d) b.loot = { ...d.loot };
}
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

const url = () => `/plans/${planId.value}/settlement`;
/** Saves the corrections (only what differs from the hub's data is stored). */
const save = () =>
  run(async () => {
    show(await uniApi<Response>(uni.value, url(), { method: 'PUT', body: { state: state.value } }));
    notice.value = t('loot.saved');
  });
const discard = () => load(true);

/** Freezes the settlement for the deliveries (unsaved corrections are saved with it). */
const finalize = () =>
  confirm(t('loot.finalizeConfirm')) &&
  run(async () => {
    show(await uniApi<Response>(uni.value, `${url()}/finalize`, { method: 'POST', body: dirty.value ? { state: state.value } : {} }));
  });
const reopen = () =>
  confirm(t('loot.reopenConfirm')) &&
  run(async () => {
    show(await uniApi<Response>(uni.value, `${url()}/finalize`, { method: 'DELETE' }));
  });

/** Drops all corrections (and a finalized state): the settlement follows the hub's data alone. */
const reset = () =>
  confirm(t('loot.resetConfirm')) &&
  run(async () => {
    await uniApi(uni.value, url(), { method: 'DELETE' });
    await load(true);
  });

function importLink() {
  const m = linkText.value.match(/#s=([\w-]+)/);
  const s = m ? decodeShare(m[1]) : null;
  if (!s) {
    error.value = t('loot.importFailed');
    return;
  }
  // battles and recycling rows the hub knows keep following its data
  fill(draftState.value ? adoptKeys(draftState.value, cleanState(s)) : cleanState(s), true);
  linkText.value = '';
  error.value = '';
}

const calcLink = computed(() => (state.value && ctx.value ? lootCalcLink(ctx.value.universe.settings, state.value) : ''));

/** Game time of a pasted report in the universe's time zone, as the server reads synced reports (same battle, same instant). */
const gameEpoch = (local: string | null) => (local ? localToEpoch(local, ctx.value?.universe.settings.timezone) : null);

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
  // a hold: the defenders settle (no loot of theirs, the debris covers their losses)
  const side = data.value?.plan.mission === 'hold' ? 'defender' : 'attacker';
  const { battle, skipped } = battleFromReport(state.value, report, gameEpoch, 'g', side);
  const i = reportTarget.value >= 0 && reportTarget.value < state.value.battles.length ? reportTarget.value : state.value.battles.length;
  // replacing a battle of the hub: a correction of that battle
  const key = state.value.battles[i]?.key;
  state.value.battles[i] = key ? { ...battle, key } : battle;
  pasted.value = new Set([...pasted.value, i]);
  reportText.value = '';
  reportTarget.value = -1;
  error.value = skipped.length ? t('loot.pasteSkipped', { names: skipped.join(', ') }) : '';
}

// ---- debris field ----
/** How much of the field was recycled, what is left, and what others took of an emptied field. */
const debris = computed(() => (state.value ? debrisSummary(state.value) : null));
const debrisText = (d: { m: number; k: number }) => `${fmt(d.m)} ${name(901)} · ${fmt(d.k)} ${name(902)}`;

// ---- recycling reports pasted here ----
const recycleText = ref('');
const recycleBy = ref('');
/** who may have recycled: the settlement's people, then the other members (they join as helpers) */
const recyclers = computed(() => [
  ...people.value.map((p) => ({ id: p.id, name: p.name })),
  ...(ctx.value?.members ?? []).map((m) => ({ id: `u${m.id}`, name: m.name })).filter((m) => !people.value.some((p) => p.id === m.id)),
]);
// the viewer by default, else the first one
watch(recyclers, (list) => {
  if (!list.some((r) => r.id === recycleBy.value)) recycleBy.value = list.find((r) => r.id === data.value?.me)?.id ?? list[0]?.id ?? '';
}, { immediate: true });
function applyRecycling() {
  const reports = parseRecycleReportsText(recycleText.value);
  const s = state.value;
  const who = recyclers.value.find((r) => r.id === recycleBy.value) ?? recyclers.value[0];
  if (!reports.length || !s || !who) {
    error.value = t('loot.recyclePasteFailed');
    return;
  }
  if (!people.value.some((p) => p.id === who.id)) s.helpers.push({ id: who.id, name: who.name, keepPct: 20, recDeut: 0 });
  for (const r of reports) s.recycling.push({ by: who.id, m: r.metal, k: r.crystal, field: { m: r.totalMetal, k: r.totalCrystal }, time: gameEpoch(r.time) });
  recycleText.value = '';
  error.value = '';
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
const done = computed(() => new Set(data.value?.done ?? []));
const shipsFor = (r: Res) => {
  const cap = CAPACITY[state.value?.settings.cargoShip ?? 203] ?? 25000;
  return Math.ceil((r.m + r.k + r.d) / cap);
};
const mayTick = (x: TransferInput) => !!finalized.value && (canEdit.value || x.from === data.value?.me || x.to === data.value?.me);
const tick = (x: TransferInput, checked: boolean) =>
  run(async () => {
    const res = await uniApi<{ done: string[] }>(uni.value, `${url()}/done`, { method: 'PUT', body: { key: keyOf(x), done: checked } });
    data.value!.done = res.done;
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
/** the viewer's deliveries not ticked off yet (finalized settlement) */
const myOpen = computed(() =>
  finalized.value ? transfers.value.filter((x) => (x.from === data.value?.me || x.to === data.value?.me) && x.res.m + x.res.k + x.res.d > 0 && !done.value.has(keyOf(x))) : [],
);
const copyText = () => navigator.clipboard?.writeText(transferText.value).then(() => (notice.value = t('loot.copied')));

const target = computed(() => {
  const p = data.value?.plan;
  return p && p.g != null ? coords(p.g, p.s!, p.p!) + (p.planet_type === 'moon' ? ' (M)' : '') : '';
});
const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;
</script>

<template>
  <BackLink :to="`/${uni}/raid-planner?tab=settlements`" :label="t('loot.back')" />
  <PageHeader :title="t('loot.title')">
    <template #hint>
      <span v-if="data" class="muted small" style="font-weight: 400">{{ target }} · {{ dateTime(data.plan.target_time) }}</span>
      <span v-if="data?.plan.mission === 'hold'" class="badge" style="margin-left: 6px">{{ t('hold.badge') }}</span>
    </template>
  </PageHeader>
  <p class="muted small">{{ data?.plan.mission === 'hold' ? t('loot.introHold') : t('loot.intro') }} {{ t('loot.introSync') }}</p>
  <div v-if="error" class="error">{{ error }}</div>
  <p v-if="route.query.existing" class="small warn">{{ t('loot.existingPlan') }}</p>

  <template v-if="data && state && result">
    <div class="card bar" :class="finalized ? 'final' : 'live'">
      <div class="row bar-row">
        <span v-if="finalized" class="badge ok-badge"><Icon name="check" :size="12" /> {{ t('loot.finalizedBadge') }}</span>
        <span v-else class="badge live-badge"><Icon name="sync" :size="12" /> {{ t('loot.liveBadge') }}</span>
        <span v-if="finalized" class="small">{{ t('loot.finalizedBy', { name: finalized.by ?? '?', time: dateTime(finalized.at) }) }}</span>
        <span v-else class="small muted">{{ t('loot.liveHint') }}</span>
        <span v-if="notice" class="small ok">{{ notice }}</span>
        <span class="grow" />
        <template v-if="canEdit">
          <template v-if="!finalized">
            <button v-if="dirty" class="primary" :disabled="busy" @click="save">{{ t('loot.saveCorrections') }}</button>
            <button v-if="dirty" :disabled="busy" @click="discard">{{ t('loot.discard') }}</button>
            <button :class="{ primary: !dirty }" :disabled="busy" :title="t('loot.finalizeHint')" @click="finalize">{{ t('loot.finalize') }}</button>
          </template>
          <button v-else :disabled="busy" :title="t('loot.reopenHint')" @click="reopen">{{ t('loot.reopen') }}</button>
          <button v-if="hasCorrections || finalized" class="danger" :disabled="busy" :title="t('loot.resetHint')" @click="reset">{{ t('loot.reset') }}</button>
        </template>
        <a v-if="calcLink" class="small" :href="calcLink" target="_blank" rel="noopener">{{ t('loot.calculator') }} <Icon name="external" :size="12" /></a>
      </div>
      <p v-if="finalized && changeCount" class="small warn">
        <Icon name="warning" :size="14" /> {{ t('loot.changedSince', { n: changeCount }, changeCount) }}
        <button v-if="canEdit" class="link" :disabled="busy" @click="reopen">{{ t('loot.reopen') }}</button>
      </p>
      <p v-if="stale" class="small warn"><Icon name="warning" :size="14" /> {{ t('loot.staleWhileEditing') }}</p>
      <p v-if="!finalized && data.corrected && !dirty" class="small muted">{{ t('loot.correctedBy', { name: data.corrected.updated_by ?? '?', time: dateTime(data.corrected.updated_at) }) }}</p>
    </div>
    <p v-if="!canEdit" class="muted small">{{ t('loot.readOnly') }}</p>
    <div v-else-if="editing" class="row small import">
      <input v-model="linkText" :placeholder="t('loot.importLink')" @keydown.enter="importLink" />
      <button :disabled="!linkText" @click="importLink">{{ t('common.apply') }}</button>
      <Hint>{{ t('loot.calculatorHint') }}</Hint>
    </div>

    <Section v-if="checks && !finalized" :title="t('loot.dataStatus')" store-key="loot.dataStatus">
      <template #hint>
        <span v-if="checks.missing" class="small warn">{{ t('loot.dataMissing', { n: checks.missing }, checks.missing) }}</span>
        <span v-else class="small ok">{{ t('loot.dataComplete') }}</span>
      </template>
      <ul class="checks small">
        <li :class="checks.battle === 'report' ? 'ok' : 'warn'">
          <Icon :name="checks.battle === 'report' ? 'check' : 'warning'" :size="14" />
          {{ t(`loot.check.battle_${checks.battle}`) }}
        </li>
        <li v-for="(r, id) in checks.returns" :key="id" :class="r === 'missing' ? 'warn' : r === 'overview' ? 'muted' : 'ok'">
          <Icon :name="r === 'missing' ? 'warning' : 'check'" :size="14" />
          {{ t(`loot.check.return_${r}`, { name: checkName(String(id)) }) }}
        </li>
        <li v-if="checks.recycling !== 'n/a'" :class="checks.recycling === 'gap' ? 'warn' : checks.recycling === 'none' ? 'muted' : 'ok'">
          <Icon :name="checks.recycling === 'ok' ? 'check' : 'warning'" :size="14" />
          {{ t(`loot.check.recycling_${checks.recycling}`) }}
        </li>
      </ul>
      <p v-if="checks.missing" class="small muted">
        {{ t('loot.check.howTo') }} <RouterLink :to="`/${uni}/paste`">{{ t('nav.sync') }}</RouterLink>
      </p>
    </Section>

    <div v-if="myOpen.length" class="card mine">
      <h3>{{ t('loot.myDeliveries') }}</h3>
      <div v-for="x in myOpen" :key="keyOf(x)" class="small">
        <b>{{ x.from === data.me ? t('loot.youSend', { to: personName(x.to) }) : t('loot.youGet', { from: personName(x.from) }) }}</b>
        {{ resText(x.res) }} ({{ shipsFor(x.res) }} {{ cargoName }})
      </div>
    </div>

    <div class="cols">
      <div class="col">
        <Section :title="t('loot.settings')" store-key="loot.settings" :default-open-mobile="false">
          <fieldset :disabled="!editing" class="stack">
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
              <button
                v-if="market" type="button" class="small"
                :title="t('loot.marketRateHint', { rate: rateText(market.m, market.k), time: dateTime(market.time) }) + (market.source === 'text' ? ` (${t('market.estimated')})` : '')"
                @click="takeMarketRate"
              >
                {{ t('loot.marketRate') }}
              </button>
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
        </Section>

        <div class="card">
          <h3>{{ t('loot.participants') }}</h3>
          <div class="table-wrap">
            <table v-stack class="data">
              <thead>
                <tr><th>{{ t('common.name') }}</th><th class="num">{{ t('loot.flightDeut') }}</th><th class="num">{{ t('loot.recDeut') }}</th><th class="num">{{ t('loot.missiles') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in state.participants" :key="p.id">
                  <td>{{ p.name }}</td>
                  <td v-for="f in (['flightDeut', 'recDeut', 'missiles'] as const)" :key="f" class="num">
                    <input v-model.number="p[f]" type="number" min="0" :disabled="!editing" />
                    <button
                      v-if="manual.has(`p:${p.id}:${f}`) && draftPerson(p.id)" class="src manual" type="button" :disabled="!editing"
                      :title="t('loot.manualReset', { value: fmt(draftValue(p.id, f)) })" @click="resetPerson(p.id, f)"
                    >
                      <Icon name="edit" :size="12" :label="t('loot.manual')" />
                    </button>
                    <span v-else-if="f === 'flightDeut' && sources?.flightDeut[p.id] != null" class="src"><Icon name="check" :size="12" :label="t('loot.fromPlan')" /></span>
                  </td>
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
              <span v-if="pasted.has(i) || !b.key" class="muted">{{ t('loot.fromPasted') }}</span>
              <template v-else-if="battleSource(b)">
                <RouterLink v-if="battleSource(b)!.reportId" :to="`/${uni}/battle-hall/${battleSource(b)!.reportId}`">{{ t('loot.report') }}</RouterLink>
                <span :class="battleSource(b)!.fleets === 'report' ? 'muted' : 'warn'">
                  {{ battleSource(b)!.fleets === 'report' ? t('loot.fromReport') : t('loot.fromPlanShips') }}
                </span>
              </template>
            </div>
            <div class="row small">
              <span class="lbl">{{ t('loot.lootTotal') }}</span>
              <label v-for="k in RES" :key="k">{{ name(RES_IDS[k]) }} <input v-model.number="b.loot[k]" type="number" min="0" :disabled="!editing" /></label>
              <button
                v-if="b.key && manual.has(`b:${b.key}:loot`) && draftBattle(b)" class="src manual" type="button" :disabled="!editing"
                :title="t('loot.manualReset', { value: resText(draftBattle(b)!.loot) || '0' })" @click="resetLoot(b)"
              >
                <Icon name="edit" :size="12" :label="t('loot.manual')" />
              </button>
            </div>
            <div class="table-wrap">
            <table v-stack class="data">
              <thead>
                <tr><th>{{ t('loot.lootShare') }}</th><th>{{ t('loot.lost') }}</th><th v-for="k in RES" :key="k" class="num">{{ name(RES_IDS[k]) }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="f in b.fleets" :key="f.participant">
                  <td :title="shipsText(f.start)">{{ personName(f.participant) }}</td>
                  <td class="small neg">{{ lost(f.start, f.end).map((x) => `${fmt(x.n)} ${name(x.id)}`).join(', ') }}</td>
                  <td v-for="k in RES" :key="k" class="num">
                    {{ fmt(shares[i]?.get(f.participant)?.[k] ?? 0) }}
                    <span v-if="f.loot && k === 'm'" class="src"><Icon name="check" :size="12" :label="sources?.returnSource?.[f.participant] === 'overview' ? t('loot.fromOverview') : t('loot.fromFleet')" /></span>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <Section v-if="editing" :title="t('loot.pasteReport')" store-key="loot.pasteReport" :default-open="false">
          <template #hint><Hint>{{ t('loot.pasteHint') }}</Hint></template>
          <textarea v-model="reportText" class="report" :placeholder="t('loot.pastePlaceholder')" />
          <div class="row small" style="gap: 8px; margin-top: 6px">
            <select v-model.number="reportTarget">
              <option :value="-1">{{ t('loot.newBattle') }}</option>
              <option v-for="(_, i) in state.battles" :key="i" :value="i">{{ t('loot.replaceBattle', { n: i + 1 }) }}</option>
            </select>
            <button :disabled="!reportText.trim()" @click="applyReport">{{ t('common.apply') }}</button>
          </div>
        </Section>

        <Section :title="t('loot.recycling')" store-key="loot.recycling" :default-open-mobile="false">
          <div v-if="debris && (debris.field || debris.left)" class="debris small">
            <div v-if="debris.field">
              <span class="muted">{{ t('loot.debrisField') }}</span> {{ debrisText(debris.field) }}
            </div>
            <div>
              <span class="muted">{{ t('loot.debrisRecycled') }}</span> {{ debrisText(debris.recycled) }}
              <template v-if="debris.share != null"> ({{ Math.round(debris.share * 100) }} %)</template>
            </div>
            <div v-if="debris.left">
              <span class="muted">{{ t('loot.debrisLeft') }}</span> <span :class="{ ok: debris.empty }">{{ debris.empty ? t('loot.debrisEmpty') : debrisText(debris.left) }}</span>
            </div>
            <div v-if="debris.taken" class="warn">
              {{ t('loot.debrisTaken') }} {{ debrisText(debris.taken) }} <Hint>{{ t('loot.debrisTakenHint') }}</Hint>
            </div>
          </div>
          <p v-if="!state.recycling.length" class="muted small">{{ t('loot.noRecycling') }}</p>
          <div v-else class="table-wrap">
          <table v-stack class="data">
            <tbody>
              <tr v-for="(r, i) in state.recycling" :key="i">
                <td>
                  {{ personName(r.by) }}
                  <div v-if="r.time" class="muted small">{{ dateTime(r.time) }}</div>
                </td>
                <td class="num">{{ fmt(r.m) }} {{ name(901) }}<br />{{ fmt(r.k) }} {{ name(902) }}</td>
                <td v-if="editing"><button class="icon-btn" :title="t('loot.removeRecycling')" :aria-label="t('loot.removeRecycling')" @click="state.recycling.splice(i, 1)"><Icon name="close" :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
          </div>
          <template v-if="editing">
            <h3 style="margin-top: 12px">{{ t('loot.pasteRecycling') }} <Hint>{{ t('loot.pasteRecyclingHint') }}</Hint></h3>
            <textarea v-model="recycleText" class="report" :placeholder="t('loot.pasteRecyclingPlaceholder')" />
            <div class="row small" style="gap: 8px; margin-top: 6px">
              <select v-model="recycleBy" :aria-label="t('loot.recycledBy')">
                <option v-for="r in recyclers" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <button :disabled="!recycleText.trim()" @click="applyRecycling">{{ t('common.apply') }}</button>
            </div>
          </template>
          <template v-if="state.helpers.length">
            <h3>{{ t('loot.helpers') }} <Hint>{{ t('loot.helpersHint') }}</Hint></h3>
            <label class="row small tick" style="margin-bottom: 6px">
              <input v-model="state.settings.helperDeut" type="checkbox" :disabled="!editing" />
              {{ t('loot.helperDeut') }} <Hint>{{ t('loot.helperDeutHint') }}</Hint>
            </label>
            <div class="table-wrap">
            <table v-stack class="data">
              <thead>
                <tr>
                  <th>{{ t('common.name') }}</th><th class="num">{{ t('loot.keepPct') }}</th>
                  <th v-if="state.settings.helperDeut" class="num">{{ t('loot.recDeut') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="h in state.helpers" :key="h.id">
                  <td>{{ h.name }}</td>
                  <td class="num">
                    <input v-model.number="h.keepPct" type="number" min="0" :max="MAX_HELPER_KEEP" :disabled="!editing" />
                    <button
                      v-if="manual.has(`p:${h.id}:keepPct`) && draftPerson(h.id)" class="src manual" type="button" :disabled="!editing"
                      :title="t('loot.manualReset', { value: fmt(draftValue(h.id, 'keepPct')) })" @click="resetPerson(h.id, 'keepPct')"
                    >
                      <Icon name="edit" :size="12" :label="t('loot.manual')" />
                    </button>
                  </td>
                  <td v-if="state.settings.helperDeut" class="num"><input v-model.number="h.recDeut" type="number" min="0" :disabled="!editing" /></td>
                </tr>
              </tbody>
            </table>
            </div>
          </template>
        </Section>
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
          <!-- mobile: one block per person, resources as columns -->
          <div v-if="mobile" class="people">
            <div v-for="p in result.people" :key="p.id" class="person">
              <div class="person-head">
                <b>{{ p.name }}</b>
                <span class="muted small">{{ p.role === 'helper' ? t('loot.helper') : `${t('loot.share')} ${pct(p.share)}` }}</span>
              </div>
              <table class="person-grid">
                <thead>
                  <tr><th /><th v-for="k in RES" :key="k" class="num">{{ name(RES_IDS[k]) }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in RESULT_ROWS" :key="row">
                    <th class="faint">{{ t(`loot.${row}`) }}</th>
                    <td
                      v-for="k in RES"
                      :key="k"
                      class="num"
                      :class="row === 'balance' ? { pos: p.balance[k] > 0, neg: p.balance[k] < 0, faint: !p.balance[k] } : undefined"
                    >
                      {{ row === 'balance' && p.balance[k] > 0 ? '+' : '' }}{{ fmt(p[row][k]) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="table-wrap">
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
          <table v-stack class="data">
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

    <Section :title="t('comments.title')" store-key="loot.comments">
      <CommentThread :plan="data.plan.id" />
    </Section>
  </template>
</template>

<style scoped>
.bar-row { gap: 10px; flex-wrap: wrap; }
.checks { list-style: none; padding: 0; margin: 0 0 6px; display: flex; flex-direction: column; gap: 4px; }
.checks li { display: flex; align-items: center; gap: 6px; }
.card.mine { border-left: 3px solid var(--warn); }
.card.mine h3 { margin-bottom: 4px; }
.bar p { margin: 6px 0 0; }
.bar.live { border-left: 3px solid var(--accent); }
.bar.final { border-left: 3px solid var(--pos); }
.badge.live-badge, .badge.ok-badge { display: inline-flex; align-items: center; gap: 4px; }
.badge.ok-badge { color: var(--pos); }
button.link { background: none; border: 0; padding: 0 4px; color: var(--accent); text-decoration: underline; cursor: pointer; }
button.src { background: none; border: 0; padding: 0; cursor: pointer; }
.src.manual { color: var(--warn); margin-left: 4px; }
.debris { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
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
.src { color: var(--pos); margin-left: 4px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 10px; }
.kpi { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
tr.first td { border-top: 2px solid var(--border); }
textarea.report { width: 100%; min-height: 90px; font-family: var(--mono); font-size: 12px; }
.tick { display: inline-flex; align-items: center; gap: 6px; }
.people { display: flex; flex-direction: column; gap: 12px; }
.person-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 4px; }
.person-grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.person-grid th, .person-grid td { padding: 2px 4px; border-bottom: 1px solid var(--border); font-weight: 400; text-align: left; }
.person-grid td.num, .person-grid th.num { text-align: right; font-family: var(--mono); }
.person-grid thead th { color: var(--muted); }
@media (max-width: 800px) {
  .lbl { min-width: 0; flex-basis: 100%; }
  .import input { min-width: 0; }
}
</style>

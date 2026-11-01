<script setup lang="ts">
import { nowSec } from '../clock';
import Icon from './Icon.vue';
import DateTimeInput from './DateTimeInput.vue';
import EnemySummary from './EnemySummary.vue';
import Hint from './Hint.vue';
import Section from './Section.vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, duration, fmt, numDate } from '../format';
import { intlLocale } from '../i18n';
import { bufferRating, candidateHome, DEFAULT_BUFFER, DRIVES_MAX_AGE, enemyCalcLink, enemyCandidates, fromLocalInput, toLocalInput, type AttackPlan, type PlanEnemy } from '../plans';

/**
 * Retime analysis of a plan's hostile fleet: speed candidates of its return home, narrowed by departure window,
 * drive levels and a recall; the chosen candidate plus the buffer is the plan's target time. Every participant may
 * change the inputs; saving updates the plan for everyone.
 */
const props = defineProps<{ plan: AttackPlan; editable: boolean }>();
/** shown only for plans with an enemy fleet */
const enemy = computed(() => props.plan.enemy as PlanEnemy);
const emit = defineEmits<{ saved: []; error: [message: string] }>();
const { t } = useI18n();
const { uni, ctx } = useUni();

/** Form values; reset from the plan when someone else saved (and nothing is being edited here). */
const draft = reactive({
  follow: 0,
  drives: { 115: 0, 117: 0, 118: 0 } as Record<number, number>,
  depFrom: '',
  depTo: '',
  recFrom: '',
  recTo: '',
  recallLead: true,
  percent: null as number | null,
  buffer: DEFAULT_BUFFER,
});
const dirty = ref(false);
function reset() {
  const e = enemy.value;
  Object.assign(draft, {
    follow: e.follow,
    drives: { 115: e.drives[115] ?? 0, 117: e.drives[117] ?? 0, 118: e.drives[118] ?? 0 },
    depFrom: e.departure ? toLocalInput(e.departure.from) : '',
    depTo: e.departure ? toLocalInput(e.departure.to) : '',
    recFrom: e.recall ? toLocalInput(e.recall.from) : '',
    recTo: e.recall ? toLocalInput(e.recall.to) : '',
    recallLead: e.recall_lead,
    percent: e.percent,
    buffer: e.buffer,
  });
  dirty.value = false;
}
watch(() => enemy.value.updated_at + ':' + enemy.value.arrival, () => !dirty.value && reset(), { immediate: true });
const touch = () => (dirty.value = true);

const win = (a: string, b: string) => {
  const from = a ? fromLocalInput(a) : null;
  const to = b ? fromLocalInput(b) : null;
  return from != null && to != null && to >= from ? { from, to } : null;
};
const input = computed(() => ({
  ...enemy.value,
  follow: draft.follow,
  drives: draft.drives,
  departure: win(draft.depFrom, draft.depTo),
  recall: win(draft.recFrom, draft.recTo),
  recall_lead: draft.recallLead,
}));
const candidates = computed(() => enemyCandidates(ctx.value!.universe.settings, input.value));
const chosen = computed(() => candidates.value.find((c) => c.percent === draft.percent) ?? null);
/** Landing back home: shown by a phalanx, else the chosen candidate. */
const home = computed(() => enemy.value.phalanx?.home ?? (chosen.value ? candidateHome(chosen.value) : null));
const targetTime = computed(() => (home.value != null ? home.value + draft.buffer : null));
/** The plan's target time differs from the analysis (changed by hand, or saved before the inputs changed): saving fixes it. */
const offTarget = computed(() => targetTime.value != null && targetTime.value !== props.plan.target_time);

/** Back to the speed candidates. */
async function dropPhalanx() {
  try {
    await uniApi(uni.value, `/plans/${props.plan.id}/phalanx`, { method: 'DELETE' });
    emit('saved');
  } catch (e) {
    emit('error', (e as Error).message);
  }
}

/** Flight calculator with the current inputs; the viewer's own fleet in the plan (with a start) as the counter. */
const calcLink = computed(() =>
  enemyCalcLink(
    ctx.value!.universe.settings,
    { ...input.value, percent: draft.percent, buffer: draft.buffer },
    props.plan.fleets.find((f) => f.user_id === ctx.value?.me.id && f.g != null && f.status !== 'withdrawn'),
  ),
);

/** Recall window from the overview pastes, offered while the form shows another one. */
const recallSeen = computed(() => {
  const r = enemy.value.recall_seen;
  return r && (draft.recFrom !== toLocalInput(r.from) || draft.recTo !== toLocalInput(r.to)) ? r : null;
});
function applyRecallSeen() {
  const r = enemy.value.recall_seen!;
  Object.assign(draft, { recFrom: toLocalInput(r.from), recTo: toLocalInput(r.to), recallLead: true });
  touch();
  narrowSection.value?.open();
}
/** The inputs narrowing the candidates (drives, departure and recall window), folded away with their count. */
const narrowSection = ref<InstanceType<typeof Section> | null>(null);
const narrowCount = computed(() => [input.value.departure, input.value.recall].filter(Boolean).length);
/** The speed list folds away once a speed is saved; its header then shows the chosen one. */
const speedsOpen = enemy.value.percent == null;
const speedsSection = ref<InstanceType<typeof Section> | null>(null);
/** Picking a speed folds the list (the header shows the choice); it opens again to pick another one. */
function pickSpeed() {
  touch();
  speedsSection.value?.close();
}
const speedsTitle = computed(() =>
  chosen.value
    ? t('retime.speedChosen', { percent: chosen.value.percent, home: clock(candidateHome(chosen.value)) })
    : t('retime.speeds'),
);

const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
const ships = (s: Record<string, number>) =>
  Object.entries(s)
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(', ');
const drivesOld = computed(() => {
  const e = enemy.value;
  return !e.drives_time || nowSec() - e.drives_time > DRIVES_MAX_AGE;
});

async function save() {
  try {
    await uniApi(uni.value, `/plans/${props.plan.id}/enemy`, {
      method: 'PUT',
      body: {
        follow: draft.follow,
        drives: draft.drives,
        departure_from: input.value.departure?.from ?? null,
        departure_to: input.value.departure?.to ?? null,
        recall_from: input.value.recall?.from ?? null,
        recall_to: input.value.recall?.to ?? null,
        recall_lead: draft.recallLead,
        percent: draft.percent,
        buffer: draft.buffer,
        ...(targetTime.value ? { target_time: targetTime.value } : {}),
      },
    });
    dirty.value = false;
    emit('saved');
  } catch (e) {
    emit('error', (e as Error).message);
  }
}
</script>

<template>
  <div class="retime">
    <EnemySummary :enemy="enemy">
      <template #hint><Hint>{{ t('retime.hint') }}</Hint></template>
      <template #actions>
        <a class="btn small" :href="calcLink" target="_blank" rel="noopener" :title="t('retime.calcTitle')">{{ t('retime.calcShort') }} <Icon name="external" :size="12" /></a>
      </template>
      <div v-if="enemy.fleets.length > 1" class="fleets" role="radiogroup" :aria-label="t('retime.followTitle')">
        <label v-for="(f, i) in enemy.fleets" :key="i" class="check">
          <input v-model.number="draft.follow" type="radio" :value="i" :disabled="!editable" @change="touch" />
          <span><span v-if="i === 0" class="muted">{{ t('retime.lead') }}</span> {{ ships(f.ships) }}</span>
        </label>
      </div>
      <span v-else>{{ ships(enemy.fleets[0]?.ships ?? {}) }}</span>
    </EnemySummary>

    <div v-if="recallSeen" class="notice warn-box">
      <Icon name="warning" :size="14" />
      <span class="grow small">{{ t('retime.recallSeen', { member: enemy.member ?? '?', from: clock(recallSeen.from), to: clock(recallSeen.to) }) }}</span>
      <button v-if="editable" @click="applyRecallSeen">{{ t('retime.recallApply') }}</button>
    </div>
    <div v-if="enemy.phalanx" class="notice">
      <Icon name="spy" :size="14" />
      <span class="grow small">
        <span class="pos">{{ t('retime.phalanxHome', { t: clock(enemy.phalanx.home) }) }}</span>
        <span v-if="enemy.phalanx.time" class="muted"> {{ t('retime.phalanxPasted', { t: clock(enemy.phalanx.time) }) }}</span>
      </span>
      <button v-if="editable" @click="dropPhalanx">{{ t('retime.phalanxDrop') }}</button>
    </div>

    <Section ref="narrowSection" :title="t('retime.narrow')" :count="narrowCount || null" :card="false" :default-open="false" class="narrow">
      <div class="narrow-body">
        <div class="field">
          <span class="lbl">{{ t('retime.drives') }}</span>
          <label v-for="id in [115, 117, 118]" :key="id" class="drive" :title="t(`retime.drive${id}`)">
            {{ abbr(id) }} <input v-model.number="draft.drives[id]" type="number" min="0" max="99" :disabled="!editable" :aria-label="t(`retime.drive${id}`)" @input="touch" />
          </label>
          <span class="small" :class="drivesOld ? 'warn' : 'muted'">
            {{ enemy.drives_time ? t(`retime.source.${enemy.drives_source ?? 'spy'}`, { date: numDate(new Date(enemy.drives_time * 1000)) }) : t('retime.drivesUnknown') }}
          </span>
        </div>
        <div class="field">
          <span class="lbl">{{ t('retime.departure') }}</span>
          <span class="window">
            <DateTimeInput v-model="draft.depFrom" precision="second" :disabled="!editable" @input="touch" />
            <span class="faint">–</span>
            <DateTimeInput v-model="draft.depTo" precision="second" :disabled="!editable" @input="touch" />
          </span>
        </div>
        <div class="field">
          <span class="lbl">{{ t('retime.recall') }}</span>
          <span class="window">
            <DateTimeInput v-model="draft.recFrom" precision="second" :disabled="!editable" @input="touch" />
            <span class="faint">–</span>
            <DateTimeInput v-model="draft.recTo" precision="second" :disabled="!editable" @input="touch" />
          </span>
          <label v-if="enemy.fleets.length > 1" class="check small"><input v-model="draft.recallLead" type="checkbox" :disabled="!editable" @change="touch" /> {{ t('retime.recallLead') }}</label>
        </div>
      </div>
    </Section>

    <!-- one option per speed: when the enemy launched and when it is back home -->
    <Section ref="speedsSection" :title="speedsTitle" :card="false" :default-open="speedsOpen" class="speeds">
    <div class="cands" role="radiogroup" :aria-label="t('plans.speed')">
      <div class="cand cand-head" aria-hidden="true">
        <span />
        <span>{{ t('plans.speed') }}</span>
        <span>{{ t('plans.flight') }}</span>
        <span>{{ t('retime.launch') }}</span>
        <span>{{ t('retime.home') }}</span>
      </div>
      <label v-for="c in candidates" :key="c.percent" class="cand" :class="{ impossible: !c.possible, picked: c.percent === draft.percent }">
        <input v-model.number="draft.percent" type="radio" :value="c.percent" :disabled="!editable || !c.possible" @change="pickSpeed" />
        <b class="c-speed">{{ c.percent }} %</b>
        <span class="c-flight"><span class="m-lbl">{{ t('plans.flight') }}</span> <span class="mono">{{ duration(Math.floor(c.duration)) }}</span></span>
        <span class="c-launch">
          <span class="m-lbl">{{ t('retime.launchShort') }}</span>
          <span class="mono">{{ c.launch.from != null && c.launch.from !== c.launch.to ? `${clock(c.launch.from)} – ` : c.launch.from == null ? '≤ ' : '' }}{{ clock(c.launch.to) }}</span>
        </span>
        <span class="c-home">
          <span class="m-lbl">{{ t('retime.homeShort') }}</span>
          <span class="mono">
            <template v-if="c.recallHome">{{ clock(c.recallHome.from) }}{{ c.recallHome.to != null ? ` – ${clock(c.recallHome.to)}` : ' +' }}</template>
            <template v-else>{{ clock(c.home) }}</template>
          </span>
        </span>
      </label>
    </div>
    </Section>

    <!-- the result: target time from the chosen speed plus the buffer -->
    <div class="result">
      <div class="result-line">
        <b v-if="targetTime" class="target">{{ t('retime.target', { t: clock(targetTime) }) }}</b>
        <span v-else class="muted">{{ t('retime.pick') }}</span>
        <span class="field buffer">
          <span class="small muted">{{ t('retime.buffer') }}</span>
          <input v-model.number="draft.buffer" type="number" min="0" max="3600" :disabled="!editable" :aria-label="t('retime.buffer')" @input="touch" />
          <span class="small">s</span>
          <span class="small" :class="{ pos: bufferRating(draft.buffer) === 'good', warn: bufferRating(draft.buffer) === 'poor', neg: bufferRating(draft.buffer) === 'bad' }">
            {{ t(`retime.bufferRating.${bufferRating(draft.buffer)}`) }}
          </span>
        </span>
      </div>
      <span v-if="offTarget" class="warn small">{{ t('retime.targetOff', { t: clock(plan.target_time) }) }}</span>
      <div v-if="editable" class="result-actions">
        <button class="primary" :disabled="!dirty && !offTarget" @click="save">{{ t('plans.save') }}</button>
        <button v-if="dirty" @click="reset">{{ t('plans.cancelForm') }}</button>
        <span class="grow" />
        <span v-if="enemy.updated_by" class="muted small">{{ t('retime.updatedBy', { name: enemy.updated_by }) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.retime { display: flex; flex-direction: column; gap: 12px; }
.fleets { display: flex; flex-direction: column; gap: 4px; }
.notice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
.warn-box { background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); color: var(--warn); }
.warn-box .small { color: var(--text); }
.narrow :deep(.section-head), .speeds :deep(.section-head) { margin: 0; min-height: 0; }
.narrow-body { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 2px 24px; }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.lbl { min-width: 130px; color: var(--muted); font-size: 12px; }
.drive input { width: 56px; margin-left: 2px; }
.window { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
/* speed options: a grid on desktop, two lines each on mobile */
.cands { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.cand {
  display: grid; grid-template-columns: 22px 64px 90px minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 2px 12px;
  padding: 6px 10px; border-top: 1px solid var(--border); color: var(--text); font-size: 13px; cursor: pointer;
}
.cand:first-child { border-top: 0; }
.cand-head { color: var(--muted); font-size: 12px; font-weight: 600; cursor: default; background: var(--surface-2); }
.cand:not(.cand-head):hover { background: var(--surface-2); }
.cand.picked { background: var(--accent-soft); }
.cand.impossible { color: var(--faint); cursor: default; }
.cand input { margin: 0; }
.m-lbl { display: none; color: var(--faint); font-size: 11px; }
.result { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.result-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; }
.target { font-size: 15px; }
.buffer input { width: 64px; }
.result-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
@media (max-width: 800px) {
  .lbl { flex-basis: 100%; min-width: 0; }
  .narrow-body { padding-left: 0; }
  .window :deep(.dt-input) { flex: 1 1 150px; min-width: 0; }
  .cand-head { display: none; }
  .cand { grid-template-columns: 22px 56px minmax(0, 1fr); padding: 8px 10px; }
  .c-launch, .c-home { grid-column: 2 / -1; }
  .c-launch, .c-home, .c-flight { display: flex; flex-wrap: wrap; gap: 0 6px; align-items: baseline; }
  .m-lbl { display: inline; }
  .result-actions > button { flex: 1; }
}
</style>

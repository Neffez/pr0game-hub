<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, coords, duration, fmt } from '../format';
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
const targetTime = computed(() => (chosen.value ? candidateHome(chosen.value) + draft.buffer : null));

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
}

const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
const ships = (s: Record<string, number>) =>
  Object.entries(s)
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(', ');
const delay = computed(() => enemy.value.arrival - enemy.value.first_seen);
const drivesOld = computed(() => {
  const e = enemy.value;
  return !e.drives_time || Date.now() / 1000 - e.drives_time > DRIVES_MAX_AGE;
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
    <div class="head">
      <b>{{ t('retime.enemy') }}</b>
      <span>{{ t('retime.onMember', { member: enemy.member ?? '?' }) }}</span>
      <span class="mono">{{ coords(enemy.from.g, enemy.from.s, enemy.from.p) }} → {{ coords(enemy.to.g, enemy.to.s, enemy.to.p) }}</span>
      <span>{{ t('retime.impact') }} <b class="mono">{{ clock(enemy.arrival) }}</b></span>
      <span v-if="delay > 0" class="warn small">{{ t('retime.delayed', { t: duration(delay), first: clock(enemy.first_seen) }) }}</span>
      <a class="small" :href="calcLink" target="_blank" rel="noopener" :title="t('retime.calcTitle')">{{ t('retime.calc') }} ↗</a>
    </div>

    <div class="fleets">
      <label v-for="(f, i) in enemy.fleets" :key="i" class="fleet">
        <input v-if="enemy.fleets.length > 1" v-model.number="draft.follow" type="radio" :value="i" :disabled="!editable" @change="touch" />
        <span class="small">{{ i === 0 && enemy.fleets.length > 1 ? t('retime.lead') : '' }} {{ ships(f.ships) }}</span>
      </label>
    </div>

    <div class="inputs">
      <span class="field">
        <span class="lbl">{{ t('retime.drives') }}</span>
        <label v-for="id in [115, 117, 118]" :key="id" :title="t(`retime.drive${id}`)">
          {{ abbr(id) }} <input v-model.number="draft.drives[id]" type="number" min="0" max="99" :disabled="!editable" @input="touch" />
        </label>
        <span class="small" :class="drivesOld ? 'warn' : 'muted'">
          {{ enemy.drives_time ? t(`retime.source.${enemy.drives_source ?? 'spy'}`, { date: new Date(enemy.drives_time * 1000).toLocaleDateString(intlLocale()) }) : t('retime.drivesUnknown') }}
        </span>
      </span>
      <span class="field">
        <span class="lbl">{{ t('retime.departure') }}</span>
        <input v-model="draft.depFrom" type="datetime-local" step="1" :disabled="!editable" @input="touch" />
        –
        <input v-model="draft.depTo" type="datetime-local" step="1" :disabled="!editable" @input="touch" />
      </span>
      <span class="field">
        <span class="lbl">{{ t('retime.recall') }}</span>
        <input v-model="draft.recFrom" type="datetime-local" step="1" :disabled="!editable" @input="touch" />
        –
        <input v-model="draft.recTo" type="datetime-local" step="1" :disabled="!editable" @input="touch" />
        <label v-if="enemy.fleets.length > 1"><input v-model="draft.recallLead" type="checkbox" :disabled="!editable" @change="touch" /> {{ t('retime.recallLead') }}</label>
      </span>
      <span v-if="recallSeen" class="field">
        <span class="lbl" />
        <span class="warn small">{{ t('retime.recallSeen', { member: enemy.member ?? '?', from: clock(recallSeen.from), to: clock(recallSeen.to) }) }}</span>
        <button v-if="editable" @click="applyRecallSeen">{{ t('retime.recallApply') }}</button>
      </span>
      <span class="field">
        <span class="lbl">{{ t('retime.buffer') }}</span>
        <input v-model.number="draft.buffer" type="number" min="0" max="3600" :disabled="!editable" @input="touch" /> s
        <span class="small" :class="{ pos: bufferRating(draft.buffer) === 'good', warn: bufferRating(draft.buffer) === 'poor', neg: bufferRating(draft.buffer) === 'bad' }">
          {{ t(`retime.bufferRating.${bufferRating(draft.buffer)}`) }}
        </span>
      </span>
    </div>

    <div class="table-wrap">
      <table class="data cands">
        <thead>
          <tr>
            <th />
            <th>{{ t('plans.speed') }}</th>
            <th>{{ t('plans.flight') }}</th>
            <th>{{ t('retime.launch') }}</th>
            <th>{{ t('retime.home') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in candidates" :key="c.percent" :class="{ impossible: !c.possible, picked: c.percent === draft.percent }">
            <td><input v-model.number="draft.percent" type="radio" :value="c.percent" :disabled="!editable || !c.possible" @change="touch" /></td>
            <td>{{ c.percent }} %</td>
            <td class="mono">{{ duration(Math.floor(c.duration)) }}</td>
            <td class="mono">
              {{ c.launch.from != null && c.launch.from !== c.launch.to ? `${clock(c.launch.from)} – ` : c.launch.from == null ? '≤ ' : '' }}{{ clock(c.launch.to) }}
            </td>
            <td class="mono">
              <template v-if="c.recallHome">{{ clock(c.recallHome.from) }}{{ c.recallHome.to != null ? ` – ${clock(c.recallHome.to)}` : ' +' }}</template>
              <template v-else>{{ clock(c.home) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editable" class="row">
      <button class="primary" :disabled="!dirty" @click="save">{{ t('plans.save') }}</button>
      <button v-if="dirty" @click="reset">{{ t('plans.cancelForm') }}</button>
      <span v-if="targetTime" class="small">{{ t('retime.target', { t: clock(targetTime) }) }}</span>
      <span v-else class="muted small">{{ t('retime.pick') }}</span>
      <span v-if="enemy.updated_by" class="muted small">{{ t('retime.updatedBy', { name: enemy.updated_by }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.retime { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); }
.head, .fleets { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.fleet { display: inline-flex; align-items: center; gap: 4px; color: var(--text); font-size: 13px; }
.inputs { display: flex; flex-direction: column; gap: 6px; }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lbl { min-width: 110px; color: var(--muted); font-size: 12px; }
.field input[type='number'] { width: 64px; }
.cands tr.impossible td { color: var(--faint); }
.cands tr.picked td { background: var(--accent-soft); }
</style>

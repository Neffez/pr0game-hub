<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, coords, fmt, name, numDate } from '../format';
import { FLEET_SHIPS, SPEEDS, type AttackPlan, type PlanFleet } from '../plans';
import Hint from './Hint.vue';
import Icon from './Icon.vue';
import Section from './Section.vue';
import Sheet from './Sheet.vue';

/**
 * Adds or edits a fleet of a raid plan: start planet (from the member's empire page, spy reports or typed in), speed,
 * ships with their maximum on the start planet or in total, and the drive levels. `fleet` null: the viewer's new fleet.
 */
const props = defineProps<{ plan: AttackPlan | null; fleet: PlanFleet | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const me = computed(() => ctx.value?.me.id);

/** Drive research of a fleet, also by hand: combustion, impulse, hyperspace. */
const DRIVE_IDS = [115, 117, 118];
interface OwnPlanet {
  name: string;
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon';
  values: Record<string, number>;
}
interface OwnEmpire {
  planets: OwnPlanet[];
  /** ships on fleets in flight */
  flyingShips?: Record<string, number>;
  /** where the planets come from: the member's empire page or the spy reports of their player */
  source?: 'empire' | 'spy';
  time?: number;
}
/** Latest empire pages of the members whose fleets are edited, by user id; without one put together from spy reports. */
const empires = reactive<Record<number, OwnEmpire>>({});
const ownEmpire = computed(() => empires[form.userId] ?? null);
const ownPlanets = computed(() => ownEmpire.value?.planets ?? null);
async function loadEmpire(userId: number) {
  if (empires[userId]) return;
  try {
    const r = await uniApi<{ empire: { time: number; data: OwnEmpire } | null; spy: (OwnEmpire & { time: number }) | null }>(uni.value, `/imperium?user=${userId}`);
    empires[userId] = r.empire
      ? { ...r.empire.data, source: 'empire', time: r.empire.time }
      : r.spy
        ? { planets: r.spy.planets, source: 'spy', time: r.spy.time }
        : { planets: [] };
  } catch {
    empires[userId] = { planets: [] };
  }
}
/** All ships of the fleet's member: on all planets and moons plus in flight (empire page). */
const owned = computed(() => {
  const out: Record<number, number> = {};
  const add = (values: Record<string, number>) => {
    for (const id of FLEET_SHIPS) if (values[id]) out[id] = (out[id] ?? 0) + values[id];
  };
  for (const pl of ownEmpire.value?.planets ?? []) add(pl.values);
  add(ownEmpire.value?.flyingShips ?? {});
  return out;
});
const planetKey = (c: { g: number; s: number; p: number }, type: string | null) => `${c.g}:${c.s}:${c.p}:${type ?? 'planet'}`;

/**
 * `from`: where a ship's maximum comes from, the start planet or all ships of the member. A start not in the list
 * (`start` = 'manual', or no planets at all) is typed in (`manual` g:s:p, `moon`). `drives`: the levels shown, sent
 * only when changed by hand (`drivesChanged`); `drivesReset` drops the levels by hand.
 */
const form = reactive({
  userId: 0,
  member: '',
  start: '',
  manual: '',
  moon: false,
  drives: {} as Record<number, number>,
  drivesSource: null as 'empire' | 'spy' | 'manual' | null,
  drivesTime: null as number | null,
  drivesChanged: false,
  drivesReset: false,
  ships: {} as Record<number, number>,
  from: {} as Record<number, 'start' | 'all'>,
  speed: 100,
});
const error = ref('');
const busy = ref(false);
watch(
  [open, () => props.fleet],
  ([v]) => {
    if (!v || !props.plan) return;
    const f = props.fleet;
    const userId = f?.user_id ?? me.value!;
    loadEmpire(userId);
    error.value = '';
    Object.assign(form, {
      userId,
      member: f && f.user_id !== me.value ? f.member : '',
      start: f && f.g != null ? planetKey({ g: f.g, s: f.s!, p: f.p! }, f.planet_type) : '',
      manual: f && f.g != null ? `${f.g}:${f.s}:${f.p}` : '',
      moon: f?.planet_type === 'moon',
      drives: Object.fromEntries(DRIVE_IDS.map((id) => [id, Number(f?.drives?.research[id] ?? 0)])),
      drivesSource: f?.drives?.source ?? null,
      drivesTime: f?.drives?.time ?? null,
      drivesChanged: false,
      drivesReset: false,
      ships: Object.fromEntries(Object.entries(f?.ships ?? {}).map(([id, n]) => [Number(id), n])),
      speed: f?.speed ?? 100,
      from: {},
    });
  },
  { immediate: true },
);
const startPlanet = computed(() => ownPlanets.value?.find((x) => planetKey(x.coords, x.type) === form.start) ?? null);
const onStart = (id: number) => startPlanet.value?.values[id] ?? 0;
/** Maximum of an added ship: on the start planet or all own ones, as picked (for saved fleets: start first). */
function cap(id: number): number | null {
  const from = form.from[id] ?? (onStart(id) > 0 ? 'start' : 'all');
  const n = from === 'start' ? onStart(id) : (owned.value[id] ?? 0);
  return n > 0 || from === 'start' ? n : null;
}
const added = (id: number) => form.ships[id] != null;
/** Ships to add: those on the start planet, and all own ones (also those still to be moved there). */
const startShips = computed(() => FLEET_SHIPS.filter((id) => !added(id) && onStart(id) > 0));
const ownShips = computed(() => FLEET_SHIPS.filter((id) => !added(id) && (owned.value[id] ?? 0) > 0));
/** Without an empire page (also with spy reports, which may miss planets) any ship can be entered by hand. */
const otherShips = computed(() => (ownEmpire.value?.source === 'empire' ? [] : FLEET_SHIPS.filter((id) => !added(id))));
/** The start is typed in: no planets known, "other coordinates" picked, or a saved start not among the planets. */
const typedStart = computed(
  () => !ownPlanets.value?.length || form.start === 'manual' || (!!form.start && !ownPlanets.value.some((pl) => planetKey(pl.coords, pl.type) === form.start)),
);
const changeDrives = () => Object.assign(form, { drivesChanged: true, drivesReset: false });
const resetDrives = () => Object.assign(form, { drivesChanged: false, drivesReset: true });
/** Where the drive levels in the form come from. */
const drivesInfo = computed(() => {
  if (form.drivesChanged) return t('plans.drivesSource.manual');
  if (form.drivesReset) return t('plans.drivesResetPending');
  if (!form.drivesSource) return t('plans.drivesSource.none');
  return `${t(`plans.drivesSource.${form.drivesSource}`)}${form.drivesTime ? ` · ${numDate(new Date(form.drivesTime * 1000))}` : ''}`;
});
const drivesSummary = computed(() => `${t('plans.drives')}: ${DRIVE_IDS.map((id) => `${abbr(id)} ${form.drives[id] ?? 0}`).join(' · ')} (${drivesInfo.value})`);
/** Picking a ship adds all of them (start planet or all own ones); the amount stays editable. */
function pickShip(e: Event) {
  const el = e.target as HTMLSelectElement;
  const [from, raw] = el.value.split(':');
  el.value = '';
  const id = Number(raw);
  if (!id) return;
  if (from === 'start' || from === 'all') form.from[id] = from;
  form.ships[id] = from === 'start' ? onStart(id) : from === 'all' ? (owned.value[id] ?? 0) : 0;
}
function removeShip(id: number) {
  delete form.ships[id];
  delete form.from[id];
}
/** Start typed in: g:s:p, null when empty, undefined when invalid. */
function manualStart(): { g: number; s: number; p: number; type: string } | null | undefined {
  const text = form.manual.trim();
  if (!text) return null;
  const m = /^(\d+):(\d+):(\d+)$/.exec(text);
  return m ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]), type: form.moon ? 'moon' : 'planet' } : undefined;
}
async function save() {
  const [g, s, p, type] = form.start.split(':');
  const manual = typedStart.value ? manualStart() : null;
  if (manual === undefined) return void (error.value = t('plans.startInvalid'));
  const body = {
    ...(manual ?? (form.start && !typedStart.value ? { g: Number(g), s: Number(s), p: Number(p), type } : {})),
    ...(form.drivesReset ? { drives: null } : form.drivesChanged ? { drives: form.drives } : {}),
    ships: Object.fromEntries(Object.entries(form.ships).filter(([, n]) => n > 0)),
    speed: form.speed,
    ...(props.fleet ? {} : { status: 'ready' }),
  };
  const path = `/plans/${props.plan!.id}/fleets${props.fleet ? `/${props.fleet.id}` : ''}`;
  busy.value = true;
  error.value = '';
  try {
    await uniApi(uni.value, path, { method: props.fleet ? 'PUT' : 'POST', body });
    open.value = false;
    emit('saved');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const title = computed(() => (form.member ? t('plans.fleetOf', { member: form.member }) : props.fleet ? t('plans.myFleet') : t('plans.addFleet')));
</script>

<template>
  <Sheet v-model="open" :title="title">
    <div class="fleet-form">
      <h4 v-if="form.member" class="sr-only">{{ t('plans.fleetOf', { member: form.member }) }}</h4>
      <div class="field">
        <span class="lbl">{{ t('plans.start') }}</span>
        <select v-if="ownPlanets?.length" v-model="form.start" :aria-label="t('plans.start')">
          <option value="">–</option>
          <option v-for="pl in ownPlanets" :key="planetKey(pl.coords, pl.type)" :value="planetKey(pl.coords, pl.type)">
            {{ pl.name }} {{ coords(pl.coords.g, pl.coords.s, pl.coords.p) }}{{ pl.type === 'moon' ? ` (${t('common.moon')})` : '' }}
          </option>
          <option value="manual">{{ t('plans.otherStart') }} …</option>
        </select>
        <template v-if="ownPlanets && typedStart">
          <input v-model="form.manual" class="mono start-input" placeholder="1:41:1" size="10" :aria-label="t('plans.startCoords')" />
          <label class="check"><input v-model="form.moon" type="checkbox" /> {{ t('plans.moon') }}</label>
        </template>
      </div>
      <p v-if="ownPlanets && !ownPlanets.length" class="muted small note">{{ t('plans.noEmpire') }}</p>
      <p v-else-if="ownEmpire?.source === 'spy'" class="muted small note">{{ t('plans.fromSpy', { time: numDate(new Date(ownEmpire.time! * 1000)) }) }}</p>

      <div class="field">
        <span class="lbl">{{ t('plans.speed') }}</span>
        <select v-model.number="form.speed" :aria-label="t('plans.speed')">
          <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
        </select>
      </div>

      <div class="ships">
        <div class="ships-head">
          <span class="lbl">{{ t('plans.ships') }}</span>
          <Hint>{{ t('plans.pickHint') }}</Hint>
        </div>
        <div v-for="(n, id) in form.ships" :key="id" class="ship-row">
          <span class="ship-name" :title="name(Number(id))">{{ name(Number(id)) }}</span>
          <input v-model.number="form.ships[Number(id)]" type="number" min="0" :aria-label="name(Number(id))" />
          <template v-if="cap(Number(id)) != null">
            <button type="button" :title="t('plans.maxTitle')" @click="form.ships[Number(id)] = cap(Number(id))!">{{ t('plans.max') }}</button>
            <span class="muted small">/ {{ fmt(cap(Number(id))!) }} {{ form.from[Number(id)] === 'all' || onStart(Number(id)) === 0 ? t('plans.fromAll') : t('plans.fromStart') }}</span>
            <span v-if="n > cap(Number(id))!" class="warn small">{{ t('plans.moreThanAvailable') }}</span>
          </template>
          <button type="button" class="icon-btn" :title="t('plans.removeShip')" :aria-label="t('plans.removeShip')" @click="removeShip(Number(id))"><Icon name="close" :size="14" /></button>
        </div>
        <select class="add-ship" :aria-label="t('plans.addShip')" @change="pickShip">
          <option value="">{{ t('plans.addShip') }} …</option>
          <optgroup v-if="startShips.length" :label="t('plans.groupStart', { name: startPlanet!.name })">
            <option v-for="id in startShips" :key="`s${id}`" :value="`start:${id}`">{{ name(id) }} ({{ fmt(onStart(id)) }})</option>
          </optgroup>
          <optgroup v-if="ownShips.length" :label="t('plans.groupAll')">
            <option v-for="id in ownShips" :key="`a${id}`" :value="`all:${id}`">{{ name(id) }} ({{ fmt(owned[id]) }})</option>
          </optgroup>
          <optgroup v-if="otherShips.length" :label="t('plans.groupOther')">
            <option v-for="id in otherShips" :key="`o${id}`" :value="`free:${id}`">{{ name(id) }}</option>
          </optgroup>
        </select>
      </div>

      <Section :title="drivesSummary" :card="false" :default-open="!form.drivesSource" class="drives-section">
        <div class="row drives">
          <label v-for="id in DRIVE_IDS" :key="id" :title="t(`retime.drive${id}`)">
            {{ abbr(id) }}
            <input v-model.number="form.drives[id]" type="number" min="0" max="99" :aria-label="t(`retime.drive${id}`)" @input="changeDrives" />
          </label>
          <span class="muted small">{{ drivesInfo }}</span>
          <button v-if="form.drivesSource === 'manual' && !form.drivesReset" type="button" @click="resetDrives">{{ t('plans.drivesReset') }}</button>
          <Hint>{{ t('plans.drivesHint') }}</Hint>
        </div>
      </Section>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" @click="open = false">{{ t('plans.cancelForm') }}</button>
      <button type="button" class="primary" :disabled="busy" @click="save">{{ t('plans.save') }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.fleet-form { display: flex; flex-direction: column; gap: 12px; }
.note { margin: -6px 0 0; }
.ships { display: flex; flex-direction: column; gap: 6px; }
.ships-head { display: flex; align-items: center; }
.ships-head .lbl { color: var(--muted); font-size: 12px; }
.ship-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ship-name { min-width: 150px; }
.ship-row input { width: 110px; }
.add-ship { align-self: flex-start; }
.drives { gap: 8px; }
.drives input { width: 56px; }
.drives-section :deep(.section-head) { margin: 0; min-height: 0; }
.drives-section :deep(.section-toggle) { font-weight: 400; color: var(--muted); font-size: 13px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 800px) {
  .ship-name { flex: 1 1 100%; min-width: 0; }
  .add-ship { align-self: stretch; }
}
</style>

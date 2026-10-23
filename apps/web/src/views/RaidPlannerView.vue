<script setup lang="ts">
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlayerLink from '../components/PlayerLink.vue';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { loadClaims } from '../claims';
import { useUni, vStack } from '../composables';
import { abbr, coords, duration, fmt, name } from '../format';
import { intlLocale } from '../i18n';
import { tables, useLiveReload } from '../live';
import {
  computePlan,
  DRIVES_MAX_AGE,
  FLEET_SHIPS,
  FLEET_STATUSES,
  fromLocalInput,
  isCurrent,
  parseTarget,
  PLAN_STATUSES,
  SPEEDS,
  toLocalInput,
  type AttackPlan,
  type PlanFleet,
} from '../plans';

/** Raid planner: own attacks of one or more members (solo or ACS) landing on one target at one second. */
const { t } = useI18n();
const { uni, ctx } = useUni();
const route = useRoute();
const router = useRouter();

const nowSec = () => Math.floor(Date.now() / 1000);
const now = ref(nowSec());
const ticker = setInterval(() => (now.value = nowSec()), 1000);
onBeforeUnmount(() => clearInterval(ticker));

const plans = ref<AttackPlan[]>([]);
const loaded = ref(false);
const error = ref('');
async function load() {
  try {
    plans.value = await uniApi<AttackPlan[]>(uni.value, '/plans');
  } catch (e) {
    error.value = (e as Error).message;
  }
  loaded.value = true;
}
onMounted(load);
useLiveReload(load, tables('attack_plans'), 300);

/** Runs a change; errors show above the list, the live event reloads the plans (and here at once). */
async function run(fn: () => Promise<unknown>) {
  error.value = '';
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const settings = computed(() => ctx.value!.universe.settings);
const me = computed(() => ctx.value?.me.id);
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || !!ctx.value?.me.isAdmin);
const canEdit = (p: AttackPlan) => p.user_id === me.value || isAdmin.value;
const canEditFleet = (p: AttackPlan, f: PlanFleet) => f.user_id === me.value || canEdit(p);
const closed = (p: AttackPlan) => p.status === 'done' || p.status === 'cancelled';

const views = computed(() => new Map(plans.value.map((p) => [p.id, computePlan(settings.value, p, now.value)])));
const current = computed(() => plans.value.filter((p) => isCurrent(p, now.value)));
const past = computed(() => plans.value.filter((p) => !isCurrent(p, now.value)).reverse());

const pad = (n: number) => String(n).padStart(2, '0');
/** Date and time to the second, browser time like the rest of the hub. */
const when = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clock = (epoch: number) => {
  const d = new Date(epoch * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
/** Countdown "in 1:02:03" / "vor 5:00". */
const until = (epoch: number) => {
  const s = epoch - now.value;
  return s >= 0 ? t('plans.in', { t: duration(s) || '0:00:00' }) : t('plans.ago', { t: duration(-s) });
};
const shipList = (ships: Record<string, number>) =>
  Object.entries(ships)
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(', ') || '–';
/** Member sending the lead fleet of the ACS. */
const leadName = (p: AttackPlan) => p.fleets.find((f) => String(f.id) === views.value.get(p.id)?.acs?.lead)?.member ?? '?';
const target = (p: AttackPlan) => coords(p.g, p.s, p.p);

// ---- new plan ----
const form = reactive({ open: false, target: '', type: 'planet' as 'planet' | 'moon', time: '', note: '' });
const info = ref('');
function openForm(raw = '', type: 'planet' | 'moon' = 'planet') {
  Object.assign(form, { open: true, target: raw, type, time: toLocalInput(nowSec() + 3600), note: '' });
}
watch(
  () => route.query.new,
  (v) => {
    if (v) openForm(String(v), route.query.type === 'moon' ? 'moon' : 'planet');
  },
  { immediate: true },
);
async function create() {
  const c = parseTarget(form.target);
  const time = fromLocalInput(form.time);
  if (!c || !time) {
    error.value = t('plans.formInvalid');
    return;
  }
  await run(async () => {
    const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans', {
      body: { g: c[0], s: c[1], p: c[2], type: form.type, target_time: time, note: form.note },
    });
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
    form.open = false;
    if (route.query.new) router.replace({ query: {} });
    loadClaims(uni.value);
  });
}

// ---- plan editing (creator, admins) ----
const editing = reactive<Record<number, { time: string; note: string }>>({});
const startEdit = (p: AttackPlan) => (editing[p.id] = { time: toLocalInput(p.target_time), note: p.note ?? '' });
async function savePlan(p: AttackPlan) {
  const e = editing[p.id];
  const time = fromLocalInput(e.time);
  if (!time) return void (error.value = t('plans.formInvalid'));
  await run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { target_time: time, note: e.note } }));
  delete editing[p.id];
  loadClaims(uni.value);
}
const setStatus = (p: AttackPlan, status: string) =>
  run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { status } })).then(() => loadClaims(uni.value));
function removePlan(p: AttackPlan) {
  if (!confirm(t('plans.confirmDelete', { target: target(p) }))) return;
  run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'DELETE' })).then(() => loadClaims(uni.value));
}

// ---- fleets ----
interface OwnPlanet {
  name: string;
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon';
  values: Record<string, number>;
}
const ownPlanets = ref<OwnPlanet[] | null>(null);
async function loadOwnPlanets() {
  if (ownPlanets.value) return;
  try {
    const r = await uniApi<{ empire: { data: { planets: OwnPlanet[] } } | null }>(uni.value, '/imperium');
    ownPlanets.value = r.empire?.data.planets ?? [];
  } catch {
    ownPlanets.value = [];
  }
}
const planetKey = (c: { g: number; s: number; p: number }, type: string | null) => `${c.g}:${c.s}:${c.p}:${type ?? 'planet'}`;

const fleetForm = reactive({ planId: 0, fleetId: 0, start: '', ships: {} as Record<number, number>, speed: 100 });
function openFleet(p: AttackPlan, f?: PlanFleet) {
  loadOwnPlanets();
  Object.assign(fleetForm, {
    planId: p.id,
    fleetId: f?.id ?? 0,
    start: f && f.g != null ? planetKey({ g: f.g, s: f.s!, p: f.p! }, f.planet_type) : '',
    ships: Object.fromEntries(Object.entries(f?.ships ?? {}).map(([id, n]) => [Number(id), n])),
    speed: f?.speed ?? 100,
  });
}
/** Picking a start fills in the ships on it (empire page); amounts stay editable. */
function pickStart() {
  const pl = ownPlanets.value?.find((x) => planetKey(x.coords, x.type) === fleetForm.start);
  if (!pl) return;
  fleetForm.ships = Object.fromEntries(FLEET_SHIPS.filter((id) => (pl.values[id] ?? 0) > 0).map((id) => [id, pl.values[id]]));
}
/** Ships offered in the form: those of the start planet and those already entered. */
const formShips = computed(() => {
  const pl = ownPlanets.value?.find((x) => planetKey(x.coords, x.type) === fleetForm.start);
  return FLEET_SHIPS.filter((id) => (pl?.values[id] ?? 0) > 0 || fleetForm.ships[id] != null);
});
const extraShip = ref(0);
function addShip() {
  if (extraShip.value) fleetForm.ships[extraShip.value] ??= 0;
  extraShip.value = 0;
}
async function saveFleet() {
  const [g, s, p, type] = fleetForm.start.split(':');
  const body = {
    ...(fleetForm.start ? { g: Number(g), s: Number(s), p: Number(p), type } : {}),
    ships: Object.fromEntries(Object.entries(fleetForm.ships).filter(([, n]) => n > 0)),
    speed: fleetForm.speed,
    ...(fleetForm.fleetId ? {} : { status: 'ready' }),
  };
  const path = `/plans/${fleetForm.planId}/fleets${fleetForm.fleetId ? `/${fleetForm.fleetId}` : ''}`;
  await run(() => uniApi(uni.value, path, { method: fleetForm.fleetId ? 'PUT' : 'POST', body }));
  fleetForm.planId = 0;
}
const setFleetStatus = (p: AttackPlan, f: PlanFleet, status: string) =>
  run(() => uniApi(uni.value, `/plans/${p.id}/fleets/${f.id}`, { method: 'PUT', body: { status } }));
function removeFleet(p: AttackPlan, f: PlanFleet) {
  if (confirm(t('plans.confirmRemoveFleet', { member: f.member }))) run(() => uniApi(uni.value, `/plans/${p.id}/fleets/${f.id}`, { method: 'DELETE' }));
}
const invitee = reactive<Record<number, number>>({});
function invite(p: AttackPlan) {
  const id = invitee[p.id];
  if (id) run(() => uniApi(uni.value, `/plans/${p.id}/fleets`, { body: { user_id: id } }));
  invitee[p.id] = 0;
}
const oldDrives = (f: PlanFleet) => !f.drives || now.value - f.drives.time > DRIVES_MAX_AGE;
</script>

<template>
  <h1>
    {{ t('nav.raidPlanner') }}
    <Hint>{{ t('plans.hint') }}</Hint>
  </h1>
  <div class="row" style="margin-bottom: 12px">
    <button class="primary" @click="openForm()">{{ t('plans.new') }}</button>
    <span v-if="info" class="warn small">{{ info }}</span>
  </div>
  <div v-if="error" class="error">{{ error }}</div>

  <div v-if="form.open" class="card plan-form">
    <h3>{{ t('plans.new') }}</h3>
    <div class="row">
      <label>{{ t('plans.target') }} <input v-model="form.target" class="mono" placeholder="1:41:1" size="10" /></label>
      <label>
        <select v-model="form.type">
          <option value="planet">{{ t('plans.planet') }}</option>
          <option value="moon">{{ t('plans.moon') }}</option>
        </select>
      </label>
      <label>{{ t('plans.targetTime') }} <input v-model="form.time" type="datetime-local" step="1" /></label>
      <input v-model="form.note" class="grow" maxlength="500" :placeholder="t('plans.note')" />
    </div>
    <div class="row" style="margin-top: 8px">
      <button class="primary" @click="create">{{ t('plans.create') }}</button>
      <button @click="form.open = false">{{ t('plans.cancelForm') }}</button>
      <span class="muted small">{{ t('plans.createHint') }}</span>
    </div>
  </div>

  <div v-if="loaded && !current.length && !form.open" class="card muted">{{ t('plans.none') }}</div>

  <template v-for="(list, i) in [current, past]" :key="i">
    <h2 v-if="i === 1 && list.length">{{ t('plans.past') }}</h2>
    <div v-for="p in list" :key="p.id" class="card plan" :class="{ closed: closed(p) }">
      <div class="row plan-head">
        <span v-if="p.planet_type === 'moon'" class="moon-tag">{{ t('plans.moon') }}</span>
        <strong class="mono">{{ target(p) }}</strong>
        <span class="muted">{{ p.planet_name ?? '' }}</span>
        <PlayerLink v-if="p.player_id" :id="p.player_id" :name="p.player_name ?? '?'" />
        <PlanetActions :g="p.g" :s="p.s" :p="p.p" :type="p.planet_type" />
        <span class="grow" />
        <span class="badge">{{ t(`plans.status.${p.status}`) }}</span>
      </div>

      <div class="row plan-time">
        <span>
          {{ t('plans.targetTime') }}: <b class="mono">{{ when(p.target_time) }}</b>
          <span class="muted small"> {{ until(p.target_time) }}</span>
        </span>
        <span v-if="views.get(p.id)?.acs?.delay" class="warn">
          ⚠ {{ t('plans.delayed', { t: duration(views.get(p.id)!.acs!.delay), at: clock(views.get(p.id)!.acs!.arrival) }) }}
        </span>
        <span class="muted small">{{ t('plans.by', { name: p.creator }) }}</span>
      </div>
      <div v-if="p.note && !editing[p.id]" class="small">{{ p.note }}</div>
      <div v-if="views.get(p.id)?.acs" class="small">
        <template v-if="views.get(p.id)!.acs!.fleets.length > 1">{{ t('plans.lead', { name: leadName(p) }) }}</template>
        <span v-if="views.get(p.id)!.acs!.tooManyFleets" class="warn"> ⚠ {{ t('plans.tooManyFleets') }}</span>
        <span v-if="views.get(p.id)!.acs!.tooManyPlayers" class="warn"> ⚠ {{ t('plans.tooManyPlayers') }}</span>
      </div>

      <div v-if="editing[p.id]" class="row edit-row">
        <label>{{ t('plans.targetTime') }} <input v-model="editing[p.id].time" type="datetime-local" step="1" /></label>
        <input v-model="editing[p.id].note" class="grow" maxlength="500" :placeholder="t('plans.note')" />
        <button class="primary" @click="savePlan(p)">{{ t('plans.save') }}</button>
        <button @click="delete editing[p.id]">{{ t('plans.cancelForm') }}</button>
      </div>

      <div class="table-wrap">
        <table v-stack class="data">
          <thead>
            <tr>
              <th>{{ t('plans.member') }}</th>
              <th>{{ t('plans.start') }}</th>
              <th>{{ t('plans.ships') }}</th>
              <th>{{ t('plans.speed') }}</th>
              <th>{{ t('plans.flight') }}</th>
              <th>{{ t('plans.launch') }}</th>
              <th>{{ t('plans.home') }}</th>
              <th>{{ t('plans.fleetStatus') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in views.get(p.id)!.fleets" :key="x.fleet.id" :class="{ mine: x.fleet.user_id === me }">
              <td>
                {{ x.fleet.member }}
                <span v-if="x.plan && views.get(p.id)!.acs!.lead === x.plan.id && views.get(p.id)!.acs!.fleets.length > 1" class="badge">{{ t('plans.leadShort') }}</span>
                <span v-if="x.duration != null && oldDrives(x.fleet)" class="warn small" :title="t('plans.drivesOld')"> ⚠</span>
              </td>
              <td class="mono">{{ x.fleet.g != null ? coords(x.fleet.g, x.fleet.s!, x.fleet.p!) : '–' }}<span v-if="x.fleet.planet_type === 'moon'" class="muted"> ☾</span></td>
              <td class="small">{{ shipList(x.fleet.ships) }}</td>
              <td>{{ x.fleet.speed }} %</td>
              <td class="mono">{{ x.duration != null ? duration(Math.floor(x.duration)) : '–' }}</td>
              <td>
                <template v-if="x.plan">
                  <span class="mono" :class="{ neg: x.plan.late }">{{ clock(x.plan.launch) }}</span>
                  <span class="muted small"> {{ until(x.plan.launch) }}</span>
                  <div class="small">
                    <span v-if="x.plan.late" class="neg">{{ t('plans.late') }} </span>
                    <span v-if="x.plan.delays" class="warn">{{ t('plans.delays') }} </span>
                    <span v-if="x.plan.beforeLead" class="warn">{{ t('plans.beforeLead') }} </span>
                    <span v-if="x.plan.outside" class="warn">{{ t('plans.outside') }} </span>
                  </div>
                </template>
                <span v-else class="muted small">{{ t('plans.incomplete') }}</span>
              </td>
              <td class="mono">{{ x.plan ? clock(x.plan.home) : '–' }}</td>
              <td>
                <select
                  v-if="canEditFleet(p, x.fleet) && !closed(p)"
                  :value="x.fleet.status"
                  :aria-label="t('plans.fleetStatus')"
                  @change="setFleetStatus(p, x.fleet, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="s in FLEET_STATUSES" :key="s" :value="s">{{ t(`plans.fleetStatuses.${s}`) }}</option>
                </select>
                <span v-else>{{ t(`plans.fleetStatuses.${x.fleet.status}`) }}</span>
              </td>
              <td class="actions">
                <template v-if="canEditFleet(p, x.fleet) && !closed(p)">
                  <button v-if="x.fleet.user_id === me" @click="openFleet(p, x.fleet)">{{ t('plans.edit') }}</button>
                  <button :title="t('plans.removeFleet')" @click="removeFleet(p, x.fleet)">✕</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!p.fleets.length" class="muted small">{{ t('plans.noFleets') }}</p>

      <div v-if="fleetForm.planId === p.id" class="fleet-form">
        <div class="row">
          <label>
            {{ t('plans.start') }}
            <select v-model="fleetForm.start" @change="pickStart">
              <option value="">–</option>
              <option v-for="pl in ownPlanets ?? []" :key="planetKey(pl.coords, pl.type)" :value="planetKey(pl.coords, pl.type)">
                {{ pl.name }} {{ coords(pl.coords.g, pl.coords.s, pl.coords.p) }}{{ pl.type === 'moon' ? ' ☾' : '' }}
              </option>
            </select>
          </label>
          <label>
            {{ t('plans.speed') }}
            <select v-model.number="fleetForm.speed">
              <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
            </select>
          </label>
          <span v-if="ownPlanets && !ownPlanets.length" class="muted small">{{ t('plans.noEmpire') }}</span>
        </div>
        <div class="ship-grid">
          <label v-for="id in formShips" :key="id" :title="name(id)">
            {{ abbr(id) }} <input v-model.number="fleetForm.ships[id]" type="number" min="0" />
          </label>
          <span class="row">
            <select v-model.number="extraShip" :aria-label="t('plans.addShip')">
              <option :value="0">+ {{ t('plans.addShip') }}</option>
              <option v-for="id in FLEET_SHIPS.filter((x) => !formShips.includes(x))" :key="id" :value="id">{{ name(id) }}</option>
            </select>
            <button v-if="extraShip" @click="addShip">{{ t('plans.add') }}</button>
          </span>
        </div>
        <div class="row">
          <button class="primary" @click="saveFleet">{{ t('plans.save') }}</button>
          <button @click="fleetForm.planId = 0">{{ t('plans.cancelForm') }}</button>
        </div>
      </div>

      <div v-if="!closed(p)" class="row plan-actions">
        <button v-if="fleetForm.planId !== p.id" @click="openFleet(p)">{{ t('plans.addFleet') }}</button>
        <template v-if="canEdit(p)">
          <select v-model.number="invitee[p.id]" :aria-label="t('plans.invite')" @change="invite(p)">
            <option :value="0">{{ t('plans.invite') }} …</option>
            <option v-for="m in ctx?.members.filter((m) => m.id !== me) ?? []" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
          <button v-if="!editing[p.id]" @click="startEdit(p)">{{ t('plans.editPlan') }}</button>
        </template>
      </div>
      <div v-if="canEdit(p)" class="row plan-actions">
        <span class="muted small">{{ t('plans.setStatus') }}</span>
        <button v-for="s in PLAN_STATUSES.filter((x) => x !== p.status)" :key="s" @click="setStatus(p, s)">{{ t(`plans.status.${s}`) }}</button>
        <span class="grow" />
        <button class="danger" @click="removePlan(p)">{{ t('plans.delete') }}</button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.plan { display: flex; flex-direction: column; gap: 8px; }
.plan.closed { opacity: .7; }
.plan-head { gap: 6px; }
.plan-time { gap: 14px; }
.plan-form h3 { margin: 0 0 8px; }
.edit-row, .fleet-form { padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); }
.fleet-form { display: flex; flex-direction: column; gap: 8px; }
.ship-grid { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
.ship-grid input { width: 90px; }
.plan-actions { gap: 6px; }
tr.mine td:first-child { font-weight: 600; }
td.actions { white-space: nowrap; }
td.actions button { padding: 1px 8px; }
button.danger { color: var(--neg); }
</style>

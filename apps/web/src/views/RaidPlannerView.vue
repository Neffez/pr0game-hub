<script setup lang="ts">
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlanTargetForm from '../components/PlanTargetForm.vue';
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
  draftBody,
  draftOf,
  DRIVES_MAX_AGE,
  FLEET_SHIPS,
  FLEET_STATUSES,
  isCurrent,
  newDraft,
  PLAN_STATUSES,
  SPEEDS,
  type AttackPlan,
  type PlanDraft,
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
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}

const settings = computed(() => ctx.value!.universe.settings);
const me = computed(() => ctx.value?.me.id);
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || !!ctx.value?.me.isAdmin);
const canEdit = (p: AttackPlan) => p.user_id === me.value || isAdmin.value;
const canEditFleet = (p: AttackPlan, f: PlanFleet) => f.user_id === me.value || canEdit(p);
const closed = (p: AttackPlan) => p.status === 'done' || p.status === 'cancelled';
const hasCoords = (p: AttackPlan) => p.g != null;

const views = computed(() => new Map(plans.value.map((p) => [p.id, computePlan(settings.value, p, now.value)])));
const current = computed(() => plans.value.filter((p) => isCurrent(p, now.value)));
const past = computed(() => plans.value.filter((p) => !isCurrent(p, now.value)).reverse());

// ---- times ----
const fmtDate = (epoch: number, opts: Intl.DateTimeFormatOptions) => new Date(epoch * 1000).toLocaleString(intlLocale(), opts);
const DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit' };
/** Target time as precise as it is known: the day, around an hour, or to the second. */
function targetText(p: AttackPlan) {
  if (p.time_precision === 'day') return fmtDate(p.target_time, DAY);
  if (p.time_precision === 'hour') return t('plans.around', { t: fmtDate(p.target_time, { ...DAY, hour: '2-digit', minute: '2-digit' }) });
  return fmtDate(p.target_time, { ...DAY, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
const clock = (epoch: number) => fmtDate(epoch, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const shortClock = (epoch: number) => fmtDate(epoch, { hour: '2-digit', minute: '2-digit' });
/** Countdown "in 1:02:03" / "vor 5:00"; for days "in 2 Tagen". */
function until(epoch: number) {
  const s = epoch - now.value;
  if (Math.abs(s) >= 2 * 86400) return t(s >= 0 ? 'plans.inDays' : 'plans.agoDays', { n: Math.floor(Math.abs(s) / 86400) });
  return s >= 0 ? t('plans.in', { t: duration(s) || '0:00:00' }) : t('plans.ago', { t: duration(-s) });
}

const shipList = (ships: Record<string, number>) =>
  Object.entries(ships)
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(', ') || '–';
/** Member sending the lead fleet of the ACS. */
const leadName = (p: AttackPlan) => p.fleets.find((f) => String(f.id) === views.value.get(p.id)?.acs?.lead)?.member ?? '?';
const targetLabel = (p: AttackPlan) => (p.g != null ? coords(p.g, p.s!, p.p!) : (p.player_name ?? '?'));
/** Exact launch times and warnings only make sense with coordinates and an exact target time. */
const exact = (p: AttackPlan) => hasCoords(p) && p.time_precision === 'exact';

// ---- new plan ----
const form = reactive({ open: false, draft: newDraft(nowSec()) });
const info = ref('');
function openForm(target = '', type: 'planet' | 'moon' = 'planet') {
  form.draft = newDraft(nowSec(), target, type);
  form.open = true;
}
watch(
  () => route.query.new,
  (v) => {
    if (v) openForm(String(v), route.query.type === 'moon' ? 'moon' : 'planet');
  },
  { immediate: true },
);
async function create() {
  const body = draftBody(form.draft);
  if (!body) return void (error.value = t('plans.formInvalid'));
  const ok = await run(async () => {
    const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans', { body });
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  if (!ok) return;
  form.open = false;
  if (route.query.new) router.replace({ query: {} });
  loadClaims(uni.value);
}

// ---- plan editing (creator, admins) ----
const editing = reactive<Record<number, PlanDraft>>({});
const startEdit = (p: AttackPlan) => (editing[p.id] = draftOf(p));
async function savePlan(p: AttackPlan) {
  const body = draftBody(editing[p.id]);
  if (!body) return void (error.value = t('plans.formInvalid'));
  const ok = await run(async () => {
    const res = await uniApi<{ claimedBy: string | null }>(uni.value, `/plans/${p.id}`, { method: 'PUT', body });
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  if (ok) delete editing[p.id];
  loadClaims(uni.value);
}
const setStatus = (p: AttackPlan, status: string) =>
  run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { status } })).then(() => loadClaims(uni.value));
function removePlan(p: AttackPlan) {
  if (!confirm(t('plans.confirmDelete', { target: targetLabel(p) }))) return;
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

const fleetForm = reactive({ planId: 0, fleetId: 0, start: '', ships: {} as Record<number, number>, speed: 100, pick: 0 });
function openFleet(p: AttackPlan, f?: PlanFleet) {
  loadOwnPlanets();
  Object.assign(fleetForm, {
    planId: p.id,
    fleetId: f?.id ?? 0,
    start: f && f.g != null ? planetKey({ g: f.g, s: f.s!, p: f.p! }, f.planet_type) : '',
    ships: Object.fromEntries(Object.entries(f?.ships ?? {}).map(([id, n]) => [Number(id), n])),
    speed: f?.speed ?? 100,
    pick: 0,
  });
}
const startPlanet = computed(() => ownPlanets.value?.find((x) => planetKey(x.coords, x.type) === fleetForm.start) ?? null);
/** Ships on the start planet (empire page); null when unknown (no start or no empire page). */
const available = (id: number): number | null => (startPlanet.value ? (startPlanet.value.values[id] ?? 0) : null);
/** Ships to add: those on the start planet not added yet (all ships when the planet is unknown). */
const pickable = computed(() =>
  FLEET_SHIPS.filter((id) => fleetForm.ships[id] == null && (startPlanet.value ? (startPlanet.value.values[id] ?? 0) > 0 : true)),
);
function addShip(max: boolean) {
  const id = fleetForm.pick;
  if (!id) return;
  fleetForm.ships[id] = max ? (available(id) ?? 0) : 0;
  fleetForm.pick = 0;
}
const removeShip = (id: number) => delete fleetForm.ships[id];
async function saveFleet() {
  const [g, s, p, type] = fleetForm.start.split(':');
  const body = {
    ...(fleetForm.start ? { g: Number(g), s: Number(s), p: Number(p), type } : {}),
    ships: Object.fromEntries(Object.entries(fleetForm.ships).filter(([, n]) => n > 0)),
    speed: fleetForm.speed,
    ...(fleetForm.fleetId ? {} : { status: 'ready' }),
  };
  const path = `/plans/${fleetForm.planId}/fleets${fleetForm.fleetId ? `/${fleetForm.fleetId}` : ''}`;
  if (await run(() => uniApi(uni.value, path, { method: fleetForm.fleetId ? 'PUT' : 'POST', body }))) fleetForm.planId = 0;
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
    <PlanTargetForm v-model="form.draft" />
    <div class="row">
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
        <template v-if="hasCoords(p)">
          <span v-if="p.planet_type === 'moon'" class="moon-tag">{{ t('plans.moon') }}</span>
          <strong class="mono">{{ coords(p.g!, p.s!, p.p!) }}</strong>
          <span v-if="p.planet_name" class="muted">{{ p.planet_name }}</span>
        </template>
        <span v-else class="warn small">{{ t('plans.coordsMissing') }}</span>
        <PlayerLink v-if="p.player_id" :id="p.player_id" :name="p.player_name ?? '?'" />
        <PlanetActions v-if="hasCoords(p)" :g="p.g!" :s="p.s!" :p="p.p!" :type="p.planet_type" />
        <span class="grow" />
        <span class="badge">{{ t(`plans.status.${p.status}`) }}</span>
      </div>

      <div class="times">
        <span class="time">
          <span class="lbl">{{ t('plans.targetTime') }}</span>
          <b class="mono">{{ targetText(p) }}</b>
          <span v-if="p.time_precision !== 'day'" class="muted small">{{ until(p.target_time) }}</span>
        </span>
        <span v-if="exact(p) && views.get(p.id)?.acs?.delay" class="time warn">
          <span class="lbl">⚠ {{ t('plans.arrival') }}</span>
          <b class="mono">{{ clock(views.get(p.id)!.acs!.arrival) }}</b>
          <span class="small">{{ t('plans.delayedBy', { t: duration(views.get(p.id)!.acs!.delay) }) }}</span>
        </span>
        <span class="muted small">{{ t('plans.by', { name: p.creator }) }}</span>
      </div>
      <div v-if="p.note && !editing[p.id]" class="small">{{ p.note }}</div>
      <div v-if="views.get(p.id)?.acs" class="small">
        <template v-if="views.get(p.id)!.acs!.fleets.length > 1">{{ t('plans.lead', { name: leadName(p) }) }}</template>
        <span v-if="views.get(p.id)!.acs!.tooManyFleets" class="warn"> ⚠ {{ t('plans.tooManyFleets') }}</span>
        <span v-if="views.get(p.id)!.acs!.tooManyPlayers" class="warn"> ⚠ {{ t('plans.tooManyPlayers') }}</span>
      </div>
      <div v-if="!exact(p)" class="muted small">{{ hasCoords(p) ? t('plans.roughTime') : t('plans.noCoordsHint') }}</div>

      <div v-if="editing[p.id]" class="edit-box">
        <PlanTargetForm v-model="editing[p.id]" />
        <div class="row">
          <button class="primary" @click="savePlan(p)">{{ t('plans.save') }}</button>
          <button @click="delete editing[p.id]">{{ t('plans.cancelForm') }}</button>
        </div>
      </div>

      <div v-if="p.fleets.length" class="table-wrap">
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
                <template v-if="x.plan && exact(p)">
                  <span class="time">
                    <span class="mono" :class="{ neg: x.plan.late }">{{ clock(x.plan.launch) }}</span>
                    <span class="muted small">{{ until(x.plan.launch) }}</span>
                  </span>
                  <div class="small flags">
                    <span v-if="x.plan.late" class="neg">{{ t('plans.late') }}</span>
                    <span v-if="x.plan.delays" class="warn">{{ t('plans.delays') }}</span>
                    <span v-if="x.plan.beforeLead" class="warn">{{ t('plans.beforeLead') }}</span>
                    <span v-if="x.plan.outside" class="warn">{{ t('plans.outside') }}</span>
                  </div>
                </template>
                <span v-else-if="x.plan && p.time_precision === 'hour'" class="mono">{{ t('plans.around', { t: shortClock(x.plan.launch) }) }}</span>
                <span v-else-if="x.duration == null" class="muted small">{{ hasCoords(p) ? t('plans.incomplete') : '–' }}</span>
                <span v-else class="muted small">–</span>
              </td>
              <td class="mono">{{ x.plan && exact(p) ? clock(x.plan.home) : '–' }}</td>
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
      <p v-else class="muted small">{{ t('plans.noFleets') }}</p>

      <div v-if="fleetForm.planId === p.id" class="fleet-form">
        <div class="row">
          <label>
            {{ t('plans.start') }}
            <select v-model="fleetForm.start">
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
        <div v-for="(n, id) in fleetForm.ships" :key="id" class="ship-row">
          <span class="ship-name" :title="name(Number(id))">{{ name(Number(id)) }}</span>
          <input v-model.number="fleetForm.ships[Number(id)]" type="number" min="0" />
          <button v-if="available(Number(id)) != null" :title="t('plans.maxTitle')" @click="fleetForm.ships[Number(id)] = available(Number(id))!">
            {{ t('plans.max') }}
          </button>
          <span v-if="available(Number(id)) != null" class="muted small">/ {{ fmt(available(Number(id))!) }}</span>
          <span v-if="available(Number(id)) != null && n > available(Number(id))!" class="warn small">{{ t('plans.moreThanAvailable') }}</span>
          <button :title="t('plans.removeShip')" @click="removeShip(Number(id))">✕</button>
        </div>
        <div class="row">
          <select v-model.number="fleetForm.pick" :aria-label="t('plans.addShip')">
            <option :value="0">{{ t('plans.addShip') }} …</option>
            <option v-for="id in pickable" :key="id" :value="id">{{ name(id) }}{{ available(id) != null ? ` (${fmt(available(id)!)})` : '' }}</option>
          </select>
          <button :disabled="!fleetForm.pick" @click="addShip(false)">{{ t('plans.add') }}</button>
          <button v-if="startPlanet" :disabled="!fleetForm.pick" :title="t('plans.maxTitle')" @click="addShip(true)">{{ t('plans.max') }}</button>
          <span v-if="startPlanet && !pickable.length && !Object.keys(fleetForm.ships).length" class="muted small">{{ t('plans.noShips') }}</span>
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
.plan-form { display: flex; flex-direction: column; gap: 10px; }
.plan-form h3 { margin: 0; }
/* times: label, value and countdown with fixed gaps, wrapping as a whole */
.times { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 20px; }
.time { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.time .lbl { color: var(--muted); font-size: 12px; }
.time.warn .lbl, .time.warn b { color: var(--warn); }
.flags { display: flex; flex-wrap: wrap; gap: 2px 8px; }
.edit-box, .fleet-form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); }
.ship-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ship-name { min-width: 150px; }
.ship-row input { width: 110px; }
.plan-actions { gap: 6px; }
tr.mine td:first-child { font-weight: 600; }
td.actions { white-space: nowrap; }
td.actions button { padding: 1px 8px; }
button.danger { color: var(--neg); }
</style>

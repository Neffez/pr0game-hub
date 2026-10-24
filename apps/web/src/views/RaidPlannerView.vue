<script setup lang="ts">
import Countdown from '../components/Countdown.vue';
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlanTargetForm from '../components/PlanTargetForm.vue';
import PlayerLink from '../components/PlayerLink.vue';
import HoldPanel from '../components/HoldPanel.vue';
import LootSettlementList from '../components/LootSettlementList.vue';
import RetimePanel from '../components/RetimePanel.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { loadClaims } from '../claims';
import { useStored, useUni, vStack } from '../composables';
import { abbr, clockTime, coords, duration, fmt, name, numDate, simLinks, timeWithAge, weekday, type Coords3, type SimFleet } from '../format';
import { intlLocale } from '../i18n';
import { tables, useLiveReload } from '../live';
import {
  computePlan,
  draftBody,
  draftOf,
  DRIVES_MAX_AGE,
  FLEET_SHIPS,
  holdPlanetValues,
  FLEET_STATUSES,
  isCurrent,
  candidateHome,
  DEFAULT_BUFFER,
  enemyCandidates,
  fleetCalcLink,
  latestTime,
  mainFleet,
  newDraft,
  PLAN_STATUSES,
  seenShipsDiffer,
  SPEEDS,
  type AttackPlan,
  type HostileAttack,
  type OwnAttack,
  type PlanDraft,
  type PlanFleet,
} from '../plans';

/** Raid planner: own attacks of one or more members (solo or ACS) landing on one target at one second. */
const { t } = useI18n();
const { uni, ctx } = useUni();
const route = useRoute();
const router = useRouter();
/** plans, or the attacks and holds to settle (link: ?tab=settlements) */
type PlannerTab = 'plans' | 'settlements';
const storedTab = useStored<PlannerTab>('raidPlanner.tab', 'plans');
const tab = computed<PlannerTab>({
  get: () => (route.query.tab === 'settlements' || route.query.tab === 'plans' ? route.query.tab : storedTab.value),
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});

const nowSec = () => Math.floor(Date.now() / 1000);
/**
 * Time for the plan state (late, delays, current or past). It only moves when something changes: at the next launch,
 * target time or end of a plan, at least every minute. Countdowns tick on their own (Countdown), so the page is not
 * rendered again every second (that reset open dropdowns).
 */
const now = ref(nowSec());
let stepTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleStep() {
  clearTimeout(stepTimer);
  const t0 = nowSec();
  const next = Math.min(
    t0 + 60,
    ...plans.value.flatMap((p) => [p.target_time, latestTime(p) + 3601, ...(views.value.get(p.id)?.fleets.map((x) => x.plan?.launch ?? Infinity) ?? [])]).filter((x) => x > t0),
    // an attack arrives: no hold any more
    ...attacks.value.map((a) => a.arrival).filter((x) => x > t0),
    // an own attack arrives: off the list
    ...ownAttacks.value.map((a) => a.arrival).filter((x) => x > t0),
  );
  stepTimer = setTimeout(() => {
    now.value = nowSec();
    scheduleStep();
  }, (next - t0) * 1000 + 50);
}
onBeforeUnmount(() => clearTimeout(stepTimer));

const plans = ref<AttackPlan[]>([]);
/** hostile attacks on members (overview pastes), to plan a retime on */
const attacks = ref<HostileAttack[]>([]);
/** own attacks in flight (overview pastes) without a plan yet, only those the viewer flies in */
const ownAttacks = ref<OwnAttack[]>([]);
const loaded = ref(false);
const error = ref('');
async function load() {
  try {
    [plans.value, attacks.value, ownAttacks.value] = await Promise.all([
      uniApi<AttackPlan[]>(uni.value, '/plans'),
      uniApi<HostileAttack[]>(uni.value, '/hostile-attacks'),
      uniApi<OwnAttack[]>(uni.value, '/own-attacks'),
    ]);
    now.value = nowSec();
  } catch (e) {
    error.value = (e as Error).message;
  }
  loaded.value = true;
  scheduleStep();
}
onMounted(load);
useLiveReload(load, tables('attack_plans', 'fleets', 'hidden_attacks'), 300);

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
/**
 * Combat simulators with the target's newest spy report (needs the game URL of the universe) and the plan's fleets
 * (not withdrawn, with ships) with the research of their member's empire page. Hold plans swap the sides: the enemy
 * fleets attack, the plan's fleets defend the planet next to its own fleet and defense.
 */
const planFleets = (p: AttackPlan): SimFleet[] => [
  ...p.fleets
    .filter((f) => f.status !== 'withdrawn' && Object.values(f.ships).some((n) => n > 0))
    .map((f) => ({ ships: f.ships, research: f.drives?.research ?? {}, from: f.g != null ? [f.g, f.s!, f.p!] as Coords3 : null, speed: f.speed })),
  // ACS fleets of non-members, research from spy reports of their player
  ...(p.guests ?? []).map((g) => ({ ships: g.ships, research: g.research ?? {}, from: [g.from.g, g.from.s, g.from.p] as Coords3, speed: 100 })),
];
const sims = (p: AttackPlan) => {
  const target: Coords3 | null = hasCoords(p) ? [p.g!, p.s!, p.p!] : null;
  if (!settings.value.gameUrl) return null;
  if (p.mission === 'hold' && p.enemy) {
    const e = p.enemy;
    const research = { ...(e.research ?? {}), ...e.drives };
    const enemies = e.fleets.map((f) => ({ ships: f.ships, research, from: [e.from.g, e.from.s, e.from.p] as Coords3, speed: e.percent ?? 100 }));
    return simLinks(settings.value.gameUrl, holdPlanetValues(p), enemies, target, planFleets(p));
  }
  return p.spy ? simLinks(settings.value.gameUrl, p.spy.values, planFleets(p), target) : null;
};
/** Tooltips of the simulator links: what they are filled with. */
const simTitle = (p: AttackPlan, sim: 'Game' | 'Trash') =>
  p.mission === 'hold'
    ? t(`plans.simHold${sim}Title`, { planet: p.spy ? timeWithAge(p.spy.time) : t('plans.simNoData'), enemy: p.enemy?.research_time ? timeWithAge(p.enemy.research_time) : t('plans.simNoData') })
    : t(`plans.sim${sim}Title`, { time: timeWithAge(p.spy!.time) });
const me = computed(() => ctx.value?.me.id);
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || !!ctx.value?.me.isAdmin);
const canEdit = (p: AttackPlan) => p.user_id === me.value || isAdmin.value;
/** Every participant may change any fleet of the plan (members away or without an account); removing stays with the member. */
const isParticipant = (p: AttackPlan) => p.fleets.some((f) => f.user_id === me.value);
const canEditFleet = (p: AttackPlan, f: PlanFleet) => f.user_id === me.value || canEdit(p) || isParticipant(p);
const canRemoveFleet = (p: AttackPlan, f: PlanFleet) => f.user_id === me.value || canEdit(p);
const closed = (p: AttackPlan) => p.status === 'done' || p.status === 'cancelled';
const hasCoords = (p: AttackPlan) => p.g != null;
/** Attacks and holds that flew can be settled (loot, debris, losses). */
const settleable = (p: AttackPlan) => hasCoords(p) && (p.status === 'launched' || p.status === 'done');

const views = computed(() => new Map(plans.value.map((p) => [p.id, computePlan(settings.value, p, now.value)])));
const current = computed(() => plans.value.filter((p) => isCurrent(p, now.value)));
const past = computed(() => plans.value.filter((p) => !isCurrent(p, now.value)).reverse());

// ---- collapsing ----
/** Opened and closed plans of this viewer (browser storage, per universe); a plan without a choice follows `isOpen`. */
const OPEN_KEY = `raidPlanner.open.${uni.value}`;
const openState = reactive<Record<number, boolean>>(readOpen());
function readOpen(): Record<number, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}
watch(openState, (v) => {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(v));
  } catch {
    /* kept for this page only */
  }
});
/** Current plans are open while there are at most two, past ones closed. */
const isOpen = (p: AttackPlan) => openState[p.id] ?? (isCurrent(p, now.value) && current.value.length <= 2);
const toggle = (p: AttackPlan) => (openState[p.id] = !isOpen(p));
/** `?plan=<id>` (an invitation from the bell): opens that plan and scrolls to it once loaded. */
watch(
  [() => route.query.plan, plans],
  async ([id]) => {
    const plan = id ? plans.value.find((p) => p.id === Number(id)) : undefined;
    if (!plan) return;
    openState[plan.id] = true;
    router.replace({ query: {} });
    await nextTick();
    document.getElementById(`plan-${plan.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  { immediate: true },
);
/** The viewer's next own launch in a plan (not launched yet), for the closed plan's summary. */
const myLaunch = (p: AttackPlan) =>
  views.value.get(p.id)?.fleets.find((x) => x.fleet.user_id === me.value && x.plan && !x.fleet.seen && x.fleet.status !== 'launched' && x.plan.launch > now.value)?.plan
    ?.launch ?? null;
const flying = (p: AttackPlan) => p.fleets.filter((f) => f.status !== 'withdrawn').length;

// ---- times ----
const fmtDate = (epoch: number, opts: Intl.DateTimeFormatOptions) => new Date(epoch * 1000).toLocaleString(intlLocale(), opts);
/** Target time as precise as it is known: the day, around an hour, or to the second. */
function targetText(p: AttackPlan) {
  const d = new Date(p.target_time * 1000);
  const day = `${weekday(d)} ${numDate(d, 'none')}`;
  if (p.time_precision === 'day') return day;
  if (p.time_precision === 'hour') return t('plans.around', { t: `${day}, ${clockTime(d)}` });
  return `${day}, ${clockTime(d, true)}`;
}
const clock = (epoch: number) => fmtDate(epoch, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
/** Real arrival against the target time: "on time", "+3 s", "−1:05". */
const offset = (d: number) => (d === 0 ? t('plans.onTime') : `${d > 0 ? '+' : '−'}${Math.abs(d) < 60 ? `${Math.abs(d)} s` : duration(Math.abs(d))}`);
const shortClock = (epoch: number) => fmtDate(epoch, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' });

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
    openState[res.id] = true;
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  if (!ok) return;
  form.open = false;
  if (route.query.new) router.replace({ query: {} });
  loadClaims(uni.value);
}

// ---- retime ----
/** Starts a retime plan on a hostile attack: follows the main fleet, target time first its return at full speed plus 1 s. */
async function planRetime(a: HostileAttack) {
  const follow = mainFleet(a.fleets);
  const input = { ...a, follow, first_seen: a.arrival, drives: a.drives?.research ?? {}, departure: null, recall: null, recall_lead: true };
  const full = enemyCandidates(settings.value, input)[0];
  // a phalanx showing the return gives the landing home directly
  const target = (a.home ?? (full ? candidateHome(full) : a.arrival + 3600)) + DEFAULT_BUFFER;
  await run(async () => {
    const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans/retime', { body: { key: a.key, follow, target_time: target, buffer: DEFAULT_BUFFER } });
    openState[res.id] = true;
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  loadClaims(uni.value);
}
/** Own attack in flight: a plan with the fleets flying (launched), visible to everyone from then on. */
async function planOwn(a: OwnAttack) {
  await run(async () => {
    const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans/own', { body: { key: a.key } });
    openState[res.id] = true;
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  loadClaims(uni.value);
}
const ownAttackShips = (a: OwnAttack) =>
  a.fleets.length > 1 ? t('notify.acs', { n: a.fleets.length }) : (a.fleets[0]?.mission != null ? t(`game.missions.${a.fleets[0].mission}`) : '');
const ownFleetName = (f: OwnAttack['fleets'][number]) => f.member ?? f.player?.name ?? coords(f.from.g, f.from.s, f.from.p);

/** Phalanx result (copied like the overview): its attacks join the list above. */
const phalanx = reactive({ open: false, text: '' });
async function sendPhalanx() {
  await run(async () => {
    const res = await uniApi<{ attacks: number }>(uni.value, '/phalanx', { body: { text: phalanx.text } });
    info.value = t('phalanx.found', { n: res.attacks }, res.attacks);
    Object.assign(phalanx, { open: false, text: '' });
  });
}

/** Hold on the attacked planet: the fleets land 1 s before the impact (changeable in the plan). */
async function planHold(a: HostileAttack) {
  await run(async () => {
    const res = await uniApi<{ id: number }>(uni.value, '/plans/hold', { body: { key: a.key } });
    openState[res.id] = true;
  });
}
/** Hidden by hand for the whole group; shown again from the section at the end. */
const shownAttacks = computed(() => attacks.value.filter((a) => !a.hidden));
const hiddenAttacks = computed(() => attacks.value.filter((a) => a.hidden));
const showHidden = ref(false);
async function setHidden(a: HostileAttack, hide: boolean) {
  await run(() => uniApi(uni.value, `/hostile-attacks/${hide ? 'hide' : 'unhide'}`, { body: { key: a.key } }));
}
const attackShips = (a: HostileAttack) =>
  a.fleets.length > 1 ? t('notify.acs', { n: a.fleets.length }) : (a.fleets[0]?.mission != null ? t(`game.missions.${a.fleets[0].mission}`) : '');
/** Enemy inputs: creator, admins, participants and, on a hold, the attacked member (the ships on their planet). */
const canEditEnemy = (p: AttackPlan) => canEdit(p) || isParticipant(p) || (p.mission === 'hold' && p.enemy?.member_id === me.value);

// ---- plan editing (creator, admins) ----
const editing = reactive<Record<number, PlanDraft>>({});
/** the plan as the edit started: an unchanged time is not sent, so it cannot undo a retime saved meanwhile */
const editStart: Record<number, PlanDraft> = {};
const startEdit = (p: AttackPlan) => ((editStart[p.id] = draftOf(p)), (editing[p.id] = draftOf(p)));
async function savePlan(p: AttackPlan) {
  const d = editing[p.id];
  const full = draftBody(d);
  if (!full) return void (error.value = t('plans.formInvalid'));
  const o = editStart[p.id];
  const { target_time, time_precision, ...rest } = full;
  const body = o && o.precision === d.precision && o.date === d.date && o.time === d.time ? rest : full;
  const ok = await run(async () => {
    const res = await uniApi<{ claimedBy: string | null }>(uni.value, `/plans/${p.id}`, { method: 'PUT', body });
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  if (ok) delete editing[p.id];
  loadClaims(uni.value);
}
/** Open coordinates: the creator, admins and every participant (also only invited) fill them in. */
const canSetCoords = (p: AttackPlan) => !closed(p) && (canEdit(p) || isParticipant(p));
const coordsEdit = reactive<Record<number, PlanDraft>>({});
async function saveCoords(p: AttackPlan) {
  const body = draftBody(coordsEdit[p.id]);
  if (!body || body.g == null) return void (error.value = t('plans.coordsInvalid'));
  const ok = await run(async () => {
    const res = await uniApi<{ claimedBy: string | null }>(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { g: body.g, s: body.s, p: body.p, type: body.type } });
    info.value = res.claimedBy ? t('plans.claimedBy', { name: res.claimedBy }) : '';
  });
  if (ok) delete coordsEdit[p.id];
  loadClaims(uni.value);
}
const setStatus = (p: AttackPlan, status: string) =>
  run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { status } })).then(() => loadClaims(uni.value));
function removePlan(p: AttackPlan) {
  if (!confirm(t('plans.confirmDelete', { target: targetLabel(p) }))) return;
  run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'DELETE' })).then(() => loadClaims(uni.value));
}

// ---- fleets ----
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
  /** ships on fleets in flight (✈) */
  flyingShips?: Record<string, number>;
  /** where the planets come from: the member's empire page or the spy reports of their player */
  source?: 'empire' | 'spy';
  time?: number;
}
/** Latest empire pages of the members whose fleets are edited, by user id; without one put together from spy reports. */
const empires = reactive<Record<number, OwnEmpire>>({});
const ownEmpire = computed(() => empires[fleetForm.userId] ?? null);
const ownPlanets = computed(() => ownEmpire.value?.planets ?? null);
async function loadEmpire(userId: number) {
  if (empires[userId]) return;
  try {
    const r = await uniApi<{ empire: { time: number; data: OwnEmpire } | null; spy: (OwnEmpire & { time: number }) | null }>(
      uni.value,
      `/imperium?user=${userId}`,
    );
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
const fleetForm = reactive({
  planId: 0,
  fleetId: 0,
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
function openFleet(p: AttackPlan, f?: PlanFleet) {
  const userId = f?.user_id ?? me.value!;
  loadEmpire(userId);
  Object.assign(fleetForm, {
    planId: p.id,
    fleetId: f?.id ?? 0,
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
}
const startPlanet = computed(() => ownPlanets.value?.find((x) => planetKey(x.coords, x.type) === fleetForm.start) ?? null);
const onStart = (id: number) => startPlanet.value?.values[id] ?? 0;
/** Maximum of an added ship: on the start planet or all own ones, as picked (for saved fleets: start first). */
function cap(id: number): number | null {
  const from = fleetForm.from[id] ?? (onStart(id) > 0 ? 'start' : 'all');
  const n = from === 'start' ? onStart(id) : (owned.value[id] ?? 0);
  return n > 0 || from === 'start' ? n : null;
}
const added = (id: number) => fleetForm.ships[id] != null;
/** Ships to add: those on the start planet, and all own ones (also those still to be moved there). */
const startShips = computed(() => FLEET_SHIPS.filter((id) => !added(id) && onStart(id) > 0));
const ownShips = computed(() => FLEET_SHIPS.filter((id) => !added(id) && (owned.value[id] ?? 0) > 0));
/** Without an empire page (also with spy reports, which may miss planets) any ship can be entered by hand. */
const otherShips = computed(() => (ownEmpire.value?.source === 'empire' ? [] : FLEET_SHIPS.filter((id) => !added(id))));
/** The start is typed in: no planets known, "other coordinates" picked, or a saved start not among the planets. */
const typedStart = computed(
  () =>
    !ownPlanets.value?.length ||
    fleetForm.start === 'manual' ||
    (!!fleetForm.start && !ownPlanets.value.some((pl) => planetKey(pl.coords, pl.type) === fleetForm.start)),
);
const changeDrives = () => Object.assign(fleetForm, { drivesChanged: true, drivesReset: false });
const resetDrives = () => Object.assign(fleetForm, { drivesChanged: false, drivesReset: true });
/** Where the drive levels in the form come from. */
const drivesInfo = computed(() => {
  if (fleetForm.drivesChanged) return t('plans.drivesSource.manual');
  if (fleetForm.drivesReset) return t('plans.drivesResetPending');
  if (!fleetForm.drivesSource) return t('plans.drivesSource.none');
  return `${t(`plans.drivesSource.${fleetForm.drivesSource}`)}${fleetForm.drivesTime ? ` · ${numDate(new Date(fleetForm.drivesTime * 1000))}` : ''}`;
});
/** Picking a ship adds all of them (start planet or all own ones); the amount stays editable. */
function pickShip(e: Event) {
  const el = e.target as HTMLSelectElement;
  const [from, raw] = el.value.split(':');
  el.value = '';
  const id = Number(raw);
  if (!id) return;
  if (from === 'start' || from === 'all') fleetForm.from[id] = from;
  fleetForm.ships[id] = from === 'start' ? onStart(id) : from === 'all' ? (owned.value[id] ?? 0) : 0;
}
function removeShip(id: number) {
  delete fleetForm.ships[id];
  delete fleetForm.from[id];
}
/** Start typed in: g:s:p, null when empty, undefined when invalid. */
function manualStart(): { g: number; s: number; p: number; type: string } | null | undefined {
  const text = fleetForm.manual.trim();
  if (!text) return null;
  const m = /^(\d+):(\d+):(\d+)$/.exec(text);
  return m ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]), type: fleetForm.moon ? 'moon' : 'planet' } : undefined;
}
async function saveFleet() {
  const [g, s, p, type] = fleetForm.start.split(':');
  const manual = typedStart.value ? manualStart() : null;
  if (manual === undefined) {
    error.value = t('plans.startInvalid');
    return;
  }
  const body = {
    ...(manual ?? (fleetForm.start && !typedStart.value ? { g: Number(g), s: Number(s), p: Number(p), type } : {})),
    ...(fleetForm.drivesReset ? { drives: null } : fleetForm.drivesChanged ? { drives: fleetForm.drives } : {}),
    ships: Object.fromEntries(Object.entries(fleetForm.ships).filter(([, n]) => n > 0)),
    speed: fleetForm.speed,
    ...(fleetForm.fleetId ? {} : { status: 'ready' }),
  };
  const path = `/plans/${fleetForm.planId}/fleets${fleetForm.fleetId ? `/${fleetForm.fleetId}` : ''}`;
  if (await run(() => uniApi(uni.value, path, { method: fleetForm.fleetId ? 'PUT' : 'POST', body }))) fleetForm.planId = 0;
}
/** Speed right in the table: try speeds without opening the fleet form. */
const setFleetSpeed = (p: AttackPlan, f: PlanFleet, speed: number) =>
  run(() => uniApi(uni.value, `/plans/${p.id}/fleets/${f.id}`, { method: 'PUT', body: { speed } }));
/** The ships the overview shows flying become the plan's (flight time, simulator). */
const takeSeenShips = (p: AttackPlan, f: PlanFleet) =>
  run(() => uniApi(uni.value, `/plans/${p.id}/fleets/${f.id}`, { method: 'PUT', body: { ships: f.seen!.ships } }));
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
  <div class="tabs">
    <button :class="{ active: tab === 'plans' }" @click="tab = 'plans'">{{ t('plans.tabPlans') }}</button>
    <button :class="{ active: tab === 'settlements' }" @click="tab = 'settlements'">{{ t('plans.tabSettlements') }}</button>
  </div>
  <LootSettlementList v-if="tab === 'settlements'" />
  <template v-else>
  <div class="row" style="margin-bottom: 12px">
    <button class="primary" @click="openForm()">{{ t('plans.new') }}</button>
    <button @click="phalanx.open = !phalanx.open">{{ t('phalanx.paste') }}</button>
    <span v-if="info" class="warn small">{{ info }}</span>
  </div>
  <div v-if="error" class="error">{{ error }}</div>

  <div v-if="phalanx.open" class="card phalanx-form">
    <textarea v-model="phalanx.text" rows="4" :placeholder="t('phalanx.placeholder')" />
    <div class="row">
      <button class="primary" :disabled="!phalanx.text.trim()" @click="sendPhalanx">{{ t('phalanx.apply') }}</button>
      <button @click="phalanx.open = false">{{ t('plans.cancelForm') }}</button>
      <Hint>{{ t('phalanx.hint') }}</Hint>
    </div>
  </div>

  <div v-if="form.open" class="card plan-form">
    <h3>{{ t('plans.new') }}</h3>
    <PlanTargetForm v-model="form.draft" />
    <div class="row">
      <button class="primary" @click="create">{{ t('plans.create') }}</button>
      <button @click="form.open = false">{{ t('plans.cancelForm') }}</button>
      <Hint>{{ t('plans.createHint') }}</Hint>
    </div>
  </div>

  <div v-if="ownAttacks.length" class="card attacks">
    <h3>{{ t('ownAttacks.title') }} <Hint>{{ t('ownAttacks.hint') }}</Hint></h3>
    <div v-for="a in ownAttacks" :key="a.key" class="row attack">
      <span>⚔ {{ ownAttackShips(a) }}</span>
      <span class="mono">{{ coords(a.to.g, a.to.s, a.to.p) }}</span><span v-if="a.to.type === 'moon'" class="muted"> ☾</span>
      <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
      <span class="time"><b class="mono">{{ clock(a.arrival) }}</b> <Countdown class="muted small" :to="a.arrival" /></span>
      <span class="small">
        <template v-for="(f, i) in a.fleets" :key="i">
          <span v-if="i">, </span>
          <span :class="{ muted: f.memberId == null }" :title="f.memberId == null ? t('ownAttacks.guestTitle') : undefined">{{ ownFleetName(f) }}</span>
        </template>
      </span>
      <span class="grow" />
      <button class="primary" @click="planOwn(a)">{{ t('ownAttacks.plan') }}</button>
    </div>
  </div>

  <div v-if="shownAttacks.length" class="card attacks">
    <h3>{{ t('retime.attacks') }}</h3>
    <div v-for="a in shownAttacks" :key="a.key" class="row attack">
      <span class="neg">⚔ {{ t('notify.attack', { member: a.member ?? coords(a.to.g, a.to.s, a.to.p) }) }}</span>
      <span v-if="a.source === 'phalanx'" class="badge" :title="t('phalanx.byTitle', { name: a.reporter ?? '?' })">{{ t('phalanx.badge') }}</span>
      <span class="mono">{{ coords(a.to.g, a.to.s, a.to.p) }}</span>
      <span class="time"><b class="mono">{{ clock(a.arrival) }}</b> <Countdown class="muted small" :to="a.arrival" /></span>
      <span v-if="a.arrival <= now" class="badge" :title="t('retime.arrivedTitle')">{{ t('retime.arrived') }}</span>
      <span v-if="a.home" class="small">{{ t('phalanx.home', { t: clock(a.home) }) }}</span>
      <span class="small">{{ attackShips(a) }}</span>
      <span class="small">
        {{ t('notify.from') }} <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
        <span class="mono">{{ coords(a.from.g, a.from.s, a.from.p) }}</span><span v-if="a.from.type === 'moon'" class="muted"> ☾</span>
      </span>
      <span class="grow" />
      <span v-if="a.planId" class="muted small">{{ t('retime.planned') }}</span>
      <button v-else class="primary" @click="planRetime(a)">{{ t('retime.plan') }}</button>
      <span v-if="a.holdPlanId" class="muted small">{{ t('hold.planned') }}</span>
      <button v-else-if="a.arrival > now" @click="planHold(a)">{{ t('hold.plan') }}</button>
      <button :title="t('retime.hideTitle')" @click="setHidden(a, true)">{{ t('retime.hide') }}</button>
    </div>
  </div>

  <div v-if="loaded && !current.length && !form.open" class="card muted">{{ t('plans.none') }}</div>

  <template v-for="(list, i) in [current, past]" :key="i">
    <h2 v-if="i === 1 && list.length">{{ t('plans.past') }}</h2>
    <div v-for="p in list" :id="`plan-${p.id}`" :key="p.id" class="card plan" :class="{ closed: closed(p) }">
      <div class="row plan-head">
        <button class="toggle" :aria-expanded="isOpen(p)" :title="isOpen(p) ? t('plans.collapse') : t('plans.expand')" @click="toggle(p)">{{ isOpen(p) ? '▾' : '▸' }}</button>
        <template v-if="hasCoords(p)">
          <span v-if="p.planet_type === 'moon'" class="moon-tag">{{ t('plans.moon') }}</span>
          <strong class="mono">{{ coords(p.g!, p.s!, p.p!) }}</strong>
          <span v-if="p.planet_name" class="muted">{{ p.planet_name }}</span>
        </template>
        <button v-else-if="canSetCoords(p) && !coordsEdit[p.id]" class="link warn small" :title="t('plans.setCoordsTitle')" @click="coordsEdit[p.id] = draftOf(p)">
          {{ t('plans.coordsMissing') }} ✎
        </button>
        <span v-else class="warn small">{{ t('plans.coordsMissing') }}</span>
        <PlayerLink v-if="p.player_id" :id="p.player_id" :name="p.player_name ?? '?'" />
        <PlanetActions v-if="hasCoords(p)" :g="p.g!" :s="p.s!" :p="p.p!" :type="p.planet_type" />
        <span class="grow" />
        <RouterLink v-if="settleable(p)" class="small" :to="`/${uni}/raid-planner/${p.id}/loot`">{{ t('loot.open') }}</RouterLink>
        <span v-if="p.mission === 'hold'" class="badge mission-hold">{{ t('hold.badge') }}</span>
        <span class="badge">{{ t(`plans.status.${p.status}`) }}</span>
      </div>

      <div v-if="!isOpen(p)" class="summary small" @click="toggle(p)">
        <span class="time">
          <b class="mono">{{ targetText(p) }}</b>
          <Countdown v-if="p.time_precision !== 'day'" class="muted" :to="p.target_time" />
        </span>
        <span>{{ t('plans.fleetCount', { n: flying(p) }, flying(p)) }}</span>
        <span v-if="myLaunch(p) && exact(p)" class="time">
          {{ t('plans.myLaunch') }} <b class="mono">{{ clock(myLaunch(p)!) }}</b> <Countdown class="muted" :to="myLaunch(p)!" />
        </span>
        <span v-if="views.get(p.id)?.fleets.some((x) => x.plan?.late && !x.fleet.seen && x.fleet.status !== 'launched')" class="neg">{{ t('plans.late') }}</span>
      </div>

      <template v-if="isOpen(p)">
      <div class="times">
        <span class="time">
          <span class="lbl">{{ t('plans.targetTime') }}</span>
          <b class="mono">{{ targetText(p) }}</b>
          <Countdown v-if="p.time_precision !== 'day'" class="muted small" :to="p.target_time" />
          <Hint v-if="!exact(p)">{{ hasCoords(p) ? t('plans.roughTime') : t('plans.noCoordsHint') }}</Hint>
        </span>
        <span v-if="exact(p) && views.get(p.id)?.acs?.delay" class="time warn">
          <span class="lbl">⚠ {{ t('plans.arrival') }}</span>
          <b class="mono">{{ clock(views.get(p.id)!.acs!.arrival) }}</b>
          <span class="small">{{ t('plans.delayedBy', { t: duration(views.get(p.id)!.acs!.delay) }) }}</span>
        </span>
        <span class="muted small">{{ t('plans.by', { name: p.creator }) }}</span>
        <span v-if="sims(p)" class="small sims">
          <a :href="sims(p)!.game" target="_blank" rel="noopener" :title="simTitle(p, 'Game')">{{ t('plans.simGame') }}</a>
          · <a :href="sims(p)!.trash" target="_blank" rel="noopener" :title="simTitle(p, 'Trash')">TrashSim</a>
        </span>
      </div>
      <div v-if="p.note && !editing[p.id]" class="small">{{ p.note }}</div>
      <HoldPanel v-if="p.enemy && p.mission === 'hold'" :plan="p" :editable="canEditEnemy(p) && !closed(p)" @saved="load" @error="(m) => (error = m)" />
      <RetimePanel v-else-if="p.enemy" :plan="p" :editable="canEditEnemy(p) && !closed(p)" @saved="load" @error="(m) => (error = m)" />
      <div v-if="views.get(p.id)?.acs" class="small">
        <template v-if="views.get(p.id)!.acs!.fleets.length > 1">{{ t('plans.lead', { name: leadName(p) }) }}</template>
        <span v-if="views.get(p.id)!.acs!.tooManyFleets" class="warn"> ⚠ {{ t('plans.tooManyFleets') }}</span>
        <span v-if="views.get(p.id)!.acs!.tooManyPlayers" class="warn"> ⚠ {{ t('plans.tooManyPlayers') }}</span>
      </div>

      <div v-if="coordsEdit[p.id] && !hasCoords(p)" class="edit-box">
        <PlanTargetForm v-model="coordsEdit[p.id]" coords-only />
        <div class="row">
          <button class="primary" @click="saveCoords(p)">{{ t('plans.save') }}</button>
          <button @click="delete coordsEdit[p.id]">{{ t('plans.cancelForm') }}</button>
        </div>
      </div>
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
                <span v-if="x.plan && views.get(p.id)!.acs?.lead === x.plan.id && (views.get(p.id)!.acs?.fleets.length ?? 0) > 1" class="badge">{{ t('plans.leadShort') }}</span>
                <span v-if="x.duration != null && oldDrives(x.fleet)" class="warn small" :title="t('plans.drivesOld')"> ⚠</span>
              </td>
              <td class="mono">{{ x.fleet.g != null ? coords(x.fleet.g, x.fleet.s!, x.fleet.p!) : '–' }}<span v-if="x.fleet.planet_type === 'moon'" class="muted"> ☾</span></td>
              <td class="small m-wide">{{ shipList(x.fleet.ships) }}</td>
              <td>
                <select
                  v-if="canEditFleet(p, x.fleet) && !closed(p)"
                  class="speed"
                  :value="x.fleet.speed"
                  :aria-label="t('plans.speed')"
                  @change="setFleetSpeed(p, x.fleet, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
                </select>
                <span v-else>{{ x.fleet.speed }} %</span>
              </td>
              <td class="mono">{{ x.duration != null ? duration(Math.floor(x.duration)) : '–' }}</td>
              <td class="c-launch m-wide">
                <template v-if="x.fleet.seen">
                  <span class="small muted">{{ t('plans.arrival') }}</span> <span class="mono">{{ clock(x.fleet.seen.arrival) }}</span>
                  <div class="small" :class="exact(p) && x.fleet.seen.arrival !== p.target_time ? 'warn' : 'pos'">
                    {{ t('plans.seen') }}<template v-if="exact(p)"> · {{ offset(x.fleet.seen.arrival - p.target_time) }}</template>
                  </div>
                  <div v-if="seenShipsDiffer(x.fleet)" class="small warn">
                    {{ t('plans.seenShips', { ships: shipList(x.fleet.seen.ships) }) }}
                    <button v-if="canEditFleet(p, x.fleet) && !closed(p)" class="small" @click="takeSeenShips(p, x.fleet)">{{ t('plans.takeSeen') }}</button>
                  </div>
                </template>
                <template v-else-if="x.plan && exact(p)">
                  <span class="time">
                    <span class="mono" :class="{ neg: x.plan.late }">{{ clock(x.plan.launch) }}</span>
                    <Countdown class="muted small" :to="x.plan.launch" />
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
              <td class="mono">{{ x.plan && exact(p) && p.mission !== 'hold' ? clock(x.plan.home) : '–' }}</td>
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
                <a v-if="x.duration != null && exact(p)" class="calc" :href="fleetCalcLink(settings, p, x.fleet)!" target="_blank" rel="noopener" :title="t('plans.calcTitle')">↗</a>
                <template v-if="canEditFleet(p, x.fleet) && !closed(p)">
                  <button @click="openFleet(p, x.fleet)">{{ t('plans.edit') }}</button>
                  <button v-if="canRemoveFleet(p, x.fleet)" :title="t('plans.removeFleet')" @click="removeFleet(p, x.fleet)">✕</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted small">{{ t('plans.noFleets') }}</p>
      <p v-for="(g, i) in p.guests ?? []" :key="`g${i}`" class="small">
        <span class="badge" :title="t('ownAttacks.guestTitle')">{{ t('ownAttacks.guest') }}</span>
        <PlayerLink v-if="g.player" :id="g.player.id" :name="g.player.name" />
        <span v-else-if="g.name">{{ g.name }}</span>
        <span class="mono">{{ coords(g.from.g, g.from.s, g.from.p) }}</span><span v-if="g.from.type === 'moon'" class="muted"> ☾</span>
        · {{ Object.entries(g.ships).map(([id, n]) => `${fmt(n)} ${name(Number(id))}`).join(', ') }}
      </p>

      <div v-if="fleetForm.planId === p.id" class="fleet-form">
        <h4 v-if="fleetForm.member">{{ t('plans.fleetOf', { member: fleetForm.member }) }}</h4>
        <div class="row">
          <label v-if="ownPlanets?.length">
            {{ t('plans.start') }}
            <select v-model="fleetForm.start">
              <option value="">–</option>
              <option v-for="pl in ownPlanets" :key="planetKey(pl.coords, pl.type)" :value="planetKey(pl.coords, pl.type)">
                {{ pl.name }} {{ coords(pl.coords.g, pl.coords.s, pl.coords.p) }}{{ pl.type === 'moon' ? ' ☾' : '' }}
              </option>
              <option value="manual">{{ t('plans.otherStart') }} …</option>
            </select>
          </label>
          <template v-if="ownPlanets && typedStart">
            <label>
              {{ ownPlanets.length ? t('plans.startCoords') : t('plans.start') }}
              <input v-model="fleetForm.manual" class="mono start-input" placeholder="1:41:1" size="10" />
            </label>
            <label><input v-model="fleetForm.moon" type="checkbox" /> {{ t('plans.moon') }}</label>
          </template>
          <label>
            {{ t('plans.speed') }}
            <select v-model.number="fleetForm.speed">
              <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
            </select>
          </label>
          <span v-if="ownPlanets && !ownPlanets.length" class="muted small">{{ t('plans.noEmpire') }}</span>
          <span v-else-if="ownEmpire?.source === 'spy'" class="muted small">{{ t('plans.fromSpy', { time: numDate(new Date(ownEmpire.time! * 1000)) }) }}</span>
        </div>
        <div class="row drives">
          <span>{{ t('plans.drives') }}</span>
          <label v-for="id in DRIVE_IDS" :key="id" :title="t(`retime.drive${id}`)">
            {{ abbr(id) }}
            <input v-model.number="fleetForm.drives[id]" type="number" min="0" max="99" :aria-label="t(`retime.drive${id}`)" @input="changeDrives" />
          </label>
          <span class="muted small">{{ drivesInfo }}</span>
          <button v-if="fleetForm.drivesSource === 'manual' && !fleetForm.drivesReset" @click="resetDrives">{{ t('plans.drivesReset') }}</button>
          <Hint>{{ t('plans.drivesHint') }}</Hint>
        </div>
        <div v-for="(n, id) in fleetForm.ships" :key="id" class="ship-row">
          <span class="ship-name" :title="name(Number(id))">{{ name(Number(id)) }}</span>
          <input v-model.number="fleetForm.ships[Number(id)]" type="number" min="0" />
          <template v-if="cap(Number(id)) != null">
            <button :title="t('plans.maxTitle')" @click="fleetForm.ships[Number(id)] = cap(Number(id))!">{{ t('plans.max') }}</button>
            <span class="muted small">/ {{ fmt(cap(Number(id))!) }} {{ fleetForm.from[Number(id)] === 'all' || onStart(Number(id)) === 0 ? t('plans.fromAll') : t('plans.fromStart') }}</span>
            <span v-if="n > cap(Number(id))!" class="warn small">{{ t('plans.moreThanAvailable') }}</span>
          </template>
          <button :title="t('plans.removeShip')" @click="removeShip(Number(id))">✕</button>
        </div>
        <div class="row">
          <select :aria-label="t('plans.addShip')" @change="pickShip">
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
          <Hint>{{ t('plans.pickHint') }}</Hint>
        </div>
        <div class="row">
          <button class="primary" @click="saveFleet">{{ t('plans.save') }}</button>
          <button @click="fleetForm.planId = 0">{{ t('plans.cancelForm') }}</button>
        </div>
      </div>

      <div v-if="!closed(p)" class="row plan-actions">
        <button v-if="fleetForm.planId !== p.id" @click="openFleet(p)">{{ t('plans.addFleet') }}</button>
        <select v-model.number="invitee[p.id]" :aria-label="t('plans.invite')" @change="invite(p)">
          <option :value="0">{{ t('plans.invite') }} …</option>
          <option v-for="m in ctx?.members.filter((m) => m.id !== me) ?? []" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <template v-if="canEdit(p)">
          <button v-if="!editing[p.id]" @click="startEdit(p)">{{ t('plans.editPlan') }}</button>
        </template>
      </div>
      <div v-if="canEdit(p)" class="row plan-actions">
        <span class="muted small">{{ t('plans.setStatus') }}</span>
        <button v-for="s in PLAN_STATUSES.filter((x) => x !== p.status)" :key="s" @click="setStatus(p, s)">{{ t(`plans.status.${s}`) }}</button>
        <span class="grow" />
        <button class="danger" @click="removePlan(p)">{{ t('plans.delete') }}</button>
      </div>
      </template>
    </div>
  </template>

  <template v-if="hiddenAttacks.length">
    <h2 class="hidden-head">
      <button class="toggle" :aria-expanded="showHidden" @click="showHidden = !showHidden">{{ showHidden ? '▾' : '▸' }}</button>
      {{ t('retime.hidden', { n: hiddenAttacks.length }) }}
    </h2>
    <div v-if="showHidden" class="card attacks">
      <div v-for="a in hiddenAttacks" :key="a.key" class="row attack">
        <span class="neg">⚔ {{ t('notify.attack', { member: a.member ?? coords(a.to.g, a.to.s, a.to.p) }) }}</span>
        <span class="mono">{{ coords(a.to.g, a.to.s, a.to.p) }}</span>
        <span class="time"><b class="mono">{{ clock(a.arrival) }}</b> <Countdown class="muted small" :to="a.arrival" /></span>
        <span v-if="a.arrival <= now" class="badge" :title="t('retime.arrivedTitle')">{{ t('retime.arrived') }}</span>
        <span class="small">{{ attackShips(a) }}</span>
        <span class="small">
          {{ t('notify.from') }} <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
          <span class="mono">{{ coords(a.from.g, a.from.s, a.from.p) }}</span><span v-if="a.from.type === 'moon'" class="muted"> ☾</span>
        </span>
        <span class="grow" />
        <span class="muted small">{{ t('retime.hiddenBy', { name: a.hidden!.by ?? '?', time: timeWithAge(a.hidden!.at) }) }}</span>
        <button @click="setHidden(a, false)">{{ t('retime.unhide') }}</button>
      </div>
    </div>
  </template>
  </template>
</template>

<style scoped>
.plan { display: flex; flex-direction: column; gap: 8px; }
.attacks h3 { margin: 0 0 6px; }
.attack { gap: 6px 12px; padding: 4px 0; border-top: 1px solid var(--border); }
.plan.closed { opacity: .7; }
.plan-head { gap: 6px; }
.hidden-head .toggle, .plan-head .toggle { padding: 0 6px; border: 0; background: none; color: var(--muted); font-size: 14px; cursor: pointer; }
.summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; padding-left: 26px; cursor: pointer; }
.plan-form { display: flex; flex-direction: column; gap: 10px; }
.plan-form h3 { margin: 0; }
.phalanx-form { display: flex; flex-direction: column; gap: 8px; }
.phalanx-form textarea { width: 100%; font-size: 12px; }
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
.drives { gap: 6px; }
.drives input { width: 52px; }
.plan-actions { gap: 6px; }
tr.mine td:first-child { font-weight: 600; }
td.actions { white-space: nowrap; }
td.actions button { padding: 1px 8px; }
td.actions .calc { margin-right: 6px; }
button.danger { color: var(--neg); }
.badge.mission-hold { color: var(--pos); }
button.link { padding: 0; border: 0; background: none; cursor: pointer; text-decoration: underline dotted; }

@media (max-width: 800px) {
  .summary { padding-left: 0; }
  /* fleet cards: the launch right below the member, before start, ships and speed */
  td.c-launch { order: 1; justify-content: flex-start; text-align: left; }
  td.c-launch::before { margin-right: 8px; }
  .edit-box, .fleet-form { padding: 8px; }
  .ship-name { flex: 1 1 100%; min-width: 0; }
  .plan-actions button, .plan-actions select { flex: 1 1 auto; }
}
</style>

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from './api';
import { loadClaims } from './claims';
import { useUni } from './composables';
import { abbr, battleSimLink, clockTime, coords, duration, fmt, ipmCalcLink, ipmStart, numDate, simLinks, timeWithAge, weekday, type Coords3, type SimFleet } from './format';
import { intlLocale } from './i18n';
import { tables, useLiveReload } from './live';
import { toast } from './toast';
import {
  candidateHome,
  computePlan,
  DEFAULT_BUFFER,
  DRIVES_MAX_AGE,
  enemyCandidates,
  holdPlanetValues,
  isCurrent,
  latestTime,
  mainFleet,
  type AttackPlan,
  type HostileAttack,
  type OwnAttack,
  type PlanFleet,
} from './plans';

/**
 * State and actions of the raid planner, shared by the plan list and a plan's page: the plans, hostile and own
 * attacks (live), permissions, times and the changes. Each page loads its own copy.
 */
export function useRaidPlanner() {
  const { t } = useI18n();
  const { uni, ctx } = useUni();

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

  /**
   * Runs a change; errors show at the top of the page, the live event reloads the plans (and here at once).
   * `done`: feedback shown as a toast on success.
   */
  async function run(fn: () => Promise<unknown>, done?: string) {
    error.value = '';
    try {
      await fn();
      await load();
      if (done) toast(done);
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      return false;
    }
  }
  /** The target is claimed by someone else already: told as a warning. */
  const claimedInfo = (res: { claimedBy?: string | null }) => res.claimedBy && toast(t('plans.claimedBy', { name: res.claimedBy }), 'warn');

  const settings = computed(() => ctx.value!.universe.settings);
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
  /** Open coordinates: the creator, admins and every participant (also only invited) fill them in. */
  const canSetCoords = (p: AttackPlan) => !closed(p) && (canEdit(p) || isParticipant(p));
  /** Enemy inputs: creator, admins, participants and, on a hold, the attacked member (the ships on their planet). */
  const canEditEnemy = (p: AttackPlan) => canEdit(p) || isParticipant(p) || (p.mission === 'hold' && p.enemy?.member_id === me.value);
  /** A shared battle simulation updates attack plans (creator, admins, participants). */
  const canSim = (p: AttackPlan) => p.mission === 'attack' && (canEdit(p) || isParticipant(p));

  const views = computed(() => new Map(plans.value.map((p) => [p.id, computePlan(settings.value, p, now.value)])));
  const current = computed(() => plans.value.filter((p) => isCurrent(p, now.value)));
  const past = computed(() => plans.value.filter((p) => !isCurrent(p, now.value)).reverse());
  /** Exact launch times and warnings only make sense with coordinates and an exact target time. */
  const exact = (p: AttackPlan) => hasCoords(p) && p.time_precision === 'exact';
  /** The viewer's next own launch in a plan (not launched yet). */
  const myLaunch = (p: AttackPlan) =>
    views.value.get(p.id)?.fleets.find((x) => x.fleet.user_id === me.value && x.plan && !x.fleet.seen && x.fleet.status !== 'launched' && x.plan.launch > now.value)?.plan
      ?.launch ?? null;
  /** A fleet still to launch can't make it any more. */
  const lateFleet = (p: AttackPlan) => !!views.value.get(p.id)?.fleets.some((x) => x.plan?.late && !x.fleet.seen && x.fleet.status !== 'launched');
  const flying = (p: AttackPlan) => p.fleets.filter((f) => f.status !== 'withdrawn').length;
  const oldDrives = (f: PlanFleet) => !f.drives || now.value - f.drives.time > DRIVES_MAX_AGE;

  /**
   * Combat simulators with the target's newest spy report (needs the game URL of the universe) and the plan's fleets
   * (not withdrawn, with ships) with the research of their member's empire page. Hold plans swap the sides: the enemy
   * fleets attack, the plan's fleets defend the planet next to its own fleet and defense.
   */
  const planFleets = (p: AttackPlan): SimFleet[] => [
    ...p.fleets
      .filter((f) => f.status !== 'withdrawn' && Object.values(f.ships).some((n) => n > 0))
      .map((f) => ({ ships: f.ships, research: { ...(f.sim_research ?? {}), ...(f.drives?.research ?? {}) }, from: f.g != null ? [f.g, f.s!, f.p!] as Coords3 : null, speed: f.speed })),
    // ACS fleets of non-members, research from spy reports of their player
    ...(p.guests ?? []).map((g) => ({ ships: g.ships, research: g.research ?? {}, from: [g.from.g, g.from.s, g.from.p] as Coords3, speed: 100 })),
  ];
  const sims = (p: AttackPlan): { tools: string; game: string | null; trash: string | null } | null => {
    const target: Coords3 | null = hasCoords(p) ? [p.g!, p.s!, p.p!] : null;
    let battle: [Record<string, number>, SimFleet[], SimFleet[]];
    if (p.mission === 'hold' && p.enemy) {
      const e = p.enemy;
      const research = { ...(e.research ?? {}), ...e.drives };
      const enemies = e.fleets.map((f) => ({ ships: f.ships, research, from: [e.from.g, e.from.s, e.from.p] as Coords3, speed: e.percent ?? 100 }));
      battle = [holdPlanetValues(p), enemies, planFleets(p)];
    } else if (p.spy) {
      battle = [p.spy.values, planFleets(p), []];
    } else {
      return null;
    }
    const [values, attackers, defenders] = battle;
    // the game's simulators need the universe's game URL, the battle simulator (pr0game-tools) does not
    const game = settings.value.gameUrl ? simLinks(settings.value.gameUrl, values, attackers, target, defenders) : null;
    return { tools: battleSimLink(settings.value, values, attackers, target, defenders), game: game?.game ?? null, trash: game?.trash ?? null };
  };
  /** IPM calculator with the target's newest spy report (attack plans; a moon's interceptors are left to the user). */
  const ipm = (p: AttackPlan) => {
    if (p.mission === 'hold' || !p.spy || !hasCoords(p)) return null;
    const to: Coords3 = [p.g!, p.s!, p.p!];
    const start = ipmStart(settings.value, ctx.value?.own?.planets, to);
    return {
      href: ipmCalcLink(settings.value, {
        from: start?.c ?? null,
        silo: start?.silo,
        missiles: start?.ipm,
        to,
        moon: p.planet_type === 'moon',
        research: ctx.value?.own?.research,
        values: p.spy.values,
      }),
      title: t('plans.ipmTitle', { source: t(p.spy.source === 'sim' ? 'plans.simFromSim' : 'plans.simFromSpy', { time: timeWithAge(p.spy.time) }) }),
    };
  };
  /** Tooltips of the simulator links: what they are filled with. */
  const simTitle = (p: AttackPlan, sim: 'Tools' | 'Game' | 'Trash') =>
    p.mission === 'hold'
      ? t(`plans.simHold${sim}Title`, { planet: p.spy ? timeWithAge(p.spy.time) : t('plans.simNoData'), enemy: p.enemy?.research_time ? timeWithAge(p.enemy.research_time) : t('plans.simNoData') })
      : t(`plans.sim${sim}Title`, { source: t(p.spy!.source === 'sim' ? 'plans.simFromSim' : 'plans.simFromSpy', { time: timeWithAge(p.spy!.time) }) });

  // ---- times and labels ----
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
  const shortClock = (epoch: number) => fmtDate(epoch, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' });
  /** Real arrival against the target time: "on time", "+3 s", "−1:05". */
  const offset = (d: number) => (d === 0 ? t('plans.onTime') : `${d > 0 ? '+' : '−'}${Math.abs(d) < 60 ? `${Math.abs(d)} s` : duration(Math.abs(d))}`);
  const shipList = (ships: Record<string, number>) =>
    Object.entries(ships)
      .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
      .join(', ') || '–';
  /** Member sending the lead fleet of the ACS. */
  const leadName = (p: AttackPlan) => p.fleets.find((f) => String(f.id) === views.value.get(p.id)?.acs?.lead)?.member ?? '?';
  const targetLabel = (p: AttackPlan) => (p.g != null ? coords(p.g, p.s!, p.p!) : (p.player_name ?? '?'));
  const attackShips = (a: HostileAttack | OwnAttack) =>
    a.fleets.length > 1 ? t('notify.acs', { n: a.fleets.length }) : (a.fleets[0]?.mission != null ? t(`game.missions.${a.fleets[0].mission}`) : '');
  const ownFleetName = (f: OwnAttack['fleets'][number]) => f.member ?? f.player?.name ?? coords(f.from.g, f.from.s, f.from.p);

  // ---- changes ----
  const setStatus = (p: AttackPlan, status: string) =>
    run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'PUT', body: { status } }), t('plans.toast.status', { status: t(`plans.status.${status}`) })).then(
      (ok) => (loadClaims(uni.value), ok),
    );
  async function removePlan(p: AttackPlan) {
    if (!confirm(t('plans.confirmDelete', { target: targetLabel(p) }))) return false;
    const ok = await run(() => uniApi(uni.value, `/plans/${p.id}`, { method: 'DELETE' }), t('plans.toast.deleted'));
    loadClaims(uni.value);
    return ok;
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
    if (confirm(t('plans.confirmRemoveFleet', { member: f.member }))) {
      run(() => uniApi(uni.value, `/plans/${p.id}/fleets/${f.id}`, { method: 'DELETE' }), t('plans.toast.fleetRemoved', { member: f.member }));
    }
  }
  const invite = (p: AttackPlan, userId: number) =>
    run(
      () => uniApi(uni.value, `/plans/${p.id}/fleets`, { body: { user_id: userId } }),
      t('plans.toast.invited', { member: ctx.value?.members.find((m) => m.id === userId)?.name ?? '?' }),
    );

  /** Starts a retime plan on a hostile attack: follows the main fleet, target time first its return at full speed plus 1 s. */
  async function planRetime(a: HostileAttack) {
    const follow = mainFleet(a.fleets);
    const input = { ...a, follow, first_seen: a.arrival, drives: a.drives?.research ?? {}, departure: null, recall: null, recall_lead: true };
    const full = enemyCandidates(settings.value, input)[0];
    // a phalanx showing the return gives the landing home directly
    const target = (a.home ?? (full ? candidateHome(full) : a.arrival + 3600)) + DEFAULT_BUFFER;
    let id: number | null = null;
    await run(async () => {
      const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans/retime', { body: { key: a.key, follow, target_time: target, buffer: DEFAULT_BUFFER } });
      claimedInfo(res);
      id = res.id;
    }, t('plans.toast.created'));
    loadClaims(uni.value);
    return id;
  }
  /** Hold on the attacked planet: the fleets land 1 s before the impact (changeable in the plan). */
  async function planHold(a: HostileAttack) {
    let id: number | null = null;
    await run(async () => {
      id = (await uniApi<{ id: number }>(uni.value, '/plans/hold', { body: { key: a.key } })).id;
    }, t('plans.toast.created'));
    return id;
  }
  /** Own attack in flight: a plan with the fleets flying (launched), visible to everyone from then on. */
  async function planOwn(a: OwnAttack) {
    let id: number | null = null;
    await run(async () => {
      const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans/own', { body: { key: a.key } });
      claimedInfo(res);
      id = res.id;
    }, t('plans.toast.created'));
    loadClaims(uni.value);
    return id;
  }
  const setHidden = (a: HostileAttack, hide: boolean) =>
    run(() => uniApi(uni.value, `/hostile-attacks/${hide ? 'hide' : 'unhide'}`, { body: { key: a.key } }), t(hide ? 'plans.toast.hidden' : 'plans.toast.shown'));

  return {
    t, uni, ctx, now, plans, attacks, ownAttacks, loaded, error, load, run, claimedInfo, settings, me,
    canEdit, isParticipant, canEditFleet, canRemoveFleet, closed, hasCoords, settleable, canSetCoords, canEditEnemy, canSim,
    views, current, past, exact, myLaunch, lateFleet, flying, oldDrives, sims, simTitle, ipm,
    targetText, clock, shortClock, offset, shipList, leadName, targetLabel, attackShips, ownFleetName,
    setStatus, removePlan, setFleetSpeed, takeSeenShips, setFleetStatus, removeFleet, invite, planRetime, planHold, planOwn, setHidden,
  };
}

/** The next status a plan usually moves to, for the main button of its page (null when closed). */
export function nextStatus(p: AttackPlan): 'launched' | 'done' | null {
  if (p.status === 'planning') return 'launched';
  if (p.status === 'launched') return 'done';
  return null;
}

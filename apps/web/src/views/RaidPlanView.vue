<script setup lang="ts">
import Loading from '../components/Loading.vue';
import ActionMenu, { type MenuItem } from '../components/ActionMenu.vue';
import BackLink from '../components/BackLink.vue';
import Countdown from '../components/Countdown.vue';
import Hint from '../components/Hint.vue';
import HoldPanel from '../components/HoldPanel.vue';
import Icon from '../components/Icon.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlanFleetSheet from '../components/PlanFleetSheet.vue';
import PlanTargetForm from '../components/PlanTargetForm.vue';
import PlayerLink from '../components/PlayerLink.vue';
import RetimePanel from '../components/RetimePanel.vue';
import Section from '../components/Section.vue';
import Sheet from '../components/Sheet.vue';
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { loadClaims } from '../claims';
import { useMobile, vStack } from '../composables';
import { coords, duration, fmt, name, timeWithAge } from '../format';
import { draftBody, draftOf, fleetCalcLink, FLEET_STATUSES, PLAN_STATUSES, seenShipsDiffer, SPEEDS, type PlanDraft, type PlanFleet } from '../plans';
import { nextStatus, useRaidPlanner } from '../raidPlanner';
import { toast } from '../toast';

/**
 * One raid plan: target and time, the next step for the viewer (add the own fleet, launch, settle …), the fleets of
 * all members and, for retimes and holds, the enemy fleet. Everything else sits in the plan's menu; forms open in
 * sheets.
 */
const rp = useRaidPlanner();
const { t, uni, ctx, me, now, plans, loaded, error, settings, run, claimedInfo } = rp;
/** A panel or sheet saved: reload and confirm. */
const onSaved = () => (toast(t('plans.toast.saved')), rp.load());
const route = useRoute();
const router = useRouter();
const planId = computed(() => Number(route.params.id));
const plan = computed(() => plans.value.find((p) => p.id === planId.value) ?? null);
const view = computed(() => (plan.value ? rp.views.value.get(plan.value.id) : undefined));
const listLink = computed(() => `/${uni.value}/raid-planner`);
const mobile = useMobile();

// ---- fleets ----
const fleetSheet = reactive({ open: false, fleet: null as PlanFleet | null });
const openFleet = (f: PlanFleet | null = null) => Object.assign(fleetSheet, { open: true, fleet: f });
/** The viewer's fleets in this plan (not withdrawn). */
const myFleets = computed(() => view.value?.fleets.filter((x) => x.fleet.user_id === me.value && x.fleet.status !== 'withdrawn') ?? []);
const isLead = (id: string | number | undefined) => !!view.value?.acs && view.value.acs.lead === String(id) && view.value.acs.fleets.length > 1;
const fleetMenu = (f: PlanFleet, duration: number | null): MenuItem[] => {
  const p = plan.value!;
  const editable = rp.canEditFleet(p, f) && !rp.closed(p);
  return [
    editable && { label: t('plans.edit'), icon: 'edit', onClick: () => openFleet(f) },
    duration != null && rp.exact(p) && { label: t('plans.calc'), href: fleetCalcLink(settings.value, p, f)!, hint: t('plans.calcTitle') },
    editable && seenShipsDiffer(f) && { label: t('plans.takeSeen'), icon: 'check', hint: t('plans.seenShips', { ships: rp.shipList(f.seen!.ships) }), onClick: () => rp.takeSeenShips(p, f) },
    editable && rp.canRemoveFleet(p, f) && { label: t('plans.removeFleet'), icon: 'trash', danger: true, divider: true, onClick: () => rp.removeFleet(p, f) },
  ].filter(Boolean) as MenuItem[];
};
/** Members to invite: not in the plan yet. */
const invitable = computed(() => (ctx.value?.members ?? []).filter((m) => m.id !== me.value && !plan.value?.fleets.some((f) => f.user_id === m.id)));
const inviteMenu = computed<MenuItem[]>(() => invitable.value.map((m) => ({ label: m.name, onClick: () => rp.invite(plan.value!, m.id) })));

// ---- the next step for the viewer ----
type Step =
  | { kind: 'coords' | 'join' | 'start' | 'finish' | 'settle' }
  | { kind: 'complete'; fleet: PlanFleet }
  | { kind: 'launch'; fleet: PlanFleet; at: number; late: boolean; duration: number | null };
const step = computed<Step | null>(() => {
  const p = plan.value;
  if (!p) return null;
  if (rp.closed(p)) return rp.settleable(p) ? { kind: 'settle' } : null;
  if (!rp.hasCoords(p)) return rp.canSetCoords(p) ? { kind: 'coords' } : null;
  const mine = myFleets.value;
  const incomplete = mine.find((x) => x.duration == null && !x.fleet.seen);
  if (incomplete) return { kind: 'complete', fleet: incomplete.fleet };
  const launch = mine.find((x) => x.plan && !x.fleet.seen && x.fleet.status !== 'launched' && rp.exact(p));
  if (launch) return { kind: 'launch', fleet: launch.fleet, at: launch.plan!.launch, late: launch.plan!.late, duration: launch.duration };
  if (!mine.length && p.status === 'planning') return { kind: 'join' };
  if (rp.canEdit(p) && p.status === 'planning' && p.fleets.length && p.fleets.every((f) => f.status !== 'invited')) return { kind: 'start' };
  if (rp.canEdit(p) && p.status === 'launched' && p.target_time < now.value) return { kind: 'finish' };
  if (rp.settleable(p)) return { kind: 'settle' };
  return null;
});

// ---- plan: edit, coordinates, simulation, status ----
const editSheet = reactive({ open: false, coordsOnly: false, draft: null as PlanDraft | null, start: null as PlanDraft | null });
function openEdit(coordsOnly = false) {
  Object.assign(editSheet, { open: true, coordsOnly, draft: draftOf(plan.value!), start: draftOf(plan.value!) });
}
async function saveEdit() {
  const p = plan.value!;
  const d = editSheet.draft!;
  const full = draftBody(d);
  if (!full || (editSheet.coordsOnly && full.g == null)) return void (error.value = t(editSheet.coordsOnly ? 'plans.coordsInvalid' : 'plans.formInvalid'));
  const o = editSheet.start;
  const { target_time, time_precision, ...rest } = full;
  // an unchanged time is not sent, so it cannot undo a retime saved meanwhile
  const body = editSheet.coordsOnly
    ? { g: full.g, s: full.s, p: full.p, type: full.type }
    : o && o.precision === d.precision && o.date === d.date && o.time === d.time ? rest : full;
  const ok = await run(async () => claimedInfo(await uniApi<{ claimedBy: string | null }>(uni.value, `/plans/${p.id}`, { method: 'PUT', body })), t('plans.toast.saved'));
  if (ok) editSheet.open = false;
  loadClaims(uni.value);
}

/**
 * Battle simulation someone shared, pasted into an attack plan: the defender fills the target for the simulators,
 * attacker fleets change the plan only where the server recognises them.
 */
const simSheet = reactive({ open: false, text: '' });
async function sendSim() {
  await run(async () => {
    const res = await uniApi<{ defender: boolean; attackers: number; identified: number; updated: number }>(uni.value, `/plans/${plan.value!.id}/sim`, {
      body: { text: simSheet.text },
    });
    toast([
      res.defender ? t('plans.simDefender') : '',
      res.attackers ? t('plans.simAttackers', { identified: res.identified, attackers: res.attackers, updated: res.updated }) : '',
    ].filter(Boolean).join(' ') || t('plans.toast.saved'));
    Object.assign(simSheet, { open: false, text: '' });
  });
}
const removeSim = () => {
  if (confirm(t('plans.simRemoveConfirm'))) run(() => uniApi(uni.value, `/plans/${plan.value!.id}/sim`, { method: 'DELETE' }), t('plans.toast.saved'));
};
async function remove() {
  if (await rp.removePlan(plan.value!)) router.push(listLink.value);
}
const settleLink = computed(() => `/${uni.value}/raid-planner/${planId.value}/loot`);
const planMenu = computed<MenuItem[]>(() => {
  const p = plan.value;
  if (!p) return [];
  const open = !rp.closed(p);
  const next = nextStatus(p);
  const sims = rp.sims(p);
  return [
    rp.canEdit(p) && open && { label: t('plans.editPlan'), icon: 'edit', onClick: () => openEdit() },
    !rp.hasCoords(p) && rp.canSetCoords(p) && { label: t('plans.setCoordsTitle'), icon: 'target', onClick: () => openEdit(true) },
    rp.canSim(p) && open && { label: t('plans.simUpdate'), icon: 'sync', onClick: () => Object.assign(simSheet, { open: true, text: '' }) },
    rp.canSim(p) && p.sim && { label: t('plans.simRemoveLong'), icon: 'close', onClick: removeSim },
    sims && { label: t('plans.simGame'), href: sims.game, hint: rp.simTitle(p, 'Game'), divider: true },
    sims && { label: 'TrashSim', href: sims.trash, hint: rp.simTitle(p, 'Trash') },
    rp.settleable(p) && { label: t('loot.open'), icon: 'cargo', to: settleLink.value, divider: !sims },
    ...(rp.canEdit(p)
      ? PLAN_STATUSES.filter((s) => s !== p.status && s !== next).map((s, i) => ({
          label: t('plans.setStatusTo', { status: t(`plans.status.${s}`) }),
          icon: s === 'cancelled' ? 'close' : s === 'done' ? 'check' : 'timer',
          divider: i === 0,
          onClick: () => rp.setStatus(p, s),
        }))
      : []),
    rp.canEdit(p) && { label: t('plans.delete'), icon: 'trash', danger: true, divider: true, onClick: remove },
  ].filter(Boolean) as MenuItem[];
});
</script>

<template>
  <BackLink :to="listLink" :label="t('nav.raidPlanner')" />
  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-if="!loaded" :lines="4" />
  <div v-if="loaded && !plan" class="card muted">{{ t('plans.notFound') }}</div>

  <template v-if="plan">
    <!-- target, time and the plan's menu -->
    <div class="card plan-card" :class="{ closed: rp.closed(plan) }">
      <div class="plan-title">
        <template v-if="rp.hasCoords(plan)">
          <span v-if="plan.planet_type === 'moon'" class="moon-tag"><Icon name="moon" :size="11" /> {{ t('plans.moon') }}</span>
          <h1 class="mono">{{ coords(plan.g!, plan.s!, plan.p!) }}</h1>
          <span v-if="plan.planet_name" class="muted">{{ plan.planet_name }}</span>
        </template>
        <h1 v-else class="warn coords-missing">{{ t('plans.coordsMissing') }}</h1>
        <PlayerLink v-if="plan.player_id" :id="plan.player_id" :name="plan.player_name ?? '?'" />
        <PlanetActions v-if="rp.hasCoords(plan)" :g="plan.g!" :s="plan.s!" :p="plan.p!" :type="plan.planet_type" />
        <span class="grow" />
        <span v-if="plan.mission === 'hold'" class="badge mission-hold">{{ t('hold.badge') }}</span>
        <span v-else-if="plan.enemy" class="badge">{{ t('plans.retimeBadge') }}</span>
        <span class="badge status" :class="`st-${plan.status}`">{{ t(`plans.status.${plan.status}`) }}</span>
        <ActionMenu v-if="planMenu.length" :items="planMenu" :title="t('plans.menu')" />
      </div>
      <dl class="facts">
        <div>
          <dt>{{ t('plans.targetTime') }}</dt>
          <dd class="time">
            <b class="mono">{{ rp.targetText(plan) }}</b>
            <Countdown v-if="plan.time_precision !== 'day'" class="muted small" :to="plan.target_time" />
            <Hint v-if="!rp.exact(plan)">{{ rp.hasCoords(plan) ? t('plans.roughTime') : t('plans.noCoordsHint') }}</Hint>
          </dd>
        </div>
        <div v-if="rp.exact(plan) && view?.acs?.delay" class="warn">
          <dt><Icon name="warning" :size="12" /> {{ t('plans.arrival') }}</dt>
          <dd class="time"><b class="mono">{{ rp.clock(view.acs.arrival) }}</b> <span class="small">{{ t('plans.delayedBy', { t: duration(view.acs.delay) }) }}</span></dd>
        </div>
        <div v-if="view?.acs && view.acs.fleets.length > 1">
          <dt>{{ t('plans.leadShort') }}</dt>
          <dd>{{ rp.leadName(plan) }}</dd>
        </div>
        <div>
          <dt>{{ t('plans.creator') }}</dt>
          <dd>{{ plan.creator }}</dd>
        </div>
      </dl>
      <p v-if="plan.note" class="note">{{ plan.note }}</p>
      <p v-if="plan.sim" class="small muted sim-line">
        {{ t('plans.simTaken', { name: plan.sim.by ?? '?', time: timeWithAge(plan.sim.time) }) }}
        <template v-if="plan.sim.defender && plan.spy?.source === 'spy'"> · {{ t('plans.simOlder') }}</template>
      </p>
      <div v-if="view?.acs?.tooManyFleets || view?.acs?.tooManyPlayers" class="small warn">
        <div v-if="view.acs.tooManyFleets"><Icon name="warning" :size="12" /> {{ t('plans.tooManyFleets') }}</div>
        <div v-if="view.acs.tooManyPlayers"><Icon name="warning" :size="12" /> {{ t('plans.tooManyPlayers') }}</div>
      </div>
    </div>

    <!-- what the viewer does next -->
    <div v-if="step" class="card next-step" :class="`step-${step.kind}`">
      <template v-if="step.kind === 'launch'">
        <div class="step-text">
          <span class="step-label">{{ t('plans.myLaunch') }}</span>
          <span class="step-time"><b class="mono" :class="{ neg: step.late }">{{ rp.clock(step.at) }}</b> <Countdown class="mono muted" :to="step.at" /></span>
          <span v-if="step.late" class="neg small">{{ t('plans.lateLong') }}</span>
          <span v-else-if="step.duration != null" class="muted small">{{ t('plans.flightOf', { t: duration(Math.floor(step.duration)) }) }}</span>
        </div>
        <div class="step-actions">
          <a v-if="step.duration != null" class="btn" :href="fleetCalcLink(settings, plan, step.fleet)!" target="_blank" rel="noopener" :title="t('plans.calcTitle')">
            {{ t('plans.calc') }} <Icon name="external" :size="12" />
          </a>
          <button class="primary" @click="rp.setFleetStatus(plan, step.fleet, 'launched')">{{ t('plans.markLaunched') }}</button>
        </div>
      </template>
      <template v-else>
        <div class="step-text">
          <span class="step-label">{{ t('plans.nextStep') }}</span>
          <span>{{ t(`plans.steps.${step.kind}`) }}</span>
        </div>
        <div class="step-actions">
          <button v-if="step.kind === 'coords'" class="primary" @click="openEdit(true)">{{ t('plans.setCoordsTitle') }}</button>
          <button v-else-if="step.kind === 'join'" class="primary btn-icon" @click="openFleet()"><Icon name="plus" />{{ t('plans.addFleet') }}</button>
          <button v-else-if="step.kind === 'complete'" class="primary" @click="openFleet(step.fleet)">{{ t('plans.completeFleet') }}</button>
          <button v-else-if="step.kind === 'start'" class="primary" @click="rp.setStatus(plan, 'launched')">{{ t('plans.setStatusTo', { status: t('plans.status.launched') }) }}</button>
          <button v-else-if="step.kind === 'finish'" class="primary" @click="rp.setStatus(plan, 'done')">{{ t('plans.setStatusTo', { status: t('plans.status.done') }) }}</button>
          <RouterLink v-else-if="step.kind === 'settle'" class="btn primary" :to="settleLink">{{ t('loot.open') }}</RouterLink>
        </div>
      </template>
    </div>

    <Section v-if="plan.enemy" :title="plan.mission === 'hold' ? t('hold.title') : t('retime.enemy')" store-key="raidPlan.enemy" class="enemy">
      <HoldPanel v-if="plan.mission === 'hold'" :plan="plan" :editable="rp.canEditEnemy(plan) && !rp.closed(plan)" @saved="onSaved" @error="(m) => (error = m)" />
      <RetimePanel v-else :plan="plan" :editable="rp.canEditEnemy(plan) && !rp.closed(plan)" @saved="onSaved" @error="(m) => (error = m)" />
    </Section>

    <Section :title="t('plans.fleets')" :count="rp.flying(plan)" store-key="raidPlan.fleets" class="fleets">
      <template v-if="!rp.closed(plan)" #actions>
        <button class="btn-icon" @click="openFleet()"><Icon name="plus" />{{ t('plans.addFleet') }}</button>
        <ActionMenu v-if="inviteMenu.length" :items="inviteMenu" :label="t('plans.invite')" icon="user" :title="t('plans.inviteTitle')" />
      </template>
      <!-- mobile: one card per fleet, the launch time first -->
      <div v-if="mobile && (plan.fleets.length || plan.guests?.length)" class="fleet-cards">
        <div v-for="x in view!.fleets" :key="x.fleet.id" class="fleet-card" :class="{ mine: x.fleet.user_id === me, dim: x.fleet.status === 'withdrawn' }">
          <div class="fc-head">
            <b>{{ x.fleet.member }}</b>
            <span v-if="isLead(x.plan?.id)" class="badge">{{ t('plans.leadShort') }}</span>
            <Icon v-if="x.duration != null && rp.oldDrives(x.fleet)" name="warning" :size="13" class="warn" :label="t('plans.drivesOld')" />
            <span class="grow" />
            <select
              v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)"
              :value="x.fleet.status"
              :aria-label="t('plans.fleetStatus')"
              @change="rp.setFleetStatus(plan, x.fleet, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="s in FLEET_STATUSES" :key="s" :value="s">{{ t(`plans.fleetStatuses.${s}`) }}</option>
            </select>
            <span v-else class="badge">{{ t(`plans.fleetStatuses.${x.fleet.status}`) }}</span>
            <ActionMenu v-if="fleetMenu(x.fleet, x.duration).length" :items="fleetMenu(x.fleet, x.duration)" :title="t('plans.fleetMenu', { member: x.fleet.member })" />
          </div>
          <div class="fc-launch">
            <span v-if="x.fleet.recalled_at && x.fleet.status === 'withdrawn'" class="small warn">{{ t('plans.recalled', { time: rp.clock(x.fleet.recalled_at) }) }}</span>
            <template v-else-if="x.fleet.seen">
              <span class="small muted">{{ t('plans.arrival') }}</span> <b class="mono">{{ rp.clock(x.fleet.seen.arrival) }}</b>
              <span class="small" :class="rp.exact(plan) && x.fleet.seen.arrival !== plan.target_time ? 'warn' : 'pos'">
                {{ t('plans.seen') }}<template v-if="rp.exact(plan)"> · {{ rp.offset(x.fleet.seen.arrival - plan.target_time) }}</template>
              </span>
            </template>
            <template v-else-if="x.plan && rp.exact(plan)">
              <span class="small muted">{{ t('plans.launch') }}</span>
              <b class="mono" :class="{ neg: x.plan.late }">{{ rp.clock(x.plan.launch) }}</b>
              <Countdown class="muted small mono" :to="x.plan.launch" />
              <span v-if="x.plan.late" class="neg small">{{ t('plans.late') }}</span>
              <span v-if="x.plan.delays" class="warn small">{{ t('plans.delays') }}</span>
              <span v-if="x.plan.beforeLead" class="warn small">{{ t('plans.beforeLead') }}</span>
              <span v-if="x.plan.outside" class="warn small">{{ t('plans.outside') }}</span>
            </template>
            <span v-else-if="x.plan && plan.time_precision === 'hour'" class="mono">{{ t('plans.around', { t: rp.shortClock(x.plan.launch) }) }}</span>
            <span v-else class="muted small">{{ x.duration == null && rp.hasCoords(plan) ? t('plans.incomplete') : '–' }}</span>
          </div>
          <div v-if="x.fleet.seen && seenShipsDiffer(x.fleet)" class="small warn">
            {{ t('plans.seenShips', { ships: rp.shipList(x.fleet.seen.ships) }) }}
            <button v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)" class="small" @click="rp.takeSeenShips(plan, x.fleet)">{{ t('plans.takeSeen') }}</button>
          </div>
          <div class="fc-details small">
            <span class="mono">
              {{ x.fleet.g != null ? coords(x.fleet.g, x.fleet.s!, x.fleet.p!) : '–' }}
              <Icon v-if="x.fleet.planet_type === 'moon'" name="moon" :size="11" class="muted" :label="t('common.moon')" />
            </span>
            <span>{{ rp.shipList(x.fleet.ships) }}</span>
            <span v-if="x.duration != null" class="muted">{{ t('plans.flightOf', { t: duration(Math.floor(x.duration)) }) }}</span>
            <select
              v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)"
              class="speed"
              :value="x.fleet.speed"
              :aria-label="t('plans.speed')"
              @change="rp.setFleetSpeed(plan, x.fleet, Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
            </select>
            <span v-else>{{ x.fleet.speed }} %</span>
          </div>
        </div>
        <div v-for="(g, i) in plan.guests ?? []" :key="`g${i}`" class="fleet-card guest">
          <div class="fc-head">
            <PlayerLink v-if="g.player" :id="g.player.id" :name="g.player.name" />
            <span v-else>{{ g.name ?? '?' }}</span>
            <span class="badge" :title="t('ownAttacks.guestTitle')">{{ t('ownAttacks.guest') }}</span>
          </div>
          <div class="fc-details small">
            <span class="mono">{{ coords(g.from.g, g.from.s, g.from.p) }}</span>
            <span>{{ Object.entries(g.ships).map(([id, n]) => `${fmt(n)} ${name(Number(id))}`).join(', ') }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="plan.fleets.length || plan.guests?.length" class="table-wrap flat">
        <table v-stack class="data fleet-table">
          <thead>
            <tr>
              <th>{{ t('plans.member') }}</th>
              <th>{{ t('plans.launch') }}</th>
              <th>{{ t('plans.fleetStatus') }}</th>
              <th>{{ t('plans.start') }}</th>
              <th>{{ t('plans.ships') }}</th>
              <th>{{ t('plans.speed') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in view!.fleets" :key="x.fleet.id" :class="{ mine: x.fleet.user_id === me, dim: x.fleet.status === 'withdrawn' }">
              <td>
                {{ x.fleet.member }}
                <span v-if="isLead(x.plan?.id)" class="badge">{{ t('plans.leadShort') }}</span>
                <Icon v-if="x.duration != null && rp.oldDrives(x.fleet)" name="warning" :size="13" class="warn" :label="t('plans.drivesOld')" />
              </td>
              <td class="c-launch">
                <div>
                  <span v-if="x.fleet.recalled_at && x.fleet.status === 'withdrawn'" class="small warn">{{ t('plans.recalled', { time: rp.clock(x.fleet.recalled_at) }) }}</span>
                  <template v-else-if="x.fleet.seen">
                    <span class="small muted">{{ t('plans.arrival') }}</span> <span class="mono">{{ rp.clock(x.fleet.seen.arrival) }}</span>
                    <div class="small" :class="rp.exact(plan) && x.fleet.seen.arrival !== plan.target_time ? 'warn' : 'pos'">
                      {{ t('plans.seen') }}<template v-if="rp.exact(plan)"> · {{ rp.offset(x.fleet.seen.arrival - plan.target_time) }}</template>
                    </div>
                    <div v-if="seenShipsDiffer(x.fleet)" class="small warn">
                      {{ t('plans.seenShips', { ships: rp.shipList(x.fleet.seen.ships) }) }}
                      <button v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)" class="small" @click="rp.takeSeenShips(plan, x.fleet)">{{ t('plans.takeSeen') }}</button>
                    </div>
                  </template>
                  <template v-else-if="x.plan && rp.exact(plan)">
                    <span class="time">
                      <span class="mono" :class="{ neg: x.plan.late }">{{ rp.clock(x.plan.launch) }}</span>
                      <Countdown class="muted small" :to="x.plan.launch" />
                    </span>
                    <div class="small flags">
                      <span v-if="x.plan.late" class="neg">{{ t('plans.late') }}</span>
                      <span v-if="x.plan.delays" class="warn">{{ t('plans.delays') }}</span>
                      <span v-if="x.plan.beforeLead" class="warn">{{ t('plans.beforeLead') }}</span>
                      <span v-if="x.plan.outside" class="warn">{{ t('plans.outside') }}</span>
                    </div>
                  </template>
                  <span v-else-if="x.plan && plan.time_precision === 'hour'" class="mono">{{ t('plans.around', { t: rp.shortClock(x.plan.launch) }) }}</span>
                  <span v-else-if="x.duration == null" class="muted small">{{ rp.hasCoords(plan) ? t('plans.incomplete') : '–' }}</span>
                  <span v-else class="muted small">–</span>
                  <div v-if="x.duration != null" class="small faint">
                    {{ t('plans.flightOf', { t: duration(Math.floor(x.duration)) }) }}<template v-if="x.plan && rp.exact(plan) && plan.mission !== 'hold'"> · {{ t('plans.homeAt', { t: rp.clock(x.plan.home) }) }}</template>
                  </div>
                </div>
              </td>
              <td>
                <select
                  v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)"
                  :value="x.fleet.status"
                  :aria-label="t('plans.fleetStatus')"
                  @change="rp.setFleetStatus(plan, x.fleet, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="s in FLEET_STATUSES" :key="s" :value="s">{{ t(`plans.fleetStatuses.${s}`) }}</option>
                </select>
                <span v-else>{{ t(`plans.fleetStatuses.${x.fleet.status}`) }}</span>
              </td>
              <td class="mono">
                {{ x.fleet.g != null ? coords(x.fleet.g, x.fleet.s!, x.fleet.p!) : '–' }}
                <Icon v-if="x.fleet.planet_type === 'moon'" name="moon" :size="12" class="muted" :label="t('common.moon')" />
              </td>
              <td class="small m-wide">{{ rp.shipList(x.fleet.ships) }}</td>
              <td>
                <select
                  v-if="rp.canEditFleet(plan, x.fleet) && !rp.closed(plan)"
                  class="speed"
                  :value="x.fleet.speed"
                  :aria-label="t('plans.speed')"
                  @change="rp.setFleetSpeed(plan, x.fleet, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="v in SPEEDS" :key="v" :value="v">{{ v }} %</option>
                </select>
                <span v-else>{{ x.fleet.speed }} %</span>
              </td>
              <td class="actions">
                <ActionMenu v-if="fleetMenu(x.fleet, x.duration).length" :items="fleetMenu(x.fleet, x.duration)" :title="t('plans.fleetMenu', { member: x.fleet.member })" />
              </td>
            </tr>
            <tr v-for="(g, i) in plan.guests ?? []" :key="`g${i}`" class="guest">
              <td>
                <PlayerLink v-if="g.player" :id="g.player.id" :name="g.player.name" />
                <span v-else>{{ g.name ?? '?' }}</span>
                <span class="badge" :title="t('ownAttacks.guestTitle')">{{ t('ownAttacks.guest') }}</span>
              </td>
              <td />
              <td />
              <td class="mono">
                {{ coords(g.from.g, g.from.s, g.from.p) }}
                <Icon v-if="g.from.type === 'moon'" name="moon" :size="12" class="muted" :label="t('common.moon')" />
              </td>
              <td class="small m-wide">{{ Object.entries(g.ships).map(([id, n]) => `${fmt(n)} ${name(Number(id))}`).join(', ') }}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted small">{{ t('plans.noFleets') }}</p>
    </Section>
  </template>

  <PlanFleetSheet v-model="fleetSheet.open" :plan="plan" :fleet="fleetSheet.fleet" @saved="onSaved" />

  <Sheet v-model="editSheet.open" :title="editSheet.coordsOnly ? t('plans.setCoordsTitle') : t('plans.editPlan')">
    <div v-if="editSheet.draft" class="edit-box">
      <PlanTargetForm v-model="editSheet.draft" :coords-only="editSheet.coordsOnly" />
    </div>
    <template #footer>
      <button @click="editSheet.open = false">{{ t('plans.cancelForm') }}</button>
      <button class="primary" @click="saveEdit">{{ t('plans.save') }}</button>
    </template>
  </Sheet>

  <Sheet v-model="simSheet.open" :title="t('plans.simUpdate')">
    <div class="sim-form">
      <textarea v-model="simSheet.text" rows="6" :placeholder="t('plans.simPlaceholder')" />
      <p class="muted small">{{ t('plans.simHint') }}</p>
    </div>
    <template #footer>
      <button @click="simSheet.open = false">{{ t('plans.cancelForm') }}</button>
      <button class="primary" :disabled="!simSheet.text.trim()" @click="sendSim">{{ t('plans.simApply') }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.plan-card { display: flex; flex-direction: column; gap: 10px; }
.plan-card.closed { opacity: .8; }
.plan-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.plan-title h1 { margin: 0; font-size: 20px; }
.plan-title .coords-missing { font-size: 16px; }
.plan-title .moon-tag { margin: 0; }
.badge.mission-hold { color: var(--pos); }
.badge.st-launched { color: var(--pos); }
.badge.st-cancelled { color: var(--faint); }
.facts { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0; }
.facts > div { display: flex; flex-direction: column; gap: 1px; }
.facts dt { color: var(--muted); font-size: 12px; }
.facts .warn dt { color: var(--warn); }
.facts dd { margin: 0; }
.time { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.note { margin: 0; white-space: pre-wrap; }
.sim-line { margin: 0; }
/* the next step: the one thing to do now, with its button */
.next-step { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.next-step.step-launch { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.step-text { flex: 1 1 260px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.step-label { color: var(--accent); font-weight: 600; }
.step-time { display: inline-flex; align-items: baseline; gap: 8px; font-size: 20px; }
.step-actions { display: flex; flex-wrap: wrap; gap: 8px; }
/* fleet cards (mobile) */
.fleet-cards { display: flex; flex-direction: column; gap: 8px; }
.fleet-card { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.fleet-card.mine { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.fleet-card.dim { opacity: .6; }
.fleet-card.guest { background: none; }
.fc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fc-head select { max-width: 45%; }
.fc-launch { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.fc-launch b { font-size: 16px; }
.fc-details { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.fc-details select { min-height: 32px; padding: 2px 6px; font-size: 14px; }
.flags { display: flex; flex-wrap: wrap; gap: 2px 8px; }
tr.mine td:first-child { font-weight: 600; }
tr.guest td { color: var(--muted); }
td.actions { width: 1%; white-space: nowrap; }
select.speed { min-width: 80px; }
.edit-box, .sim-form { display: flex; flex-direction: column; gap: 10px; }
.sim-form textarea { width: 100%; font-size: 12px; }
.sim-form p { margin: 0; }
@media (max-width: 800px) {
  .plan-title h1 { font-size: 18px; }
  .step-actions { width: 100%; }
  .step-actions > * { flex: 1; justify-content: center; }
  /* fleet cards: member, launch and status in the title area */
  .fleet-table td.c-launch { order: 0; flex-basis: 100%; justify-content: flex-start; text-align: left; }
  .fleet-table td.c-launch::before { content: none; }
}
</style>

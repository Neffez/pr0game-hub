<script setup lang="ts">
import Loading from '../components/Loading.vue';
import ActionMenu from '../components/ActionMenu.vue';
import Countdown from '../components/Countdown.vue';
import Hint from '../components/Hint.vue';
import Icon from '../components/Icon.vue';
import LootSettlementList from '../components/LootSettlementList.vue';
import PageHeader from '../components/PageHeader.vue';
import PlanTargetForm from '../components/PlanTargetForm.vue';
import PlayerLink from '../components/PlayerLink.vue';
import Section from '../components/Section.vue';
import Sheet from '../components/Sheet.vue';
import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { loadClaims } from '../claims';
import { useStored } from '../composables';
import { coords, duration } from '../format';
import { draftBody, newDraft, type AttackPlan, type HostileAttack, type OwnAttack } from '../plans';
import { useRaidPlanner } from '../raidPlanner';
import { toast } from '../toast';

/**
 * Raid planner: what needs attention first (own launches, hostile attacks, own attacks without a plan), then the
 * current plans as compact rows that open the plan's page, the past ones folded away. New plans and phalanx results
 * are entered in a sheet.
 */
const rp = useRaidPlanner();
const { t, uni, now, attacks, ownAttacks, loaded, error, current, past, run, claimedInfo } = rp;
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

const planLink = (id: number) => `/${uni.value}/raid-planner/${id}`;
const openPlan = (id: number | null) => id && router.push(planLink(id));
/** `?plan=<id>` (bell, push and Discord links): the plan's own page. */
watch(
  () => route.query.plan,
  (id) => {
    if (id) router.replace(planLink(Number(id)));
  },
  { immediate: true },
);

// ---- new plan ----
const form = reactive({ open: false, draft: newDraft(Math.floor(Date.now() / 1000)) });
function openForm(target = '', type: 'planet' | 'moon' = 'planet') {
  form.draft = newDraft(Math.floor(Date.now() / 1000), target, type);
  form.open = true;
}
/** `?new=<g:s:p>&type=moon` (planet action menu): the form filled in. */
watch(
  () => route.query.new,
  (v) => {
    if (v) openForm(String(v), route.query.type === 'moon' ? 'moon' : 'planet');
  },
  { immediate: true },
);
watch(
  () => form.open,
  (v) => {
    if (!v && route.query.new) router.replace({ query: { ...route.query, new: undefined, type: undefined } });
  },
);
async function create() {
  const body = draftBody(form.draft);
  if (!body) return void (error.value = t('plans.formInvalid'));
  let id = 0;
  const ok = await run(async () => {
    const res = await uniApi<{ id: number; claimedBy: string | null }>(uni.value, '/plans', { body });
    claimedInfo(res);
    id = res.id;
  }, t('plans.toast.created'));
  loadClaims(uni.value);
  if (!ok) return;
  form.open = false;
  openPlan(id);
}

/** Phalanx result (copied like the overview): its attacks join the hostile attacks. */
const phalanx = reactive({ open: false, text: '' });
async function sendPhalanx() {
  await run(async () => {
    const res = await uniApi<{ attacks: number }>(uni.value, '/phalanx', { body: { text: phalanx.text } });
    toast(t('phalanx.found', { n: res.attacks }, res.attacks), res.attacks ? 'ok' : 'warn');
    Object.assign(phalanx, { open: false, text: '' });
  });
}

const shownAttacks = computed(() => attacks.value.filter((a) => !a.hidden));
const hiddenAttacks = computed(() => attacks.value.filter((a) => a.hidden));
/** The viewer's launches still to come, soonest first (exact plans only). */
const myLaunches = computed(() =>
  current.value
    .filter((p) => rp.exact(p) && rp.myLaunch(p))
    .map((p) => ({ plan: p, at: rp.myLaunch(p)! }))
    .sort((a, b) => a.at - b.at),
);
const attackTarget = (a: HostileAttack | OwnAttack) => `${coords(a.to.g, a.to.s, a.to.p)}${a.to.type === 'moon' ? ` (${t('common.moon')})` : ''}`;
const attackMenu = (a: HostileAttack) => [
  a.holdPlanId
    ? { label: t('plans.openHold'), icon: 'arrowRight', to: planLink(a.holdPlanId) }
    : a.arrival > now.value && { label: t('hold.plan'), icon: 'pause', onClick: async () => openPlan(await rp.planHold(a)) },
  { label: t('retime.hide'), icon: 'eyeOff', hint: t('retime.hideTitle'), onClick: () => rp.setHidden(a, true) },
];
/** Things of a plan row worth a glance: fleets, own launch, problems. */
const delay = (p: AttackPlan) => (rp.exact(p) ? (rp.views.value.get(p.id)?.acs?.delay ?? 0) : 0);
</script>

<template>
  <PageHeader :title="t('nav.raidPlanner')">
    <template #hint><Hint>{{ t('plans.hint') }}</Hint></template>
    <button class="primary btn-icon" @click="openForm()"><Icon name="plus" />{{ t('plans.new') }}</button>
    <ActionMenu :items="[{ label: t('phalanx.paste'), icon: 'spy', hint: t('phalanx.menuHint'), onClick: () => (phalanx.open = true) }]" />
  </PageHeader>
  <div class="seg tab-seg">
    <button :class="{ active: tab === 'plans' }" @click="tab = 'plans'">{{ t('plans.tabPlans') }}</button>
    <button :class="{ active: tab === 'settlements' }" @click="tab = 'settlements'">{{ t('plans.tabSettlements') }}</button>
  </div>

  <LootSettlementList v-if="tab === 'settlements'" />
  <template v-else>
    <div v-if="error" class="error">{{ error }}</div>

    <!-- what to do next: the viewer's own launches -->
    <RouterLink v-for="l in myLaunches" :key="l.plan.id" :to="planLink(l.plan.id)" class="card launch-strip">
      <Icon name="fleet" :size="18" />
      <span class="launch-label">{{ t('plans.myLaunch') }}</span>
      <b class="mono">{{ rp.clock(l.at) }}</b>
      <Countdown class="mono" :to="l.at" />
      <span class="muted small">{{ rp.targetLabel(l.plan) }}</span>
      <span class="grow" />
      <Icon name="chevronRight" class="muted" />
    </RouterLink>

    <Section v-if="shownAttacks.length || hiddenAttacks.length" :title="t('retime.attacks')" :count="shownAttacks.length" store-key="raidPlanner.attacks" class="attacks">
      <p v-if="!shownAttacks.length" class="muted small">{{ t('plans.noAttacks') }}</p>
      <div v-for="a in shownAttacks" :key="a.key" class="item attack">
        <div class="item-main">
          <div class="item-line">
            <Icon name="attack" class="neg" />
            <b class="neg">{{ t('notify.attack', { member: a.member ?? coords(a.to.g, a.to.s, a.to.p) }) }}</b>
            <span v-if="a.source === 'phalanx'" class="badge" :title="t('phalanx.byTitle', { name: a.reporter ?? '?' })">{{ t('phalanx.badge') }}</span>
            <span v-if="a.arrival <= now" class="badge" :title="t('retime.arrivedTitle')">{{ t('retime.arrived') }}</span>
            <span class="grow" />
            <span class="time"><b class="mono">{{ rp.clock(a.arrival) }}</b> <Countdown class="muted small" :to="a.arrival" /></span>
          </div>
          <div class="item-line small muted">
            <span class="mono">{{ attackTarget(a) }}</span>
            <span>{{ rp.attackShips(a) }}</span>
            <span>
              {{ t('notify.from') }} <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
              <span class="mono">{{ coords(a.from.g, a.from.s, a.from.p) }}</span><template v-if="a.from.type === 'moon'"> ({{ t('common.moon') }})</template>
            </span>
            <span v-if="a.home">{{ t('phalanx.home', { t: rp.clock(a.home) }) }}</span>
          </div>
        </div>
        <div class="item-actions">
          <RouterLink v-if="a.planId" class="btn" :to="planLink(a.planId)">{{ t('retime.planned') }}</RouterLink>
          <button v-else class="primary" @click="async () => openPlan(await rp.planRetime(a))">{{ t('retime.plan') }}</button>
          <span v-if="a.holdPlanId" class="muted small">{{ t('hold.planned') }}</span>
          <ActionMenu :items="attackMenu(a)" />
        </div>
      </div>

      <Section v-if="hiddenAttacks.length" :title="t('retime.hidden', { n: hiddenAttacks.length })" :card="false" :default-open="false" store-key="raidPlanner.hiddenAttacks">
        <div v-for="a in hiddenAttacks" :key="a.key" class="item attack hidden-attack">
          <div class="item-main">
            <div class="item-line">
              <span>{{ t('notify.attack', { member: a.member ?? coords(a.to.g, a.to.s, a.to.p) }) }}</span>
              <span class="grow" />
              <span class="time"><span class="mono">{{ rp.clock(a.arrival) }}</span> <Countdown class="muted small" :to="a.arrival" /></span>
            </div>
            <div class="item-line small muted">
              <span class="mono">{{ attackTarget(a) }}</span>
              <span>{{ rp.attackShips(a) }}</span>
              <span>{{ t('retime.hiddenBy', { name: a.hidden!.by ?? '?', time: rp.clock(a.hidden!.at) }) }}</span>
            </div>
          </div>
          <div class="item-actions">
            <button @click="rp.setHidden(a, false)">{{ t('retime.unhide') }}</button>
          </div>
        </div>
      </Section>
    </Section>

    <Section v-if="ownAttacks.length" :title="t('ownAttacks.title')" :count="ownAttacks.length" store-key="raidPlanner.ownAttacks" class="own-attacks">
      <template #hint><Hint>{{ t('ownAttacks.hint') }}</Hint></template>
      <div v-for="a in ownAttacks" :key="a.key" class="item attack">
        <div class="item-main">
          <div class="item-line">
            <Icon name="inFlight" />
            <b class="mono">{{ attackTarget(a) }}</b>
            <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
            <span class="grow" />
            <span class="time"><b class="mono">{{ rp.clock(a.arrival) }}</b> <Countdown class="muted small" :to="a.arrival" /></span>
          </div>
          <div class="item-line small muted">
            <span>{{ rp.attackShips(a) }}</span>
            <span>
              <template v-for="(f, i) in a.fleets" :key="i">
                <span v-if="i">, </span>
                <span :class="{ faint: f.memberId == null }" :title="f.memberId == null ? t('ownAttacks.guestTitle') : undefined">{{ rp.ownFleetName(f) }}</span>
              </template>
            </span>
          </div>
        </div>
        <div class="item-actions">
          <button class="primary" @click="async () => openPlan(await rp.planOwn(a))">{{ t('ownAttacks.plan') }}</button>
        </div>
      </div>
    </Section>

    <Loading v-if="!loaded" />
    <h2 class="plans-head">{{ t('plans.current') }} <span v-if="current.length" class="badge">{{ current.length }}</span></h2>
    <div v-if="loaded && !current.length" class="card muted empty">
      {{ t('plans.none') }}
      <button class="btn-icon" @click="openForm()"><Icon name="plus" />{{ t('plans.new') }}</button>
    </div>
    <div v-if="current.length" class="plan-list">
      <RouterLink v-for="p in current" :id="`plan-${p.id}`" :key="p.id" :to="planLink(p.id)" class="plan-row" :class="{ mine: rp.myLaunch(p) }">
        <div class="item-line">
          <template v-if="rp.hasCoords(p)">
            <span v-if="p.planet_type === 'moon'" class="moon-tag"><Icon name="moon" :size="11" /> {{ t('plans.moon') }}</span>
            <b class="mono">{{ coords(p.g!, p.s!, p.p!) }}</b>
            <span v-if="p.planet_name" class="muted">{{ p.planet_name }}</span>
          </template>
          <span v-else class="warn small">{{ t('plans.coordsMissing') }}</span>
          <span v-if="p.player_name" class="player">{{ p.player_name }}</span>
          <span class="grow" />
          <span v-if="p.mission === 'hold'" class="badge mission-hold">{{ t('hold.badge') }}</span>
          <span v-else-if="p.enemy" class="badge">{{ t('plans.retimeBadge') }}</span>
          <span class="badge" :class="`st-${p.status}`">{{ t(`plans.status.${p.status}`) }}</span>
        </div>
        <div class="item-line small">
          <span class="time">
            <span class="mono">{{ rp.targetText(p) }}</span>
            <Countdown v-if="p.time_precision !== 'day'" class="muted" :to="p.target_time" />
          </span>
          <span class="muted">{{ t('plans.fleetCount', { n: rp.flying(p) }, rp.flying(p)) }}</span>
          <span v-if="rp.myLaunch(p) && rp.exact(p)" class="time my-launch">
            {{ t('plans.myLaunch') }} <b class="mono">{{ rp.clock(rp.myLaunch(p)!) }}</b>
          </span>
          <span v-if="rp.lateFleet(p)" class="neg"><Icon name="warning" :size="12" /> {{ t('plans.late') }}</span>
          <span v-else-if="delay(p)" class="warn"><Icon name="warning" :size="12" /> {{ t('plans.delayedBy', { t: duration(delay(p)) }) }}</span>
          <span class="grow" />
          <Icon name="chevronRight" class="muted chevron" />
        </div>
      </RouterLink>
    </div>

    <Section v-if="past.length" :title="t('plans.past')" :count="past.length" :default-open="false" store-key="raidPlanner.past" class="past">
      <div class="plan-list flat">
        <RouterLink v-for="p in past" :key="p.id" :to="planLink(p.id)" class="plan-row closed">
          <div class="item-line">
            <b class="mono">{{ rp.targetLabel(p) }}</b>
            <span v-if="p.player_name && rp.hasCoords(p)" class="player">{{ p.player_name }}</span>
            <span class="muted small">{{ rp.targetText(p) }}</span>
            <span class="grow" />
            <span v-if="p.mission === 'hold'" class="badge mission-hold">{{ t('hold.badge') }}</span>
            <span class="badge" :class="`st-${p.status}`">{{ t(`plans.status.${p.status}`) }}</span>
            <Icon name="chevronRight" class="muted chevron" />
          </div>
        </RouterLink>
      </div>
    </Section>
  </template>

  <Sheet v-model="form.open" :title="t('plans.new')">
    <div class="plan-form">
      <PlanTargetForm v-model="form.draft" />
      <p class="muted small">{{ t('plans.createHint') }}</p>
    </div>
    <template #footer>
      <button @click="form.open = false">{{ t('plans.cancelForm') }}</button>
      <button class="primary" @click="create">{{ t('plans.create') }}</button>
    </template>
  </Sheet>

  <Sheet v-model="phalanx.open" :title="t('phalanx.paste')">
    <div class="phalanx-form">
      <textarea v-model="phalanx.text" rows="6" :placeholder="t('phalanx.placeholder')" />
      <p class="muted small">{{ t('phalanx.hint') }}</p>
    </div>
    <template #footer>
      <button @click="phalanx.open = false">{{ t('plans.cancelForm') }}</button>
      <button class="primary" :disabled="!phalanx.text.trim()" @click="sendPhalanx">{{ t('phalanx.apply') }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.tab-seg { margin-bottom: 14px; }
.launch-strip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.launch-strip:hover { text-decoration: none; border-color: var(--accent); }
.launch-strip > .icon:first-child { color: var(--accent); }
.launch-label { font-weight: 600; }
/* list entries: main part (two lines) and actions on the right, below on mobile */
.item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 0; border-top: 1px solid var(--border); }
.item:first-child { border-top: 0; }
.item-main { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.item-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; }
.item-actions { display: flex; align-items: center; gap: 6px; }
.hidden-attack { opacity: .75; }
.time { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.plans-head { display: flex; align-items: center; gap: 6px; }
.plans-head .badge { margin: 0; }
.empty { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.plan-list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; margin-bottom: 14px; }
.plan-list.flat { border: 0; margin: 0; background: none; }
.plan-row { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; border-top: 1px solid var(--border); color: var(--text); }
.plan-row:first-child { border-top: 0; }
.plan-row:hover { background: var(--surface-2); text-decoration: none; }
.plan-row.mine { box-shadow: inset 3px 0 0 var(--accent); }
.plan-row.closed { opacity: .75; padding: 8px 4px; }
.plan-row .player { color: var(--muted); }
.my-launch { color: var(--accent); }
.chevron { flex: none; }
.badge.mission-hold { color: var(--pos); }
.badge.st-launched { color: var(--pos); }
.badge.st-cancelled { color: var(--faint); }
.plan-form { display: flex; flex-direction: column; gap: 10px; }
.plan-form p, .phalanx-form p { margin: 0; }
.phalanx-form { display: flex; flex-direction: column; gap: 8px; }
.phalanx-form textarea { width: 100%; font-size: 12px; }
@media (max-width: 800px) {
  .item-actions { width: 100%; }
  .item-actions > .primary, .item-actions > .btn { flex: 1; justify-content: center; }
  .plan-row { padding: 10px 12px; }
}
</style>

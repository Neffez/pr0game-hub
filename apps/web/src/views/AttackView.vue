<script setup lang="ts">
import type { SaveTarget } from '@pr0hub/flight';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import { useClock } from '../clock';
import BackLink from '../components/BackLink.vue';
import Countdown from '../components/Countdown.vue';
import FleetSaveOptions, { type DebrisField } from '../components/FleetSaveOptions.vue';
import Hint from '../components/Hint.vue';
import Icon from '../components/Icon.vue';
import PageHeader from '../components/PageHeader.vue';
import PlayerLink from '../components/PlayerLink.vue';
import Section from '../components/Section.vue';
import { useLoader, useMobile, useUni } from '../composables';
import { abbr, battleSimLink, dateTime, duration, fmt, name, short } from '../format';
import { tables, useLiveReload } from '../live';
import { useAutoTour } from '../tours';

/**
 * Incoming attack assistant (server: repo/attackAssist.ts): one hostile attack on a member and what to do about it —
 * will the planet hold, which fleet save is possible before the impact, what the attacker can take, and who of the
 * alliance can still land a hold. Everything in the game is done by hand.
 */
interface C3 { g: number; s: number; p: number }
type Res = { metal: number; crystal: number; deuterium: number };
interface Range { avg: number; min: number; max: number }
interface Assist {
  attack: {
    key: string; arrival: number; from: C3 & { type: 'planet' | 'moon' }; to: C3 & { type: 'planet' | 'moon' }; source: 'overview' | 'phalanx';
    fleets: { mission: number | null; ships: Record<string, number> }[]; player: { id: number; name: string } | null; member: string | null;
  };
  member: { id: number; name: string | null } | null;
  target: (C3 & { type: 'planet' | 'moon'; name: string; values: Record<string, number>; resources: Res | null; empireTime: number; deuterium: number | null; perHour: Record<string, number> | null }) | null;
  bodies: (C3 & { type: 'planet' | 'moon'; name: string })[];
  research: Record<string, number>;
  attacker: { player: { id: number; name: string } | null; research: { values: Record<string, number>; time: number } | null; ships: Record<string, number>; estimated: { time: number } | null };
  away: { ships: Record<string, number>; fleets: number; unknown: boolean } | null;
  loot: Res | null;
  helpers: { userId: number; member: string; from: C3 & { type: 'planet' | 'moon'; name: string }; ships: Record<string, number>; points: number; duration: number; launch: number }[];
  holdPlan: number | null;
  holds: { member: string | null; player: string | null; from: C3 & { type: string | null }; ships: Record<string, number>; research: Record<string, number>; arrival: number | null }[];
  phalanx: { moon: C3; level: number; player: { name: string; ally: string | null } | null }[];
  simulated: boolean;
  sim: null | { error: string } | {
    error: null; runs: number; wins: { attacker: number; defender: number; draw: number }; rounds: number;
    loot: Res; debris: { metal: Range; crystal: Range }; lostResources: { attacker: Res; defender: Res };
  };
  now: number;
}

const { t } = useI18n();
const { uni, ctx } = useUni();
const route = useRoute();
const query = computed(() => new URLSearchParams(Object.entries(route.query).filter(([k, v]) => ['key', 'member', 'arrival', 'from'].includes(k) && typeof v === 'string') as [string, string][]));
const { data, error, load } = useLoader(() => uniApi<Assist>(uni.value, `/attack-assist?${query.value}`));
onMounted(load);
watch(query, load);
useLiveReload(load, tables('fleets', 'empire', 'attack_plans'));
useAutoTour('attack', () => !!data.value);

const clock = useClock();
const mobile = useMobile();
const now = computed(() => Math.floor(clock.value / 60) * 60);
const a = computed(() => data.value?.attack ?? null);
const arrived = computed(() => !!a.value && a.value.arrival <= clock.value);
const missionName = (m: number | null) => (m != null ? t(`game.missions.${m}`) : t('attack.unknownMission'));
const shipsText = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`).join(' · ');
const shipsTitle = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${name(id)}`).join('\n');
const c = (x: C3) => `${x.g}:${x.s}:${x.p}`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const resSum = (r: Res) => r.metal + r.crystal + r.deuterium;

const sim = computed(() => (data.value?.sim && data.value.sim.error == null ? data.value.sim : null));
const verdict = computed(() => {
  const s = sim.value;
  if (!s) return null;
  if (s.wins.defender >= 0.9) return { key: 'holds', cls: 'pos' };
  if (s.wins.attacker >= 0.9) return { key: 'falls', cls: 'neg' };
  if (s.wins.draw >= 0.9) return { key: 'draw', cls: 'warn' };
  return { key: 'open', cls: 'warn' };
});
const simLink = computed(() => {
  const d = data.value;
  if (!d?.target || !Object.keys(d.attacker.ships).length) return null;
  const r = d.target.resources;
  const values = { ...d.target.values, 109: d.research[109] ?? 0, 110: d.research[110] ?? 0, 111: d.research[111] ?? 0, ...(r ? { 901: r.metal, 902: r.crystal, 903: r.deuterium } : {}) };
  const from: [number, number, number] = [d.attack.from.g, d.attack.from.s, d.attack.from.p];
  const attackers = d.attack.fleets.filter((f) => Object.keys(f.ships).length).map((f) => ({ ships: f.ships, research: d.attacker.research?.values ?? {}, from, name: d.attacker.player?.name ?? null }));
  const holds = d.holds.map((h) => ({ ships: h.ships, research: h.research, from: [h.from.g, h.from.s, h.from.p] as [number, number, number], name: h.member ?? h.player }));
  return battleSimLink(ctx.value!.universe.settings, values, attackers, [d.target.g, d.target.s, d.target.p], holds, d.member?.name ?? null);
});

// ---- fleet save of the attacked body
const from = computed<SaveTarget | null>(() => (data.value?.target ? { coords: [data.value.target.g, data.value.target.s, data.value.target.p], type: data.value.target.type, name: data.value.target.name } : null));
const targets = computed<SaveTarget[]>(() => (data.value?.bodies ?? []).map((b) => ({ coords: [b.g, b.s, b.p], type: b.type, name: b.name })));
/** existing debris fields of the target's galaxy: recycling targets */
const fields = ref<Record<string, DebrisField[]>>({});
const cleanup = ref<number | null>(null);
watch(
  () => data.value?.target?.g,
  async (g) => {
    if (g == null) return;
    try {
      ({ fields: fields.value, cleanup: cleanup.value } = await uniApi<{ fields: Record<string, DebrisField[]>; cleanup: number }>(uni.value, `/debris-fields?g=${g}`));
    } catch {
      /* without them no recycling */
    }
  },
);
const deuterium = computed(() => {
  const x = data.value?.target;
  if (!x || x.deuterium == null) return null;
  return Math.floor(x.deuterium + ((x.perHour?.[903] ?? 0) * Math.max(0, now.value - x.empireTime)) / 3600);
});
const mine = computed(() => data.value?.member?.id === ctx.value!.me.id);

// ---- help of the alliance: a hold plan and invitations
const busy = ref(false);
const actionError = ref<string | null>(null);
const invited = reactive(new Set<string>());
const helperKey = (h: Assist['helpers'][number]) => `${h.userId}:${c(h.from)}:${h.from.type}`;
async function holdPlan(): Promise<number> {
  if (data.value!.holdPlan) return data.value!.holdPlan;
  const res = await uniApi<{ id: number }>(uni.value, '/plans/hold', { method: 'POST', body: { key: data.value!.attack.key } });
  data.value!.holdPlan = res.id;
  return res.id;
}
async function invite(list: Assist['helpers']) {
  busy.value = true;
  actionError.value = null;
  try {
    const id = await holdPlan();
    for (const h of list) {
      if (invited.has(helperKey(h))) continue;
      await uniApi(uni.value, `/plans/${id}/fleets`, {
        method: 'POST', body: { user_id: h.userId, g: h.from.g, s: h.from.s, p: h.from.p, type: h.from.type, ships: h.ships, speed: 100 },
      });
      invited.add(helperKey(h));
    }
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const openHelpers = computed(() => (data.value?.helpers ?? []).filter((h) => h.launch > clock.value));
</script>

<template>
  <BackLink :to="`/${uni}/fleet`" :label="t('nav.fleet')" />
  <PageHeader :title="a ? t('attack.title', { member: data?.member?.name ?? a.member ?? '?' }) : t('attack.titleShort')" tour="attack">
    <template #hint>
      <Hint>
        <p>{{ t('attack.hint1') }}</p>
        <p>{{ t('attack.hint2') }}</p>
      </Hint>
    </template>
  </PageHeader>

  <div v-if="error" class="error">{{ error }}</div>
  <template v-else-if="data && a">
    <div class="card at-head" :class="{ arrived }" data-tour="attack-head">
      <div class="at-count">
        <Icon name="attack" :size="22" class="neg" />
        <b v-if="!arrived" class="mono"><Countdown :to="a.arrival" /></b>
        <b v-else>{{ t('attack.arrived') }}</b>
        <span class="muted small">{{ t('attack.impact', { time: dateTime(a.arrival) }) }}</span>
      </div>
      <div class="at-grid small">
        <span class="muted">{{ t('attack.attacker') }}</span>
        <span>
          <PlayerLink v-if="a.player" :id="a.player.id" :name="a.player.name" />
          <span v-else>{{ t('common.unknown') }}</span>
          <span class="mono muted at-from">{{ c(a.from) }}<template v-if="a.from.type === 'moon'"> ({{ t('common.moon') }})</template></span>
        </span>
        <span class="muted">{{ t('attack.mission') }}</span>
        <span>{{ a.fleets.length > 1 ? t('attack.acs', { n: a.fleets.length }) : missionName(a.fleets[0]?.mission ?? null) }}</span>
        <span class="muted">{{ t('attack.target') }}</span>
        <span>{{ data.target?.name ?? '' }} <span class="mono">{{ c(a.to) }}</span><template v-if="a.to.type === 'moon'"> ({{ t('common.moon') }})</template></span>
        <span class="muted">{{ t('attack.ships') }}</span>
        <span :title="shipsTitle(data.attacker.ships)">
          {{ shipsText(data.attacker.ships) || t('attack.shipsUnknown') }}
          <span v-if="data.attacker.estimated" class="warn"> ({{ t('attack.estimated', { time: dateTime(data.attacker.estimated.time) }) }})</span>
        </span>
        <span class="muted">{{ t('attack.research') }}</span>
        <span>
          <template v-if="data.attacker.research">
            {{ [109, 110, 111].map((id) => `${abbr(id)} ${data!.attacker.research!.values[id] ?? 0}`).join(' · ') }}
            <span class="muted"> ({{ dateTime(data.attacker.research.time) }})</span>
          </template>
          <span v-else class="warn">{{ t('attack.researchUnknown') }}</span>
        </span>
      </div>
    </div>

    <Section :title="t('attack.resultTitle')" store-key="attack.sim" data-tour="attack-sim">
      <p v-if="!data.simulated" class="muted small m-0">{{ data.target ? t('attack.noShips') : t('attack.noEmpire') }}</p>
      <p v-else-if="data.sim && data.sim.error" class="warn small m-0">{{ t('attack.simError', { code: data.sim.error }) }}</p>
      <template v-else-if="sim && verdict">
        <div class="at-stats small">
          <b :class="verdict.cls">{{ t(`attack.verdict.${verdict.key}`) }}</b>
          <span>{{ t('attack.winsDefender') }} <b>{{ pct(sim.wins.defender) }}</b></span>
          <span>{{ t('attack.winsAttacker') }} <b>{{ pct(sim.wins.attacker) }}</b></span>
          <span>{{ t('attack.draw') }} <b>{{ pct(sim.wins.draw) }}</b></span>
        </div>
        <div class="at-stats small muted">
          <span>{{ t('attack.losses') }}: {{ t('attack.winsDefender') }} <b>{{ short(resSum(sim.lostResources.defender)) }}</b> · {{ t('attack.winsAttacker') }} <b>{{ short(resSum(sim.lostResources.attacker)) }}</b></span>
          <span>{{ t('attack.debris') }} <b>{{ short(sim.debris.metal.avg + sim.debris.crystal.avg) }}</b></span>
        </div>
      </template>
      <p v-else-if="arrived" class="muted small m-0">{{ t('attack.simArrived') }}</p>
      <p v-if="data.away?.fleets" class="small at-holds muted" :title="shipsTitle(data.away.ships)">{{ t('attack.away', { ships: shipsText(data.away.ships) }) }}</p>
      <p v-else-if="data.away?.unknown" class="small at-holds muted">{{ t('attack.awayUnknown') }}</p>
      <p v-if="data.holds.length" class="small at-holds">
        {{ t('attack.holds') }}:
        <span v-for="(h, i) in data.holds" :key="i" :title="shipsTitle(h.ships)">{{ i ? ', ' : '' }}{{ h.member ?? h.player ?? '?' }} ({{ fmt(Object.values(h.ships).reduce((s, n) => s + n, 0)) }})</span>
      </p>
      <a v-if="simLink" :href="simLink" target="_blank" rel="noopener" class="small">{{ t('attack.openSim') }} <Icon name="external" :size="12" /></a>
    </Section>

    <Section :title="t('attack.lootTitle')" store-key="attack.loot" data-tour="attack-loot">
      <p v-if="!data.target?.resources" class="muted small m-0">{{ t('attack.noResources') }}</p>
      <template v-else>
        <div class="at-stats small">
          <span v-for="k in (['metal', 'crystal', 'deuterium'] as const)" :key="k">
            {{ name({ metal: 901, crystal: 902, deuterium: 903 }[k]) }}: <b>{{ short(data.target.resources[k]) }}</b>
            <span v-if="data.loot" class="neg at-loot">−{{ short(data.loot[k]) }}</span>
          </span>
        </div>
        <p v-if="data.loot" class="small muted m-0">{{ t('attack.lootText', { sum: short(resSum(data.loot)) }) }}</p>
      </template>
    </Section>

    <Section :title="t('attack.saveTitle')" store-key="attack.save" data-tour="attack-save">
      <template #hint><Hint><p>{{ t('attack.saveHint') }}</p></Hint></template>
      <p v-if="data.phalanx.length" class="warn small"><Icon name="eye" :size="13" /> {{ t('attack.phalanx', { list: data.phalanx.map((x) => `${x.player?.name ?? '?'} ${c(x.moon)}`).join(', ') }) }}</p>
      <p v-if="!mine && data.member" class="muted small">{{ t('attack.saveOther', { member: data.member.name }) }}</p>
      <p v-if="arrived" class="muted small m-0">{{ t('attack.simArrived') }}</p>
      <p v-else-if="!from" class="muted small m-0">{{ t('attack.noEmpire') }}</p>
      <FleetSaveOptions
        v-else :from="from" :values="data.target!.values" :research="data.research" :deuterium="deuterium" :targets="targets"
        :now="now" :latest="a.arrival - 1" :back="a.arrival + 1" :kinds="['deploy', 'transport', 'harvest', 'recall']" :fields="fields" :cleanup="cleanup"
      />
    </Section>

    <Section :title="t('attack.helpTitle')" :count="openHelpers.length" store-key="attack.help" data-tour="attack-help">
      <template #hint><Hint><p>{{ t('attack.helpHint') }}</p></Hint></template>
      <div class="row small at-plan">
        <RouterLink v-if="data.holdPlan" :to="{ path: `/${uni}/raid-planner`, query: { plan: data.holdPlan } }">{{ t('attack.openPlan') }}</RouterLink>
        <button v-else-if="!arrived" class="small" :disabled="busy" @click="holdPlan()">{{ t('attack.createPlan') }}</button>
        <button v-if="openHelpers.length && !arrived" class="small primary" :disabled="busy" @click="invite(openHelpers)">{{ t('attack.inviteAll', { n: openHelpers.length }) }}</button>
        <span v-if="actionError" class="error">{{ actionError }}</span>
      </div>
      <p v-if="!openHelpers.length" class="muted small m-0">{{ t('attack.noHelpers') }}</p>
      <div v-else-if="mobile" class="at-cards">
        <div v-for="h in openHelpers" :key="helperKey(h)" class="at-card small">
          <div class="row">
            <b>{{ h.member }}</b>
            <span>{{ h.from.name }} <span class="mono">{{ c(h.from) }}</span><template v-if="h.from.type === 'moon'"> ({{ t('common.moon') }})</template></span>
          </div>
          <div class="muted" :title="shipsTitle(h.ships)">{{ shipsText(h.ships) }} · {{ short(h.points) }} {{ t('attack.points') }}</div>
          <div class="mono">{{ t('attack.launchBy') }} {{ dateTime(h.launch) }} <span class="muted">(<Countdown :to="h.launch" />)</span></div>
          <div>
            <span v-if="invited.has(helperKey(h))" class="pos"><Icon name="check" :size="12" /> {{ t('attack.invited') }}</span>
            <button v-else class="small" :disabled="busy || arrived" @click="invite([h])">{{ t('attack.invite') }}</button>
          </div>
        </div>
      </div>
      <div v-else class="scroll-x">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('attack.helper') }}</th>
              <th>{{ t('attack.from') }}</th>
              <th>{{ t('attack.ships') }}</th>
              <th class="num">{{ t('attack.points') }}</th>
              <th class="num">{{ t('attack.flight') }}</th>
              <th>{{ t('attack.launchBy') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in openHelpers" :key="helperKey(h)">
              <td>{{ h.member }}</td>
              <td class="small">{{ h.from.name }} <span class="mono">{{ c(h.from) }}</span><template v-if="h.from.type === 'moon'"> ({{ t('common.moon') }})</template></td>
              <td class="small" :title="shipsTitle(h.ships)">{{ shipsText(h.ships) }}</td>
              <td class="num">{{ short(h.points) }}</td>
              <td class="num mono">{{ duration(h.duration) }}</td>
              <td class="mono small">{{ dateTime(h.launch) }} <span class="muted">(<Countdown :to="h.launch" />)</span></td>
              <td>
                <span v-if="invited.has(helperKey(h))" class="pos small"><Icon name="check" :size="12" /> {{ t('attack.invited') }}</span>
                <button v-else class="small" :disabled="busy || arrived" @click="invite([h])">{{ t('attack.invite') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  </template>
</template>

<style scoped>
.at-head { display: flex; flex-wrap: wrap; gap: 12px 32px; align-items: flex-start; border-left: 3px solid var(--neg); }
.at-head.arrived { border-left-color: var(--muted); }
.at-count { display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.at-count b { font-size: 26px; }
.at-grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; align-items: baseline; }
.at-holds { margin: 0 0 6px; }
.at-stats { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-bottom: 6px; }
.at-plan { margin-bottom: 8px; }
.at-from, .at-loot { margin-left: 6px; }
.at-cards { display: flex; flex-direction: column; gap: 6px; }
.at-card { display: flex; flex-direction: column; gap: 3px; padding: 8px; border-radius: 6px; background: var(--surface-2); }
</style>

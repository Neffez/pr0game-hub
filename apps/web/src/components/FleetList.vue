<script lang="ts">
/** How long the server keeps past fleet movements (seconds), the history below the fleets in flight. */
export const FLEET_HISTORY = 12 * 3600;

/** Fleet movements of the game overview, next arrival first (empire view, alliance fleets). */
export interface FleetBody {
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon' | 'debris' | null;
  name: string | null;
}
/** fleet of the overview's event list (server: FleetMovement plus the arrival) */
export interface Fleet {
  owner: 'own' | 'hostile' | 'foreign';
  player: string | null;
  mission: number | null;
  missionName: string;
  phase: 'out' | 'return' | 'hold';
  from: FleetBody;
  to: FleetBody | null;
  ships: Record<string, number>;
  resources: Record<string, number> | null;
  arrival: number;
  /** fleets of one ACS share the number (the first is the lead) */
  acs?: number | null;
  /** owner of the start by the galaxy data (the game names none on attacks) */
  fromPlayer?: { id: number; name: string } | null;
  /** in the viewer's own list: whether the other members see this own fleet */
  shared?: boolean;
}

/** A notification for the arrival of an own fleet, `lead` minutes before it (server: repo/fleetAlerts.ts). */
export interface FleetAlert {
  id: number;
  arrival: number;
  lead: number;
  fleet: Fleet;
  created_at: number;
}
/** Lead times offered for a fleet alert (minutes, 0: at the arrival). */
export const FLEET_LEADS = [0, 1, 2, 5, 10];

const sameBody = (a: FleetBody | null, b: FleetBody | null) =>
  a == null || b == null ? a == b : a.coords.g === b.coords.g && a.coords.s === b.coords.s && a.coords.p === b.coords.p && a.type === b.type;
/** Whether an alert is for this fleet (the game gives fleets no id; arrivals of two syncs differ by a few seconds). */
export const alertFor = (a: FleetAlert, f: Fleet) =>
  f.owner === 'own' && a.fleet.mission === f.mission && a.fleet.phase === f.phase && sameBody(a.fleet.from, f.from) && sameBody(a.fleet.to, f.to) &&
  Math.abs(a.arrival - f.arrival) <= 5;
</script>

<script setup lang="ts">
import Icon from './Icon.vue';
import { RESOURCES } from '@pr0hub/core/tech';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile } from '../composables';
import { abbr, fmt, name, short } from '../format';
import PlayerLink from './PlayerLink.vue';
import Ticker from './Ticker.vue';

const props = defineProps<{
  /** fleets in flight, sorted; `member` names the owner in the alliance list */
  fleets: (Fleet & { member?: string })[];
  /** arrived fleets (history): time since the arrival instead of the remaining time */
  past?: boolean;
  /** the viewer's fleet alerts: given, own fleets get a bell to set one (the viewer's own list) */
  alerts?: FleetAlert[];
  /** a fleet whose alert is being changed */
  busy?: Fleet | null;
  /** the viewer's own list: own fleets get an eye to share them with the other members or not */
  sharing?: boolean;
  /** a fleet whose sharing is being changed */
  shareBusy?: Fleet | null;
}>();
const emit = defineEmits<{
  /** set an alert `lead` minutes before the arrival, or remove it (null) */
  alert: [fleet: Fleet, lead: number | null];
  /** share the own fleets of a row (one, or the own ones of an ACS) or not */
  share: [fleets: Fleet[], shared: boolean];
}>();

const { t, locale } = useI18n();
const mobile = useMobile();

type Row = Fleet & { member?: string };
/**
 * Rows: an ACS (fleets of one event, same `acs` and arrival) as one row with the ships of all its fleets, which
 * opens to the single fleets.
 */
const rows = computed(() => {
  const out: { key: string; fleet: Row; parts: Row[] }[] = [];
  props.fleets.forEach((f, i) => {
    const last = out[out.length - 1];
    if (f.acs != null && last && last.parts[0].acs === f.acs && last.parts[0].arrival === f.arrival && last.parts[0].member === f.member) {
      last.parts.push(f);
      for (const [id, n] of Object.entries(f.ships)) last.fleet.ships[id] = (last.fleet.ships[id] ?? 0) + n;
      return;
    }
    out.push({ key: `${i}:${f.arrival}`, fleet: { ...f, ships: { ...f.ships } }, parts: [f] });
  });
  return out;
});
const open = reactive(new Set<string>());
// ---------------------------------------------------------------- alerts
const bells = computed(() => !!props.alerts && !props.past);
const alertOf = (f: Fleet) => props.alerts?.find((a) => alertFor(a, f)) ?? null;
/** row whose lead menu is open */
const menu = ref<string | null>(null);
function pick(f: Fleet, lead: number | null) {
  menu.value = null;
  emit('alert', f, lead);
}
const bellTitle = (f: Fleet) => {
  const a = alertOf(f);
  if (!a) return t('imperium.alertOn');
  return a.lead ? t('imperium.alertBefore', { n: a.lead }) : t('imperium.alertAtArrival');
};
// ---------------------------------------------------------------- sharing
const ownParts = (parts: Row[]) => parts.filter((f) => f.owner === 'own' && f.shared != null);
const eyeTitle = (f: Fleet) => t(f.shared ? 'imperium.fleetShared' : 'imperium.fleetNotShared');
const actions = computed(() => bells.value || !!props.sharing);
const toggle = (key: string) => (open.has(key) ? open.delete(key) : open.add(key));
const mission = (r: { fleet: Row; parts: Row[] }) => (r.parts.length > 1 ? t('notify.acs', { n: r.parts.length }) : r.fleet.missionName);
/** the named player, else the owner of the start from the galaxy data */
const playerName = (f: Fleet) => f.player ?? f.fromPlayer?.name ?? null;

/** Mission colours of the game's overview (colorMission<id>Own / Foreign, colorMissionReturn…). */
const OWN: Record<number, string> = {
  1: '#66cc33', 2: '#339966', 3: '#5bf1c2', 4: '#cf79de', 5: '#80a0c0', 6: '#ffcc66', 7: '#c1c1c1', 8: '#ceff68', 9: '#ffff99',
  10: '#ffcc66', 15: '#5bf1c2', 16: '#5bf1c2', 17: '#5bf1c2',
};
const FOREIGN: Record<number, string> = {
  1: '#ff0000', 2: '#aa0000', 3: '#00ff00', 4: '#ff00ff', 5: '#3399cc', 6: '#ff6600', 7: '#00ff00', 8: '#acdd46', 9: '#dddd77',
  10: '#ff6600', 15: '#39d0a0', 16: '#39d0a0', 17: '#39d0a0',
};
const RETURN = '#6e8eea';
function color(f: Fleet) {
  if (f.phase === 'return') return f.owner === 'own' && f.mission === 7 ? OWN[4] : RETURN;
  return (f.owner === 'own' ? OWN : FOREIGN)[f.mission ?? 0] ?? 'var(--text)';
}

const coords = (b: FleetBody) => `${b.coords.g}:${b.coords.s}:${b.coords.p}`;
const ships = (f: Fleet) => Object.entries(f.ships).map(([id, n]) => ({ id, label: `${fmt(n)} ${abbr(Number(id))}`, title: `${fmt(n)} ${name(id)}` }));
const shipCount = (f: Fleet) => Object.values(f.ships).reduce((s, n) => s + n, 0);
const cargo = (f: Fleet) => (f.resources ? RESOURCES.filter((id) => f.resources![id]).map((id) => `${short(f.resources![id])} ${abbr(id)}`) : []);

/** "1d 02:03:04" / "02:03:04" */
function countdown(sec: number) {
  const d = Math.floor(sec / 86400);
  const hms = [Math.floor((sec % 86400) / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)].map((n) => String(n).padStart(2, '0')).join(':');
  return d ? `${d}d ${hms}` : hms;
}
/** arrival clock with seconds; the weekday in front when it is not today */
function clock(epoch: number) {
  const d = new Date(epoch * 1000);
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(locale.value, { weekday: 'short' })} ${time}`;
}
</script>

<template>
  <!-- mobile: one block per fleet -->
  <div v-if="mobile" class="fl-cards">
    <div v-for="r in rows" :key="r.key" class="fl-card" :class="{ hostile: r.fleet.owner === 'hostile' }" :style="{ '--mc': color(r.fleet) }">
      <template v-for="f in [r.fleet]" :key="r.key">
      <div class="fl-head">
        <span class="mono fl-clock">{{ clock(f.arrival) }}</span>
        <Ticker v-slot="{ now }"><span class="mono muted">{{ past ? t('imperium.since', { time: countdown(now - f.arrival) }) : countdown(f.arrival - now) }}</span></Ticker>
        <span class="grow" />
        <b v-if="f.member" class="fl-member">{{ f.member }}</b>
        <button v-if="sharing && ownParts(r.parts).length" class="small fl-eye alert-btn" :class="{ active: f.shared }" :disabled="shareBusy === r.parts[0]" :title="eyeTitle(f)" :aria-label="eyeTitle(f)" @click="emit('share', ownParts(r.parts), !f.shared)">
          <Icon :name="f.shared ? 'eye' : 'eyeOff'" :size="14" />
        </button>
        <span v-if="bells && f.owner === 'own'" class="fl-bell-wrap">
          <button class="small fl-bell alert-btn" :class="{ active: alertOf(f) }" :disabled="busy === r.parts[0]" :title="bellTitle(f)" :aria-label="bellTitle(f)" @click="menu = menu === r.key ? null : r.key">
            <Icon :name="alertOf(f) ? 'bell' : 'bellOff'" :size="14" /><span v-if="alertOf(f)?.lead" class="fl-lead">{{ alertOf(f)!.lead }}′</span>
          </button>
          <span v-if="menu === r.key" class="fl-backdrop" @click="menu = null" />
          <span v-if="menu === r.key" class="fl-menu card">
            <button v-for="m in FLEET_LEADS" :key="m" class="small" :class="{ active: alertOf(f)?.lead === m }" @click="pick(r.parts[0], m)">
              {{ m ? t('imperium.alertBefore', { n: m }) : t('imperium.alertAtArrival') }}
            </button>
            <button v-if="alertOf(f)" class="small" @click="pick(r.parts[0], null)">{{ t('imperium.alertOff') }}</button>
          </span>
        </span>
      </div>
      <div class="fl-line">
        <span class="fl-mission">{{ mission(r) }}</span>
        <button v-if="r.parts.length > 1" class="fl-toggle icon-btn small" :aria-expanded="open.has(r.key)" :aria-label="open.has(r.key) ? t('common.collapse') : t('common.expand')" @click="toggle(r.key)"><Icon :name="open.has(r.key) ? 'chevronDown' : 'chevronRight'" :size="14" /></button>
        <span v-if="f.phase !== 'out'" class="fl-phase"><Icon :name="f.phase === 'return' ? 'return' : 'pause'" :size="12" /> {{ t(`imperium.phase.${f.phase}`) }}</span>
        <span v-if="f.owner !== 'own'" class="small" :class="f.owner === 'hostile' ? 'neg' : 'muted'">
          {{ t(`imperium.${f.owner}`) }}<template v-if="f.fromPlayer && !f.player">: <PlayerLink :id="f.fromPlayer.id" :name="f.fromPlayer.name" /></template
              ><template v-else-if="playerName(f)">: {{ playerName(f) }}</template>
        </span>
      </div>
      <div class="small">
        {{ f.from.name }} <span class="mono muted"><Icon v-if="f.from.type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> {{ coords(f.from) }}</span>
        <template v-if="f.to">
          <Icon name="arrowRight" :size="12" class="faint" /> {{ f.to.name }} <span class="mono muted"><Icon v-if="f.to.type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> {{ coords(f.to) }}</span>
        </template>
      </div>
      <div v-if="shipCount(f) || cargo(f).length" class="small muted fl-ships">
        <span v-for="s in ships(f)" :key="s.id" :title="s.title">{{ s.label }}</span>
        <span v-if="cargo(f).length"><Icon name="cargo" :size="13" :label="t('imperium.cargo')" /> {{ cargo(f).join(' · ') }}</span>
      </div>
      <div v-for="(part, j) in open.has(r.key) ? r.parts : []" :key="j" class="small fl-part">
        <span>{{ part.missionName }}</span> <span class="muted">{{ ships(part).map((s) => s.label).join(' · ') }}</span>
      </div>
      </template>
    </div>
  </div>

  <div v-else class="table-wrap">
    <table class="data fl-table">
      <thead>
        <tr>
          <th>{{ t('imperium.arrival') }}</th>
          <th>{{ t(past ? 'imperium.ago' : 'imperium.remaining') }}</th>
          <th v-if="fleets.some((f) => f.member)">{{ t('common.player') }}</th>
          <th>{{ t('imperium.mission') }}</th>
          <th>{{ t('imperium.from') }}</th>
          <th>{{ t('imperium.to') }}</th>
          <th>{{ t('imperium.ships') }}</th>
          <th>{{ t('imperium.cargo') }}</th>
          <th v-if="actions" />
        </tr>
      </thead>
      <tbody>
        <template v-for="r in rows" :key="r.key">
        <tr v-for="f in [r.fleet]" :key="r.key" :class="{ hostile: f.owner === 'hostile' }" :style="{ '--mc': color(f) }">
          <td class="mono fl-clock">{{ clock(f.arrival) }}</td>
          <td class="mono muted"><Ticker v-slot="{ now }">{{ countdown(past ? now - f.arrival : f.arrival - now) }}</Ticker></td>
          <td v-if="fleets.some((x) => x.member)"><b class="fl-member">{{ f.member }}</b></td>
          <td>
            <span class="fl-mission">{{ mission(r) }}</span>
            <button v-if="r.parts.length > 1" class="fl-toggle icon-btn small" :aria-expanded="open.has(r.key)" :aria-label="open.has(r.key) ? t('common.collapse') : t('common.expand')" @click="toggle(r.key)"><Icon :name="open.has(r.key) ? 'chevronDown' : 'chevronRight'" :size="14" /></button>
            <span v-if="f.phase !== 'out'" class="fl-phase"><Icon :name="f.phase === 'return' ? 'return' : 'pause'" :size="12" /> {{ t(`imperium.phase.${f.phase}`) }}</span>
            <div v-if="f.owner !== 'own'" class="small" :class="f.owner === 'hostile' ? 'neg' : 'muted'">
              {{ t(`imperium.${f.owner}`) }}<template v-if="f.fromPlayer && !f.player">: <PlayerLink :id="f.fromPlayer.id" :name="f.fromPlayer.name" /></template
              ><template v-else-if="playerName(f)">: {{ playerName(f) }}</template>
            </div>
          </td>
          <td>
            {{ f.from.name }} <span class="mono small muted"><Icon v-if="f.from.type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> {{ coords(f.from) }}</span>
          </td>
          <td>
            <template v-if="f.to">{{ f.to.name }} <span class="mono small muted"><Icon v-if="f.to.type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> {{ coords(f.to) }}</span></template>
          </td>
          <td class="small fl-ships" :title="ships(f).map((s) => s.title).join('\n')">
            <span v-for="s in ships(f)" :key="s.id">{{ s.label }}</span>
          </td>
          <td class="small muted">{{ cargo(f).join(' · ') }}</td>
          <td v-if="actions" class="fl-bell-wrap">
            <button v-if="sharing && ownParts(r.parts).length" class="small fl-eye alert-btn" :class="{ active: f.shared }" :disabled="shareBusy === r.parts[0]" :title="eyeTitle(f)" :aria-label="eyeTitle(f)" @click="emit('share', ownParts(r.parts), !f.shared)">
              <Icon :name="f.shared ? 'eye' : 'eyeOff'" :size="14" />
            </button>
            <template v-if="bells && f.owner === 'own'">
              <button class="small fl-bell alert-btn" :class="{ active: alertOf(f) }" :disabled="busy === r.parts[0]" :title="bellTitle(f)" :aria-label="bellTitle(f)" @click="menu = menu === r.key ? null : r.key">
                <Icon :name="alertOf(f) ? 'bell' : 'bellOff'" :size="14" /><span v-if="alertOf(f)?.lead" class="fl-lead">{{ alertOf(f)!.lead }}′</span>
              </button>
              <span v-if="menu === r.key" class="fl-backdrop" @click="menu = null" />
              <span v-if="menu === r.key" class="fl-menu card">
                <button v-for="m in FLEET_LEADS" :key="m" class="small" :class="{ active: alertOf(f)?.lead === m }" @click="pick(r.parts[0], m)">
                  {{ m ? t('imperium.alertBefore', { n: m }) : t('imperium.alertAtArrival') }}
                </button>
                <button v-if="alertOf(f)" class="small" @click="pick(r.parts[0], null)">{{ t('imperium.alertOff') }}</button>
              </span>
            </template>
          </td>
        </tr>
        <tr v-for="(part, j) in open.has(r.key) ? r.parts : []" :key="`${r.key}-${j}`" class="fl-part" :style="{ '--mc': color(part) }">
          <td colspan="2" />
          <td v-if="fleets.some((x) => x.member)" />
          <td class="small"><span class="fl-mission">{{ part.missionName }}</span></td>
          <td colspan="2" />
          <td class="small fl-ships"><span v-for="s in ships(part)" :key="s.id" :title="s.title">{{ s.label }}</span></td>
          <td />
          <td v-if="actions" />
        </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* --mc: the mission colour of the game */
.fl-mission { color: var(--mc); font-weight: 600; }
.fl-phase { margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 11px; color: var(--mc); background: color-mix(in srgb, var(--mc) 15%, transparent); }
.fl-member { color: var(--accent); }
.fl-clock { font-weight: 600; }
.fl-table td { vertical-align: top; }
.fl-table tbody tr { box-shadow: inset 3px 0 0 var(--mc); }
.fl-table tr.hostile { background: color-mix(in srgb, var(--neg) 10%, transparent); }
.fl-ships { display: flex; flex-wrap: wrap; gap: 0 8px; max-width: 320px; }
/* many ship types wrap between the entries (table cells don't wrap by default), each entry stays on one line */
td.fl-ships { display: table-cell; min-width: 180px; max-width: 340px; white-space: normal; }
td.fl-ships span { display: inline-block; margin-right: 8px; white-space: nowrap; }
.fl-cards { display: flex; flex-direction: column; gap: 8px; }
.fl-card { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-left: 3px solid var(--mc); background: var(--surface-2); border-radius: 4px; }
/* mission, phase and owner of a card: the template's line breaks between them render as nothing */
.fl-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
.fl-line .fl-phase, .fl-line .fl-toggle { margin-left: 0; }
.fl-card.hostile { background: color-mix(in srgb, var(--neg) 12%, var(--surface-2)); }
.fl-head { display: flex; align-items: baseline; gap: 8px; }
.fl-toggle { margin-left: 6px; vertical-align: middle; }
.fl-part td { padding-top: 0; }
div.fl-part { padding-left: 10px; border-left: 2px solid var(--mc); }
.fl-bell-wrap { position: relative; white-space: nowrap; }
.fl-lead { margin-left: 2px; font-size: 10px; }
.fl-eye + .fl-bell, .fl-eye + .fl-bell-wrap { margin-left: 4px; }
.fl-menu {
  position: absolute; z-index: 20; top: 100%; right: 0; display: flex; flex-direction: column; gap: 4px; margin: 4px 0 0; padding: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .4);
}
.fl-backdrop { position: fixed; inset: 0; z-index: 19; }
.fl-menu button { text-align: left; white-space: nowrap; }
.fl-menu button.active { border-color: var(--accent); background: var(--accent-soft); }
</style>

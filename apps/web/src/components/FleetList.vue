<script lang="ts">
/** How long the server keeps past fleet movements (seconds), the history below the fleets in flight. */
export const FLEET_HISTORY = 12 * 3600;
</script>

<script setup lang="ts">
import { RESOURCES } from '@pr0hub/core/tech';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile } from '../composables';
import { abbr, fmt, name, short } from '../format';
import PlayerLink from './PlayerLink.vue';
import Ticker from './Ticker.vue';

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
}

const props = defineProps<{
  /** fleets in flight, sorted; `member` names the owner in the alliance list */
  fleets: (Fleet & { member?: string })[];
  /** arrived fleets (history): time since the arrival instead of the remaining time */
  past?: boolean;
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
      </div>
      <div>
        <span class="fl-mission">{{ mission(r) }}</span>
        <button v-if="r.parts.length > 1" class="fl-toggle" :aria-expanded="open.has(r.key)" @click="toggle(r.key)">{{ open.has(r.key) ? '▾' : '▸' }}</button>
        <span v-if="f.phase !== 'out'" class="fl-phase">{{ t(`imperium.phase.${f.phase}`) }}</span>
        <span v-if="f.owner !== 'own'" class="small" :class="f.owner === 'hostile' ? 'neg' : 'muted'">
          {{ t(`imperium.${f.owner}`) }}<template v-if="f.fromPlayer && !f.player">: <PlayerLink :id="f.fromPlayer.id" :name="f.fromPlayer.name" /></template
              ><template v-else-if="playerName(f)">: {{ playerName(f) }}</template>
        </span>
      </div>
      <div class="small">
        {{ f.from.name }} <span class="mono muted">{{ f.from.type === 'moon' ? '☾ ' : '' }}{{ coords(f.from) }}</span>
        <template v-if="f.to">
          → {{ f.to.name }} <span class="mono muted">{{ f.to.type === 'moon' ? '☾ ' : '' }}{{ coords(f.to) }}</span>
        </template>
      </div>
      <div v-if="shipCount(f) || cargo(f).length" class="small muted fl-ships">
        <span v-for="s in ships(f)" :key="s.id" :title="s.title">{{ s.label }}</span>
        <span v-if="cargo(f).length">📦 {{ cargo(f).join(' · ') }}</span>
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
            <button v-if="r.parts.length > 1" class="fl-toggle" :aria-expanded="open.has(r.key)" @click="toggle(r.key)">{{ open.has(r.key) ? '▾' : '▸' }}</button>
            <span v-if="f.phase !== 'out'" class="fl-phase">{{ t(`imperium.phase.${f.phase}`) }}</span>
            <div v-if="f.owner !== 'own'" class="small" :class="f.owner === 'hostile' ? 'neg' : 'muted'">
              {{ t(`imperium.${f.owner}`) }}<template v-if="f.fromPlayer && !f.player">: <PlayerLink :id="f.fromPlayer.id" :name="f.fromPlayer.name" /></template
              ><template v-else-if="playerName(f)">: {{ playerName(f) }}</template>
            </div>
          </td>
          <td>
            {{ f.from.name }} <span class="mono small muted">{{ f.from.type === 'moon' ? '☾ ' : '' }}{{ coords(f.from) }}</span>
          </td>
          <td>
            <template v-if="f.to">{{ f.to.name }} <span class="mono small muted">{{ f.to.type === 'moon' ? '☾ ' : '' }}{{ coords(f.to) }}</span></template>
          </td>
          <td class="small fl-ships" :title="ships(f).map((s) => s.title).join('\n')">
            <span v-for="s in ships(f)" :key="s.id">{{ s.label }}</span>
          </td>
          <td class="small muted">{{ cargo(f).join(' · ') }}</td>
        </tr>
        <tr v-for="(part, j) in open.has(r.key) ? r.parts : []" :key="`${r.key}-${j}`" class="fl-part" :style="{ '--mc': color(part) }">
          <td colspan="2" />
          <td v-if="fleets.some((x) => x.member)" />
          <td class="small"><span class="fl-mission">{{ part.missionName }}</span></td>
          <td colspan="2" />
          <td class="small fl-ships"><span v-for="s in ships(part)" :key="s.id" :title="s.title">{{ s.label }}</span></td>
          <td />
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
td.fl-ships { display: table-cell; }
td.fl-ships span { display: inline-block; margin-right: 8px; }
.fl-cards { display: flex; flex-direction: column; gap: 8px; }
.fl-card { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-left: 3px solid var(--mc); background: var(--surface-2); border-radius: 4px; }
.fl-card.hostile { background: color-mix(in srgb, var(--neg) 12%, var(--surface-2)); }
.fl-head { display: flex; align-items: baseline; gap: 8px; }
.fl-toggle { margin-left: 6px; padding: 0 6px; font-size: 11px; line-height: 1.4; }
.fl-part td { padding-top: 0; }
div.fl-part { padding-left: 10px; border-left: 2px solid var(--mc); }
</style>

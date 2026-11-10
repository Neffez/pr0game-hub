<script setup lang="ts">
import type { SaveTarget } from '@pr0hub/flight';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, uniApi } from '../api';
import { useClock } from '../clock';
import FleetSaveOptions, { type DebrisField, type FreeSystem } from '../components/FleetSaveOptions.vue';
import Hint from '../components/Hint.vue';
import Icon from '../components/Icon.vue';
import Loading from '../components/Loading.vue';
import PageHeader from '../components/PageHeader.vue';
import { useLoader, useStored, useUni } from '../composables';
import { abbr, dateTime, duration, fmt, name } from '../format';
import { tables, useLiveReload } from '../live';
import { toast } from '../toast';
import { useAutoTour } from '../tours';
import { fleetShips } from '../units';

/**
 * Fleet save planner: the member says when they are offline, the hub suggests per planet and moon a flight to another
 * own body that is in the air when they leave and at rest again when they are back (math in @pr0hub/flight, data of
 * the own empire page). The member sends it in the game by hand; after pasting the overview the bell on the fleet
 * reminds them before it lands.
 */
interface C3 { g: number; s: number; p: number }
interface Body { name: string; coords: C3; type: 'planet' | 'moon'; values: Record<string, number>; resources?: Record<string, number>; perHour?: Record<string, number> }
interface Data {
  empire: { time: number; data: { planets: Body[]; research?: Record<string, number> } } | null;
  phalanx?: { planet: C3 & { name: string | null }; threats: { moon: C3; level: number; player: { name: string; ally: string | null } | null }[] }[];
}
type Builtin = 'night' | 'work';
interface Preset { name: string; from: string; to: string; builtin?: Builtin }

const { t } = useI18n();
const { uni, ctx } = useUni();
const { data, error, load } = useLoader(() => uniApi<Data>(uni.value, `/imperium?user=${ctx.value!.me.id}`));
onMounted(load);
useLiveReload(load, tables('empire'));
useAutoTour('fleetsave', () => !!data.value);

/**
 * The built-in presets carry a mark and are shown in the viewer's language; `name` (stored with the account at the
 * first change) is only the fallback for other clients.
 */
const BUILTIN_TEXT: Record<Builtin, string> = { night: 'fleetsave.presetNight', work: 'fleetsave.presetWork' };
const DEFAULT_PRESETS: Preset[] = [
  { name: 'Night', from: '23:30', to: '07:15', builtin: 'night' },
  { name: 'Work', from: '07:45', to: '17:00', builtin: 'work' },
];
/** names the built-ins were stored under before they had a mark (the language active at the first change) */
const LEGACY_NAMES: Record<string, Builtin> = { Nacht: 'night', Night: 'night', Arbeit: 'work', Work: 'work' };
/** the built-in a preset is: by its mark, or stored before the mark under a built-in's name with its times */
function builtinOf(p: Preset): Builtin | null {
  if (p.builtin) return p.builtin;
  const legacy = LEGACY_NAMES[p.name];
  const d = legacy && DEFAULT_PRESETS.find((x) => x.builtin === legacy);
  return d && d.from === p.from && d.to === p.to ? legacy : null;
}
const presetLabel = (p: Preset) => {
  const b = builtinOf(p);
  return b ? t(BUILTIN_TEXT[b]) : p.name;
};
/** the member's presets, stored with their account (the same on every device); the built-ins until changed */
const presets = ref<Preset[]>(DEFAULT_PRESETS);
/** where earlier versions kept the presets, on this device only */
const LOCAL_PRESETS = 'hub.fleetsave.presets';
function localPresets(): Preset[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_PRESETS);
    return raw ? (JSON.parse(raw) as Preset[]) : null;
  } catch {
    return null;
  }
}
function dropLocalPresets() {
  try {
    localStorage.removeItem(LOCAL_PRESETS);
  } catch {
    /* storage unavailable */
  }
}
const postPresets = (list: Preset[]) => api<{ presets: Preset[] }>('/auth/fleetsave-presets', { body: { presets: list } });
async function loadPresets() {
  try {
    const { presets: stored } = await api<{ presets: Preset[] | null }>('/auth/fleetsave-presets');
    if (stored) {
      presets.value = stored;
      dropLocalPresets();
      return;
    }
    // presets of this device from before: take them over into the account once
    const local = localPresets();
    if (local) {
      presets.value = (await postPresets(local)).presets;
      dropLocalPresets();
    }
  } catch {
    /* the built-ins stay */
  }
}
onMounted(loadPresets);
/** Shows the change at once and stores it; back to the previous presets when that fails. */
async function storePresets(list: Preset[]) {
  const before = presets.value;
  presets.value = list;
  try {
    presets.value = (await postPresets(list)).presets;
  } catch {
    presets.value = before;
    toast(t('fleetsave.presetsFailed'), 'warn');
  }
}
const win = useStored<{ from: string; to: string }>('fleetsave.window', { from: DEFAULT_PRESETS[0].from, to: DEFAULT_PRESETS[0].to });
const kinds = useStored<{ deploy: boolean; transport: boolean; harvest?: boolean; colonize?: boolean }>('fleetsave.kinds', { deploy: true, transport: true, harvest: true, colonize: true });
/** existing debris fields of the own galaxies: recycling targets */
const fields = ref<Record<string, DebrisField[]>>({});
const cleanup = ref<number | null>(null);
/** free positions of the own galaxies: colonization targets */
const free = ref<Record<string, FreeSystem[]>>({});
async function loadFields() {
  const gs = [...new Set((data.value?.empire?.data.planets ?? []).map((b) => b.coords.g))];
  if (!gs.length) return;
  try {
    ({ fields: fields.value, cleanup: cleanup.value } = await uniApi<{ fields: Record<string, DebrisField[]>; cleanup: number }>(uni.value, `/debris-fields?g=${gs.join(',')}`));
  } catch {
    /* without them no recycling */
  }
  try {
    ({ systems: free.value } = await uniApi<{ systems: Record<string, FreeSystem[]> }>(uni.value, `/free-positions?g=${gs.join(',')}`));
  } catch {
    /* without them no colonization */
  }
}
watch(data, loadFields);
const presetName = ref('');

const clock = useClock();
/** the options follow the minute, not every second */
const now = computed(() => Math.floor(clock.value / 60) * 60);

/** Time of day "HH:MM" as epoch: today, or the next day when that is earlier than `after`. */
function at(hhmm: string, after: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(after * 1000);
  d.setHours(h || 0, m || 0, 0, 0);
  let epoch = Math.floor(d.getTime() / 1000);
  if (epoch < after) epoch += 86400;
  return epoch;
}
/** Offline from (the latest departure; now when the window already started) until back. */
const offline = computed(() => {
  // a start up to 6 hours ago means "I am offline already": leave now
  const start = at(win.value.from, now.value - 6 * 3600);
  const latest = Math.max(now.value, start);
  return { latest, back: at(win.value.to, latest + 60) };
});

function usePreset(p: Preset) {
  win.value = { from: p.from, to: p.to };
}
function savePreset() {
  const label = presetName.value.trim() || `${win.value.from}–${win.value.to}`;
  presetName.value = '';
  // replaces a preset shown under this name (a built-in under its translated one)
  void storePresets([...presets.value.filter((p) => p.name !== label && presetLabel(p) !== label), { name: label, ...win.value }]);
}
function removePreset(p: Preset) {
  void storePresets(presets.value.filter((x) => x !== p));
}

const research = computed(() => data.value?.empire?.data.research ?? {});
const bodies = computed(() => data.value?.empire?.data.planets ?? []);
const targets = computed<SaveTarget[]>(() => bodies.value.map((b) => ({ coords: [b.coords.g, b.coords.s, b.coords.p], type: b.type, name: b.name })));
const key = (c: C3) => `${c.g}:${c.s}:${c.p}`;
/** own planets in reach of a hostile phalanx: flights to them are marked per option */
const watched = computed(() => (data.value?.phalanx ?? []).map((e) => key(e.planet)));
const phalanxOf = computed(() => new Map((data.value?.phalanx ?? []).map((e) => [key(e.planet), e.threats])));
/** deuterium on the body now: the empire page's plus the production since */
function deuterium(b: Body) {
  if (b.resources?.[903] == null) return null;
  const hours = Math.max(0, now.value - data.value!.empire!.time) / 3600;
  return Math.floor(b.resources[903] + (b.perHour?.[903] ?? 0) * hours);
}
const ships = (b: Body) =>
  fleetShips()
    .filter((id) => (b.values[id] ?? 0) > 0 && id !== 212)
    .map((id) => ({ id, n: b.values[id] }));
const rows = computed(() =>
  bodies.value.map((b) => ({
    b,
    key: `${key(b.coords)}:${b.type}`,
    from: { coords: [b.coords.g, b.coords.s, b.coords.p], type: b.type, name: b.name } as SaveTarget,
    ships: ships(b),
    phalanx: b.type === 'planet' ? (phalanxOf.value.get(key(b.coords)) ?? []) : [],
  })),
);
const withShips = computed(() => rows.value.filter((r) => r.ships.length));
const kindList = computed(() => (['deploy', 'transport', 'harvest', 'colonize'] as const).filter((k) => kinds.value[k] ?? true));
</script>

<template>
  <PageHeader :title="t('fleetsave.title')" tour="fleetsave">
    <template #hint>
      <Hint>
        <p>{{ t('fleetsave.hint1') }}</p>
        <p>{{ t('fleetsave.hint2') }}</p>
        <p>{{ t('fleetsave.hint3') }}</p>
      </Hint>
    </template>
  </PageHeader>

  <div class="card fs-window" data-tour="fleetsave-window">
    <label class="field-inline">{{ t('fleetsave.offlineFrom') }} <input v-model="win.from" type="time" /></label>
    <label class="field-inline">{{ t('fleetsave.offlineTo') }} <input v-model="win.to" type="time" /></label>
    <span class="muted small">
      {{ t('fleetsave.windowText', { from: dateTime(offline.latest), to: dateTime(offline.back), time: duration(offline.back - offline.latest) }) }}
    </span>
    <span class="grow" />
    <label class="check small"><input v-model="kinds.deploy" type="checkbox" /> {{ t('fleetsave.kinds.deploy') }}</label>
    <label class="check small"><input v-model="kinds.transport" type="checkbox" /> {{ t('fleetsave.kinds.transport') }}</label>
    <label class="check small" :title="t('fleetsave.harvestTitle')"><input v-model="kinds.harvest" type="checkbox" /> {{ t('fleetsave.kinds.harvest') }}</label>
    <label class="check small" :title="t('fleetsave.colonizeTitle')" data-tour="fleetsave-colonize"><input v-model="kinds.colonize" type="checkbox" /> {{ t('fleetsave.kinds.colonize') }}</label>
  </div>
  <div class="card fs-presets small" data-tour="fleetsave-presets">
    <b>{{ t('fleetsave.presets') }}</b>
    <span v-for="p in presets" :key="p.name" class="fs-preset" :class="{ active: p.from === win.from && p.to === win.to }">
      <button class="small" @click="usePreset(p)">{{ presetLabel(p) }} <span class="muted">{{ p.from }}–{{ p.to }}</span></button>
      <button class="icon-btn small" :title="t('fleetsave.removePreset')" :aria-label="t('fleetsave.removePreset')" @click="removePreset(p)"><Icon name="close" :size="12" /></button>
    </span>
    <input v-model="presetName" class="fs-name" maxlength="40" :placeholder="t('fleetsave.presetName')" @keydown.enter="savePreset" />
    <button class="small" @click="savePreset"><Icon name="plus" :size="12" /> {{ t('fleetsave.savePreset') }}</button>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <div v-else-if="data && !data.empire" class="card muted">{{ t('fleetsave.noEmpire') }}</div>
  <div v-else-if="data && !withShips.length" class="card muted">{{ t('fleetsave.noFleet') }}</div>

  <div v-for="(r, i) in withShips" :key="r.key" class="card fs-body" :data-tour="i === 0 ? 'fleetsave-body' : undefined">
    <div class="fs-head">
      <Icon :name="r.b.type === 'moon' ? 'moon' : 'planets'" :size="14" />
      <b>{{ r.b.name }}</b>
      <span class="mono small">{{ r.b.coords.g }}:{{ r.b.coords.s }}:{{ r.b.coords.p }}</span>
      <span class="small muted" :title="r.ships.map((x) => `${fmt(x.n)} ${name(x.id)}`).join('\n')">
        {{ r.ships.map((x) => `${fmt(x.n)} ${abbr(x.id)}`).join(' · ') }}
      </span>
    </div>
    <p v-if="r.phalanx.length" class="warn small fs-phalanx" :data-tour="i === 0 ? 'fleetsave-phalanx' : undefined">
      <Icon name="eye" :size="13" />
      {{ t('fleetsave.phalanx', { list: r.phalanx.map((x) => `${x.player?.name ?? '?'} ${x.moon.g}:${x.moon.s}:${x.moon.p}`).join(', ') }) }}
    </p>
    <FleetSaveOptions
      :from="r.from" :values="r.b.values" :research="research" :deuterium="deuterium(r.b)" :targets="targets"
      :now="now" :latest="offline.latest" :back="offline.back" :kinds="kindList" :fields="fields" :free="free" :cleanup="cleanup" :watched="watched"
    />
  </div>
  <p v-if="withShips.length" class="muted small" data-tour="fleetsave-remind">
    <Icon name="bell" :size="13" /> {{ t('fleetsave.remind') }}
    <RouterLink :to="`/${uni}/imperium`">{{ t('nav.imperium') }}</RouterLink>
  </p>
</template>

<style scoped>
.fs-window, .fs-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.fs-preset { display: inline-flex; align-items: center; gap: 2px; }
.fs-preset.active > button:first-child { border-color: var(--accent); }
.fs-name { width: 140px; }
.fs-body { display: flex; flex-direction: column; gap: 8px; }
.fs-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.fs-phalanx { display: flex; align-items: center; gap: 6px; margin: 0; }
</style>

<script setup lang="ts">
import { BUILDINGS, RESEARCH } from '@pr0hub/core/buildings';
import { techName } from '@pr0hub/core/tech';
import { DEFAULT_UNIT_DEFS, emptyUnit, isUnitId, unitCatalog, unitPatch, type ShipDrives, type UnitDef, type UnitOverrides } from '@pr0hub/core/units';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { fmt } from '../format';
import Icon from './Icon.vue';

/**
 * Ships, defense and missiles of a universe (admin): the universe's differences from the hub's defaults. Values come
 * from pasted game pages (preview, then taken over) or the form per unit; `save` stores them.
 */
const props = defineProps<{ slug: string }>();
const { t, locale } = useI18n();
const lang = computed(() => (locale.value === 'en' ? 'en' : 'de'));

interface ParsedUnit {
  id: number;
  name?: string;
  cost?: [number, number, number];
  req?: Record<string, number>;
  one?: boolean;
  structure?: number;
  attack?: number;
  shield?: number;
  capacity?: number;
  drives?: ShipDrives | null;
  rapidfire?: Record<string, number>;
  rapidfireFrom?: Record<string, number>;
}
interface UnitPage {
  kind: 'shipyard' | 'techtree' | 'info';
  lang: 'de' | 'en';
  units: ParsedUnit[];
  unknown: string[];
  mode?: 'fleet' | 'defense';
}

const saved = ref<UnitOverrides>({});
const overrides = ref<UnitOverrides>({});
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await api<{ overrides: UnitOverrides }>(`/admin/universes/${props.slug}/units`);
    saved.value = res.overrides;
    overrides.value = structuredClone(res.overrides);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => props.slug, load, { immediate: true });

const dirty = computed(() => JSON.stringify(overrides.value) !== JSON.stringify(saved.value));
const catalog = computed(() => unitCatalog(overrides.value));
/** every unit: the defaults, new ones and hidden ones */
const all = computed(() => {
  const ids = new Set([...Object.keys(DEFAULT_UNIT_DEFS), ...Object.keys(overrides.value)].map(Number));
  return [...ids].filter(isUnitId).sort((a, b) => a - b).map((id) => ({
    id,
    unit: catalog.value.units[id] ?? merged(id),
    state: overrides.value[id]?.hidden ? 'hidden' : !DEFAULT_UNIT_DEFS[id] ? 'new' : overrides.value[id] ? 'changed' : 'default',
  }));
});

/** The unit with the universe's changes, also when hidden. */
function merged(id: number): UnitDef {
  const { hidden: _, ...patch } = overrides.value[id] ?? {};
  return unitCatalog({ [id]: patch }).units[id] ?? DEFAULT_UNIT_DEFS[id] ?? emptyUnit(id);
}

const unitName = (id: number | string) => catalog.value.units[id]?.name[lang.value] ?? DEFAULT_UNIT_DEFS[id]?.name[lang.value] ?? techName(id, lang.value);

/** Stores `unit` as the difference from the default (nothing left: the default again); keeps `hidden`. */
function put(unit: UnitDef) {
  const patch = unitPatch(unit, DEFAULT_UNIT_DEFS[unit.id]);
  const hidden = overrides.value[unit.id]?.hidden;
  const next = { ...overrides.value };
  if (Object.keys(patch).length || hidden) next[unit.id] = { ...patch, ...(hidden ? { hidden } : {}) };
  else delete next[unit.id];
  overrides.value = next;
}

function toggleHidden(id: number) {
  const next = { ...overrides.value };
  const cur = { ...next[id] };
  if (cur.hidden) delete cur.hidden;
  else cur.hidden = true;
  if (Object.keys(cur).length) next[id] = cur;
  else delete next[id];
  overrides.value = next;
}

function reset(id: number) {
  if (!DEFAULT_UNIT_DEFS[id] && !confirm(t('admin.units.removeConfirm', { name: unitName(id) }))) return;
  const next = { ...overrides.value };
  delete next[id];
  overrides.value = next;
  if (editing.value?.id === id) editing.value = null;
}

// ------------------------------------------------------------------ form
const editing = ref<UnitDef | null>(null);
const flies = ref(false);
const reqRows = ref<{ id: number; level: number }[]>([]);
const rfRows = ref<{ id: number; shots: number }[]>([]);
const newId = ref<number | null>(null);

function edit(id: number) {
  const u = structuredClone(merged(id)) as UnitDef;
  editing.value = u;
  flies.value = !!u.drives;
  if (!u.drives) u.drives = { speed: [0, 0, 0], tech: [0, 0, 0], consumption: [0, 0, 0] };
  reqRows.value = Object.entries(u.req).map(([r, level]) => ({ id: Number(r), level }));
  rfRows.value = Object.entries(u.rapidfire).map(([r, shots]) => ({ id: Number(r), shots }));
}

function addUnit() {
  const id = Number(newId.value);
  if (!isUnitId(id)) return void (error.value = t('admin.units.idInvalid'));
  if (all.value.some((x) => x.id === id)) return void edit(id);
  error.value = '';
  const u = emptyUnit(id);
  overrides.value = { ...overrides.value, [id]: { name: u.name, cost: u.cost } };
  newId.value = null;
  edit(id);
}

function applyForm() {
  const u = editing.value!;
  const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const unit: UnitDef = {
    ...u,
    name: { de: u.name.de.trim() || `#${u.id}`, en: u.name.en.trim() || u.name.de.trim() || `#${u.id}` },
    short: { de: u.short.de.trim() || `#${u.id}`, en: u.short.en.trim() || u.short.de.trim() || `#${u.id}` },
    cost: [num(u.cost[0]), num(u.cost[1]), num(u.cost[2])],
    attack: Math.max(0, Number(u.attack) || 0),
    shield: Math.max(0, Number(u.shield) || 0),
    capacity: u.id < 300 ? num(u.capacity) : 0,
    req: Object.fromEntries(reqRows.value.filter((r) => r.id && num(r.level) > 0).map((r) => [r.id, num(r.level)])),
    rapidfire: Object.fromEntries(rfRows.value.filter((r) => r.id && num(r.shots) > 1).map((r) => [r.id, num(r.shots)])),
    drives: u.id < 300 && flies.value && u.drives
      ? { speed: u.drives.speed.map(num) as ShipDrives['speed'], tech: u.drives.tech.map(num) as ShipDrives['tech'], consumption: u.drives.consumption.map(num) as ShipDrives['consumption'] }
      : null,
  };
  put(unit);
  editing.value = null;
}

/** buildings and research for the requirement rows */
const reqOptions = computed(() =>
  [...Object.keys(BUILDINGS), ...Object.keys(RESEARCH)].map(Number).map((id) => ({ id, name: techName(id, lang.value) })),
);
const DRIVES = [115, 117, 118];

// ----------------------------------------------------------------- paste
const pasteOpen = ref(false);
const pasteHtml = ref('');
const parsing = ref(false);
/** names → id of the pages pasted so far (an info page has no id) */
const pastedNames = ref<Record<string, number>>({});
/** what the pages found per unit, merged over several pastes */
const found = ref<Record<number, ParsedUnit & { lang?: 'de' | 'en' }>>({});
/** rapidfire of other units against a unit (info page "Rapidfire von"): shooter -> target -> shots */
const foundFrom = ref<Record<number, Record<string, number>>>({});
const unknown = ref<string[]>([]);
const pasted = ref<string[]>([]);
const chosen = ref<Record<number, boolean>>({});
/** units on the pasted shipyard and defense lists (they show every unit of the universe) */
const listed = ref<{ fleet?: number[]; defense?: number[] }>({});

async function parse() {
  if (!pasteHtml.value.trim()) return;
  parsing.value = true;
  error.value = '';
  try {
    const page = await api<UnitPage>(`/admin/universes/${props.slug}/units/parse`, { body: { html: pasteHtml.value, names: pastedNames.value } });
    for (const u of page.units) {
      if (u.name) pastedNames.value[u.name] = u.id;
      const { rapidfireFrom, ...rest } = u;
      const before = found.value[u.id] ?? { id: u.id };
      found.value = { ...found.value, [u.id]: { ...before, ...rest, lang: u.name ? page.lang : before.lang, req: page.kind === 'shipyard' && !u.req ? before.req : (u.req ?? before.req) } };
      for (const [shooter, shots] of Object.entries(rapidfireFrom ?? {})) {
        foundFrom.value = { ...foundFrom.value, [shooter]: { ...foundFrom.value[Number(shooter)], [u.id]: shots } };
      }
      chosen.value[u.id] ??= true;
    }
    for (const shooter of Object.keys(foundFrom.value)) chosen.value[Number(shooter)] ??= true;
    if (page.kind === 'shipyard' && page.mode) {
      listed.value = { ...listed.value, [page.mode]: [...new Set([...(listed.value[page.mode] ?? []), ...page.units.map((u) => u.id)])] };
      // preselected unless much of the list is missing (rather a cut page than a smaller universe)
      const ofList = (id: number) => (page.mode === 'fleet' ? id < 300 : id >= 400);
      const missing = absent.value.filter(ofList);
      const preselect = missing.length <= all.value.filter((x) => ofList(x.id) && x.state !== 'hidden').length / 2;
      for (const x of missing) chosen.value[x] ??= preselect;
    }
    unknown.value = [...new Set([...unknown.value.filter((n) => !pastedNames.value[n]), ...page.unknown])];
    pasted.value = [...pasted.value, t(`admin.units.kind.${page.kind}`, { n: page.units.length })];
    pasteHtml.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    parsing.value = false;
  }
}

/** The unit with what the pages found applied. */
function withFound(id: number): UnitDef {
  const u = structuredClone(merged(id)) as UnitDef;
  const f = found.value[id];
  if (f) {
    if (f.name && f.lang) {
      u.name = { ...u.name, [f.lang]: f.name };
      if (!DEFAULT_UNIT_DEFS[id] && u.name[f.lang === 'de' ? 'en' : 'de'] === `#${id}`) u.name = { de: f.name, en: f.name };
      if (u.short.de === `#${id}`) u.short = { de: f.name.slice(0, 6).trim(), en: f.name.slice(0, 6).trim() };
    }
    if (f.cost) u.cost = f.cost;
    if (f.req) u.req = f.req;
    if (f.one) u.one = true;
    if (f.attack != null) u.attack = f.attack;
    if (f.shield != null) u.shield = f.shield;
    if (f.capacity != null) u.capacity = f.capacity;
    if (f.drives !== undefined) u.drives = f.drives;
    if (f.rapidfire) u.rapidfire = f.rapidfire;
  }
  if (foundFrom.value[id]) u.rapidfire = { ...u.rapidfire, ...foundFrom.value[id] };
  return u;
}

/** Units of the universe missing on a pasted shipyard or defense list: they do not exist there. */
const absent = computed(() =>
  all.value
    .filter((x) => x.state !== 'hidden' && !found.value[x.id])
    .filter((x) => (x.id < 300 ? listed.value.fleet : listed.value.defense)?.includes(x.id) === false)
    .map((x) => x.id),
);
const hiddenNow = (id: number) => !!overrides.value[id]?.hidden;

const FIELDS = ['name', 'cost', 'req', 'one', 'attack', 'shield', 'capacity', 'drives', 'rapidfire'] as const;
/** Fields that would change, as text, per unit with findings. */
const preview = computed(() => {
  const ids = new Set([...Object.keys(found.value), ...Object.keys(foundFrom.value)].map(Number));
  return [...ids].sort((a, b) => a - b).map((id) => {
    const before = merged(id);
    const after = withFound(id);
    const changes: { field: string; from: string; to: string }[] = FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ field: k, from: show(k, before), to: show(k, after) }));
    if (hiddenNow(id) && found.value[id]) changes.unshift({ field: 'present', from: t('common.no'), to: t('common.yes') });
    const f = found.value[id];
    const structure = f?.structure != null && f.structure !== after.cost[0] + after.cost[1] ? f.structure : null;
    return { id, isNew: !all.value.some((x) => x.id === id), name: f?.name ?? unitName(id), changes, structure, hide: false };
  }).filter((p) => p.changes.length || p.isNew || p.structure != null).concat(
    absent.value.map((id) => ({ id, isNew: false, name: unitName(id), changes: [{ field: 'present', from: t('common.yes'), to: t('common.no') }], structure: null, hide: true })),
  );
});

function show(field: (typeof FIELDS)[number], u: UnitDef): string {
  switch (field) {
    case 'name': return `${u.name.de} / ${u.name.en}`;
    case 'cost': return u.cost.map((n) => fmt(n)).join(' / ');
    case 'req': return Object.entries(u.req).map(([id, l]) => `${techName(id, lang.value)} ${l}`).join(', ') || '–';
    case 'one': return u.one ? t('common.yes') : t('common.no');
    case 'drives': return u.drives ? u.drives.speed.map((s, i) => (u.drives!.tech[i] ? `${techName(DRIVES[i], lang.value)} ${fmt(s)}` : '')).filter(Boolean).join(', ') : '–';
    case 'rapidfire': return Object.entries(u.rapidfire).map(([id, n]) => `${unitName(id)} ${n}`).join(', ') || '–';
    default: return fmt(u[field]);
  }
}

function takeOver() {
  for (const p of preview.value) {
    if (!chosen.value[p.id]) continue;
    if (p.hide) {
      if (!hiddenNow(p.id)) toggleHidden(p.id);
      continue;
    }
    const unhide = hiddenNow(p.id) && !!found.value[p.id];
    put(withFound(p.id));
    if (unhide) toggleHidden(p.id);
  }
  clearPaste();
}

function clearPaste() {
  found.value = {};
  foundFrom.value = {};
  unknown.value = [];
  pasted.value = [];
  chosen.value = {};
  pastedNames.value = {};
  listed.value = {};
}

async function save() {
  const res = await api<{ overrides: UnitOverrides }>(`/admin/universes/${props.slug}/units`, { method: 'PUT', body: { units: overrides.value } });
  saved.value = res.overrides;
  overrides.value = structuredClone(res.overrides);
}

const changedCount = computed(() => Object.keys(overrides.value).length);
defineExpose({ save, dirty, changedCount });
</script>

<template>
  <div class="units">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="loading" class="muted small">…</div>
    <template v-else>
      <div class="units-bar">
        <button @click="pasteOpen = !pasteOpen">{{ t('admin.units.paste') }}</button>
        <span class="units-new">
          <input v-model.number="newId" type="number" min="200" max="599" :placeholder="t('admin.units.newId')" :aria-label="t('admin.units.newId')" />
          <button :disabled="!newId" @click="addUnit">{{ t('admin.units.add') }}</button>
        </span>
      </div>

      <div v-if="pasteOpen" class="units-paste">
        <p class="muted small">{{ t('admin.units.pasteHint') }}</p>
        <textarea v-model="pasteHtml" rows="4" :placeholder="t('admin.units.pastePlaceholder')" />
        <div class="units-bar">
          <button class="primary" :disabled="parsing || !pasteHtml.trim()" @click="parse">{{ t('admin.units.read') }}</button>
          <span v-for="(p, i) in pasted" :key="i" class="chip">{{ p }}</span>
        </div>
        <div v-if="unknown.length" class="warn small">{{ t('admin.units.unknown', { names: unknown.join(', ') }) }}</div>
        <template v-if="pasted.length">
          <p v-if="!preview.length" class="muted small">{{ t('admin.units.nothingNew') }}</p>
          <div v-for="p in preview" :key="p.id" class="units-found">
            <label class="check">
              <input v-model="chosen[p.id]" type="checkbox" />
              <b>{{ p.id }} {{ p.name }}</b>
              <span v-if="p.isNew" class="badge">{{ t('admin.units.state.new') }}</span>
            </label>
            <ul class="small">
              <li v-for="c in p.changes" :key="c.field">
                <span class="muted">{{ t(`admin.units.field.${c.field}`) }}:</span> <s class="muted">{{ c.from }}</s> → {{ c.to }}
              </li>
              <li v-if="p.structure != null" class="warn">{{ t('admin.units.structure', { n: fmt(p.structure) }) }}</li>
            </ul>
          </div>
          <div class="units-bar">
            <button class="primary" :disabled="!preview.some((p) => chosen[p.id])" @click="takeOver">{{ t('admin.units.takeOver') }}</button>
            <button @click="clearPaste">{{ t('common.cancel') }}</button>
          </div>
        </template>
      </div>

      <div v-if="editing" class="units-form">
        <h4>{{ editing.id }} {{ editing.name[lang] }}</h4>
        <div class="units-grid">
          <label>{{ t('admin.units.field.name') }} DE<input v-model="editing.name.de" maxlength="64" /></label>
          <label>{{ t('admin.units.field.name') }} EN<input v-model="editing.name.en" maxlength="64" /></label>
          <label>{{ t('admin.units.field.short') }} DE<input v-model="editing.short.de" maxlength="64" /></label>
          <label>{{ t('admin.units.field.short') }} EN<input v-model="editing.short.en" maxlength="64" /></label>
          <label>{{ techName(901, lang) }}<input v-model.number="editing.cost[0]" type="number" min="0" /></label>
          <label>{{ techName(902, lang) }}<input v-model.number="editing.cost[1]" type="number" min="0" /></label>
          <label>{{ techName(903, lang) }}<input v-model.number="editing.cost[2]" type="number" min="0" /></label>
          <label>{{ t('admin.units.field.attack') }}<input v-model.number="editing.attack" type="number" min="0" /></label>
          <label>{{ t('admin.units.field.shield') }}<input v-model.number="editing.shield" type="number" min="0" /></label>
          <label v-if="editing.id < 300">{{ t('admin.units.field.capacity') }}<input v-model.number="editing.capacity" type="number" min="0" /></label>
        </div>
        <p class="muted small">{{ t('admin.units.hull', { n: fmt((Number(editing.cost[0]) + Number(editing.cost[1])) / 10) }) }}</p>
        <label class="check"><input v-model="editing.one" type="checkbox" /> {{ t('admin.units.field.one') }}</label>

        <template v-if="editing.id < 300">
          <label class="check"><input v-model="flies" type="checkbox" /> {{ t('admin.units.flies') }}</label>
          <div v-if="flies && editing.drives" class="units-drives">
            <div v-for="(d, i) in DRIVES" :key="d" class="units-drive">
              <b>{{ techName(d, lang) }}</b>
              <label>{{ t('admin.units.speed') }}<input v-model.number="editing.drives.speed[i]" type="number" min="0" /></label>
              <label>{{ t('admin.units.consumption') }}<input v-model.number="editing.drives.consumption[i]" type="number" min="0" /></label>
              <label>{{ t('admin.units.from') }}<input v-model.number="editing.drives.tech[i]" type="number" min="0" /></label>
            </div>
          </div>
          <p v-if="flies" class="muted small">{{ t('admin.units.fromHint') }}</p>
        </template>

        <h5>{{ t('admin.units.field.req') }}</h5>
        <div v-for="(r, i) in reqRows" :key="'r' + i" class="units-row">
          <select v-model.number="r.id"><option v-for="o in reqOptions" :key="o.id" :value="o.id">{{ o.name }}</option></select>
          <input v-model.number="r.level" type="number" min="1" :aria-label="t('admin.units.level')" />
          <button class="icon" :title="t('common.delete')" @click="reqRows.splice(i, 1)">×</button>
        </div>
        <button class="units-add" @click="reqRows.push({ id: 21, level: 1 })"><Icon name="plus" /> {{ t('admin.units.addReq') }}</button>

        <h5>{{ t('admin.units.field.rapidfire') }}</h5>
        <div v-for="(r, i) in rfRows" :key="'f' + i" class="units-row">
          <select v-model.number="r.id"><option v-for="x in all" :key="x.id" :value="x.id">{{ x.unit.name[lang] }}</option></select>
          <input v-model.number="r.shots" type="number" min="2" :aria-label="t('admin.units.shots')" />
          <button class="icon" :title="t('common.delete')" @click="rfRows.splice(i, 1)">×</button>
        </div>
        <button class="units-add" @click="rfRows.push({ id: 202, shots: 2 })"><Icon name="plus" /> {{ t('admin.units.addRf') }}</button>
        <p class="muted small">{{ t('admin.units.shotsHint') }}</p>

        <div class="units-bar">
          <button class="primary" @click="applyForm">{{ t('admin.units.apply') }}</button>
          <button @click="editing = null">{{ t('common.cancel') }}</button>
        </div>
      </div>

      <table class="data units-list">
        <thead><tr><th class="num">ID</th><th>{{ t('common.name') }} · {{ t('admin.units.field.cost') }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="x in all" :key="x.id" :class="{ muted: x.state === 'hidden' }">
            <td class="num mono">{{ x.id }}</td>
            <td class="units-name">
              {{ x.unit.name[lang] }}
              <span v-if="x.state !== 'default'" class="badge" :class="x.state">{{ t(`admin.units.state.${x.state}`) }}</span>
              <div class="muted mono units-cost">{{ x.unit.cost.map((n) => fmt(n)).join(' / ') }}</div>
            </td>
            <td><div class="units-actions">
              <button class="icon" :title="t('admin.units.edit')" :aria-label="t('admin.units.edit')" @click="edit(x.id)"><Icon name="edit" /></button>
              <button class="icon" :class="{ off: x.state === 'hidden' }" :title="x.state === 'hidden' ? t('admin.units.show') : t('admin.units.hide')" :aria-label="x.state === 'hidden' ? t('admin.units.show') : t('admin.units.hide')" @click="toggleHidden(x.id)"><Icon name="eye" /></button>
              <button v-if="x.state !== 'default'" class="icon" :title="DEFAULT_UNIT_DEFS[x.id] ? t('admin.units.reset') : t('common.delete')" :aria-label="DEFAULT_UNIT_DEFS[x.id] ? t('admin.units.reset') : t('common.delete')" @click="reset(x.id)"><Icon :name="DEFAULT_UNIT_DEFS[x.id] ? 'return' : 'trash'" /></button>
            </div></td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">{{ t('admin.units.saveHint') }}</p>
    </template>
  </div>
</template>

<style scoped>
.units { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.units-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.units-new { display: inline-flex; gap: 6px; margin-left: auto; }
.units-new input { width: 110px; }
.units-paste, .units-form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.units-paste textarea { width: 100%; box-sizing: border-box; font-family: var(--mono, monospace); font-size: 12px; }
.units-found ul { margin: 4px 0 0 22px; padding: 0; }
.units-form h4, .units-form h5 { margin: 4px 0 0; }
.units-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.units-grid label { display: flex; flex-direction: column; gap: 3px; color: var(--muted); font-size: 12px; }
.units-grid input { width: 100%; box-sizing: border-box; }
.units-drives { display: flex; flex-direction: column; gap: 6px; }
.units-drive { display: grid; grid-template-columns: minmax(0, 1fr) repeat(3, minmax(0, 100px)); gap: 6px; align-items: end; }
.units-drive b { align-self: center; font-weight: 500; }
.units-drive label { display: flex; flex-direction: column; gap: 2px; color: var(--muted); font-size: 11px; }
.units-drive input { width: 100%; box-sizing: border-box; text-align: right; }
.units-name { white-space: normal !important; }
.units-cost { font-size: 11px; }
.units-add { align-self: flex-start; }
.units-list td { padding-top: 4px; padding-bottom: 4px; vertical-align: middle; }
.units-actions button { min-height: 0; padding: 4px 6px; }
.units-actions button.off { color: var(--faint); }
.units-row { display: flex; gap: 6px; align-items: center; }
.units-row select { flex: 1; min-width: 0; }
.units-row input { width: 80px; }
.units-list { width: 100%; }
.units-actions { display: flex; gap: 4px; justify-content: flex-end; white-space: nowrap; }
.badge.changed { color: var(--info); }
.badge.new { color: var(--pos); }
.badge.hidden { color: var(--faint); }
.warn { color: var(--warn); }
@media (max-width: 800px) {
  .units-new { margin-left: 0; }
  .units-drive { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .units-drive b { grid-column: 1 / -1; }
}
</style>

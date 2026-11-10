<script setup lang="ts">
import {
  baseFromFile, baseFromHub, compareSettings, ImportError, parsePr0plan, plannedKey, toBuildOrder, type Base, type HubState, type Pr0planImport,
} from '@pr0hub/planner';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import Sheet from './Sheet.vue';
import type { StoredBuildOrder } from './BuildOrder.vue';

/**
 * Import of a pr0plan build order (its JSON download, with or without settings): file or pasted text, each pr0plan
 * planet onto one of the viewer's planets, where the start levels come from, and the differences between the file's
 * settings and the hub (the hub's values are used). A planet without coordinates yet (before the start, or a colony
 * to come) is imported as a planned planet and assigned to a synced one later.
 */
type HubPlanetLike = HubState['planets'][number];
const props = defineProps<{ hub: HubState; replaces: boolean }>();
const emit = defineEmits<{ imported: [StoredBuildOrder] }>();
const open = defineModel<boolean>({ required: true });
const { t } = useI18n();
const { uni } = useUni();

const text = ref('');
const dragging = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

async function readFile(f: File | null | undefined) {
  if (f) text.value = await f.text();
}
const pick = (e: Event) => readFile((e.target as HTMLInputElement).files?.[0]);
function drop(e: DragEvent) {
  dragging.value = false;
  readFile(e.dataTransfer?.files?.[0]);
}

const parsed = computed<{ imp: Pr0planImport } | { error: string } | null>(() => {
  if (!text.value.trim()) return null;
  try {
    return { imp: parsePr0plan(text.value) };
  } catch (e) {
    return { error: e instanceof ImportError ? e.code : 'format' };
  }
});
const imp = computed(() => (parsed.value && 'imp' in parsed.value ? parsed.value.imp : null));

/** the viewer's planets (research and production need planets, not moons) */
const planets = computed(() => props.hub.planets.filter((p) => p.type === 'planet'));
const label = (p: HubPlanetLike) => `${p.name ? p.name + ' ' : ''}[${p.coords.g}:${p.coords.s}:${p.coords.p}]`;
/**
 * pr0plan planet id -> hub planet key; by order (pr0plan's planet 1 is the home planet, the first of the empire),
 * planets beyond the synced ones as planned planets (`plannedKey`)
 */
const mapping = ref<Record<string, string | null>>({});
/** pr0plan numbers its planets: those can become planned planets */
const canPlan = (id: string) => /^\d{1,2}$/.test(id);
watch(imp, (i) => {
  if (!i) return;
  mapping.value = Object.fromEntries(i.planets.map((p, n) => [p.id, planets.value[n]?.key ?? (canPlan(p.id) ? plannedKey(p.id) : null)]));
  basis.value = i.settings ? 'file' : 'hub';
});
type Basis = 'file' | 'hub' | 'zero';
const basis = ref<Basis>('file');
const BASES = computed<Basis[]>(() => (imp.value?.settings ? ['file', 'hub', 'zero'] : ['hub', 'zero']));
const mappedTwice = computed(() => {
  const keys = Object.values(mapping.value).filter(Boolean);
  return new Set(keys).size !== keys.length;
});
const diffs = computed(() => (imp.value ? compareSettings(imp.value, props.hub, mapping.value) : []));
const planetName = (key: string | undefined) => {
  const p = props.hub.planets.find((x) => x.key === key);
  return p ? label(p) : key ?? '';
};
const stepCount = computed(() => imp.value?.planets.reduce((n, p) => n + (mapping.value[p.id] ? p.steps.length : 0), 0) ?? 0);

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function submit() {
  const i = imp.value;
  if (!i || !stepCount.value || mappedTwice.value) return;
  if (props.replaces && !confirm(t('buildOrder.replaceConfirm'))) return;
  const keys = Object.values(mapping.value).filter((k): k is string => !!k);
  const base: Base = basis.value === 'file' ? baseFromFile(i, mapping.value) : basis.value === 'hub' ? baseFromHub(props.hub, keys) : { planets: {}, research: {} };
  const order = toBuildOrder(i, mapping.value, base, newId);
  const meta = {
    source: 'pr0plan', basis: basis.value, settings: i.settings, mapping: mapping.value, skipped: i.skipped,
    names: Object.fromEntries(i.planets.map((p) => [p.id, p.name])),
  };
  busy.value = true;
  error.value = null;
  try {
    const res = await uniApi<{ buildOrder: StoredBuildOrder }>(uni.value, '/build-order', { method: 'PUT', body: { order, meta } });
    emit('imported', res.buildOrder);
    text.value = '';
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet v-model="open" :title="t('buildOrder.importTitle')" wide>
    <p class="muted small" style="margin-top: 0">{{ t('buildOrder.importHint') }}</p>
    <div class="card bo-drop" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="drop">
      <input type="file" accept=".json,application/json" @change="pick" />
      <textarea v-model="text" rows="5" class="bo-text" :placeholder="t('buildOrder.pastePlaceholder')" spellcheck="false" />
    </div>
    <p v-if="parsed && 'error' in parsed" class="error">{{ t(`buildOrder.importError.${parsed.error}`) }}</p>

    <template v-if="imp">
      <div class="card">
        <b>{{ t('buildOrder.planets') }}</b>
        <div v-for="p in imp.planets" :key="p.id" class="row small bo-map">
          <span class="bo-map-from">{{ p.name ?? t('buildOrder.pr0planPlanet', { id: p.id }) }} · {{ t('buildOrder.steps', { n: p.steps.length }) }}</span>
          <span class="muted">→</span>
          <select v-model="mapping[p.id]" :aria-label="t('buildOrder.mapTo')">
            <option :value="null">{{ t('buildOrder.skipPlanet') }}</option>
            <option v-for="h in planets" :key="h.key" :value="h.key">{{ label(h) }}</option>
            <option v-if="canPlan(p.id)" :value="plannedKey(p.id)">{{ t('buildOrder.plannedOption') }}</option>
          </select>
        </div>
        <p v-if="mappedTwice" class="warn small">{{ t('buildOrder.mappedTwice') }}</p>
      </div>

      <div class="card">
        <b>{{ t('buildOrder.basis') }}</b>
        <label v-for="b in BASES" :key="b" class="row small bo-basis">
          <input v-model="basis" type="radio" :value="b" />
          <span><b>{{ t(`buildOrder.basisLabel.${b}`) }}</b> <span class="muted">{{ t(`buildOrder.basisHint.${b}`) }}</span></span>
        </label>
      </div>

      <div v-if="diffs.length" class="card bo-warn">
        <b class="warn">{{ t('buildOrder.settingsDiffer') }}</b>
        <ul class="small">
          <li v-for="(d, i) in diffs" :key="i">
            {{ d.key === 'temp' ? t('buildOrder.diff.temp', { planet: planetName(d.planet), file: d.file, hub: d.hub }) : t(`buildOrder.diff.${d.key}`, { file: d.file, hub: d.hub }) }}
          </li>
        </ul>
        <p class="small muted" style="margin-bottom: 0">{{ t('buildOrder.hubWins') }}</p>
      </div>
      <p v-if="imp.skipped.length" class="warn small">{{ t('buildOrder.skipped', { list: imp.skipped.join(', ') }) }}</p>
    </template>
    <p v-if="error" class="error">{{ error }}</p>

    <template #footer>
      <button type="button" @click="open = false">{{ t('common.cancel') }}</button>
      <button type="button" class="primary" :disabled="!imp || !stepCount || mappedTwice || busy" @click="submit">
        {{ t('buildOrder.importButton', { n: stepCount }) }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.bo-drop { display: flex; flex-direction: column; gap: 8px; }
.bo-drop.dragging { border-color: var(--accent); }
.bo-text { width: 100%; font-family: var(--mono, monospace); font-size: 12px; resize: vertical; }
.bo-map { margin-top: 6px; flex-wrap: wrap; }
.bo-map-from { min-width: 180px; }
.bo-basis { margin-top: 6px; align-items: flex-start; }
.bo-warn ul { margin: 6px 0; padding-left: 18px; }
@media (max-width: 800px) {
  .bo-map select { flex: 1 1 100%; }
}
</style>

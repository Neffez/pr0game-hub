<script setup lang="ts">
import Icon from './Icon.vue';
import DateTimeInput from './DateTimeInput.vue';
import Hint from './Hint.vue';
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { coords } from '../format';
import { PRECISIONS, type PlanDraft } from '../plans';

/**
 * Target and time of an attack plan: a player (search) and/or coordinates, which may follow later (picked from the
 * player's known planets and moons), and the time as a day, around an hour, or to the second.
 */
const draft = defineModel<PlanDraft>({ required: true });
/** only the coordinates (participants fill in a target that was still open) */
defineProps<{ coordsOnly?: boolean }>();
const { t } = useI18n();
const { uni } = useUni();

interface Found {
  id: number;
  name: string;
  ally_name: string | null;
}
const query = ref('');
const found = ref<Found[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(timer);
  if (q.trim().length < 2) return void (found.value = []);
  timer = setTimeout(async () => {
    try {
      found.value = (await uniApi<Found[]>(uni.value, `/players?q=${encodeURIComponent(q.trim())}`)).slice(0, 8);
    } catch {
      found.value = [];
    }
  }, 250);
});
onBeforeUnmount(() => clearTimeout(timer));
function pick(p: Found) {
  draft.value.player = { id: p.id, name: p.name };
  query.value = '';
  found.value = [];
}

/** Known planets and moons of the chosen player, to fill in the coordinates. */
const bodies = ref<{ key: string; label: string }[]>([]);
watch(
  () => draft.value.player?.id,
  async (id) => {
    bodies.value = [];
    if (!id) return;
    try {
      const d = await uniApi<{ planets: { g: number; s: number; p: number; name: string | null; has_moon: number; moon_name: string | null }[] }>(
        uni.value,
        `/players/${id}`,
      );
      bodies.value = d.planets.flatMap((pl) => [
        { key: `${pl.g}:${pl.s}:${pl.p}:planet`, label: `${coords(pl.g, pl.s, pl.p)} ${pl.name ?? ''}` },
        ...(pl.has_moon ? [{ key: `${pl.g}:${pl.s}:${pl.p}:moon`, label: `${coords(pl.g, pl.s, pl.p)} ${t('common.moon')} ${pl.moon_name ?? ''}` }] : []),
      ]);
    } catch {
      /* coordinates by hand */
    }
  },
  { immediate: true },
);
function pickBody(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (!v) return;
  const [g, s, p, type] = v.split(':');
  draft.value.target = `${g}:${s}:${p}`;
  draft.value.type = type as 'planet' | 'moon';
}
</script>

<template>
  <div class="target-form">
    <div v-if="!coordsOnly" class="field">
      <span class="lbl">{{ t('plans.player') }}</span>
      <span v-if="draft.player" class="chip">
        {{ draft.player.name }} <button type="button" class="icon-btn small" :title="t('plans.clear')" :aria-label="t('plans.clear')" @click="draft.player = null"><Icon name="close" :size="12" /></button>
      </span>
      <span v-else class="search">
        <input v-model="query" :placeholder="t('plans.playerSearch')" />
        <span v-if="found.length" class="results">
          <button v-for="p in found" :key="p.id" @click="pick(p)">{{ p.name }}<span v-if="p.ally_name" class="muted"> [{{ p.ally_name }}]</span></button>
        </span>
      </span>
    </div>
    <div class="field">
      <span class="lbl">{{ t('plans.target') }}</span>
      <input v-model="draft.target" class="mono" placeholder="1:41:1" size="10" />
      <select v-model="draft.type" :aria-label="t('plans.bodyType')">
        <option value="planet">{{ t('plans.planet') }}</option>
        <option value="moon">{{ t('plans.moon') }}</option>
      </select>
      <select v-if="bodies.length" :aria-label="t('plans.knownBodies')" @change="pickBody">
        <option value="">{{ t('plans.knownBodies') }} …</option>
        <option v-for="b in bodies" :key="b.key" :value="b.key">{{ b.label }}</option>
      </select>
      <Hint v-if="!draft.target">{{ t('plans.coordsLater') }}</Hint>
    </div>
    <div v-if="!coordsOnly" class="field">
      <span class="lbl">{{ t('plans.targetTime') }}</span>
      <select v-model="draft.precision" :aria-label="t('plans.precision')">
        <option v-for="p in PRECISIONS" :key="p" :value="p">{{ t(`plans.precisions.${p}`) }}</option>
      </select>
      <DateTimeInput v-if="draft.precision === 'day'" v-model="draft.date" precision="day" />
      <DateTimeInput v-else v-model="draft.time" :precision="draft.precision === 'exact' ? 'second' : 'minute'" />
    </div>
    <div v-if="!coordsOnly" class="field">
      <span class="lbl">{{ t('plans.note') }}</span>
      <input v-model="draft.note" class="grow" maxlength="500" />
    </div>
  </div>
</template>

<style scoped>
.target-form { display: flex; flex-direction: column; gap: 8px; }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lbl { min-width: 90px; color: var(--muted); font-size: 12px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px; border: 1px solid var(--border); border-radius: 6px; }
.chip button { padding: 0 6px; }
.search { position: relative; }
.results {
  position: absolute; z-index: 20; top: 100%; left: 0; display: flex; flex-direction: column; min-width: 220px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
}
.results button { border: 0; border-radius: 0; text-align: left; }
.results button:hover { background: var(--accent-soft); }
.grow { flex: 1; min-width: 160px; }
</style>

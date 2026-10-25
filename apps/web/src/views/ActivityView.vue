<script setup lang="ts">
import Icon from '../components/Icon.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import PlayerLink from '../components/PlayerLink.vue';
import RangePicker from '../components/RangePicker.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { useLoader, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { coords, dateTime, fmt, fmtSigned, name, numDate, short, weekday } from '../format';
import { intlLocale } from '../i18n';

/** Noteworthy changes detected while syncing, newest first, filterable by kind. */
interface Entry {
  id: number;
  time: number;
  kind: string;
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: string | null;
  data: Record<string, any>;
  player_id: number | null;
  player_name: string | null;
  status: string[];
  ally_tag: string | null;
  ally_name: string | null;
}

/** label: activity.kinds.<kind>; icon: name in Icon.vue */
const KINDS: { kind: string; icon: string; color: string }[] = [
  { kind: 'phalanx_new', icon: 'spy', color: 'var(--info)' },
  { kind: 'phalanx_up', icon: 'arrowUp', color: 'var(--info)' },
  { kind: 'planet_new', icon: 'planets', color: 'var(--pos)' },
  { kind: 'moon_new', icon: 'moon', color: 'var(--pos)' },
  { kind: 'debris_new', icon: 'sparkle', color: 'var(--warn)' },
  { kind: 'debris_grown', icon: 'sparkle', color: 'var(--neg)' },
  { kind: 'debris_shrunk', icon: 'sparkle', color: 'var(--info)' },
  { kind: 'debris_cleared', icon: 'close', color: 'var(--muted)' },
  { kind: 'points_loss', icon: 'rankDown', color: 'var(--neg)' },
  { kind: 'fleet_loss', icon: 'rankDown', color: 'var(--neg)' },
  { kind: 'no_growth', icon: 'pause', color: 'var(--muted)' },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

const { t } = useI18n();
const { uni } = useUni();
const kindLabel = (kind: string) => t(`activity.kinds.${kind}`);
const days = useStored('activity.days', 3);
/** hidden kinds (per viewer) */
const hidden = useStored<string[]>('activity.hidden', []);
const minHours = useStored('activity.minHours', 6);
const { data, error, load } = useLoader(() =>
  uniApi<{ counts: Record<string, number>; entries: Entry[] }>(uni.value, `/activity?from=${Math.floor(Date.now() / 1000) - days.value * 86400}`),
);
onMounted(load);
useLiveReload(load, tables('activity_log', 'player_scores', 'spy_reports', 'galaxy_systems'));
watch(days, load);

function toggle(kind: string) {
  hidden.value = hidden.value.includes(kind) ? hidden.value.filter((k) => k !== kind) : [...hidden.value, kind];
}

const entries = computed(() =>
  (data.value?.entries ?? []).filter((e) => !hidden.value.includes(e.kind) && (e.kind !== 'no_growth' || e.data.hours >= minHours.value)),
);

/** Entries grouped by day for the timeline. */
const days_ = computed(() => {
  const out: { day: string; entries: Entry[] }[] = [];
  for (const e of entries.value) {
    const d = new Date(e.time * 1000);
    const day = `${weekday(d, 'long')}, ${numDate(d)}`;
    if (out.at(-1)?.day !== day) out.push({ day, entries: [] });
    out.at(-1)!.entries.push(e);
  }
  return out;
});

const time = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' });
const browse = (e: Entry) => ({ path: `/${uni.value}/browse`, query: { g: e.g, s: e.s } });

const res = (d: Record<string, any>) => `${name(901)} ${short(d.metal)} · ${name(902)} ${short(d.crystal)}`;

function text(e: Entry) {
  const d = e.data;
  switch (e.kind) {
    case 'phalanx_new':
      return t(d.known ? 'activity.text.phalanxBuilt' : 'activity.text.phalanxFound', { level: d.level });
    case 'phalanx_up':
      return t('activity.text.phalanxUp', { before: d.before, level: d.level });
    case 'planet_new':
      return d.name ? t('activity.text.planetNewNamed', { name: d.name }) : kindLabel('planet_new');
    case 'moon_new':
      return kindLabel('moon_new');
    case 'debris_new':
      // older entries stored the galaxy strings
      if (d.debris) return t('activity.text.debris', { res: `${name(901)} ${d.debris.metal} · ${name(902)} ${d.debris.crystal}` });
      return t(d.firstSeen ? 'activity.text.debrisSeen' : 'activity.text.debrisNew', { res: res(d) });
    case 'debris_grown':
      return t('activity.text.debrisGrown', { res: res(d), delta: short(d.delta) });
    case 'debris_shrunk':
      return d.collected
        ? t('activity.text.debrisCollected', { by: d.by ?? name(209), res: res(d.collected), rest: res(d) })
        : t('activity.text.debrisShrunk', { res: res(d), delta: short(d.delta) });
    case 'debris_cleared':
      return d.collected
        ? t('activity.text.debrisClearedBy', { by: d.by ?? name(209), res: res(d.collected) })
        : t('activity.text.debrisCleared', { res: res(d.before) });
    case 'points_loss':
      return t('activity.text.pointsLoss', { delta: fmtSigned(d.delta), before: short(d.before), points: short(d.points) });
    case 'fleet_loss':
      return t('activity.text.fleetLoss', { delta: fmtSigned(d.delta), before: short(d.before), points: short(d.points) });
    case 'no_growth':
      return t('activity.text.noGrowth', { hours: d.hours, points: fmt(d.points), since: dateTime(d.since) });
  }
  return e.kind;
}
</script>

<template>
  <h1>
    {{ t('activity.title') }}
    <Hint>
      <p>{{ t('activity.hint1') }}</p>
      <p>
        <b>{{ t('activity.hintPhalanx') }}</b> {{ t('activity.hintPhalanxText') }}
        <b>{{ t('activity.hintPlanet') }}</b> {{ t('activity.hintPlanetText') }}
        <b>{{ t('activity.hintDebris') }}</b> {{ t('activity.hintDebrisText') }}
        <b>{{ t('activity.hintPoints') }}</b> {{ t('activity.hintPointsText') }}
        <b>{{ t('activity.hintNoGrowth') }}</b> {{ t('activity.hintNoGrowthText') }}
      </p>
      <p>{{ t('activity.hintFilter') }}</p>
    </Hint>
  </h1>

  <div class="card">
    <div class="row">
      <RangePicker v-model="days" />
      <label v-if="!hidden.includes('no_growth')">
        {{ t('activity.noGrowthFrom') }}
        <select v-model.number="minHours">
          <option v-for="h in [6, 12, 18, 24]" :key="h" :value="h">{{ h }} h</option>
        </select>
      </label>
    </div>
    <div class="row chips">
      <button
        v-for="k in KINDS"
        :key="k.kind"
        class="chip"
        :class="{ off: hidden.includes(k.kind) }"
        :aria-pressed="!hidden.includes(k.kind)"
        :title="hidden.includes(k.kind) ? t('activity.show') : t('activity.hide')"
        @click="toggle(k.kind)"
      >
        <Icon :name="k.icon" :size="13" :style="{ color: k.color }" /> {{ kindLabel(k.kind) }}
        <span class="faint">{{ data?.counts[k.kind] ?? 0 }}</span>
      </button>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !entries.length" class="card muted">{{ t('activity.empty') }}</div>

  <div v-for="d in days_" :key="d.day" class="day">
    <h3>{{ d.day }}</h3>
    <div class="card" style="padding: 4px 0">
      <div v-for="e in d.entries" :key="e.id" class="entry">
        <span class="mono small faint">{{ time(e.time) }}</span>
        <span class="kind-icon" :style="{ color: META[e.kind]?.color }"><Icon :name="META[e.kind]?.icon ?? 'activity'" :size="15" :label="kindLabel(e.kind)" /></span>
        <span class="who">
          <template v-if="e.player_id">
            <PlayerLink :id="e.player_id" :name="e.player_name ?? '?'" />
            <StatusBadges :status="e.status" />
            <span v-if="e.ally_tag || e.ally_name" class="muted small"> [{{ e.ally_tag ?? e.ally_name }}]</span>
          </template>
          <span v-else class="faint">–</span>
        </span>
        <span class="what">{{ text(e) }}</span>
        <RouterLink v-if="e.g" class="mono small" :to="browse(e)" :title="t('activity.showInBrowser')">
          <Icon v-if="e.planet_type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> {{ coords(e.g, e.s!, e.p!) }}
        </RouterLink>
        <span v-else />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chips { margin-top: 10px; gap: 6px; }
.chip.off { opacity: 0.4; text-decoration: line-through; }
.day h3 { margin: 16px 0 6px; font-size: 13px; color: var(--muted); text-transform: capitalize; }
.entry { display: grid; grid-template-columns: 44px 20px minmax(160px, 260px) 1fr auto; align-items: center; gap: 10px; padding: 6px 16px; }
.entry + .entry { border-top: 1px solid var(--border); }
.kind-icon { display: flex; justify-content: center; }
@media (max-width: 800px) {
  .entry { grid-template-columns: 44px 20px 1fr; }
  .what, .entry > a { grid-column: 3; }
}
</style>

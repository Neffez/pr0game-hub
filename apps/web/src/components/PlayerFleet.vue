<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { Schema } from '../apiTypes';
import { nowSec } from '../clock';
import { useLoader, useUni } from '../composables';
import { abbr, ago, coords, dateTime, fmt, freshnessColor, name } from '../format';
import { tables, useLiveReload } from '../live';
import Section from './Section.vue';

/**
 * The fleet a player has or last had (player page; server: repo/playerFleet.ts): the strongest recent sighting with
 * all its ships, the spy reports of several bodies added up and checked against the fleet statistics, and every
 * sighting (spy reports per body, battles, fleets on their way) on request.
 */
type Sighting = Schema<'FleetSighting'>;
const props = defineProps<{ player: number }>();
const { t } = useI18n();
const { uni } = useUni();

const { data, error, load } = useLoader(() => uniApi<Schema<'PlayerFleet'>>(uni.value, `/players/${props.player}/fleet`));
load();
watch(() => props.player, load);
useLiveReload(load, tables('spy_reports', 'combat_reports', 'fleets', 'player_scores'));

const all = ref(false);
const fleet = computed(() => data.value?.fleet ?? null);
const ships = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => n > 0).sort(([a], [b]) => Number(a) - Number(b));
const shipsText = (s: Record<string, number>) => ships(s).map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`).join(' · ') || t('player.fleet.noShips');
const shipsTitle = (s: Record<string, number>) => ships(s).map(([id, n]) => `${fmt(n)} ${name(id)}`).join('\n');
const where = (x: Sighting) => (x.body ? `${coords(x.body.g, x.body.s, x.body.p)}${x.body.type === 'moon' ? ` ${t('common.moon')}` : ''}` : '');
const sourceKey = (x: Sighting) => (x.source !== 'empire' ? x.source : x.count == null ? 'empireUnknown' : x.count ? 'empireFlights' : 'empire');
const sourceText = (x: Sighting) => t(`player.fleet.source.${sourceKey(x)}`, { where: where(x), n: x.count ?? 0 });
/** the statistics show clearly more fleet points than the fleet known: it may be larger now */
const grown = computed(() => {
  const f = fleet.value;
  const fp = data.value?.fleetPoints;
  return !!f && !!fp && fp.points > f.points * 1.3 + 10;
});
</script>

<template>
  <Section :title="t('player.fleet.title')" store-key="player.fleet">
    <template #hint>
      <span v-if="fleet" class="small" :style="{ color: freshnessColor(nowSec() - fleet.time) }" :title="dateTime(fleet.time)">
        {{ sourceText(fleet) }} · {{ ago(fleet.time) }}
      </span>
    </template>
    <div v-if="error" class="error">{{ error }}</div>
    <template v-else-if="data">
      <p v-if="!fleet" class="muted small m-0">{{ t('player.fleet.unknown') }}</p>
      <template v-else>
        <div v-if="ships(fleet.units).length" class="fleet-grid">
          <div v-for="[id, n] in ships(fleet.units)" :key="id" class="fleet-line">
            <span>{{ name(id) }}</span>
            <b class="mono">{{ fmt(n) }}</b>
          </div>
        </div>
        <p v-else class="muted small m-0">{{ t('player.fleet.noShips') }}</p>
        <p class="small muted fleet-note">
          {{ t('player.fleet.points', { n: fmt(fleet.points) }) }}
          <template v-if="data.fleetPoints">
            · <span :title="dateTime(data.fleetPoints.time)">{{ t('player.fleet.stat', { n: fmt(data.fleetPoints.points), ago: ago(data.fleetPoints.time) }) }}</span>
          </template>
          <span v-if="grown" class="warn"> · {{ t('player.fleet.grown') }}</span>
        </p>
      </template>
      <p v-if="data.sum" class="small fleet-note">
        <span :title="shipsTitle(data.sum.units)">{{ t('player.fleet.sum', { n: data.sum.count ?? 0, points: fmt(data.sum.points) }) }}</span>
        <template v-if="data.sum.stat && data.sum.check">
          –
          <span :class="{ ok: data.sum.check === 'match', warn: data.sum.check === 'over', muted: data.sum.check === 'under' }" :title="dateTime(data.sum.stat.time)">
            {{ t(`player.fleet.check.${data.sum.check}`, { n: fmt(data.sum.stat.points) }) }}
          </span>
        </template>
        <span v-else class="faint"> – {{ t('player.fleet.check.none') }}</span>
      </p>
      <template v-if="data.sightings.length">
        <p class="small fleet-note">
          <button class="link" :aria-expanded="all" @click="all = !all">
            {{ all ? t('player.fleet.hide') : t('player.fleet.all', { n: data.sightings.length }) }}
          </button>
        </p>
        <div v-if="all" class="table-wrap flat">
          <table class="data small">
            <thead><tr><th>{{ t('player.fleet.sourceHead') }}</th><th>{{ t('player.fleet.when') }}</th><th>{{ t('player.fleet.ships') }}</th><th class="num">{{ t('player.fleet.pointsHead') }}</th></tr></thead>
            <tbody>
              <tr v-for="(x, i) in data.sightings" :key="`${x.source}:${x.time}:${i}`">
                <td>
                  <RouterLink v-if="x.reportId" :to="`/${uni}/battle-hall/${encodeURIComponent(x.reportId)}`">{{ sourceText(x) }}</RouterLink>
                  <template v-else>{{ sourceText(x) }}</template>
                </td>
                <td :title="dateTime(x.time)">{{ ago(x.time) }}</td>
                <td class="fleet-ships" :title="shipsTitle(x.units)">{{ shipsText(x.units) }}</td>
                <td class="num mono">{{ fmt(x.points) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </Section>
</template>

<style scoped>
.fleet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0 24px; }
.fleet-line { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid var(--border); }
p.fleet-note { margin: 8px 0 0; }
td.fleet-ships { white-space: normal; min-width: 200px; }
</style>

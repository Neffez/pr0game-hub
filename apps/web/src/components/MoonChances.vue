<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useStored, useUni } from '../composables';
import Loading from './Loading.vue';
import { tables, useLiveReload } from '../live';
import { coords, dateTime, fmt, moonCalcLink } from '../format';

/**
 * Moon chances (backlog B-6): battles of the alliance's combat reports with a moon chance or a moon created, expected
 * against created moons per member, moons that appeared at members' planets, and the moon destruction calculator with
 * the moon's diameter for a moon at a battle's position (server: repo/moons.ts).
 */
interface Battle {
  reportId: string; time: number; g: number | null; s: number | null; p: number | null; chance: number; extra: number; created: boolean;
  attackers: string[]; defenders: string[]; memberSide: 'attacker' | 'defender' | null; moon: { diameter: number | null } | null;
}
interface MoonResponse {
  battles: Battle[];
  members: { name: string; battles: number; expected: number; created: number }[];
  newMoons: { time: number; g: number; s: number; p: number; player: string; diameter: number | null }[];
  days: number;
}

const { t } = useI18n();
const { ctx, uni } = useUni();
const DAYS = [7, 30, 90, 365];
/** period and filter are remembered like on the other pages */
const filter = useStored('moons.filter', { days: 30, membersOnly: true });
if (!DAYS.includes(filter.value.days)) filter.value.days = 30;
const days = computed({ get: () => filter.value.days, set: (v) => (filter.value.days = v) });
const membersOnly = computed({ get: () => filter.value.membersOnly, set: (v) => (filter.value.membersOnly = v) });
const { data, error, load } = useLoader(() => uniApi<MoonResponse>(uni.value, `/moon-chances?days=${days.value}`));
onMounted(load);
watch(days, load);
useLiveReload(load, tables('combat_reports', 'galaxy_systems'));

const settings = computed(() => ctx.value!.universe.settings);
const battles = computed(() => (data.value?.battles ?? []).filter((b) => !membersOnly.value || b.memberSide));
const moonLink = (b: Battle) => (b.g != null && b.s != null && b.p != null ? moonCalcLink(settings.value, [b.g, b.s, b.p], { diameter: b.moon?.diameter }) : null);
const pct = (n: number) => `${fmt(n)} %`;
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <template v-else>
    <div class="row small moon-filters">
      <label>
        {{ t('moons.period') }}
        <select v-model.number="days">
          <option v-for="d in DAYS" :key="d" :value="d">{{ t('farm.daysOption', { n: d }, d) }}</option>
        </select>
      </label>
      <label class="check"><input v-model="membersOnly" type="checkbox" /> {{ t('moons.membersOnly') }}</label>
    </div>

    <p v-if="!data.battles.length && !data.newMoons.length" class="muted small">{{ t('moons.empty', { days: data.days }) }}</p>
    <p v-else-if="data.battles.length && !battles.length" class="muted small">{{ t('moons.emptyFiltered', { days: data.days }) }}</p>

    <div v-if="data.members.length" class="table-wrap">
      <table class="data moon-members">
        <thead>
          <tr><th>{{ t('moons.member') }}</th><th class="num">{{ t('moons.battles') }}</th><th class="num" :title="t('moons.expectedTitle')">{{ t('moons.expected') }}</th><th class="num">{{ t('moons.created') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in data.members" :key="m.name">
            <td>{{ m.name }}</td>
            <td class="num">{{ fmt(m.battles) }}</td>
            <td class="num">{{ fmt(m.expected, 2) }}</td>
            <td class="num" :class="{ pos: m.created > m.expected, neg: m.created < m.expected - 1 }">{{ fmt(m.created) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="battles.length" class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>{{ t('battleHall.date') }}</th>
            <th>{{ t('moons.target') }}</th>
            <th>{{ t('combat.attacker') }}</th>
            <th>{{ t('combat.defender') }}</th>
            <th class="num">{{ t('moons.chance') }}</th>
            <th>{{ t('moons.result') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in battles" :key="b.reportId">
            <td class="nowrap"><RouterLink :to="`/${uni}/battle-hall/${b.reportId}`">{{ dateTime(b.time) }}</RouterLink></td>
            <td class="mono nowrap">{{ b.g != null ? coords(b.g, b.s!, b.p!) : '–' }}</td>
            <td :class="{ strong: b.memberSide === 'attacker' }">{{ b.attackers.join(', ') }}</td>
            <td :class="{ strong: b.memberSide === 'defender' }">{{ b.defenders.join(', ') }}</td>
            <td class="num" :title="b.extra ? t('moons.extraTitle', { n: b.extra }) : ''">{{ pct(b.chance) }}</td>
            <td>
              <span v-if="b.created" class="pos">{{ t('moons.yes') }}</span>
              <span v-else class="muted">{{ t('moons.no') }}</span>
            </td>
            <td class="nowrap">
              <a v-if="b.moon && moonLink(b)" :href="moonLink(b)!" target="_blank" rel="noopener" :title="b.moon.diameter ? t('actions.moonDiameter', { n: fmt(b.moon.diameter) }) : t('actions.moonNoDiameter')">
                {{ t('actions.moonDestruction') }}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="data.newMoons.length">
      <h4>{{ t('moons.newMoons') }}</h4>
      <ul class="small new-moons">
        <li v-for="m in data.newMoons" :key="`${m.g}:${m.s}:${m.p}:${m.time}`">
          <span class="mono">{{ coords(m.g, m.s, m.p) }}</span> {{ m.player }} · {{ dateTime(m.time) }}<template v-if="m.diameter"> · {{ fmt(m.diameter) }} km</template>
        </li>
      </ul>
    </template>
  </template>
</template>

<style scoped>
.moon-filters { margin-bottom: 8px; gap: 12px; }
.moon-members { width: auto; margin-bottom: 12px; }
.strong { font-weight: 600; }
.nowrap { white-space: nowrap; }
.new-moons { margin: 4px 0 0; padding-left: 18px; }
</style>

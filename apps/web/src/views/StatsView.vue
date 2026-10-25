<script setup lang="ts">
import Icon from '../components/Icon.vue';
import Hint from '../components/Hint.vue';
import PlayerLink from '../components/PlayerLink.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import PageHeader from '../components/PageHeader.vue';
import { useLoader, useMobile, useStored, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
import { dateTime, fmt, fmtSigned, short, STATS_CATEGORIES, STATS_TYPES } from '../format';

interface Category { who: string; type: number; stat_time: number; pages: number[] }
interface Row {
  rank: number;
  rank_change: number | null;
  prev_rank: number | null;
  points: number;
  delta: number | null;
  id: number;
  name: string;
  // players
  title?: string | null;
  status?: string[];
  ally_id?: number | null;
  ally_name?: string | null;
  ally_tag?: string | null;
  member?: number;
  ownAlly?: boolean;
  planet_count?: number;
  first_planet?: string | null;
  scores?: Record<number, number>;
  // alliances
  tag?: string | null;
  members?: number | null;
  own?: boolean;
}
interface Stats {
  statTime: number | null;
  prevTime: number | null;
  categories: Category[];
  me: { id: number; allyId: number | null; points: Record<number, number> } | null;
  rows: Row[];
}

const { t } = useI18n();
const { uni } = useUni();
const who = useStored<'player' | 'alliance'>('stats.who', 'player');
const type = useStored('stats.type', 1);
/** Mobile: the categories as a select instead of a cloud of buttons. */
const mobile = useMobile();
const { data, error, load } = useLoader(() => uniApi<Stats>(uni.value, `/stats?who=${who.value}&type=${type.value}`));
onMounted(load);
useLiveReload(load, tables('player_scores', 'alliance_scores', 'players'));
watch([who, type], load);

// ------------------------------------------------------------ sync overview
const categoryOf = (cat: number) => data.value?.categories.find((c) => c.who === who.value && c.type === cat) ?? null;
/** Pages of 100 ranks to show per category: up to the highest page synced in any category. */
const pageCount = computed(() => Math.max(1, ...(data.value?.categories ?? []).filter((c) => c.who === who.value).flatMap((c) => c.pages.map((p) => p + 1))));
const pageTitle = (cat: number, p: number) => {
  const c = categoryOf(cat);
  const range = t('stats.ranks', { from: p * 100 + 1, to: p * 100 + 100 });
  return c?.pages.includes(p) ? t('stats.pageIncluded', { range, time: dateTime(c.stat_time) }) : t('stats.pageMissing', { range });
};

// ------------------------------------------------------------------ colours
/** Like the FF-Hub: the closer a value gets to your own (or above), the stronger the colour. */
const COLORS = { 1: [0, 143, 255], 2: [238, 77, 46], 3: [255, 0, 130], 4: [92, 184, 92], 5: [247, 197, 22], fd: [205, 110, 60] } as const;
const BASE = [230, 237, 243];
function tone(value: number | null | undefined, own: number | null | undefined, color: readonly number[]) {
  if (value == null || !own || own <= 0 || value <= 0) return undefined;
  const w = Math.min(1, value / own);
  const c = color.map((v, i) => Math.round(v * w + BASE[i] * (1 - w)));
  return { color: `rgb(${c.join(', ')})` };
}
const mine = computed(() => data.value?.me?.points ?? {});
const fleetDef = (s: Record<number, number> | undefined) => (s && (s[2] != null || s[5] != null) ? (s[2] ?? 0) + (s[5] ?? 0) : null);
/** Points column: compared with your own points of the shown category (not for honor points). */
const pointsStyle = (r: Row) => (type.value <= 5 && who.value === 'player' ? tone(r.points, mine.value[type.value], COLORS[type.value as 1]) : undefined);

/** Name colour: you, your alliance, vacation, inactive. */
function nameClass(r: Row) {
  if (data.value?.me?.id === r.id) return 'me';
  if (r.status?.includes('vacation')) return 'vacation';
  if (r.status?.some((s) => s === 'inactive' || s === 'longinactive')) return 'inactive';
  if (r.ownAlly || r.member) return 'ally';
  return '';
}

/** Rank change as shown in the game tooltip; falls back to the change since the previous synced stand. */
function rankMove(r: Row): { n: number; game: boolean } | null {
  if (r.rank_change) return { n: r.rank_change, game: true };
  if (r.rank_change == null && r.prev_rank != null && r.prev_rank !== r.rank) return { n: r.prev_rank - r.rank, game: false };
  return null;
}

/** Score columns (stat type; header stats.col.<type>, full name as tooltip) */
const SCORE_COLS = [4, 3, 2, 5] as const;
</script>

<template>
  <PageHeader :title="t('nav.stats')">
    <template #hint>
      <Hint>
        <p>{{ t('stats.hint1') }}</p>
        <p>{{ t('stats.hint2') }}</p>
        <p>{{ t('stats.hint3') }}</p>
        <p>{{ t('stats.hint4') }}</p>
        <p>{{ t('stats.hint5') }}</p>
      </Hint>
    </template>
  </PageHeader>

  <div class="card">
    <div class="row">
      <div class="seg">
        <button :class="{ active: who === 'player' }" @click="who = 'player'">{{ t('stats.players') }}</button>
        <button :class="{ active: who === 'alliance' }" @click="who = 'alliance'">{{ t('stats.alliances') }}</button>
      </div>
      <span class="grow" />
      <span v-if="data?.statTime" class="muted small">
        {{ t('stats.asOf', { time: dateTime(data.statTime) }) }} · {{ t('stats.rankCount', { n: data.rows.length }) }}
        <template v-if="data.prevTime"> · {{ t('stats.deltaSince', { time: dateTime(data.prevTime) }) }}</template>
      </span>
    </div>
    <div v-if="mobile" class="cat-select">
      <select v-model.number="type" :aria-label="t('stats.category')">
        <option v-for="(label, cat) in STATS_CATEGORIES" :key="cat" :value="Number(cat)">
          {{ label }}{{ data && !categoryOf(Number(cat)) ? ` (${t('stats.notSynced')})` : '' }}
        </option>
      </select>
      <span class="pages" :title="t('stats.category')">
        <i v-for="p in pageCount" :key="p" :class="{ ok: categoryOf(type)?.pages.includes(p - 1) }" :title="pageTitle(type, p - 1)" />
      </span>
    </div>
    <div v-else class="cats">
      <button
        v-for="(label, cat) in STATS_CATEGORIES"
        :key="cat"
        class="cat"
        :class="{ active: type === Number(cat), empty: data && !categoryOf(Number(cat)) }"
        :title="categoryOf(Number(cat)) ? t('stats.asOf', { time: dateTime(categoryOf(Number(cat))!.stat_time) }) : t('stats.notSynced')"
        @click="type = Number(cat)"
      >
        <span>{{ label }}</span>
        <span class="pages">
          <i v-for="p in pageCount" :key="p" :class="{ ok: categoryOf(Number(cat))?.pages.includes(p - 1) }" :title="pageTitle(Number(cat), p - 1)" />
        </span>
      </button>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <p v-else-if="data && !data.rows.length" class="muted">
    {{ t('stats.empty', { who: who === 'player' ? t('stats.players') : t('stats.alliances'), category: STATS_CATEGORIES[type] }) }}
  </p>

  <div v-else-if="data" class="table-wrap">
    <table v-if="who === 'player'" v-stack="4" class="data stats">
      <thead>
        <tr>
          <th class="num">{{ t('stats.rank') }}</th>
          <th class="num" :title="t('stats.moveTitle')">±</th>
          <th>{{ t('common.player') }}</th>
          <th>{{ t('common.alliance') }}</th>
          <th class="num">{{ STATS_CATEGORIES[type] }}</th>
          <th class="num" :title="t('stats.deltaTitle')">Δ</th>
          <th>{{ t('common.coords') }}</th>
          <th v-for="c in SCORE_COLS" :key="c" class="num" :class="{ cur: type === c }" :title="STATS_TYPES[c]">{{ t(`stats.col.${c}`) }}</th>
          <th class="num" :title="t('stats.fleetDefTitle')">{{ t('stats.fleetDef') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in data.rows" :key="r.id" :class="{ mine: data.me?.id === r.id }">
          <td class="num">{{ fmt(r.rank) }}</td>
          <td class="num small">
            <template v-for="m in [rankMove(r)]" :key="0">
              <span v-if="m" :class="[m.n > 0 ? 'pos' : 'neg', { calc: !m.game }]" :title="m.game ? t('stats.moveGame') : t('stats.moveCalc', { rank: r.prev_rank })">
                <Icon :name="m.n > 0 ? 'rankUp' : 'rankDown'" :size="10" />{{ Math.abs(m.n) }}
              </span>
              <span v-else class="faint">·</span>
            </template>
          </td>
          <td>
            <span v-if="r.title" class="honor">{{ r.title }}</span>
            <span :class="['pname', nameClass(r)]"><PlayerLink :id="r.id" :name="r.name" /></span>
            <StatusBadges :status="r.status ?? []" />
          </td>
          <td>
            <span v-if="r.ally_id" :class="{ ally: r.ownAlly }">{{ r.ally_name ?? '' }}<span v-if="r.ally_tag" class="muted"> [{{ r.ally_tag }}]</span></span>
            <span v-else class="faint">–</span>
          </td>
          <td class="num strong m-wide" :style="pointsStyle(r)" :title="fmt(r.points)">{{ fmt(r.points) }}</td>
          <td class="num small" :class="r.delta ? (r.delta > 0 ? 'pos' : 'neg') : 'faint'">{{ r.delta == null ? '' : r.delta ? fmtSigned(r.delta) : '±0' }}</td>
          <td class="mono small">
            <template v-if="r.first_planet">{{ r.first_planet }}<span v-if="(r.planet_count ?? 0) > 1" class="faint"> +{{ r.planet_count! - 1 }}</span></template>
            <span v-else class="faint">–</span>
          </td>
          <td
            v-for="c in SCORE_COLS"
            :key="c"
            class="num"
            :class="{ cur: type === c }"
            :style="tone(r.scores?.[c], mine[c], COLORS[c])"
            :title="r.scores?.[c] != null ? fmt(r.scores[c]) : t('stats.notSynced')"
          >
            {{ r.scores?.[c] != null ? short(r.scores[c]) : '' }}
          </td>
          <td class="num" :style="tone(fleetDef(r.scores), fleetDef(mine), COLORS.fd)" :title="fleetDef(r.scores) != null ? fmt(fleetDef(r.scores)) : ''">
            {{ fleetDef(r.scores) != null ? short(fleetDef(r.scores)) : '' }}
          </td>
        </tr>
      </tbody>
    </table>

    <table v-else v-stack="3" class="data stats">
      <thead>
        <tr>
          <th class="num">{{ t('stats.rank') }}</th>
          <th class="num" :title="t('stats.moveTitle')">±</th>
          <th>{{ t('common.alliance') }}</th>
          <th class="num">{{ t('stats.members') }}</th>
          <th class="num">{{ STATS_CATEGORIES[type] }}</th>
          <th class="num">{{ t('stats.perMember') }}</th>
          <th class="num" :title="t('stats.deltaTitle')">Δ</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in data.rows" :key="r.id" :class="{ mine: r.own }">
          <td class="num">{{ fmt(r.rank) }}</td>
          <td class="num small">
            <template v-for="m in [rankMove(r)]" :key="0">
              <span v-if="m" :class="[m.n > 0 ? 'pos' : 'neg', { calc: !m.game }]"><Icon :name="m.n > 0 ? 'rankUp' : 'rankDown'" :size="10" />{{ Math.abs(m.n) }}</span>
              <span v-else class="faint">·</span>
            </template>
          </td>
          <td :class="{ ally: r.own }">{{ r.name }}<span v-if="r.tag" class="muted"> [{{ r.tag }}]</span></td>
          <td class="num">{{ r.members ?? '' }}</td>
          <td class="num strong">{{ fmt(r.points) }}</td>
          <td class="num">{{ r.members ? fmt(Math.floor(r.points / r.members)) : '' }}</td>
          <td class="num small" :class="r.delta ? (r.delta > 0 ? 'pos' : 'neg') : 'faint'">{{ r.delta == null ? '' : r.delta ? fmtSigned(r.delta) : '±0' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.cat-select { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.cat-select select { flex: 1; min-width: 0; }

.cats { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cat {
  display: flex; flex-direction: column; align-items: flex-start; gap: 5px; margin: 0;
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent;
}
.cat:hover { background: var(--surface-2); }
.cat.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.cat.empty:not(.active) { color: var(--faint); }
.pages { display: flex; gap: 2px; }
.pages i { width: 6px; height: 10px; border-radius: 1px; background: color-mix(in srgb, var(--neg) 70%, transparent); }
.pages i.ok { background: var(--pos); }

table.stats td.strong { font-weight: 600; }
table.stats th.cur, table.stats td.cur { background: color-mix(in srgb, var(--accent) 6%, transparent); }
table.stats tr.mine td { background: var(--accent-soft); }
.calc { opacity: .6; }
.honor { display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--surface-2); color: var(--warn); }
.pname :deep(a) { color: var(--text); }
.pname.me :deep(a) { color: var(--accent); font-weight: 700; }
.pname.ally :deep(a), .ally { color: var(--pos); }
.pname.vacation :deep(a) { color: var(--info); }
.pname.inactive :deep(a) { color: var(--faint); }
</style>

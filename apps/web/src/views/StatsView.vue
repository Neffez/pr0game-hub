<script setup lang="ts">
import Hint from '../components/Hint.vue';
import PlayerLink from '../components/PlayerLink.vue';
import StatusBadges from '../components/StatusBadges.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import { useStored, useUni } from '../composables';
import { dateTime, fmt, fmtSigned, short, STATS_CATEGORIES } from '../format';

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

const { uni } = useUni();
const who = useStored<'player' | 'alliance'>('stats.who', 'player');
const type = useStored('stats.type', 1);
const data = ref<Stats | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    data.value = await uniApi(uni.value, `/stats?who=${who.value}&type=${type.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch([who, type], load);

// ------------------------------------------------------------ sync overview
const categoryOf = (t: number) => data.value?.categories.find((c) => c.who === who.value && c.type === t) ?? null;
/** Pages of 100 ranks to show per category: up to the highest page synced in any category. */
const pageCount = computed(() => Math.max(1, ...(data.value?.categories ?? []).filter((c) => c.who === who.value).flatMap((c) => c.pages.map((p) => p + 1))));
const pageTitle = (t: number, p: number) => {
  const c = categoryOf(t);
  const range = `Plätze ${p * 100 + 1}–${p * 100 + 100}`;
  return c?.pages.includes(p) ? `${range}: im Stand vom ${dateTime(c.stat_time)}` : `${range}: nicht im neuesten Stand – Seite im Spiel einfügen`;
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

const SCORE_COLS = [
  { t: 4, label: 'Geb.', title: 'Gebäude' },
  { t: 3, label: 'Forsch.', title: 'Forschung' },
  { t: 2, label: 'Flotte', title: 'Flotte' },
  { t: 5, label: 'Vert.', title: 'Verteidigung' },
] as const;
</script>

<template>
  <h1>
    Statistik
    <Hint>
      <p>Der zuletzt synchronisierte Stand der Statistik aus dem Spiel – je Kategorie die neueste eingefügte Statistikseite, so wie das Spiel sie gezeigt hat. Mehrere Seiten desselben Stands (Plätze 1–100, 101–200 …) werden zusammengeführt.</p>
      <p><b>Leiste unter den Kategorien</b>: je Block 100 Plätze, grün = im neuesten Stand enthalten, rot = fehlt.</p>
      <p><b>±</b>: Auf- und Abstieg laut Spiel (seit der letzten Statistik-Aktualisierung im Spiel). Grau = selbst berechnet aus dem vorherigen synchronisierten Stand, wenn das Spiel keinen Wert liefert (Text-Einfügen). <b>Δ</b>: Punkte seit dem vorherigen synchronisierten Stand.</p>
      <p><b>Geb./Forsch./Flotte/Vert.</b>: jeweils neuester synchronisierter Stand der Kategorie, <b>F+V</b> = Flotte + Verteidigung. Farbe wie im FF-Hub: je näher am eigenen Wert (oder darüber), desto kräftiger.</p>
      <p><b>Koords</b>: zuerst bekannter Planet des Spielers, dahinter die Anzahl weiterer bekannter Planeten. Status und Allianz sind der aktuelle Stand im Hub.</p>
    </Hint>
  </h1>

  <div class="card">
    <div class="row">
      <div class="seg">
        <button :class="{ active: who === 'player' }" @click="who = 'player'">Spieler</button>
        <button :class="{ active: who === 'alliance' }" @click="who = 'alliance'">Allianzen</button>
      </div>
      <span class="grow" />
      <span v-if="data?.statTime" class="muted small">
        Stand {{ dateTime(data.statTime) }} · {{ data.rows.length }} Plätze
        <template v-if="data.prevTime"> · Δ seit {{ dateTime(data.prevTime) }}</template>
      </span>
    </div>
    <div class="cats">
      <button
        v-for="(label, t) in STATS_CATEGORIES"
        :key="t"
        class="cat"
        :class="{ active: type === Number(t), empty: data && !categoryOf(Number(t)) }"
        :title="categoryOf(Number(t)) ? `Stand ${dateTime(categoryOf(Number(t))!.stat_time)}` : 'noch nicht synchronisiert'"
        @click="type = Number(t)"
      >
        <span>{{ label }}</span>
        <span class="pages">
          <i v-for="p in pageCount" :key="p" :class="{ ok: categoryOf(Number(t))?.pages.includes(p - 1) }" :title="pageTitle(Number(t), p - 1)" />
        </span>
      </button>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <p v-else-if="data && !data.rows.length" class="muted">
    Für {{ who === 'player' ? 'Spieler' : 'Allianzen' }} · {{ STATS_CATEGORIES[type] }} wurde noch keine Statistik synchronisiert.
  </p>

  <div v-else-if="data" class="table-wrap">
    <table v-if="who === 'player'" class="data stats">
      <thead>
        <tr>
          <th class="num">Platz</th>
          <th class="num" title="Auf-/Abstieg">±</th>
          <th>Spieler</th>
          <th>Allianz</th>
          <th class="num">{{ STATS_CATEGORIES[type] }}</th>
          <th class="num" title="Punkte seit dem vorherigen synchronisierten Stand">Δ</th>
          <th>Koords</th>
          <th v-for="c in SCORE_COLS" :key="c.t" class="num" :class="{ cur: type === c.t }" :title="c.title">{{ c.label }}</th>
          <th class="num" title="Flotte + Verteidigung">F+V</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in data.rows" :key="r.id" :class="{ mine: data.me?.id === r.id }">
          <td class="num">{{ fmt(r.rank) }}</td>
          <td class="num small">
            <template v-for="m in [rankMove(r)]" :key="0">
              <span v-if="m" :class="[m.n > 0 ? 'pos' : 'neg', { calc: !m.game }]" :title="m.game ? 'laut Spiel' : `seit dem vorherigen Stand (Platz ${r.prev_rank})`">
                {{ m.n > 0 ? '▲' : '▼' }}{{ Math.abs(m.n) }}
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
          <td class="num strong" :style="pointsStyle(r)" :title="fmt(r.points)">{{ fmt(r.points) }}</td>
          <td class="num small" :class="r.delta ? (r.delta > 0 ? 'pos' : 'neg') : 'faint'">{{ r.delta == null ? '' : r.delta ? fmtSigned(r.delta) : '±0' }}</td>
          <td class="mono small">
            <template v-if="r.first_planet">{{ r.first_planet }}<span v-if="(r.planet_count ?? 0) > 1" class="faint"> +{{ r.planet_count! - 1 }}</span></template>
            <span v-else class="faint">–</span>
          </td>
          <td
            v-for="c in SCORE_COLS"
            :key="c.t"
            class="num"
            :class="{ cur: type === c.t }"
            :style="tone(r.scores?.[c.t], mine[c.t], COLORS[c.t])"
            :title="r.scores?.[c.t] != null ? fmt(r.scores[c.t]) : 'nicht synchronisiert'"
          >
            {{ r.scores?.[c.t] != null ? short(r.scores[c.t]) : '' }}
          </td>
          <td class="num" :style="tone(fleetDef(r.scores), fleetDef(mine), COLORS.fd)" :title="fleetDef(r.scores) != null ? fmt(fleetDef(r.scores)) : ''">
            {{ fleetDef(r.scores) != null ? short(fleetDef(r.scores)) : '' }}
          </td>
        </tr>
      </tbody>
    </table>

    <table v-else class="data stats">
      <thead>
        <tr>
          <th class="num">Platz</th>
          <th class="num" title="Auf-/Abstieg">±</th>
          <th>Allianz</th>
          <th class="num">Mitglieder</th>
          <th class="num">{{ STATS_CATEGORIES[type] }}</th>
          <th class="num">pro Mitglied</th>
          <th class="num" title="Punkte seit dem vorherigen synchronisierten Stand">Δ</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in data.rows" :key="r.id" :class="{ mine: r.own }">
          <td class="num">{{ fmt(r.rank) }}</td>
          <td class="num small">
            <template v-for="m in [rankMove(r)]" :key="0">
              <span v-if="m" :class="[m.n > 0 ? 'pos' : 'neg', { calc: !m.game }]">{{ m.n > 0 ? '▲' : '▼' }}{{ Math.abs(m.n) }}</span>
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
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: transparent; margin: 0; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button.active { background: var(--accent-soft); color: var(--accent); }

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

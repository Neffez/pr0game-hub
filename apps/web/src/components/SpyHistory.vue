<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile, useUni } from '../composables';
import ActionMenu, { type MenuItem } from './ActionMenu.vue';
import { battleSimLink, fmt, fmtSigned, ipmCalcLink, ipmStart, name, SECTIONS, simLinks, timeWithAge, type Coords3 } from '../format';

export interface SpyReport {
  id: number;
  report_time: number;
  sections: Record<string, Record<string, number>>;
  reporter?: string | null;
  player_name?: string;
  destroy_chance?: number | null;
}

const props = defineProps<{
  reports: SpyReport[];
  gameUrl?: string;
  /** the spied target, for the IPM calculator link */
  target?: Coords3 | null;
  moon?: boolean;
  /** a moon is defended by the interceptors of its planet: newest report of the planet (undefined while unknown) */
  planetReport?: SpyReport | null;
}>();
const { t } = useI18n();
const { ctx } = useUni();
const mobile = useMobile();

/**
 * Per section: rows (newest first) with values and the change against the previous
 * report that had this section visible. Rows without any change are dropped
 * except the newest (like FF-Hub's history view).
 */
const tables = computed(() =>
  SECTIONS.map(({ cls, label }) => {
    const withSection = props.reports.filter((r) => r.sections[cls]);
    const ids = new Set<string>();
    for (const r of withSection) for (const id of Object.keys(r.sections[cls])) ids.add(id);
    const columns = [...ids].sort((a, b) => Number(a) - Number(b));
    const rows = withSection.map((r, i) => {
      const prev = withSection[i + 1];
      const values = columns.map((id) => {
        const v = r.sections[cls][id] ?? 0;
        const before = prev ? (prev.sections[cls][id] ?? 0) : null;
        return { v, diff: before == null ? null : v - before };
      });
      return { report: r, values, changed: !prev || values.some((x) => x.diff) };
    });
    return { cls, label, columns, rows: rows.filter((r, i) => i === 0 || r.changed) };
  }).filter((t) => t.rows.length),
);

/** Combat simulators with all values of the newest report: the battle simulator (pr0game-tools), the one in the game and TrashSim. */
const values = (r: SpyReport): Record<string, number> => Object.assign({}, ...Object.values(r.sections));
const simMenu = computed<MenuItem[]>(() => {
  const r = props.reports[0];
  if (!r) return [];
  const game = props.gameUrl ? simLinks(props.gameUrl, values(r)) : null;
  const u = ctx.value?.universe.settings;
  return [
    u && { label: t('spyHistory.simTools'), href: battleSimLink(u, values(r), [], props.target ?? null) },
    game && { label: t('spyHistory.simulator'), href: game.game },
    game && { label: 'TrashSim', href: game.trash },
  ].filter(Boolean) as MenuItem[];
});

/** IPM calculator with the newest report: defense, interceptors (of the planet for a moon) and armour, own research. */
const ipm = computed(() => {
  if (!props.target || !ctx.value) return null;
  const u = ctx.value.universe.settings;
  const planet = props.planetReport;
  const start = ipmStart(u, ctx.value.own?.planets, props.target);
  return {
    href: ipmCalcLink(u, {
      from: start?.c ?? null,
      silo: start?.silo,
      missiles: start?.ipm,
      to: props.target,
      moon: props.moon,
      research: ctx.value.own?.research,
      values: values(props.reports[0]),
      planetInterceptors: planet ? (planet.sections['400']?.[502] ?? 0) : null,
    }),
    title: !props.moon
      ? t('spyHistory.ipmTitle')
      : t('spyHistory.ipmMoonTitle', { planet: planet ? timeWithAge(planet.report_time) : t('spyHistory.ipmMoonNoPlanet') }),
  };
});
</script>

<template>
  <div v-if="!reports.length" class="muted">{{ t('spyHistory.none') }}</div>
  <template v-else>
    <p class="small muted">
      {{ t('spyHistory.latest', { time: timeWithAge(reports[0].report_time) }) }}
      <template v-if="reports[0].reporter"> {{ t('common.from') }} {{ reports[0].reporter }}</template>
      <template v-if="simMenu.length">
        · <ActionMenu :items="simMenu" :label="t('spyHistory.simulate')" icon="chevronDown" :title="t('spyHistory.simulateTitle')" />
      </template>
      <template v-if="ipm"> · <a :href="ipm.href" :title="ipm.title" target="_blank" rel="noopener">{{ t('spyHistory.ipm') }}</a></template>
    </p>
    <!-- mobile: per section one block per report, values as name/value list -->
    <template v-if="mobile">
      <div v-for="tbl in tables" :key="tbl.cls" class="card sh-card">
        <h3>{{ tbl.label }}</h3>
        <div v-for="(row, ri) in tbl.rows" :key="row.report.id" class="sh-report" :class="{ older: ri > 0 }">
          <div class="small muted"><span class="mono">{{ timeWithAge(row.report.report_time) }}</span><template v-if="row.report.reporter"> · {{ row.report.reporter }}</template></div>
          <div class="sh-grid small">
            <template v-for="(x, i) in row.values" :key="i">
              <div v-if="x.v || x.diff" :title="name(tbl.columns[i])">
                <span class="sh-name">{{ name(tbl.columns[i]) }}</span>
                <span class="mono">
                  {{ fmt(x.v) }}
                  <span v-if="x.diff" :class="x.diff > 0 ? 'pos' : 'neg'">{{ fmtSigned(x.diff) }}</span>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
    <div v-for="tbl in mobile ? [] : tables" :key="tbl.cls" class="table-wrap" style="margin-bottom: 10px; max-height: none">
      <table class="data">
        <thead>
          <tr>
            <th>{{ tbl.label }}</th>
            <th>{{ t('common.from') }}</th>
            <th v-for="id in tbl.columns" :key="id" class="num" :title="name(id)">{{ name(id) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tbl.rows" :key="row.report.id">
            <td class="small mono">{{ timeWithAge(row.report.report_time) }}</td>
            <td class="small muted">{{ row.report.reporter ?? '–' }}</td>
            <td v-for="(x, i) in row.values" :key="i" class="num" :class="{ faint: !x.v }">
              {{ fmt(x.v) }}
              <div v-if="x.diff" class="small" :class="x.diff > 0 ? 'pos' : 'neg'">{{ fmtSigned(x.diff) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.sh-card { padding: 10px 12px; margin-bottom: 10px; }
.sh-card h3 { margin: 0 0 6px; }
.sh-report + .sh-report { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.sh-report.older { opacity: .8; }
.sh-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 14px; margin-top: 4px; }
.sh-grid > div { display: flex; justify-content: space-between; gap: 6px; min-width: 0; }
.sh-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.sh-grid .mono { white-space: nowrap; text-align: right; }
</style>

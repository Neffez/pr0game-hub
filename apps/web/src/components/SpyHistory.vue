<script setup lang="ts">
import { computed } from 'vue';
import type { Schema } from '../apiTypes';
import { useI18n } from 'vue-i18n';
import { useMobile, useUni } from '../composables';
import ActionMenu, { type MenuItem } from './ActionMenu.vue';
import Hint from './Hint.vue';
import { mergeFleetSaves } from '@pr0hub/core/production';
import {
  battleSimLink, clockTime, distance, duration, flightCalcLink, fmt, fmtSigned, ipmCalcLink, ipmStart, name, SECTIONS, simLinks, timeWithAge, type Coords3, type SimFleet,
  type UniverseSettings,
} from '../format';

/** A spy report as the history shows it (`GET /spy/{g}/{s}/{p}`; other lists pass their rows with the same fields). */
export type SpyReport = Pick<Schema<'SpyHistoryReport'>, 'id' | 'report_time' | 'sections'> & Partial<Schema<'SpyHistoryReport'>>;

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

/**
 * The viewer as the attacker of the battle simulator, without ships: own research (empire page) and the nearest own
 * planet as start.
 */
const ownAttacker = (u: UniverseSettings): SimFleet | null => {
  const own = ctx.value?.own;
  if (!own) return null;
  let from: { c: Coords3; d: number } | null = null;
  for (const pl of own.planets) {
    const c: Coords3 = [pl.coords.g, pl.coords.s, pl.coords.p];
    const d = props.target ? distance(u, c, props.target) : 0;
    if (!from || d < from.d) from = { c, d };
  }
  const me = ctx.value!.members.find((m) => m.id === ctx.value!.me.id);
  return { ships: {}, research: own.research, from: from?.c ?? null, name: me?.name ?? null };
};

/** Combat simulators with all values of the newest report: the battle simulator (pr0game-tools), the one in the game and TrashSim. */
const values = (r: SpyReport): Record<string, number> => Object.assign({}, ...Object.values(r.sections));
const simMenu = computed<MenuItem[]>(() => {
  const r = props.reports[0];
  if (!r) return [];
  const game = props.gameUrl ? simLinks(props.gameUrl, values(r)) : null;
  const u = ctx.value?.universe.settings;
  const attacker = u && ownAttacker(u);
  return [
    u && { label: t('spyHistory.simTools'), href: battleSimLink(u, values(r), attacker ? [attacker] : [], props.target ?? null, [], r.player_name ?? null) },
    game && { label: t('spyHistory.simulator'), href: game.game },
    game && { label: 'TrashSim', href: game.trash },
  ].filter(Boolean) as MenuItem[];
});

/**
 * Fleet save traces: reports whose metal and crystal both point to the same second as the last time the planet was
 * emptied (server `fleetSave`), newest first. Reports taken during the same save narrow its departure to what all of
 * them allow (`mergeFleetSaves`). Each links to the flight calculator with the planet as start, the departure and the
 * player's drives, to work out when the saved fleet is back.
 */
const FLEET_SAVES_SHOWN = 5;
type Saved = SpyReport & { fleetSave: NonNullable<SpyReport['fleetSave']> };
const fleetSaves = computed(() => {
  if (props.moon || !props.target || !ctx.value) return [];
  const u = ctx.value.universe.settings;
  const research = props.reports.find((r) => r.sections['100'])?.sections['100'] ?? {};
  const saved = props.reports
    .filter((r): r is Saved => !!r.fleetSave)
    .map((r) => ({ key: 'planet', from: r.fleetSave.from, to: r.fleetSave.to, report: r }));
  return mergeFleetSaves(saved)
    .slice(0, FLEET_SAVES_SHOWN)
    .map((m) => {
      // the newest report of the save shows its details
      const report = m.items[0].report;
      return {
        report,
        save: report.fleetSave,
        from: m.from,
        to: m.to,
        count: m.items.length,
        deuterium: m.items.find((i) => i.report.fleetSave.deuterium != null)?.report.fleetSave.deuterium ?? null,
        href: flightCalcLink(u, props.target!, null, research, { m: 'flight', dep: m.from, mis: 'none' }),
      };
    });
});
const clock = (epoch: number) => clockTime(new Date(epoch * 1000), true);
const saveTitle = (s: NonNullable<SpyReport['fleetSave']>) =>
  [
    t('spyHistory.fleetSavePerHour', { m: fmt(s.perHour[901]), k: fmt(s.perHour[902]), d: fmt(s.perHour[903]) }),
    t('spyHistory.fleetSaveSources', { buildings: timeWithAge(s.buildingsTime) }),
    s.researchTime ? t('spyHistory.fleetSaveResearch', { time: timeWithAge(s.researchTime) }) : t('spyHistory.fleetSaveNoResearch'),
  ].join('\n');

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
    <div v-if="fleetSaves.length" class="card fs-card" data-tour="spy-fleetsave">
      <h3>{{ t('spyHistory.fleetSave') }} <Hint>{{ t('spyHistory.fleetSaveHint') }}</Hint></h3>
      <div v-for="x in fleetSaves" :key="x.report.id" class="fs-row small" :title="saveTitle(x.save)">
        <span v-if="x.to > x.from">
          {{ t('spyHistory.fleetSaveBetween') }} <strong class="mono">{{ timeWithAge(x.from) }}</strong>
          {{ t('spyHistory.fleetSaveAnd', { time: clock(x.to) }) }}
        </span>
        <span v-else>{{ t('spyHistory.fleetSaveAt') }} <strong class="mono">{{ timeWithAge(x.from) }}</strong></span>
        <span class="muted">{{ t('spyHistory.fleetSaveBefore', { d: duration(x.report.report_time - x.to), time: timeWithAge(x.report.report_time) }) }}</span>
        <span v-if="x.count > 1" class="muted">{{ t('spyHistory.fleetSaveReports', { n: x.count }) }}</span>
        <span :class="x.deuterium ? 'pos' : 'muted'">
          {{ x.deuterium === true ? t('spyHistory.fleetSaveDeut') : x.deuterium === false ? t('spyHistory.fleetSaveDeutUsed') : '' }}
        </span>
        <span v-if="x.save.researchTime == null" class="warn">{{ t('spyHistory.fleetSaveNoResearchShort') }}</span>
        <a :href="x.href" target="_blank" rel="noopener">{{ t('spyHistory.fleetSaveCalc') }}</a>
      </div>
    </div>
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
.fs-card { padding: 10px 12px; margin-bottom: 10px; }
.fs-card h3 { margin: 0 0 6px; }
.fs-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; padding: 3px 0; }
.fs-row + .fs-row { border-top: 1px dashed var(--border); }
.sh-card { padding: 10px 12px; margin-bottom: 10px; }
.sh-card h3 { margin: 0 0 6px; }
.sh-report + .sh-report { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.sh-report.older { opacity: .8; }
.sh-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 14px; margin-top: 4px; }
.sh-grid > div { display: flex; justify-content: space-between; gap: 6px; min-width: 0; }
.sh-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.sh-grid .mono { white-space: nowrap; text-align: right; }
</style>

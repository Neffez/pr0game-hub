<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { fmt, fmtSigned, name, SECTIONS, timeWithAge } from '../format';

export interface SpyReport {
  id: number;
  report_time: number;
  sections: Record<string, Record<string, number>>;
  reporter?: string | null;
  player_name?: string;
  destroy_chance?: number | null;
}

const props = defineProps<{ reports: SpyReport[]; gameUrl?: string }>();
const { t } = useI18n();

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

/** Combat simulator link (game simulator, `im[ID]=amount`). */
function simLink(r: SpyReport) {
  const params = Object.values(r.sections)
    .flatMap((sec) => Object.entries(sec))
    .map(([id, v]) => `im[${id}]=${v}`)
    .join('&');
  return `${props.gameUrl!.replace(/\/?$/, '/')}game.php?page=battleSimulator&${params}`;
}
</script>

<template>
  <div v-if="!reports.length" class="muted">{{ t('spyHistory.none') }}</div>
  <template v-else>
    <p class="small muted">
      {{ t('spyHistory.latest', { time: timeWithAge(reports[0].report_time) }) }}
      <template v-if="reports[0].reporter"> {{ t('common.from') }} {{ reports[0].reporter }}</template>
      <template v-if="gameUrl"> · <a :href="simLink(reports[0])" target="_blank" rel="noopener">{{ t('spyHistory.simulator') }}</a></template>
    </p>
    <div v-for="tbl in tables" :key="tbl.cls" class="table-wrap" style="margin-bottom: 10px; max-height: none">
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

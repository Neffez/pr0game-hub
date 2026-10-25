<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useLimit } from '../composables';
import { dateTime, fmt } from '../format';
import ShowMore from './ShowMore.vue';

/** Operating figures of the hub for global admins (server: monitor.ts, `GET /api/admin/system`). */
const { t } = useI18n();
const sys = ref<any>(null);
const loading = ref(false);
const error = ref('');
const msg = ref('');

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    sys.value = await api('/admin/system');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const vacuum = async () => {
  if (!confirm(t('admin.system.vacuumConfirm'))) return;
  loading.value = true;
  msg.value = error.value = '';
  try {
    const res = await api('/admin/system/vacuum', { body: {} });
    msg.value = t('admin.system.vacuumDone', { before: bytes(res.before), after: bytes(res.after), sec: (res.ms / 1000).toFixed(1) });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    loading.value = false;
  }
};

const MB = 1024 * 1024;
function bytes(n: number | null | undefined) {
  if (n == null) return '–';
  if (n >= 1024 * MB) return `${fmt(n / 1024 / MB, 2)} GB`;
  if (n >= MB) return `${fmt(n / MB, 1)} MB`;
  return `${fmt(n / 1024, 0)} KB`;
}
const uptime = (sec: number) => t('admin.system.uptime', { d: Math.floor(sec / 86400), h: Math.floor((sec % 86400) / 3600) });
const pct = (part: number, whole: number | null | undefined) => (whole ? Math.round((part / whole) * 100) : null);

const db = computed(() => sys.value?.database);
const mem = computed(() => sys.value?.memory);
/** the container's memory limit (null without one); its own figure counts the file cache too, so RSS is shown */
const memLimit = computed(() => mem.value?.container.limit ?? null);
const memUsed = computed(() => mem.value?.rss ?? 0);

/** Growth of the database per day from the hourly samples (first and last of the period). */
function growth(days: number) {
  const samples: any[] = sys.value?.samples ?? [];
  const from = samples.find((s) => s.time >= sys.value.time - days * 86400);
  const to = samples.at(-1);
  if (!from || !to || to.time - from.time < 86400 / 2) return null;
  // used pages only: freed pages are taken again before the file grows
  const used = (s: any) => s.db_bytes - s.free_bytes;
  return ((used(to) - used(from)) / (to.time - from.time)) * 86400;
}
const growthWeek = computed(() => growth(7));
const growthMonth = computed(() => growth(30));

const warnings = computed(() => {
  if (!sys.value) return [];
  const out: string[] = [];
  const d = db.value;
  if (d.freeBytes > 50 * MB && d.freeBytes > d.bytes * 0.2) out.push(t('admin.system.warnFree', { free: bytes(d.freeBytes) }));
  if (d.walBytes > 128 * MB) out.push(t('admin.system.warnWal', { wal: bytes(d.walBytes) }));
  const used = pct(memUsed.value, memLimit.value);
  if (used != null && used >= 80) out.push(t('admin.system.warnMemory', { pct: used, limit: bytes(memLimit.value) }));
  const disk = sys.value.disk;
  if (disk && disk.free < d.bytes * 2) out.push(t('admin.system.warnDisk', { free: bytes(disk.free) }));
  const loop = sys.value.eventLoop;
  if (loop && loop.p99 >= 200) out.push(t('admin.system.warnLoop', { ms: fmt(loop.p99) }));
  return out;
});

/** Sparkline of the hourly samples (90 days): database size (used) and memory. */
const W = 600;
const H = 60;
function line(values: number[]) {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - min) / span) * (H - 8)).toFixed(1)}`).join(' ');
}
const dbLine = computed(() => line((sys.value?.samples ?? []).map((s: any) => s.db_bytes - s.free_bytes)));
const memLine = computed(() => line((sys.value?.samples ?? []).map((s: any) => s.rss)));

const tables = computed<any[]>(() => db.value?.tables ?? []);
const tableLimit = useLimit(tables, 12);
const requests = computed<any[]>(() => sys.value?.requests ?? []);
const requestLimit = useLimit(requests, 15);
</script>

<template>
  <div class="system">
    <div class="row">
      <span v-if="sys" class="muted small">{{
        t('admin.system.asOf', { time: dateTime(sys.time), uptime: uptime(sys.time - sys.startedAt), node: sys.node })
      }}</span>
      <span class="grow" />
      <button :disabled="loading" @click="load">{{ t('admin.system.refresh') }}</button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>
    <template v-if="sys">
      <ul v-if="warnings.length" class="warnings">
        <li v-for="w in warnings" :key="w" class="warn small">{{ w }}</li>
      </ul>

      <div class="tiles">
        <div class="tile">
          <div class="label">{{ t('admin.system.database') }}</div>
          <div class="value">{{ bytes(db.bytes) }}</div>
          <div class="sub">{{ t('admin.system.databaseSub', { free: bytes(db.freeBytes), wal: bytes(db.walBytes) }) }}</div>
        </div>
        <div class="tile">
          <div class="label">{{ t('admin.system.growth') }}</div>
          <div class="value">{{ growthWeek != null ? `${bytes(growthWeek)} / ${t('admin.system.day')}` : '–' }}</div>
          <div class="sub">{{
            growthMonth != null ? t('admin.system.growthSub', { month: bytes(growthMonth * 30) }) : t('admin.system.growthPending')
          }}</div>
        </div>
        <div class="tile">
          <div class="label">{{ t('admin.system.disk') }}</div>
          <div class="value">{{ sys.disk ? bytes(sys.disk.free) : '–' }}</div>
          <div class="sub">{{
            sys.disk ? t('admin.system.diskSub', { total: bytes(sys.disk.total), pct: pct(sys.disk.total - sys.disk.free, sys.disk.total) }) : ''
          }}</div>
        </div>
        <div class="tile">
          <div class="label">{{ t('admin.system.memory') }}</div>
          <div class="value">{{ bytes(memUsed) }}<span v-if="memLimit" class="of"> / {{ bytes(memLimit) }}</span></div>
          <div v-if="memLimit" class="bar"><span :style="{ width: `${Math.min(100, pct(memUsed, memLimit) ?? 0)}%` }" /></div>
          <div class="sub">{{ t('admin.system.memorySub', { heap: bytes(mem.heapUsed), limit: bytes(mem.heapLimit) }) }}</div>
        </div>
        <div class="tile">
          <div class="label">{{ t('admin.system.eventLoop') }}</div>
          <div class="value">{{ sys.eventLoop ? `${fmt(sys.eventLoop.p99, 1)} ms` : '–' }}</div>
          <div class="sub">{{ sys.eventLoop ? t('admin.system.eventLoopSub', { p50: fmt(sys.eventLoop.p50, 1), max: fmt(sys.eventLoop.max) }) : '' }}</div>
        </div>
        <div class="tile">
          <div class="label">{{ t('admin.system.users') }}</div>
          <div class="value">{{ sys.usage.online }} <span class="of">{{ t('admin.system.online') }}</span></div>
          <div class="sub">{{
            t('admin.system.usersSub', { day: sys.usage.activeDay, week: sys.usage.activeWeek, total: sys.usage.users, connections: sys.usage.connections })
          }}</div>
        </div>
      </div>

      <template v-if="dbLine">
        <h3>{{ t('admin.system.history') }}</h3>
        <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="t('admin.system.history')">
          <polyline :points="memLine" class="mem" />
          <polyline :points="dbLine" class="db" />
        </svg>
        <div class="legend small muted">
          <span><i class="db" /> {{ t('admin.system.historyDb') }}</span>
          <span><i class="mem" /> {{ t('admin.system.historyMem') }}</span>
          <span>{{ dateTime(sys.samples[0].time) }} – {{ dateTime(sys.samples.at(-1).time) }}</span>
        </div>
      </template>

      <h3>{{ t('admin.system.tables') }}</h3>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('admin.system.table') }}</th>
              <th class="num">{{ t('admin.system.rows') }}</th>
              <th class="num">{{ t('admin.system.data') }}</th>
              <th class="num">{{ t('admin.system.indexes') }}</th>
              <th class="num">%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tb in tableLimit.shown.value" :key="tb.name">
              <td>{{ tb.name }}</td>
              <td class="num">{{ fmt(tb.rows) }}</td>
              <td class="num">{{ bytes(tb.bytes) }}</td>
              <td class="num">{{ bytes(tb.indexBytes) }}</td>
              <td class="num">{{ pct(tb.bytes + tb.indexBytes, db.bytes - db.freeBytes) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ShowMore :limit="tableLimit" />
      <p class="muted small">{{
        t('admin.system.retention', { days: db.rawRetentionDays })
      }}<template v-if="db.backups"> {{ t('admin.system.backups', { n: db.backups.count, size: bytes(db.backups.bytes) }) }}</template></p>
      <div class="row">
        <button :disabled="loading || !db.freeBytes" @click="vacuum">{{ t('admin.system.vacuum') }}</button>
        <span class="muted small">{{ t('admin.system.vacuumHint', { free: bytes(db.freeBytes) }) }}</span>
      </div>

      <h3>{{ t('admin.system.syncs') }}</h3>
      <p v-if="!sys.usage.days.length" class="muted small">{{ t('admin.system.syncsNone') }}</p>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('admin.system.dayCol') }}</th>
              <th class="num">{{ t('admin.system.syncCount') }}</th>
              <th class="num">{{ t('admin.system.syncUsers') }}</th>
              <th class="num">{{ t('admin.system.syncBytes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in sys.usage.days" :key="d.day">
              <td>{{ d.day }}</td>
              <td class="num">{{ fmt(d.syncs) }}</td>
              <td class="num">{{ fmt(d.users) }}</td>
              <td class="num">{{ bytes(d.bytes) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>{{ t('admin.system.groups') }}</h3>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('admin.system.group') }}</th>
              <th class="num">{{ t('admin.system.members') }}</th>
              <th class="num">{{ t('admin.system.syncCount') }}</th>
              <th class="num">{{ t('admin.system.raw') }}</th>
              <th class="num">{{ t('admin.system.statSnapshots') }}</th>
              <th class="num">{{ t('admin.system.players') }}</th>
              <th class="num">{{ t('admin.system.spyReports') }}</th>
              <th class="num">{{ t('admin.system.combatReports') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in sys.usage.groups" :key="g.id">
              <td>{{ g.universe }} · {{ g.name }}</td>
              <td class="num">{{ fmt(g.members) }}</td>
              <td class="num">{{ fmt(g.syncs) }}</td>
              <td class="num">{{ bytes(g.raw_bytes) }}</td>
              <td class="num">{{ fmt(g.stat_snapshots) }}</td>
              <td class="num">{{ fmt(g.players) }}</td>
              <td class="num">{{ fmt(g.spy_reports) }}</td>
              <td class="num">{{ fmt(g.combat_reports) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>{{ t('admin.system.requests') }}</h3>
      <p class="muted small">{{ t('admin.system.requestsHint') }}</p>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('admin.system.route') }}</th>
              <th class="num">{{ t('admin.system.count') }}</th>
              <th class="num">Ø ms</th>
              <th class="num">p50</th>
              <th class="num">p95</th>
              <th class="num">max</th>
              <th class="num">5xx</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in requestLimit.shown.value" :key="r.route">
              <td class="route">{{ r.route }}</td>
              <td class="num">{{ fmt(r.count) }}</td>
              <td class="num">{{ fmt(r.avg, 1) }}</td>
              <td class="num">{{ fmt(r.p50, 1) }}</td>
              <td class="num" :class="{ warn: r.p95 >= 1000 }">{{ fmt(r.p95, 1) }}</td>
              <td class="num" :class="{ warn: r.max >= 1000 }">{{ fmt(r.max) }}</td>
              <td class="num" :class="{ warn: r.errors }">{{ r.errors || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ShowMore :limit="requestLimit" />

      <template v-if="sys.slow.length">
        <h3>{{ t('admin.system.slow') }}</h3>
        <div class="table-wrap">
          <table class="data">
            <tbody>
              <tr v-for="(s, i) in sys.slow" :key="i">
                <td class="small">{{ dateTime(s.time) }}</td>
                <td class="route">{{ s.route }}</td>
                <td class="num warn">{{ fmt(s.ms) }} ms</td>
                <td class="num">{{ s.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.warnings { margin: 8px 0; padding-left: 18px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin: 10px 0; }
.tile { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; min-width: 0; }
.tile .label { color: var(--muted); font-size: 12px; }
.tile .value { font-family: var(--mono); font-size: 18px; font-weight: 600; margin: 2px 0; }
.tile .of { color: var(--muted); font-size: 12px; font-weight: 400; }
.tile .sub { color: var(--muted); font-size: 11px; }
.bar { height: 4px; background: var(--border); border-radius: 2px; margin: 4px 0; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.spark { width: 100%; height: 60px; display: block; background: var(--surface-2); border-radius: 6px; }
.spark polyline { fill: none; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.spark .db, .legend i.db { stroke: var(--info); background: var(--info); }
.spark .mem, .legend i.mem { stroke: var(--warn); background: var(--warn); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0 10px; }
.legend i { display: inline-block; width: 10px; height: 3px; vertical-align: middle; }
td.route { font-family: var(--mono); font-size: 12px; white-space: normal; overflow-wrap: anywhere; min-width: 170px; }
</style>

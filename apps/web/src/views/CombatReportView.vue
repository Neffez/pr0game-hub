<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, dateTime, fmt, name, short } from '../format';

/** Locally archived battle report: participants, fleets before/after, outcome. */
interface Report {
  report_id: string;
  time: number | null;
  winner: 'attacker' | 'defender' | 'draw';
  rounds: number;
  lost_attacker: number;
  lost_defender: number;
  debris_metal: number;
  debris_crystal: number;
  units: number | null;
  fleets: { side: 'attacker' | 'defender'; name: string; ships: { id: number; before: number; after: number }[] }[];
}

const route = useRoute();
const { uni, ctx } = useUni();
const report = ref<Report | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    report.value = await uniApi(uni.value, `/combat-reports/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const sides = computed(() =>
  (['attacker', 'defender'] as const).map((side) => ({
    side,
    label: side === 'attacker' ? 'Angreifer' : 'Verteidiger',
    won: report.value?.winner === side,
    lost: side === 'attacker' ? report.value?.lost_attacker : report.value?.lost_defender,
    fleets: report.value?.fleets.filter((f) => f.side === side) ?? [],
  })),
);
const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
</script>

<template>
  <p><RouterLink :to="`/${uni}/battle-hall`">← Battle Hall</RouterLink></p>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="report">
    <h1>
      Kampfbericht
      <span class="muted small" style="font-weight: 400">
        {{ dateTime(report.time) }} · {{ report.rounds }} Runde{{ report.rounds === 1 ? '' : 'n' }}
        <template v-if="report.units"> · {{ short(report.units) }} Units</template>
      </span>
    </h1>
    <div class="card row">
      <b :class="{ pos: report.winner === 'attacker', neg: report.winner === 'defender' }">
        {{ report.winner === 'attacker' ? 'Der Angreifer hat gewonnen' : report.winner === 'defender' ? 'Der Verteidiger hat gewonnen' : 'Unentschieden' }}
      </b>
      <span>Trümmerfeld: Metall {{ fmt(report.debris_metal) }} · Kristall {{ fmt(report.debris_crystal) }}</span>
      <span class="grow" />
      <a v-if="gameUrl" class="small" :href="`${gameUrl}game.php?page=raport&raport=${report.report_id}`" target="_blank" rel="noopener">im Spiel öffnen</a>
    </div>

    <div v-for="s in sides" :key="s.side" class="card">
      <h3 style="margin-top: 0">
        <span :class="{ pos: s.won, neg: !s.won && report.winner !== 'draw' }">{{ s.label }}</span>
        <span class="muted small" style="font-weight: 400"> · verloren: {{ fmt(s.lost) }} Units</span>
      </h3>
      <div v-for="(f, i) in s.fleets" :key="i" class="fleet">
        <div><b>{{ f.name }}</b></div>
        <div v-if="!f.ships.length" class="muted small">keine Flotte</div>
        <table v-else class="data" style="width: auto">
          <thead>
            <tr><th /><th v-for="sh in f.ships" :key="sh.id" class="num" :title="name(sh.id)">{{ abbr(sh.id) }}</th></tr>
          </thead>
          <tbody>
            <tr><td class="muted small">vorher</td><td v-for="sh in f.ships" :key="sh.id" class="num">{{ fmt(sh.before) }}</td></tr>
            <tr><td class="muted small">übrig</td><td v-for="sh in f.ships" :key="sh.id" class="num" :class="{ neg: !sh.after }">{{ fmt(sh.after) }}</td></tr>
            <tr>
              <td class="muted small">verloren</td>
              <td v-for="sh in f.ships" :key="sh.id" class="num faint">{{ sh.before - sh.after ? fmt(sh.after - sh.before) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
.fleet + .fleet { margin-top: 14px; }
.fleet table { margin-top: 6px; }
</style>

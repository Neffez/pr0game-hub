<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, coords, dateTime, fmt, name, short } from '../format';

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
  loot_metal: number;
  loot_crystal: number;
  loot_deuterium: number;
  /** attacked planet or moon, null when the public page hid it */
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: 'planet' | 'moon' | null;
  units: number | null;
  fleets: { side: 'attacker' | 'defender'; name: string; ships: { id: number; before: number; after: number }[] }[];
}

const { t } = useI18n();
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
    label: side === 'attacker' ? t('combat.attacker') : t('combat.defender'),
    won: report.value?.winner === side,
    lost: side === 'attacker' ? report.value?.lost_attacker : report.value?.lost_defender,
    fleets: report.value?.fleets.filter((f) => f.side === side) ?? [],
  })),
);
const loot = computed(() => (report.value ? report.value.loot_metal + report.value.loot_crystal + report.value.loot_deuterium : 0));
const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
/** Reports pasted as text without a battle message have a local id the game does not know. */
const inGame = computed(() => /^[0-9a-f]{32}$/i.test(report.value?.report_id ?? ''));
</script>

<template>
  <p><RouterLink :to="`/${uni}/battle-hall`">← {{ t('nav.battleHall') }}</RouterLink></p>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="report">
    <h1>
      {{ t('combat.report') }}
      <span class="muted small" style="font-weight: 400">
        {{ dateTime(report.time) }} · {{ t('combat.rounds', report.rounds) }}
        <template v-if="report.units"> · {{ short(report.units) }} {{ t('combat.units') }}</template>
        <template v-if="report.g != null && report.s != null && report.p != null">
          · {{ coords(report.g, report.s, report.p) }}<template v-if="report.planet_type === 'moon'"> ({{ t('combat.moon') }})</template>
        </template>
      </span>
    </h1>
    <div class="card row">
      <b :class="{ pos: report.winner === 'attacker', neg: report.winner === 'defender' }">
        {{ report.winner === 'attacker' ? t('combat.attackerWon') : report.winner === 'defender' ? t('combat.defenderWon') : t('combat.draw') }}
      </b>
      <span v-if="loot">{{ t('combat.loot') }}: {{ name(901) }} {{ fmt(report.loot_metal) }} · {{ name(902) }} {{ fmt(report.loot_crystal) }} · {{ name(903) }} {{ fmt(report.loot_deuterium) }}</span>
      <span>{{ t('combat.debris') }}: {{ name(901) }} {{ fmt(report.debris_metal) }} · {{ name(902) }} {{ fmt(report.debris_crystal) }}</span>
      <span class="grow" />
      <a v-if="gameUrl && inGame" class="small" :href="`${gameUrl}game.php?page=raport&raport=${report.report_id}`" target="_blank" rel="noopener">{{ t('combat.openInGame') }}</a>
    </div>

    <div v-for="s in sides" :key="s.side" class="card">
      <h3 style="margin-top: 0">
        <span :class="{ pos: s.won, neg: !s.won && report.winner !== 'draw' }">{{ s.label }}</span>
        <span class="muted small" style="font-weight: 400"> · {{ t('combat.lostUnits', { n: fmt(s.lost) }) }}</span>
      </h3>
      <div v-for="(f, i) in s.fleets" :key="i" class="fleet">
        <div><b>{{ f.name }}</b></div>
        <div v-if="!f.ships.length" class="muted small">{{ t('combat.noFleet') }}</div>
        <div v-else class="scroll-x">
          <table class="data" style="width: auto">
            <thead>
              <tr><th /><th v-for="sh in f.ships" :key="sh.id" class="num" :title="name(sh.id)">{{ abbr(sh.id) }}</th></tr>
            </thead>
            <tbody>
              <tr><td class="muted small">{{ t('combat.before') }}</td><td v-for="sh in f.ships" :key="sh.id" class="num">{{ fmt(sh.before) }}</td></tr>
              <tr><td class="muted small">{{ t('combat.left') }}</td><td v-for="sh in f.ships" :key="sh.id" class="num" :class="{ neg: !sh.after }">{{ fmt(sh.after) }}</td></tr>
              <tr>
                <td class="muted small">{{ t('combat.lost') }}</td>
                <td v-for="sh in f.ships" :key="sh.id" class="num faint">{{ sh.before - sh.after ? fmt(sh.after - sh.before) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.fleet + .fleet { margin-top: 14px; }
.fleet table { margin-top: 6px; }
</style>

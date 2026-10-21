<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useStored, useUni } from '../composables';
import { ago, coords, dateTime } from '../format';

const { uni } = useUni();
const days = useStored('hostile.days', 7);
const data = ref<any>(null);

async function load() {
  const from = Math.floor(Date.now() / 1000) - days.value * 86400;
  data.value = await uniApi(uni.value, `/hostile?from=${from}`);
}
onMounted(load);
watch(days, load);
</script>

<template>
  <h1>Fremdspionage <Hint>Aus eingefügten „Spionage-Aktivität“-Nachrichten: wer wen wann spioniert hat.</Hint></h1>
  <div class="card row">
    <RangePicker v-model="days" />
  </div>
  <template v-if="data">
    <h2>Wer spioniert</h2>
    <div class="table-wrap" style="max-height: 40vh; margin-bottom: 14px">
      <table class="data">
        <thead><tr><th>Spieler</th><th class="num">Spionagen</th><th class="num">betroffene Mitglieder</th><th>zuletzt</th></tr></thead>
        <tbody>
          <tr v-for="s in data.bySpy" :key="s.from_player">
            <td>{{ s.from_player }}</td>
            <td class="num">{{ s.count }}</td>
            <td class="num">{{ s.victims }}</td>
            <td class="small">{{ ago(s.last) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>Verlauf</h2>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Zeit</th><th>Spion</th><th>von</th><th>Ziel</th><th>Mitglied</th></tr></thead>
        <tbody>
          <tr v-for="h in data.list" :key="h.id">
            <td class="small">{{ dateTime(h.time) }}</td>
            <td>{{ h.from_player }}</td>
            <td class="mono">{{ coords(h.from_g, h.from_s, h.from_p) }}{{ h.from_type === 'moon' ? ' M' : '' }} <span class="muted">{{ h.from_planet }}</span></td>
            <td class="mono">{{ coords(h.target_g, h.target_s, h.target_p) }}{{ h.target_type === 'moon' ? ' M' : '' }} <span class="muted">{{ h.target_planet }}</span></td>
            <td>{{ h.username }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

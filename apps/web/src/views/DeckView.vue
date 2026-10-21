<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { cardLabel, dateTime, EVENT_LABEL, fmt, SIZE_LABEL } from '../format';

const { uni, ctx } = useUni();
const userId = ref(ctx.value!.me.id);
const data = ref<any>(null);
const startLocal = ref('');
const unknownDepletion = ref(0);
const initialDrawn = ref<Record<string, number>>({});
const msg = ref('');

const isMe = computed(() => userId.value === ctx.value!.me.id);

async function load() {
  data.value = await uniApi(uni.value, `/deck?user=${userId.value}`);
  const s = data.value.settings;
  startLocal.value = s.startTime ? new Date(s.startTime * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  unknownDepletion.value = s.unknownDepletion;
  initialDrawn.value = { ...s.initialDrawn };
}
onMounted(load);
watch(userId, load);

async function save() {
  await uniApi(uni.value, '/deck', {
    method: 'PUT',
    body: {
      startTime: startLocal.value ? Math.floor(new Date(startLocal.value).getTime() / 1000) : null,
      unknownDepletion: unknownDepletion.value,
      initialDrawn: Object.fromEntries(Object.entries(initialDrawn.value).filter(([, v]) => v)),
    },
  });
  msg.value = 'Gespeichert';
  await load();
}

const cards = computed(() => [...(data.value?.state.cards ?? [])].sort((a: any, b: any) => b.nextProbability - a.nextProbability));
const progress = computed(() => (data.value ? data.value.state.drawnInDeck / data.value.state.deckSize : 0));
</script>

<template>
  <h1>
    Expo-Deck
    <Hint>
      <p>Jeder Spieler hat ein eigenes Deck mit {{ data?.state.deckSize ?? 1000 }} Karten. Gezogene Karten werden nicht zurückgelegt, das Deck wird erst nach
      der letzten Karte neu gemischt.</p>
      <p>„Nichts“ kann auch durch Erschöpfung des Systems kommen und zieht dann <b>keine</b> Karte: Mit Sonde in der Flotte
      zeigt der Bericht die Erschöpfungsstufe, die als Wahrscheinlichkeit eingerechnet wird. Ohne Sonde gilt die Annahme unten.</p>
    </Hint>
  </h1>
  <div class="card">
    <div class="row">
      <label>
        Spieler
        <select v-model="userId">
          <option v-for="m in ctx!.members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
    </div>
  </div>

  <template v-if="data">
    <div class="card">
      <div class="row">
        <span>Gezogen im aktuellen Deck: <b>{{ fmt(data.state.drawnInDeck, 1) }}</b> / {{ data.state.deckSize }}</span>
        <span>Verbleibend: <b>{{ fmt(data.state.remainingTotal, 1) }}</b></span>
        <span class="muted">Resets: {{ data.state.resets }} · Expos gezählt: {{ data.state.events }} · unsichere „Nichts“: {{ data.state.uncertainNothing }}</span>
      </div>
      <div style="height: 8px; background: var(--surface-2); border-radius: 4px; margin-top: 8px">
        <div :style="{ width: progress * 100 + '%', height: '100%', background: 'var(--accent)', borderRadius: '4px' }" />
      </div>
    </div>

    <div class="table-wrap" style="max-height: none; margin-bottom: 14px">
      <table class="data">
        <thead>
          <tr><th>Karte</th><th class="num">im Deck</th><th class="num">übrig</th><th class="num">min–max</th><th class="num">nächste Karte</th><th style="width: 30%"></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in cards" :key="c.key">
            <td>{{ cardLabel(c.key) }}</td>
            <td class="num muted">{{ c.count }}</td>
            <td class="num"><b>{{ fmt(c.remaining, c.type === 'Nothing' ? 1 : 0) }}</b></td>
            <td class="num small muted">{{ c.remainingMin !== c.remainingMax ? `${fmt(c.remainingMin)}–${fmt(c.remainingMax)}` : '' }}</td>
            <td class="num">{{ fmt(c.nextProbability * 100, 2) }} %</td>
            <td>
              <div :style="{ width: Math.min(100, c.nextProbability * 300) + '%', height: '6px', background: 'var(--accent)', borderRadius: '3px' }" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3 style="margin-top: 0">Letzte Expeditionen</h3>
      <div v-for="(e, i) in data.lastEvents" :key="i" class="small">
        <span class="muted">{{ dateTime(e.time) }}</span> {{ EVENT_LABEL[e.event] }} {{ SIZE_LABEL[e.size] }}
        <span v-if="e.event === 'Nothing'" class="faint">(Erschöpfung: {{ e.depletion ?? 'unbekannt' }})</span>
      </div>
    </div>

    <div v-if="isMe" class="card">
      <h3 style="margin-top: 0">Einstellungen</h3>
      <div class="row">
        <label>
          Deck-Start
          <Hint>Expeditionen vor diesem Zeitpunkt werden ignoriert, z. B. wenn ältere Expos fehlen oder das Deck nachweislich neu gemischt wurde.</Hint>
          <input v-model="startLocal" type="datetime-local" />
        </label>
        <label>
          Annahme Erschöpfung ohne Sonde
          <Hint>Wahrscheinlichkeit, dass ein „Nichts“ ohne Sonde in der Flotte durch Erschöpfung kam und damit keine Karte gezogen hat.</Hint>
          <select v-model.number="unknownDepletion">
            <option :value="0">0 % (jedes Nichts = Karte)</option>
            <option :value="25 / 101">25 %</option>
            <option :value="50 / 101">50 %</option>
            <option :value="75 / 101">75 %</option>
          </select>
        </label>
      </div>
      <details style="margin-top: 10px">
        <summary class="muted small">
          Korrektur zum Deck-Start
          <Hint>Karten, die zum Deck-Start im aktuellen Deck schon gezogen waren (z. B. aus eigener Zählung vor dem Hub).</Hint>
        </summary>
        <div class="row" style="margin-top: 8px">
          <label v-for="c in data.state.cards" :key="c.key">
            {{ cardLabel(c.key) }} <input v-model.number="initialDrawn[c.key]" type="number" min="0" style="width: 70px" />
          </label>
        </div>
      </details>
      <div class="row" style="margin-top: 10px">
        <button class="primary" @click="save">Speichern</button>
        <span class="ok small">{{ msg }}</span>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { cardLabel, dateTime, DEPLETION_LABEL, fmtCount } from '../format';

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

/** Starts a fresh, full deck now: older expeditions are ignored, manual corrections are cleared. */
async function resetDeck() {
  const text =
    'Expo-Deck zurücksetzen?\n\nDas Deck beginnt ab jetzt neu mit allen Karten. ' +
    'Bisherige Expeditionen zählen nicht mehr mit, manuelle Korrekturen werden gelöscht.';
  if (!confirm(text)) return;
  await uniApi(uni.value, '/deck', {
    method: 'PUT',
    body: { startTime: Math.floor(Date.now() / 1000), unknownDepletion: unknownDepletion.value, initialDrawn: {} },
  });
  msg.value = 'Deck zurückgesetzt';
  await load();
}

// ------------------------------------------------- manually counted events
const addTime = ref('');
const addDepletion = ref<string | null>(null);
const lastAdded = ref<{ id: number; label: string } | null>(null);
/** Deck cards in deck order (the buttons should not jump around while counting). */
const deckCards = computed(() => data.value?.state.cards ?? []);

async function addEvent(c: { key: string; type: string; size: string }) {
  const res = await uniApi(uni.value, '/deck/events', {
    body: {
      event: c.type,
      size: c.size,
      depletion: c.type === 'Nothing' ? addDepletion.value : null,
      time: addTime.value ? Math.floor(new Date(addTime.value).getTime() / 1000) : null,
    },
  });
  lastAdded.value = { id: res.id, label: cardLabel(c.key) };
  await load();
}

async function removeEvent(id: number) {
  await uniApi(uni.value, `/deck/events/${id}`, { method: 'DELETE' });
  if (lastAdded.value?.id === id) lastAdded.value = null;
  await load();
}

/** Events before the deck start are not counted: warn when back-dating before it. */
const beforeStart = computed(() => {
  const start = data.value?.settings.startTime;
  return !!(addTime.value && start && new Date(addTime.value).getTime() / 1000 < start);
});

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
        <span>Gezogen im aktuellen Deck: <b>{{ fmtCount(data.state.drawnInDeck) }}</b> / {{ data.state.deckSize }}</span>
        <span>Verbleibend: <b>{{ fmtCount(data.state.remainingTotal) }}</b></span>
        <span class="muted">Resets: {{ data.state.resets }} · Expos gezählt: {{ data.state.events }} · unsichere „Nichts“: {{ data.state.uncertainNothing }}</span>
        <span class="grow" />
        <span v-if="data.settings.startTime" class="muted small">Deck-Start {{ dateTime(data.settings.startTime) }}</span>
        <button v-if="isMe" @click="resetDeck">Deck zurücksetzen</button>
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
            <td class="num"><b>{{ fmtCount(c.remaining) }}</b></td>
            <td class="num small muted">{{ c.remainingMin !== c.remainingMax ? `${fmtCount(c.remainingMin)}–${fmtCount(c.remainingMax)}` : '' }}</td>
            <td class="num">{{ (c.nextProbability * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }} %</td>
            <td>
              <div :style="{ width: Math.min(100, c.nextProbability * 300) + '%', height: '6px', background: 'var(--accent)', borderRadius: '3px' }" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isMe" class="card">
      <h3 style="margin-top: 0">
        Ereignis nachtragen
        <Hint>
          <p>Expeditionsergebnisse von Hand zählen, z. B. wenn der Bericht nicht synchronisiert wurde. Ein Klick zählt eine Karte.</p>
          <p>Nachgetragene Ereignisse zählen wie synchronisierte (auch in der Expeditions-Auswertung) und lassen sich unter „Expeditionen“ wieder löschen.
          Den Bericht später zusätzlich einzufügen zählt die Expedition doppelt.</p>
        </Hint>
      </h3>
      <div class="row">
        <label>
          Zeitpunkt
          <Hint>Leer = jetzt.</Hint>
          <input v-model="addTime" type="datetime-local" />
        </label>
        <label>
          Erschöpfung bei „Nichts“
          <Hint>Nur mit Sonde in der Flotte bekannt. „Unbekannt“ verwendet die Annahme aus den Einstellungen.</Hint>
          <select v-model="addDepletion">
            <option :value="null">unbekannt</option>
            <option v-for="(label, d) in DEPLETION_LABEL" :key="d" :value="d">{{ label }}</option>
          </select>
        </label>
        <span v-if="beforeStart" class="warn small">⚠ vor dem Deck-Start – zählt nicht mit</span>
      </div>
      <div class="add-grid">
        <button v-for="c in deckCards" :key="c.key" @click="addEvent(c)">+ {{ cardLabel(c.key) }}</button>
      </div>
      <div class="row small" style="margin-top: 8px">
        <template v-if="lastAdded">
          <span class="ok">Nachgetragen: {{ lastAdded.label }}</span>
          <a href="#" @click.prevent="removeEvent(lastAdded.id)">rückgängig</a>
        </template>
        <span class="grow" />
        <RouterLink :to="`/${uni}/expeditions`">Alle Expeditionen →</RouterLink>
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

<style scoped>
.add-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 10px; }
.add-grid button { margin: 0; text-align: left; }
</style>

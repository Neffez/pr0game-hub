<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, ref } from 'vue';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { STATS_TYPES } from '../format';

interface Summary {
  pageType: string;
  source: string;
  lang: string;
  warnings: string[];
  counts: Record<string, { new: number; duplicate: number }>;
  preview: string[];
}

const { uni } = useUni();
const html = ref<string | null>(null);
const text = ref('');
const statsType = ref<number | null>(null);
const preview = ref<Summary | null>(null);
const saved = ref<Summary | null>(null);
const error = ref('');
const busy = ref(false);

const COUNT_LABEL: Record<string, string> = {
  player_scores: 'Spieler-Punkte',
  alliance_scores: 'Allianz-Punkte',
  spy_reports: 'Spionageberichte',
  battle_reports: 'Kampfberichte',
  expeditions: 'Expeditionen',
  hostile_spying: 'Fremdspionagen',
  galaxy_systems: 'Galaxie-Systeme',
  empire: 'Imperium',
  battle_hall: 'Battle Hall',
  recycle_reports: 'Recyclerberichte',
  overview: 'Übersicht (Bauschleifen)',
};

const needsType = computed(() => preview.value?.warnings.some((w) => w.includes('Kategorie')) ?? false);

function onPaste(e: ClipboardEvent) {
  const h = e.clipboardData?.getData('text/html');
  const t = e.clipboardData?.getData('text/plain') ?? '';
  e.preventDefault();
  // Copied page source (e.g. from view-source): the text is the real HTML, the clipboard HTML only the source view.
  html.value = /<(html|body|div|table|tr)[\s>]/i.test(t.slice(0, 20000)) ? null : h || null;
  text.value = t;
  run(true);
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  html.value = await file.text();
  text.value = `[Datei: ${file.name}, ${Math.round(file.size / 1024)} KB]`;
  run(true);
}

function clear() {
  html.value = null;
  text.value = '';
  preview.value = saved.value = null;
  statsType.value = null;
  error.value = '';
}

async function run(dryRun: boolean) {
  error.value = '';
  if (!html.value && !text.value.trim()) return;
  busy.value = true;
  try {
    const body = {
      html: html.value,
      text: html.value && text.value.startsWith('[Datei:') ? null : text.value,
      statsType: statsType.value,
      dryRun,
    };
    const res = await uniApi<Summary>(uni.value, '/ingest', { body });
    if (dryRun) {
      preview.value = res;
      saved.value = null;
    } else {
      saved.value = res;
      preview.value = null;
      html.value = null;
      text.value = '';
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/** Typing/pasting into the field without clipboard HTML (e.g. page source) clears stale HTML. */
function onInput() {
  html.value = null;
  preview.value = null;
}
</script>

<template>
  <h1>
    Seite einfügen
    <Hint>
      <p>Im Spiel die Seite öffnen, <b>Strg+A</b>, <b>Strg+C</b> und hier <b>Strg+V</b>. Alternativ: Seitenquelltext (Strg+U) kopieren und einfügen
      oder die gespeicherte Seite als Datei wählen.</p>
      <p>Unterstützt: Statistik (Spieler/Allianz), Nachrichten (Spionage-, Kampf-, Expeditionsberichte, Spionage-Aktivität), Galaxie, Imperium, Übersicht (Bauschleifen, nur als Quelltext/HTML).</p>
    </Hint>
  </h1>
  <div class="card">
    <textarea
      v-model="text"
      rows="10"
      style="width: 100%; font-family: var(--mono); font-size: 12px"
      placeholder="Seite im Spiel mit Strg+A, Strg+C kopieren und hier Strg+V …"
      @paste="onPaste"
      @input="onInput"
    />
    <div class="row" style="margin-top: 8px">
      <span v-if="html" class="badge" style="color: var(--pos)">HTML erkannt ({{ Math.round(html.length / 1024) }} KB)</span>
      <label>Datei <input type="file" accept=".html,.htm,.txt" @change="onFile" /></label>
      <label>
        Statistik-Kategorie
        <select v-model="statsType">
          <option :value="null">automatisch</option>
          <option v-for="(label, id) in STATS_TYPES" :key="id" :value="Number(id)">{{ label }}</option>
        </select>
      </label>
      <span class="grow" />
      <button @click="clear">Leeren</button>
      <button :disabled="busy" @click="run(true)">Vorschau</button>
      <button class="primary" :disabled="busy || !preview || !preview.preview.length || (needsType && !statsType)" @click="run(false)">Speichern</button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <div v-if="preview" class="card">
    <h2 style="margin-top: 0">Vorschau</h2>
    <p class="muted small">Seite: {{ preview.pageType }} · Quelle: {{ preview.source }} · Sprache: {{ preview.lang }}</p>
    <p v-for="w in preview.warnings" :key="w" class="warn">⚠ {{ w }}</p>
    <ul v-if="preview.preview.length">
      <li v-for="(p, i) in preview.preview.slice(0, 50)" :key="i">{{ p }}</li>
      <li v-if="preview.preview.length > 50" class="muted">… {{ preview.preview.length - 50 }} weitere</li>
    </ul>
    <p v-else class="error">Keine Daten erkannt.</p>
  </div>

  <div v-if="saved" class="card">
    <h2 style="margin-top: 0" class="ok">Gespeichert</h2>
    <p v-for="w in saved.warnings" :key="w" class="warn">⚠ {{ w }}</p>
    <table class="data" style="width: auto">
      <tr><th>Daten</th><th class="num">neu</th><th class="num">bekannt</th></tr>
      <tr v-for="(c, k) in saved.counts" :key="k">
        <td>{{ COUNT_LABEL[k] ?? k }}</td>
        <td class="num">{{ c.new }}</td>
        <td class="num">{{ c.duplicate }}</td>
      </tr>
    </table>
  </div>
</template>

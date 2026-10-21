<script setup lang="ts">
import { ref } from 'vue';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useUni } from '../composables';
import { fmt } from '../format';

interface Summary {
  counts: Record<string, { new: number; duplicate: number }>;
  warnings: string[];
}

const { uni } = useUni();
const file = ref<File | null>(null);
const result = ref<Summary | null>(null);
const error = ref('');
const busy = ref(false);
const dragging = ref(false);

function pick(e: Event) {
  choose((e.target as HTMLInputElement).files?.[0] ?? null);
}
function drop(e: DragEvent) {
  dragging.value = false;
  choose(e.dataTransfer?.files?.[0] ?? null);
}
function choose(f: File | null) {
  file.value = f;
  result.value = null;
  error.value = '';
}

async function upload() {
  if (!file.value) return;
  busy.value = true;
  error.value = '';
  try {
    let text = await file.value.text();
    // Pretty-printed exports are much larger than needed.
    try {
      text = JSON.stringify(JSON.parse(text));
    } catch {
      throw new Error('Die Datei ist kein gültiges JSON.');
    }
    result.value = await uniApi(uni.value, '/universe-json', { body: { text } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const LABEL: Record<string, string> = { galaxy_systems: 'Systeme' };
</script>

<template>
  <h1>
    universe.json hochladen
    <Hint>
      <p>Universums-Export im universe.json-Format (wie aus proscript-ui oder dem FF-Hub-Export): Planeten, Monde, Spieler, Allianzen und Status aller Systeme.</p>
      <p>Jedes System hat einen Zeitstempel. Systeme, die im Hub schon aktueller sind (z. B. aus einer eingefügten Galaxieansicht), werden übersprungen.</p>
      <p>Die Zeitstempel fließen in die Gala-Aktualität ein.</p>
    </Hint>
  </h1>

  <div
    class="card drop"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="drop"
  >
    <div class="row">
      <input type="file" accept=".json,application/json" @change="pick" />
      <span v-if="file" class="muted small">{{ file.name }} · {{ fmt(file.size / 1024 / 1024, 1) }} MB</span>
      <span class="grow" />
      <button class="primary" :disabled="!file || busy" @click="upload">{{ busy ? 'Importiere …' : 'Importieren' }}</button>
    </div>
    <p class="muted small" style="margin-bottom: 0">oder Datei hierher ziehen</p>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="result" class="card">
    <h2 style="margin-top: 0" class="ok">Importiert</h2>
    <p v-for="(c, k) in result.counts" :key="k">
      {{ LABEL[k] ?? k }}: <b>{{ fmt(c.new) }}</b> aktualisiert<template v-if="c.duplicate">, {{ fmt(c.duplicate) }} übersprungen (im Hub schon aktueller)</template>
    </p>
    <p v-for="w in result.warnings" :key="w" class="warn">⚠ {{ w }}</p>
  </div>
</template>

<style scoped>
.drop.dragging { border-color: var(--accent); }
</style>

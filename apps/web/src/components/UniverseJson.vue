<script setup lang="ts">
import Icon from './Icon.vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { selectedGroup, uniApi } from '../api';
import Hint from './Hint.vue';
import { useUni } from '../composables';
import { fmt } from '../format';

interface Summary {
  counts: Record<string, { new: number; duplicate: number }>;
  warnings: string[];
}

const { t, te } = useI18n();
const { uni } = useUni();
/** The server answers with an attachment, so the browser downloads instead of navigating. */
function download() {
  const group = selectedGroup(uni.value);
  location.href = `${import.meta.env.BASE_URL}api/${uni.value}/universe-json${group ? `?group=${group}` : ''}`;
}
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
      throw new Error(t('universeJson.invalidJson'));
    }
    result.value = await uniApi(uni.value, '/universe-json', { body: { text } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const label = (k: string) => (k === 'galaxy_systems' ? t('universeJson.systems') : k);
</script>

<template>
  <h2>
    universe.json
    <Hint>
      <p>{{ t('universeJson.hintSource') }}</p>
      <p><b>{{ t('universeJson.upload') }}</b> {{ t('universeJson.hintUpload') }}</p>
      <p><b>{{ t('universeJson.download') }}</b> {{ t('universeJson.hintDownload') }}</p>
    </Hint>
  </h2>

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
      <button class="primary" :disabled="!file || busy" @click="upload">{{ busy ? t('universeJson.importing') : t('universeJson.import') }}</button>
      <button @click="download">{{ t('universeJson.download') }}</button>
    </div>
    <p class="muted small" style="margin-bottom: 0">{{ t('universeJson.drop') }}</p>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="result" class="card">
    <h2 style="margin-top: 0" class="ok">{{ t('universeJson.imported') }}</h2>
    <p v-for="(c, k) in result.counts" :key="k">
      {{ label(k) }}: <b>{{ fmt(c.new) }}</b> {{ t('universeJson.updated') }}<template v-if="c.duplicate">, {{ t('universeJson.skipped', { n: fmt(c.duplicate) }) }}</template>
    </p>
    <p v-for="w in result.warnings" :key="w" class="warn"><Icon name="warning" :size="14" /> {{ te(`paste.warnings.${w}`) ? t(`paste.warnings.${w}`) : w }}</p>
  </div>
</template>

<style scoped>
.drop.dragging { border-color: var(--accent); }
</style>

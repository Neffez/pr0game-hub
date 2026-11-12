<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { refreshSyncHints } from '../syncHints';
import { cardLabel, coords, dateTime, DEPLETION_LABEL, fmt, rateText, STATS_CATEGORIES, STATS_CATEGORY_ORDER } from '../format';

interface Summary {
  pageType: string;
  source: string;
  lang: string;
  /** codes, see warningText */
  warnings: string[];
  counts: Record<string, { new: number; duplicate: number }>;
  preview: ({ kind: string } & Record<string, any>)[];
  /** loot settlements the messages count for */
  settlements?: { id: number; mission: string; g: number; s: number; p: number; planet_type: string; target_time: number; kinds: string[] }[];
  /** why nothing was recognized (pages of type unknown) */
  explain?: { code: string; page?: string; lang?: string };
}

/** Paste a game page and save it (sync page; `compact` = quick sync sheet on mobile, with clipboard button and series mode). */
defineProps<{ compact?: boolean }>();

const { t, te } = useI18n();
const { ctx, uni } = useUni();
/** member the sync counts for (e.g. a report they sent); null = oneself. Kept for the next page in series mode. */
const forUser = ref<number | null>(null);
const others = computed(() =>
  (ctx.value?.members ?? []).filter((m) => m.id !== ctx.value?.me.id).sort((a, b) => a.name.localeCompare(b.name)),
);
/** name of the chosen member for the saved card, null for own syncs */
const savedFor = ref<string | null>(null);
const html = ref<string | null>(null);
const text = ref('');
const statsType = ref<number | null>(null);
/** "g:s" for a copied galaxy view (the copy has no galaxy/system); kept and counted up after saving */
const system = ref('');
const preview = ref<Summary | null>(null);
const saved = ref<Summary | null>(null);
const error = ref('');
const busy = ref(false);

/**
 * Collection of several pages (backlog E-2): saved files (several at once, dropped files or folders) and pages pasted
 * one after the other ("collect"). Each page gets its own preview; "save all" saves them one after another.
 */
interface BatchItem {
  id: number;
  name: string;
  html: string | null;
  text: string;
  statsType: number | null;
  system: string;
  preview: Summary | null;
  saved: Summary | null;
  error: string;
  busy: boolean;
}
const batch = ref<BatchItem[]>([]);
let batchIds = 0;
const PAGE_FILE = /\.(html?|txt)$/i;
/** Files above the server's body limit are left out early (8 MB by default). */
const MAX_FILE = 8 * 1024 * 1024;
const dragging = ref(false);
const batchBusy = ref(false);

const itemNeedsType = (b: BatchItem) => b.preview?.warnings.includes('stats_category_unknown') ?? false;
const itemNeedsSystem = (b: BatchItem) => b.preview?.warnings.includes('galaxy_position_missing') ?? false;
const itemReady = (b: BatchItem) =>
  !b.saved && !!b.preview?.preview.length && (!itemNeedsType(b) || b.statsType != null) && (!itemNeedsSystem(b) || !!b.system.trim());
const readyCount = computed(() => batch.value.filter(itemReady).length);

function bodyOf(b: { html: string | null; text: string; statsType: number | null; system: string }, dryRun: boolean) {
  return {
    html: b.html,
    text: b.html && b.text.startsWith(FILE_MARK) ? null : b.text,
    statsType: b.statsType,
    system: b.system.trim() || null,
    forUser: forUser.value,
    dryRun,
  };
}

async function runItem(b: BatchItem, dryRun: boolean) {
  b.busy = true;
  b.error = '';
  try {
    const res = await uniApi<Summary>(uni.value, '/ingest', { body: bodyOf(b, dryRun) });
    if (dryRun) b.preview = res;
    else b.saved = res;
  } catch (e) {
    b.error = (e as Error).message;
  } finally {
    b.busy = false;
  }
}

/** Adds pages to the collection and previews them one after another. */
async function addToBatch(items: { name: string; html: string | null; text: string }[]) {
  const added = items.map((x) => {
    batch.value.push({ id: ++batchIds, ...x, statsType: null, system: '', preview: null, saved: null, error: '', busy: false });
    return batch.value[batch.value.length - 1];
  });
  for (const b of added) await runItem(b, true);
}

async function addFiles(files: File[]) {
  error.value = '';
  const pages = files.filter((f) => PAGE_FILE.test(f.name));
  const tooBig = pages.filter((f) => f.size > MAX_FILE);
  if (pages.length < files.length || tooBig.length) error.value = t('paste.batch.skipped', { n: files.length - pages.length + tooBig.length });
  const items = [];
  for (const f of pages.filter((x) => x.size <= MAX_FILE).sort((a, b) => a.name.localeCompare(b.name))) {
    items.push({ name: f.name, html: await f.text(), text: `${FILE_MARK}${f.name}, ${Math.round(f.size / 1024)} KB]` });
  }
  await addToBatch(items);
}

/** The current paste goes into the collection, the box is free for the next page. */
function collect() {
  if (!html.value && !text.value.trim()) return;
  const name = text.value.startsWith(FILE_MARK) ? text.value.slice(FILE_MARK.length, -1) : t('paste.batch.pasted', { n: batch.value.length + 1 });
  const item = { name, html: html.value, text: text.value };
  clear();
  addToBatch([item]);
}

/** Files of a drop, folders included (read recursively where the browser allows it). */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() : null));
  if (!entries.some((e) => e?.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // readEntries returns the entries in chunks until an empty one
      for (;;) {
        const chunk = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!chunk.length) break;
        for (const c of chunk) await walk(c);
      }
    }
  };
  for (const e of entries) if (e) await walk(e);
  return out;
}

async function onDrop(e: DragEvent) {
  dragging.value = false;
  if (!e.dataTransfer) return;
  const files = await droppedFiles(e.dataTransfer);
  if (files.length === 1 && !batch.value.length) return readFile(files[0]);
  if (files.length) await addFiles(files);
}

async function saveAll() {
  batchBusy.value = true;
  for (const b of batch.value.filter(itemReady)) await runItem(b, false);
  batchBusy.value = false;
  refreshSyncHints(uni.value);
}
const removeItem = (b: BatchItem) => (batch.value = batch.value.filter((x) => x !== b));
const clearBatch = () => (batch.value = []);
const savedCount = (b: BatchItem) => Object.values(b.saved?.counts ?? {}).reduce((n, c) => n + c.new, 0);

/** Translated label for a key of message group `group`, otherwise the key itself. */
const label = (group: string, key: string) => (te(`${group}.${key}`) ? t(`${group}.${key}`) : key);

/** One preview line per record (server sends the kind and its values). */
function previewText(p: Summary['preview'][number]) {
  const unknown = '?';
  switch (p.kind) {
    case 'stats':
      return t('paste.preview.stats', {
        who: t(p.who === 'player' ? 'common.player' : 'common.alliance'),
        type: p.type != null ? (STATS_CATEGORIES[p.type] ?? p.type) : unknown,
        rows: p.rows,
        time: p.time ?? unknown,
      });
    case 'spy':
      return t('paste.preview.spy', { coords: p.coords + (p.moon ? ' ' + t('common.moon') : ''), player: p.player, time: p.time ?? unknown });
    case 'expedition':
      return t('paste.preview.expedition', {
        event: cardLabel(`${p.event}:${p.size}`) + (p.depletion ? ` (${DEPLETION_LABEL[p.depletion] ?? p.depletion})` : ''),
        time: p.time ?? unknown,
      });
    case 'battle':
      return t('paste.preview.battle', { coords: p.coords, loot: fmt(p.loot) });
    case 'recycle':
      return t('paste.preview.recycle', { coords: p.coords, amount: fmt(p.amount) });
    case 'fleetReturn':
      return t('paste.preview.fleetReturn', { coords: p.coords, amount: fmt(p.amount) });
    case 'transport':
      return t('paste.preview.transport', { from: p.from, to: p.to, amount: fmt(p.amount) });
    case 'missileImpact':
      return t('paste.preview.missileImpact', { coords: p.coords, count: fmt(p.count) });
    case 'recycleReturn':
      return t('paste.preview.recycleReturn', { coords: p.coords, amount: fmt(p.amount) });
    case 'battleHall':
      return t(p.memorial ? 'paste.preview.battleHallMemorial' : 'paste.preview.battleHall', { entries: p.entries });
    case 'marketplace':
      return (
        t('paste.preview.marketplace', { offers: p.offers, rate: p.m != null || p.k != null ? rateText(p.m as number | null, p.k as number | null) : unknown }) +
        (p.exact || (p.m == null && p.k == null) ? '' : ` (${t('market.estimated')})`)
      );
  }
  return te(`paste.preview.${p.kind}`) ? t(`paste.preview.${p.kind}`, p) : JSON.stringify(p);
}

/** Plain words for a page without data (backlog E-4). */
function explainText(x: NonNullable<Summary['explain']>) {
  const page = x.page ? (te(`paste.pages.${x.page}`) ? t(`paste.pages.${x.page}`) : x.page) : '';
  return t(`paste.explain.${x.code}`, { page, lang: x.lang ?? '' });
}
/** Sending the page as a parser sample: state of the current preview. */
const sample = ref<{ note: string; sent: boolean; busy: boolean; error: string }>({ note: '', sent: false, busy: false, error: '' });
async function sendSample() {
  sample.value.busy = true;
  sample.value.error = '';
  try {
    await uniApi(uni.value, '/ingest/sample', { body: { html: html.value, text: html.value && text.value.startsWith(FILE_MARK) ? null : text.value, note: sample.value.note || null } });
    sample.value.sent = true;
  } catch (e) {
    sample.value.error = (e as Error).message;
  } finally {
    sample.value.busy = false;
  }
}

const needsType = computed(() => preview.value?.warnings.includes('stats_category_unknown') ?? false);
const needsSystem = computed(
  () => !!preview.value && (preview.value.warnings.includes('galaxy_position_missing') || (preview.value.pageType === 'galaxy' && !!system.value)),
);

/** Next system after saving a galaxy view, for the next copy. */
function nextSystem() {
  const m = system.value.trim().match(/^(\d+)\s*:\s*(\d+)/);
  if (m) system.value = `${m[1]}:${Number(m[2]) + 1}`;
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault();
  applyPasted(e.clipboardData?.getData('text/html') ?? null, e.clipboardData?.getData('text/plain') ?? '');
}

function applyPasted(h: string | null, plain: string) {
  // Copied page source (e.g. from view-source): the text is the real HTML, the clipboard HTML only the source view.
  html.value = /<(html|body|div|table|tr)[\s>]/i.test(plain.slice(0, 20000)) ? null : h || null;
  text.value = plain;
  run(true);
}

const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard && ('read' in navigator.clipboard || 'readText' in navigator.clipboard);

/** Paste button (mobile has no Ctrl+V): reads HTML where the browser allows it, otherwise plain text. */
async function pasteClipboard() {
  error.value = '';
  try {
    let h: string | null = null;
    let plain = '';
    if (navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) h = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
      }
    } else {
      plain = await navigator.clipboard.readText();
    }
    if (!h && !plain.trim()) {
      error.value = t('paste.clipboardEmpty');
      return;
    }
    applyPasted(h, plain);
  } catch {
    error.value = t('paste.clipboardDenied');
  }
}

/** Placeholder text for a chosen file (its content is sent as HTML). */
const FILE_MARK = '[file: ';

async function readFile(file: File) {
  html.value = await file.text();
  text.value = `${FILE_MARK}${file.name}, ${Math.round(file.size / 1024)} KB]`;
  run(true);
}

/** One file: into the box as before; several: into the collection. */
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length === 1 && !batch.value.length) return readFile(files[0]);
  if (files.length) await addFiles(files);
}

function clear() {
  clearTimeout(typing);
  html.value = null;
  text.value = '';
  preview.value = saved.value = null;
  statsType.value = null;
  error.value = '';
}

/** Counts runs: a preview that arrives after newer input is dropped. */
let runs = 0;

async function run(dryRun: boolean) {
  clearTimeout(typing);
  error.value = '';
  if (!html.value && !text.value.trim()) {
    busy.value = false;
    return;
  }
  const current = ++runs;
  busy.value = true;
  try {
    const body = {
      html: html.value,
      text: html.value && text.value.startsWith(FILE_MARK) ? null : text.value,
      statsType: statsType.value,
      system: system.value.trim() || null,
      forUser: forUser.value,
      dryRun,
    };
    const res = await uniApi<Summary>(uni.value, '/ingest', { body });
    if (current !== runs) return;
    if (dryRun) {
      preview.value = res;
      saved.value = null;
      sample.value = { note: '', sent: false, busy: false, error: '' };
    } else {
      saved.value = res;
      refreshSyncHints(uni.value);
      savedFor.value = others.value.find((m) => m.id === forUser.value)?.name ?? null;
      if (res.pageType === 'galaxy' && system.value) nextSystem();
      preview.value = null;
      html.value = null;
      text.value = '';
    }
  } catch (e) {
    if (current === runs) error.value = (e as Error).message;
  } finally {
    if (current === runs) busy.value = false;
  }
}

/** Typing/pasting into the field without clipboard HTML (e.g. page source) clears stale HTML; the preview follows after a pause. */
let typing: ReturnType<typeof setTimeout> | undefined;
function onInput() {
  html.value = null;
  preview.value = null;
  refresh();
}

/** New preview after a pause (typing, galaxy:system input; the latter keeps the old preview and its field). */
function refresh() {
  ++runs;
  clearTimeout(typing);
  typing = setTimeout(() => run(true), 500);
}

/** Series mode (sheet): straight on to the next page after saving. */
function next() {
  clear();
  if (canReadClipboard) pasteClipboard();
}
</script>

<template>
  <div
    v-if="!(compact && saved)"
    class="card"
    :class="{ dragging }"
    @dragover.prevent="dragging = !compact"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <button v-if="compact && canReadClipboard" class="primary paste-btn" :disabled="busy" @click="pasteClipboard">{{ t('paste.fromClipboard') }}</button>
    <textarea
      v-model="text"
      :rows="compact ? 4 : 10"
      style="width: 100%; font-family: var(--mono); font-size: 12px"
      :placeholder="t('paste.placeholder')"
      @paste="onPaste"
      @input="onInput"
    />
    <div class="row" style="margin-top: 8px">
      <span v-if="html" class="badge" style="color: var(--pos)">{{ t('paste.htmlDetected', { kb: Math.round(html.length / 1024) }) }}</span>
      <label v-if="!compact" :title="t('paste.batch.fileHint')">{{ t('paste.file') }} <input type="file" accept=".html,.htm,.txt" multiple @change="onFile" /></label>
      <label v-if="!compact || needsType">
        {{ t('paste.statsCategory') }}
        <select v-model="statsType">
          <option :value="null">{{ t('paste.auto') }}</option>
          <option v-for="id in STATS_CATEGORY_ORDER" :key="id" :value="id">{{ STATS_CATEGORIES[id] }}</option>
        </select>
      </label>
      <label v-if="others.length" :title="t('paste.forMemberHint')">
        {{ t('paste.forMember') }}
        <select v-model="forUser" :class="{ 'for-other': forUser != null }">
          <option :value="null">{{ t('paste.myself') }}</option>
          <option v-for="m in others" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
      <label v-if="needsSystem">
        {{ t('paste.system') }}
        <input v-model="system" placeholder="1:234" size="7" @input="refresh" />
      </label>
      <span class="grow" />
      <button class="primary" :disabled="busy || !preview || !preview.preview.length || (needsType && !statsType)" @click="run(false)">{{ t('common.save') }}</button>
      <button v-if="!compact" :disabled="!html && !text.trim()" :title="t('paste.batch.collectHint')" @click="collect">{{ t('paste.batch.collect') }}</button>
      <button @click="clear">{{ t('paste.clear') }}</button>
    </div>
    <p v-if="!compact && !batch.length" class="muted small drop-hint">{{ t('paste.batch.dropHint') }}</p>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <div v-if="batch.length" class="card">
    <div class="row">
      <h2 class="mt-0 grow">{{ t('paste.batch.title', { n: batch.length }) }}</h2>
      <button class="primary" :disabled="batchBusy || !readyCount" @click="saveAll">{{ t('paste.batch.saveAll', { n: readyCount }) }}</button>
      <button :disabled="batchBusy" @click="clearBatch">{{ t('paste.clear') }}</button>
    </div>
    <div v-for="b in batch" :key="b.id" class="batch-item" :class="{ done: !!b.saved }">
      <div class="row batch-head">
        <b class="batch-name">{{ b.name }}</b>
        <span v-if="b.preview" class="muted small">{{ t('paste.detected', { page: b.preview.pageType, source: b.preview.source, lang: b.preview.lang }) }}</span>
        <span class="grow" />
        <span v-if="b.busy" class="muted small">…</span>
        <span v-else-if="b.saved" class="ok small"><Icon name="check" :size="12" /> {{ t('paste.batch.saved', { n: savedCount(b) }) }}</span>
        <button v-if="!b.saved" class="small-btn" :aria-label="t('paste.batch.remove')" :title="t('paste.batch.remove')" @click="removeItem(b)"><Icon name="close" :size="12" /></button>
      </div>
      <div v-if="b.error" class="error small">{{ b.error }}</div>
      <template v-else-if="b.preview && !b.saved">
        <p v-for="w in b.preview.warnings" :key="w" class="warn small"><Icon name="warning" :size="12" /> {{ label('paste.warnings', w) }}</p>
        <div v-if="itemNeedsType(b) || itemNeedsSystem(b)" class="row small">
          <label v-if="itemNeedsType(b)">
            {{ t('paste.statsCategory') }}
            <select v-model="b.statsType" @change="runItem(b, true)">
              <option :value="null">{{ t('paste.auto') }}</option>
              <option v-for="id in STATS_CATEGORY_ORDER" :key="id" :value="id">{{ STATS_CATEGORIES[id] }}</option>
            </select>
          </label>
          <label v-if="itemNeedsSystem(b)">
            {{ t('paste.system') }}
            <input v-model="b.system" placeholder="1:234" size="7" @change="runItem(b, true)" />
          </label>
        </div>
        <ul v-if="b.preview.preview.length" class="small batch-lines">
          <li v-for="(p, i) in b.preview.preview.slice(0, 5)" :key="i">{{ previewText(p) }}</li>
          <li v-if="b.preview.preview.length > 5" class="muted">… {{ t('paste.more', { n: b.preview.preview.length - 5 }) }}</li>
        </ul>
        <p v-else class="error small">{{ b.preview.explain ? explainText(b.preview.explain) : t('paste.noData') }}</p>
      </template>
    </div>
  </div>

  <div v-if="preview" class="card">
    <h2 class="mt-0">{{ t('paste.previewTitle') }}</h2>
    <p class="muted small">{{ t('paste.detected', { page: preview.pageType, source: preview.source, lang: preview.lang }) }}</p>
    <p v-for="w in preview.warnings" :key="w" class="warn"><Icon name="warning" :size="14" /> {{ label('paste.warnings', w) }}</p>
    <ul v-if="preview.preview.length">
      <li v-for="(p, i) in preview.preview.slice(0, 50)" :key="i">{{ previewText(p) }}</li>
      <li v-if="preview.preview.length > 50" class="muted">… {{ t('paste.more', { n: preview.preview.length - 50 }) }}</li>
    </ul>
    <template v-else>
      <p class="error">{{ preview.explain ? explainText(preview.explain) : t('paste.noData') }}</p>
      <div v-if="preview.explain && preview.explain.code !== 'too_short' && preview.explain.code !== 'not_game'" class="sample">
        <p v-if="sample.sent" class="ok small"><Icon name="check" :size="12" /> {{ t('paste.sample.sent') }}</p>
        <template v-else>
          <p class="muted small">{{ t('paste.sample.hint') }}</p>
          <div class="row">
            <input v-model="sample.note" class="grow" maxlength="500" :placeholder="t('paste.sample.note')" />
            <button :disabled="sample.busy" @click="sendSample">{{ t('paste.sample.send') }}</button>
          </div>
          <p v-if="sample.error" class="error small">{{ sample.error }}</p>
        </template>
      </div>
    </template>
    <ul v-if="preview.settlements?.length" class="settlements small">
      <li v-for="x in preview.settlements" :key="x.id">
        <Icon name="raids" :size="14" />
        <RouterLink :to="`/${uni}/raid-planner/${x.id}/loot`">{{ t('paste.forSettlement', { target: coords(x.g, x.s, x.p) + (x.planet_type === 'moon' ? ' (M)' : ''), time: dateTime(x.target_time) }) }}</RouterLink>
      </li>
    </ul>
  </div>

  <div v-if="saved" class="card">
    <h2 class="ok mt-0">{{ savedFor ? t('paste.savedFor', { name: savedFor }) : t('deck.saved') }}</h2>
    <p v-for="w in saved.warnings" :key="w" class="warn"><Icon name="warning" :size="14" /> {{ label('paste.warnings', w) }}</p>
    <table class="data" style="width: auto">
      <tr><th>{{ t('paste.data') }}</th><th class="num">{{ t('paste.new') }}</th><th class="num">{{ t('paste.known') }}</th></tr>
      <tr v-for="(c, k) in saved.counts" :key="k">
        <td>{{ label('paste.counts', k) }}</td>
        <td class="num">{{ c.new }}</td>
        <td class="num">{{ c.duplicate }}</td>
      </tr>
    </table>
    <ul v-if="saved.settlements?.length" class="settlements small">
      <li v-for="x in saved.settlements" :key="x.id">
        <Icon name="raids" :size="14" />
        <RouterLink :to="`/${uni}/raid-planner/${x.id}/loot`">{{ t('paste.forSettlement', { target: coords(x.g, x.s, x.p) + (x.planet_type === 'moon' ? ' (M)' : ''), time: dateTime(x.target_time) }) }}</RouterLink>
      </li>
    </ul>
    <div v-if="compact" class="row" style="margin-top: 12px">
      <button class="primary grow next-btn" @click="next">{{ canReadClipboard ? t('paste.nextFromClipboard') : t('paste.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.paste-btn { width: 100%; padding: 12px; margin-bottom: 8px; font-size: 16px; }
.next-btn { padding: 12px; font-size: 16px; }
.for-other { border-color: var(--warn); }
.settlements { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 4px; }
.settlements li { display: flex; align-items: center; gap: 6px; }
.dragging { outline: 2px dashed var(--accent); outline-offset: -4px; }
.drop-hint { margin: 6px 0 0; }
.batch-item { border-top: 1px solid var(--border); padding: 8px 0; }
.batch-item.done { opacity: 0.75; }
.batch-head { align-items: center; gap: 8px; }
.batch-name { overflow-wrap: anywhere; }
.batch-lines { margin: 4px 0 0; padding-left: 18px; }
.small-btn { padding: 1px 6px; }
.sample { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.sample p { margin: 0 0 6px; }
</style>

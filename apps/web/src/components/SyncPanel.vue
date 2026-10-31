<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { cardLabel, coords, dateTime, DEPLETION_LABEL, fmt, rateText, STATS_CATEGORIES } from '../format';

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

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  html.value = await file.text();
  text.value = `${FILE_MARK}${file.name}, ${Math.round(file.size / 1024)} KB]`;
  run(true);
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
    } else {
      saved.value = res;
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
  <div v-if="!(compact && saved)" class="card">
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
      <label v-if="!compact">{{ t('paste.file') }} <input type="file" accept=".html,.htm,.txt" @change="onFile" /></label>
      <label v-if="!compact || needsType">
        {{ t('paste.statsCategory') }}
        <select v-model="statsType">
          <option :value="null">{{ t('paste.auto') }}</option>
          <option v-for="(label, id) in STATS_CATEGORIES" :key="id" :value="Number(id)">{{ label }}</option>
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
      <button @click="clear">{{ t('paste.clear') }}</button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>

  <div v-if="preview" class="card">
    <h2 class="mt-0">{{ t('paste.previewTitle') }}</h2>
    <p class="muted small">{{ t('paste.detected', { page: preview.pageType, source: preview.source, lang: preview.lang }) }}</p>
    <p v-for="w in preview.warnings" :key="w" class="warn"><Icon name="warning" :size="14" /> {{ label('paste.warnings', w) }}</p>
    <ul v-if="preview.preview.length">
      <li v-for="(p, i) in preview.preview.slice(0, 50)" :key="i">{{ previewText(p) }}</li>
      <li v-if="preview.preview.length > 50" class="muted">… {{ t('paste.more', { n: preview.preview.length - 50 }) }}</li>
    </ul>
    <p v-else class="error">{{ t('paste.noData') }}</p>
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
</style>

<script setup lang="ts">
import { useAutoTour } from '../tours';
import Section from './Section.vue';
import MemberSelect from './MemberSelect.vue';
import Icon from './Icon.vue';
import DateTimeInput from './DateTimeInput.vue';
import Hint from './Hint.vue';
import SortBar from './SortBar.vue';
import SortMark from './SortMark.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useMobile, useSort, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
import { cardLabel, dateTime, DEPLETION_LABEL, fmt, fmtCount } from '../format';

/**
 * Expedition deck (tab of the expeditions page): card counting per player, manually counted events and the deck
 * settings. Adding and settings are collapsible sections; the card table sorts by any column.
 */
const emit = defineEmits<{ showStats: [] }>();
const { t } = useI18n();
const { uni, ctx } = useUni();
const userId = ref(ctx.value!.me.id);
const startLocal = ref('');
const unknownDepletion = ref(0);
const initialDrawn = ref<Record<string, number>>({});
const msg = ref('');

const isMe = computed(() => userId.value === ctx.value!.me.id);

const { data, error, load: fetchDeck } = useLoader<any>(() => uniApi(uni.value, `/deck?user=${userId.value}`));
async function load() {
  const d = await fetchDeck();
  if (!d) return;
  const s = d.settings;
  startLocal.value = s.startTime ? new Date(s.startTime * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  unknownDepletion.value = s.unknownDepletion;
  initialDrawn.value = { ...s.initialDrawn };
}
onMounted(load);
// new expeditions: the drawn cards change, the settings being edited stay
useLiveReload(fetchDeck, tables('expeditions'));
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
  msg.value = t('deck.saved');
  await load();
}

/** Starts a fresh, full deck now: older expeditions are ignored, manual corrections are cleared. */
async function resetDeck() {
  if (!confirm(t('deck.resetConfirm'))) return;
  await uniApi(uni.value, '/deck', {
    method: 'PUT',
    body: { startTime: Math.floor(Date.now() / 1000), unknownDepletion: unknownDepletion.value, initialDrawn: {} },
  });
  msg.value = t('deck.resetDone');
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

// ------------------------------------------------- card table
const cardSort = useSort<any>(
  deckCards,
  (c, k) => (k === 'card' ? cardLabel(c.key) : k === 'minMax' ? c.remainingMax - c.remainingMin : c[k]),
  'nextProbability',
);
const cardCols = computed(() => [
  { key: 'count', label: t('deck.inDeck') },
  { key: 'remaining', label: t('combat.left') },
  { key: 'minMax', label: t('deck.minMax') },
  { key: 'nextProbability', label: t('deck.nextCard') },
]);
const { key: cardKey, descending: cardDesc } = cardSort;
/** Column headers are hidden in the stacked mobile table: a sort selection instead. */
const mobile = useMobile();
const cardOptions = computed(() => [{ key: 'card', label: t('deck.card') }, ...cardCols.value.map((c) => ({ key: c.key, label: c.label }))]);
/** Bar width: the most likely card fills the column. */
const maxProbability = computed(() => Math.max(0, ...deckCards.value.map((c: any) => c.nextProbability)));
const progress = computed(() => (data.value ? data.value.state.drawnInDeck / data.value.state.deckSize : 0));
useAutoTour('expeditions', () => !!data.value);
</script>

<template>
  <div class="row toolbar">
    <MemberSelect v-model="userId" />
    <span class="grow" />
    <button v-if="isMe && data" @click="resetDeck">{{ t('deck.reset') }}</button>
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <div class="card summary" data-tour="expo-deck-summary">
      <div class="row">
        <span>{{ t('deck.drawn') }} <b>{{ fmtCount(data.state.drawnInDeck) }}</b> / {{ data.state.deckSize }}</span>
        <span>{{ t('deck.remaining') }} <b>{{ fmtCount(data.state.remainingTotal) }}</b></span>
        <span class="muted small">{{ t('deck.counts', { resets: data.state.resets, events: data.state.events, uncertain: data.state.uncertainNothing }) }}</span>
        <span class="grow" />
        <span v-if="data.settings.startTime" class="muted small">{{ t('deck.start') }} {{ dateTime(data.settings.startTime) }}</span>
      </div>
      <div class="bar"><div :style="{ width: progress * 100 + '%' }" /></div>
    </div>

    <Section data-tour="expo-deck-cards" :title="t('deck.cards')" :count="deckCards.length" :card="false" :level="2" store-key="deck.cards">
      <SortBar v-if="mobile" v-model:desc="cardDesc" :sort-key="cardKey" :options="cardOptions" @sort="cardSort.sortBy" />
      <div class="table-wrap flat">
        <table v-stack class="data">
          <thead>
            <tr>
              <th class="sortable" @click="cardSort.sortBy('card')">{{ t('deck.card') }}<SortMark :dir="cardSort.direction('card')" /></th>
              <th v-for="c in cardCols" :key="c.key" class="sortable num" @click="cardSort.sortBy(c.key)">{{ c.label }}<SortMark :dir="cardSort.direction(c.key)" /></th>
              <th class="m-hide bar-col" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cardSort.sorted.value" :key="c.key" :class="{ dim: !c.remainingMax }">
              <td>{{ cardLabel(c.key) }}</td>
              <td class="num muted">{{ c.count }}</td>
              <td class="num"><b>{{ fmtCount(c.remaining) }}</b></td>
              <td class="num small muted">{{ c.remainingMin !== c.remainingMax ? `${fmtCount(c.remainingMin)}–${fmtCount(c.remainingMax)}` : '' }}</td>
              <td class="num">{{ fmt(c.nextProbability * 100, 2) }} %</td>
              <td class="m-hide">
                <div class="bar thin"><div :style="{ width: (maxProbability ? (c.nextProbability / maxProbability) * 100 : 0) + '%' }" /></div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>

    <Section v-if="isMe" data-tour="expo-deck-add" :title="t('deck.addTitle')" store-key="deck.add">
      <template #hint>
        <Hint>
          <p>{{ t('deck.addHint1') }}</p>
          <p>{{ t('deck.addHint2') }}</p>
        </Hint>
      </template>
      <div class="row">
        <label>
          {{ t('deck.when') }}
          <Hint>{{ t('deck.whenHint') }}</Hint>
          <DateTimeInput v-model="addTime" />
        </label>
        <label>
          {{ t('deck.depletion') }}
          <Hint>{{ t('deck.depletionHint') }}</Hint>
          <select v-model="addDepletion">
            <option :value="null">{{ t('common.unknown') }}</option>
            <option v-for="(label, d) in DEPLETION_LABEL" :key="d" :value="d">{{ label }}</option>
          </select>
        </label>
        <span v-if="beforeStart" class="warn small"><Icon name="warning" :size="13" /> {{ t('deck.beforeStart') }}</span>
      </div>
      <div class="add-grid">
        <button v-for="c in deckCards" :key="c.key" @click="addEvent(c)">+ {{ cardLabel(c.key) }}</button>
      </div>
      <div class="row small" style="margin-top: 8px">
        <template v-if="lastAdded">
          <span class="ok">{{ t('deck.added', { label: lastAdded.label }) }}</span>
          <a href="#" @click.prevent="removeEvent(lastAdded.id)">{{ t('deck.undo') }}</a>
        </template>
        <span class="grow" />
        <a href="#" @click.prevent="emit('showStats')">{{ t('deck.allExpeditions') }} <Icon name="arrowRight" :size="12" /></a>
      </div>
    </Section>

    <Section v-if="isMe" :title="t('home.settings')" :default-open="false" store-key="deck.settings">
      <div class="row">
        <label>
          {{ t('deck.start') }}
          <Hint>{{ t('deck.startHint') }}</Hint>
          <DateTimeInput v-model="startLocal" />
        </label>
        <label>
          {{ t('deck.assumption') }}
          <Hint>{{ t('deck.assumptionHint') }}</Hint>
          <select v-model.number="unknownDepletion">
            <option :value="0">{{ t('deck.assumptionZero') }}</option>
            <option :value="25 / 101">25 %</option>
            <option :value="50 / 101">50 %</option>
            <option :value="75 / 101">75 %</option>
          </select>
        </label>
      </div>
      <Section :title="t('deck.correction')" :card="false" :default-open="false" store-key="deck.correction" class="correction">
        <template #hint><Hint>{{ t('deck.correctionHint') }}</Hint></template>
        <div class="row">
          <label v-for="c in data.state.cards" :key="c.key">
            {{ cardLabel(c.key) }} <input v-model.number="initialDrawn[c.key]" type="number" min="0" style="width: 70px" />
          </label>
        </div>
      </Section>
      <div class="row" style="margin-top: 10px">
        <button class="primary" @click="save">{{ t('common.save') }}</button>
        <span class="ok small">{{ msg }}</span>
      </div>
    </Section>
  </template>
</template>

<style scoped>
.toolbar { margin-bottom: 12px; }
.summary { margin-bottom: 4px; }
.bar { height: 8px; margin-top: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
.bar > div { height: 100%; border-radius: 4px; background: var(--accent); }
.bar.thin { height: 6px; margin-top: 0; border-radius: 3px; }
.bar-col { width: 30%; }
.correction :deep(.section-toggle) { font-weight: 400; font-size: 12px; color: var(--muted); }
.add-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 10px; }
.add-grid button { margin: 0; text-align: left; }
</style>

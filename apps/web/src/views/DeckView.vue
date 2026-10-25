<script setup lang="ts">
import Icon from '../components/Icon.vue';
import DateTimeInput from '../components/DateTimeInput.vue';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
import { cardLabel, dateTime, DEPLETION_LABEL, fmt, fmtCount } from '../format';

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

const cards = computed(() => [...(data.value?.state.cards ?? [])].sort((a: any, b: any) => b.nextProbability - a.nextProbability));
const progress = computed(() => (data.value ? data.value.state.drawnInDeck / data.value.state.deckSize : 0));
</script>

<template>
  <h1>
    {{ t('nav.deck') }}
    <Hint>
      <p>{{ t('deck.hint1', { n: data?.state.deckSize ?? 1000 }) }}</p>
      <p>{{ t('deck.hint2') }}</p>
    </Hint>
  </h1>
  <div class="card">
    <div class="row">
      <label>
        {{ t('common.player') }}
        <select v-model="userId">
          <option v-for="m in ctx!.members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
    </div>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <div class="card">
      <div class="row">
        <span>{{ t('deck.drawn') }} <b>{{ fmtCount(data.state.drawnInDeck) }}</b> / {{ data.state.deckSize }}</span>
        <span>{{ t('deck.remaining') }} <b>{{ fmtCount(data.state.remainingTotal) }}</b></span>
        <span class="muted">{{ t('deck.counts', { resets: data.state.resets, events: data.state.events, uncertain: data.state.uncertainNothing }) }}</span>
        <span class="grow" />
        <span v-if="data.settings.startTime" class="muted small">{{ t('deck.start') }} {{ dateTime(data.settings.startTime) }}</span>
        <button v-if="isMe" @click="resetDeck">{{ t('deck.reset') }}</button>
      </div>
      <div style="height: 8px; background: var(--surface-2); border-radius: 4px; margin-top: 8px">
        <div :style="{ width: progress * 100 + '%', height: '100%', background: 'var(--accent)', borderRadius: '4px' }" />
      </div>
    </div>

    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th>{{ t('deck.card') }}</th><th class="num">{{ t('deck.inDeck') }}</th><th class="num">{{ t('combat.left') }}</th><th class="num">{{ t('deck.minMax') }}</th><th class="num">{{ t('deck.nextCard') }}</th><th style="width: 30%"></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in cards" :key="c.key">
            <td>{{ cardLabel(c.key) }}</td>
            <td class="num muted">{{ c.count }}</td>
            <td class="num"><b>{{ fmtCount(c.remaining) }}</b></td>
            <td class="num small muted">{{ c.remainingMin !== c.remainingMax ? `${fmtCount(c.remainingMin)}–${fmtCount(c.remainingMax)}` : '' }}</td>
            <td class="num">{{ fmt(c.nextProbability * 100, 2) }} %</td>
            <td class="m-hide">
              <div :style="{ width: Math.min(100, c.nextProbability * 300) + '%', height: '6px', background: 'var(--accent)', borderRadius: '3px' }" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isMe" class="card">
      <h3 style="margin-top: 0">
        {{ t('deck.addTitle') }}
        <Hint>
          <p>{{ t('deck.addHint1') }}</p>
          <p>{{ t('deck.addHint2') }}</p>
        </Hint>
      </h3>
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
        <RouterLink :to="`/${uni}/expeditions`">{{ t('deck.allExpeditions') }} <Icon name="arrowRight" :size="12" /></RouterLink>
      </div>
    </div>


    <div v-if="isMe" class="card">
      <h3 style="margin-top: 0">{{ t('home.settings') }}</h3>
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
      <details style="margin-top: 10px">
        <summary class="muted small">
          {{ t('deck.correction') }}
          <Hint>{{ t('deck.correctionHint') }}</Hint>
        </summary>
        <div class="row" style="margin-top: 8px">
          <label v-for="c in data.state.cards" :key="c.key">
            {{ cardLabel(c.key) }} <input v-model.number="initialDrawn[c.key]" type="number" min="0" style="width: 70px" />
          </label>
        </div>
      </details>
      <div class="row" style="margin-top: 10px">
        <button class="primary" @click="save">{{ t('common.save') }}</button>
        <span class="ok small">{{ msg }}</span>
      </div>
    </div>
  </template>
</template>

<style scoped>
.add-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 10px; }
.add-grid button { margin: 0; text-align: left; }
</style>

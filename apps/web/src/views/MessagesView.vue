<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useLoader, useProgressive, useSort, useUni, vStack } from '../composables';
import { dateTime } from '../format';
import { tables, useLiveReload } from '../live';

interface Party {
  name: string;
  coords: string | null;
}
interface Message {
  id: number;
  time: number;
  from_name: string;
  from_coords: string | null;
  recipients: Party[];
  subject: string;
  body: string;
  synced_by: string[];
}

const { t } = useI18n();
const { uni } = useUni();

const { data, error, load } = useLoader<{ share: boolean; messages: Message[] }>(() => uniApi(uni.value, '/messages'));
onMounted(load);
useLiveReload(load, tables('player_messages'));

const sender = ref('');
const recipient = ref('');
const all = computed(() => data.value?.messages ?? []);
const names = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
const senders = computed(() => names(all.value.map((m) => m.from_name)));
const recipients = computed(() => names(all.value.flatMap((m) => m.recipients.map((r) => r.name))));
const filtered = computed(() =>
  all.value.filter((m) => (!sender.value || m.from_name === sender.value) && (!recipient.value || m.recipients.some((r) => r.name === recipient.value))),
);

const party = (name: string, coords: string | null) => (coords ? `${name} [${coords}]` : name);
const sort = useSort(
  filtered,
  (m, k) => {
    switch (k) {
      case 'from':
        return m.from_name.toLowerCase();
      case 'to':
        return m.recipients.map((r) => r.name).join(', ').toLowerCase();
      case 'subject':
        return m.subject.toLowerCase();
      case 'synced':
        return m.synced_by.join(', ').toLowerCase();
      default:
        return m.time;
    }
  },
  'time',
);
const { shown, more, sentinel } = useProgressive(sort.sorted, 100);
</script>

<template>
  <h1>{{ t('nav.messages') }} <Hint>{{ t('messages.hint') }}</Hint></h1>
  <div class="card row">
    <label>
      {{ t('messages.sender') }}
      <select v-model="sender">
        <option value="">{{ t('common.all') }}</option>
        <option v-for="n in senders" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>
    <label>
      {{ t('messages.recipient') }}
      <select v-model="recipient">
        <option value="">{{ t('common.all') }}</option>
        <option v-for="n in recipients" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>
    <span v-if="data" class="muted small">{{ t('messages.count', { shown: filtered.length, total: all.length }) }}</span>
    <span v-if="data" class="muted small">
      {{ data.share ? t('messages.sharing') : t('messages.private') }}
      <RouterLink :to="`/${uni}/account`">{{ t('messages.change') }}</RouterLink>
    </span>
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <p v-if="data && !all.length" class="muted">{{ t('messages.empty') }}</p>
  <div v-else-if="data" class="table-wrap">
    <table v-stack class="data">
      <thead>
        <tr>
          <th class="sortable" @click="sort.sortBy('time')">{{ t('common.time') }}{{ sort.indicator('time') }}</th>
          <th class="sortable" @click="sort.sortBy('from')">{{ t('messages.sender') }}{{ sort.indicator('from') }}</th>
          <th class="sortable" @click="sort.sortBy('to')">{{ t('messages.recipient') }}{{ sort.indicator('to') }}</th>
          <th class="sortable" @click="sort.sortBy('subject')">{{ t('messages.subject') }}{{ sort.indicator('subject') }}</th>
          <th class="sortable" @click="sort.sortBy('synced')">{{ t('messages.syncedBy') }}{{ sort.indicator('synced') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in shown" :key="m.id">
          <td class="small nowrap">{{ dateTime(m.time) }}</td>
          <td>{{ party(m.from_name, m.from_coords) }}</td>
          <td>{{ m.recipients.map((r) => party(r.name, r.coords)).join(', ') }}</td>
          <td class="m-wide">
            <div class="subject">{{ m.subject }}</div>
            <div class="body">{{ m.body }}</div>
          </td>
          <td class="small muted">{{ m.synced_by.join(', ') }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="more" ref="sentinel" class="list-end" />
  </div>
</template>

<style scoped>
.nowrap { white-space: nowrap; }
.list-end { height: 1px; }
.subject { font-weight: 600; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 60ch; }
</style>

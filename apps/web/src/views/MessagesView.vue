<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import { useLoader, useProgressive, useSort, useUni } from '../composables';
import { dateTime } from '../format';
import { tables, useLiveReload } from '../live';

interface Party {
  name: string;
  coords: string | null;
  /** player of the own alliance */
  ally: boolean;
}
interface Message {
  id: number;
  time: number;
  from_name: string;
  from_coords: string | null;
  from_ally: boolean;
  recipients: Party[];
  subject: string;
  body: string;
  synced_by: string[];
  /** synced by the user: they choose whether the alliance sees their copy */
  own: boolean;
  own_shared: boolean;
  /** the alliance sees it (the user's copy or another member's) */
  shared: boolean;
}

const { t } = useI18n();
const { uni } = useUni();

const { data, error, load } = useLoader<{ share: boolean; messages: Message[] }>(() => uniApi(uni.value, '/messages'));
onMounted(load);
useLiveReload(load, tables('player_messages'));

const route = useRoute();
const router = useRouter();
/** `?with=Name` (player page, also former names; a click on a name): messages from or to that player */
const partner = computed(() => [route.query.with ?? []].flat().filter((n): n is string => !!n));
const showPartner = (name: string) => router.replace({ query: { ...route.query, with: name } });
const clearPartner = () => router.replace({ query: { ...route.query, with: undefined } });
const sender = ref('');
const recipient = ref('');
const all = computed(() => data.value?.messages ?? []);
const names = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
const senders = computed(() => names(all.value.map((m) => m.from_name)));
const recipients = computed(() => names(all.value.flatMap((m) => m.recipients.map((r) => r.name))));
const filtered = computed(() =>
  all.value.filter(
    (m) =>
      (!partner.value.length || partner.value.includes(m.from_name) || m.recipients.some((r) => partner.value.includes(r.name))) &&
      (!sender.value || m.from_name === sender.value) && (!recipient.value || m.recipients.some((r) => r.name === recipient.value)),
  ),
);

const SORT_KEYS = ['time', 'from', 'to', 'subject'] as const;
const sortLabel: Record<(typeof SORT_KEYS)[number], string> = {
  time: 'common.time', from: 'messages.sender', to: 'messages.recipient', subject: 'messages.subject',
};
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
      default:
        return m.time;
    }
  },
  'time',
);
const { shown, more, sentinel } = useProgressive(sort.sorted, 100);

/** Shares the user's copy of a message with the alliance or not. */
const busy = ref<number | null>(null);
const shareError = ref('');
async function toggleShare(m: Message) {
  busy.value = m.id;
  shareError.value = '';
  try {
    const shared = !m.own_shared;
    await uniApi(uni.value, `/messages/${m.id}/share`, { body: { shared } });
    m.own_shared = m.shared = shared;
    await load();
  } catch (e) {
    shareError.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <h1>{{ t('nav.messages') }} <Hint>{{ t('messages.hint') }}</Hint></h1>
  <div class="card filters">
    <div class="row">
      <span v-if="partner.length" class="chip">
        {{ t('messages.with', { name: partner[0] }) }}
        <button :title="t('messages.clear')" :aria-label="t('messages.clear')" @click="clearPartner">✕</button>
      </span>
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
      <label>
        {{ t('messages.sortBy') }}
        <select :value="sort.key.value" @change="sort.key.value = ($event.target as HTMLSelectElement).value">
          <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ t(sortLabel[k]) }}</option>
        </select>
      </label>
      <button
          :title="t(sort.descending.value ? 'messages.desc' : 'messages.asc')"
          :aria-label="t(sort.descending.value ? 'messages.desc' : 'messages.asc')"
          @click="sort.descending.value = !sort.descending.value"
        >
          {{ sort.descending.value ? '▾' : '▴' }}
      </button>
    </div>
    <div v-if="data" class="row small muted">
      <span>{{ t('messages.count', { shown: filtered.length, total: all.length }) }}</span>
      <span class="legend"><i class="dot ally" /> {{ t('messages.legendAlly') }} <i class="dot other" /> {{ t('messages.legendOther') }}</span>
      <span>
        {{ data.share ? t('messages.sharing') : t('messages.private') }}
        <RouterLink :to="`/${uni}/account`">{{ t('messages.change') }}</RouterLink>
      </span>
    </div>
  </div>
  <div v-if="error || shareError" class="error">{{ error || shareError }}</div>
  <p v-if="data && !all.length" class="muted">{{ t('messages.empty') }}</p>
  <div v-else-if="data" class="messages">
    <article v-for="m in shown" :key="m.id" class="msg" :class="m.from_ally ? 'ally' : 'other'">
      <header>
        <div class="parties">
          <a href="#" class="party" :class="m.from_ally ? 'ally' : 'other'" @click.prevent="showPartner(m.from_name)">
            {{ m.from_name }}<span v-if="m.from_coords" class="coords"> [{{ m.from_coords }}]</span>
          </a>
          <span class="arrow" aria-hidden="true">→</span>
          <template v-for="(r, i) in m.recipients" :key="r.name">
            <span v-if="i" class="faint">,</span>
            <a href="#" class="party" :class="r.ally ? 'ally' : 'other'" @click.prevent="showPartner(r.name)">
              {{ r.name }}<span v-if="r.coords" class="coords"> [{{ r.coords }}]</span>
            </a>
          </template>
        </div>
        <time class="small muted">{{ dateTime(m.time) }}</time>
      </header>
      <div class="subject">{{ m.subject }}</div>
      <div class="body">{{ m.body }}</div>
      <footer class="small">
        <span class="faint">{{ t('messages.syncedBy') }}: {{ m.synced_by.join(', ') }}</span>
        <span class="visibility" :class="{ on: m.shared }">
          {{ m.shared ? (m.own && !m.own_shared ? t('messages.visibleOthers') : t('messages.visibleAlliance')) : t('messages.visiblePrivate') }}
        </span>
        <button v-if="m.own && !(m.shared && !m.own_shared)" class="share" :disabled="busy === m.id" @click="toggleShare(m)">
          {{ m.own_shared ? t('messages.unshare') : t('messages.share') }}
        </button>
      </footer>
    </article>
    <div v-if="more" ref="sentinel" class="list-end" />
  </div>
</template>

<style scoped>
.filters .row + .row { margin-top: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 12px; }
.chip button { background: none; border: 0; padding: 0; color: var(--muted); cursor: pointer; }
.legend { display: inline-flex; align-items: center; gap: 4px; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-left: 4px; }
.dot.ally { background: var(--info); }
.dot.other { background: var(--warn); }

.messages { display: flex; flex-direction: column; gap: 10px; }
.msg {
  background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--warn);
  border-radius: var(--radius); padding: 10px 14px; text-align: left;
}
.msg.ally { border-left-color: var(--info); }
.msg header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
.parties { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; min-width: 0; }
.party { font-weight: 600; overflow-wrap: anywhere; }
.party.ally { color: var(--info); }
.party.other { color: var(--warn); }
.coords { font-weight: 400; font-family: var(--mono); font-size: 12px; color: var(--muted); }
.arrow { color: var(--faint); }
.subject { margin-top: 4px; font-weight: 600; }
.body { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 80ch; }
.msg footer { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); }
.visibility { color: var(--muted); }
.visibility.on { color: var(--pos); }
.share { margin-left: auto; }
.list-end { height: 1px; }

@media (max-width: 800px) {
  .msg { padding: 10px 12px; }
  .msg header time { width: 100%; }
  .share { margin-left: 0; width: 100%; }
}
</style>

<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Icon from '../components/Icon.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import PlayerMessage from '../components/PlayerMessage.vue';
import ProfileLink from '../components/ProfileLink.vue';
import { useLoader, useProgressive, useSort, useStored, useUni } from '../composables';
import { dateTime } from '../format';
import { tables, useLiveReload } from '../live';
import type { Conversation, MessageParty, PlayerMessage as Message } from '../messages';

const { t } = useI18n();
const { uni } = useUni();

const { data, error, load } = useLoader<{ share: boolean; messages: Message[]; conversations: Conversation[] }>(() =>
  uniApi(uni.value, '/messages'),
);
onMounted(load);
useLiveReload(load, tables('player_messages'));

/** single messages or conversations (all messages with the same partner) */
const mode = useStored<'conversations' | 'single'>('messages.mode', 'conversations');

const route = useRoute();
const router = useRouter();
/**
 * Partner filter: `?partner=<hub player id>` and/or `?with=Name` (player page, also former names; a click on a name):
 * messages from or to that player.
 */
const partnerId = computed(() => Number(route.query.partner) || null);
const partnerNames = computed(() => [route.query.with ?? []].flat().filter((n): n is string => !!n));
const isPartner = (p: MessageParty) => (!!partnerId.value && p.player === partnerId.value) || partnerNames.value.includes(p.name);
const partnerLabel = computed(() => {
  if (partnerId.value) {
    const p = data.value?.conversations.flatMap((c) => c.parties).find((x) => x.player === partnerId.value);
    if (p) return p.name;
  }
  return partnerNames.value[0] ?? null;
});
const showPartner = (p: MessageParty) =>
  router.replace({ query: { ...route.query, partner: p.player ? String(p.player) : undefined, with: p.player ? undefined : p.name } });
const clearPartner = () => router.replace({ query: { ...route.query, partner: undefined, with: undefined } });

const sender = ref('');
const recipient = ref('');
const all = computed(() => data.value?.messages ?? []);
const names = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
const senders = computed(() => names(all.value.map((m) => m.from.name)));
const recipients = computed(() => names(all.value.flatMap((m) => m.recipients.map((r) => r.name))));
const filtered = computed(() =>
  all.value.filter(
    (m) =>
      (!partnerLabel.value || isPartner(m.from) || m.recipients.some(isPartner)) &&
      (!sender.value || m.from.name === sender.value) && (!recipient.value || m.recipients.some((r) => r.name === recipient.value)),
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
        return m.from.name.toLowerCase();
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

// ------------------------------------------------------------ conversations

/** Conversations with at least one message passing the filters, with those messages oldest first (chat order). */
const convs = computed(() => {
  const byConv = new Map<string, Message[]>();
  for (const m of filtered.value) {
    const list = byConv.get(m.conversation) ?? [];
    list.push(m);
    byConv.set(m.conversation, list);
  }
  const dir = sort.descending.value ? -1 : 1;
  return (data.value?.conversations ?? [])
    .filter((c) => byConv.has(c.id))
    .map((c) => {
      const messages = byConv.get(c.id)!.sort((a, b) => a.time - b.time || a.id - b.id);
      return { ...c, messages, latest: messages[messages.length - 1] };
    })
    .sort((a, b) => (a.latest.time - b.latest.time) * dir);
});
const { shown: convsShown, more: convsMore, sentinel: convSentinel } = useProgressive(convs, 50);

/** Who the conversation is with: everyone but the user; without the user (shared by others) everyone, members first. */
const title = (c: Conversation) => {
  const others = c.parties.filter((p) => !p.self);
  return others.length < c.parties.length ? others : [...c.parties].sort((a, b) => Number(b.member) - Number(a.member));
};
const open = ref(new Set<string>());
const isOpen = (id: string) => open.value.has(id) || convs.value.length === 1;
function toggle(id: string) {
  const s = new Set(open.value);
  if (!s.delete(id)) s.add(id);
  open.value = s;
}
const preview = (m: Message) => m.body.split('\n')[0];

// ------------------------------------------------------------ sharing

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
  <PageHeader :title="t('nav.messages')">
    <template #hint>
      <Hint>{{ t('messages.hint') }}</Hint>
    </template>
  </PageHeader>
  <div class="card filters">
    <div class="row">
      <div class="tabs" style="margin: 0">
        <button :class="{ active: mode === 'conversations' }" @click="mode = 'conversations'">{{ t('messages.modeConversations') }}</button>
        <button :class="{ active: mode === 'single' }" @click="mode = 'single'">{{ t('messages.modeSingle') }}</button>
      </div>
      <span v-if="partnerLabel" class="chip">
        {{ t('messages.with', { name: partnerLabel }) }}
        <button class="icon-btn small" :title="t('messages.clear')" :aria-label="t('messages.clear')" @click="clearPartner"><Icon name="close" :size="12" /></button>
      </span>
    </div>
    <div class="row">
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
      <label v-if="mode === 'single'">
        {{ t('messages.sortBy') }}
        <select :value="sort.key.value" @change="sort.key.value = ($event.target as HTMLSelectElement).value">
          <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ t(sortLabel[k]) }}</option>
        </select>
      </label>
      <span v-else class="small muted">{{ t('messages.sortLast') }}</span>
      <button
        class="icon-btn"
        :title="t(sort.descending.value ? 'messages.desc' : 'messages.asc')"
        :aria-label="t(sort.descending.value ? 'messages.desc' : 'messages.asc')"
        @click="sort.descending.value = !sort.descending.value"
      >
        <Icon :name="sort.descending.value ? 'sortDesc' : 'sortAsc'" />
      </button>
    </div>
    <div v-if="data" class="row small muted">
      <span v-if="mode === 'single'">{{ t('messages.count', { shown: filtered.length, total: all.length }) }}</span>
      <span v-else>{{ t('messages.conversationCount', { n: convs.length }, convs.length) }}</span>
      <span class="legend"><i class="dot ally" /> {{ t('messages.legendAlly') }} <i class="dot other" /> {{ t('messages.legendOther') }}</span>
      <span>
        {{ data.share ? t('messages.sharing') : t('messages.private') }}
        <RouterLink :to="`/${uni}/account`">{{ t('messages.change') }}</RouterLink>
      </span>
    </div>
  </div>
  <div v-if="error || shareError" class="error">{{ error || shareError }}</div>
  <p v-if="data && !all.length" class="muted">{{ t('messages.empty') }}</p>

  <div v-else-if="data && mode === 'single'" class="list">
    <PlayerMessage v-for="m in shown" :key="m.id" :m="m" :busy="busy === m.id" @share="toggleShare" @partner="showPartner" />
    <div v-if="more" ref="sentinel" class="list-end" />
  </div>

  <div v-else-if="data" class="list">
    <section v-for="c in convsShown" :key="c.id" class="conv" :class="{ open: isOpen(c.id) }">
      <!-- not a <button>: it holds the profile links -->
      <div
        class="conv-head"
        role="button"
        tabindex="0"
        :aria-expanded="isOpen(c.id)"
        @click="toggle(c.id)"
        @keydown.enter.prevent="toggle(c.id)"
        @keydown.space.prevent="toggle(c.id)"
      >
        <span class="conv-title">
          <template v-for="(p, i) in title(c)" :key="p.name">
            <span v-if="i" class="faint">{{ c.parties.some((x) => x.self) ? ', ' : ' – ' }}</span>
            <span class="party" :class="p.ally ? 'ally' : 'other'">{{ p.name }}</span>
            <ProfileLink v-if="p.player" :id="p.player" :name="p.name" />
          </template>
          <span class="badge">{{ c.messages.length }}</span>
        </span>
        <time class="small muted">{{ dateTime(c.latest.time) }}</time>
        <span class="conv-preview small muted">
          <b>{{ c.latest.from.name }}:</b> {{ c.latest.subject }} – {{ preview(c.latest) }}
        </span>
      </div>
      <div v-if="isOpen(c.id)" class="chat">
        <PlayerMessage v-for="m in c.messages" :key="m.id" :m="m" chat :busy="busy === m.id" @share="toggleShare" @partner="showPartner" />
      </div>
    </section>
    <div v-if="convsMore" ref="convSentinel" class="list-end" />
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
.list { display: flex; flex-direction: column; gap: 10px; }
.list-end { height: 1px; }

.conv { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.conv.open { border-color: var(--border-strong); }
.conv-head {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; width: 100%; padding: 10px 14px;
  border-radius: var(--radius); cursor: pointer;
}
.conv-head:hover { background: var(--surface-2); }
.conv-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.conv-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 4px; font-weight: 600; min-width: 0; }
.conv-title .badge { margin-left: 6px; }
.party { overflow-wrap: anywhere; }
.party.ally { color: var(--info); }
.party.other { color: var(--warn); }
.conv-preview { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat { display: flex; flex-direction: column; gap: 8px; padding: 4px 14px 14px; border-top: 1px solid var(--border); padding-top: 12px; }

@media (max-width: 800px) {
  .conv-head { padding: 10px 12px; }
  .chat { padding: 10px 8px 12px; }
}
</style>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { dateTime } from '../format';
import type { MessageParty, PlayerMessage } from '../messages';
import ProfileLink from './ProfileLink.vue';

/** One player message: a card in the list, or a speech bubble in a conversation (`chat`). */
const props = defineProps<{ m: PlayerMessage; chat?: boolean; busy?: boolean }>();
const emit = defineEmits<{ share: [m: PlayerMessage]; partner: [p: MessageParty] }>();
const { t } = useI18n();

/** The alliance sees it through another member's copy: the user can't hide it. */
const sharedByOthers = () => props.m.shared && !props.m.own_shared;
</script>

<template>
  <article class="msg" :class="[m.from.ally ? 'ally' : 'other', { chat, out: chat && m.out }]">
    <header>
      <div class="parties">
        <a href="#" class="party" :class="m.from.ally ? 'ally' : 'other'" @click.prevent="emit('partner', m.from)">
          {{ m.from.name }}<span v-if="m.from.coords && !chat" class="coords"> [{{ m.from.coords }}]</span>
        </a>
        <ProfileLink v-if="m.from.player" :id="m.from.player" :name="m.from.name" />
        <template v-if="!chat || m.recipients.length > 1">
          <span class="arrow" aria-hidden="true">→</span>
          <template v-for="(r, i) in m.recipients" :key="r.name">
            <span v-if="i" class="faint">,</span>
            <a href="#" class="party" :class="r.ally ? 'ally' : 'other'" @click.prevent="emit('partner', r)">
              {{ r.name }}<span v-if="r.coords && !chat" class="coords"> [{{ r.coords }}]</span>
            </a>
            <ProfileLink v-if="r.player" :id="r.player" :name="r.name" />
          </template>
        </template>
      </div>
      <time class="small muted">{{ dateTime(m.time) }}</time>
    </header>
    <div class="subject">{{ m.subject }}</div>
    <div class="body">{{ m.body }}</div>
    <footer class="small">
      <span class="faint">{{ t('messages.syncedBy') }}: {{ m.synced_by.join(', ') }}</span>
      <span class="visibility" :class="{ on: m.shared }">
        {{ m.shared ? (m.own && sharedByOthers() ? t('messages.visibleOthers') : t('messages.visibleAlliance')) : t('messages.visiblePrivate') }}
      </span>
      <button v-if="m.own && !sharedByOthers()" class="share" :disabled="busy" @click="emit('share', m)">
        {{ m.own_shared ? t('messages.unshare') : t('messages.share') }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
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

/* conversation: speech bubbles, the user's (or the members') side on the right */
.msg.chat { max-width: min(85%, 70ch); align-self: flex-start; background: var(--surface-2); border-left-width: 1px; border-radius: 4px var(--radius) var(--radius) var(--radius); }
.msg.chat.ally { border-left-color: var(--info); }
.msg.chat.out { align-self: flex-end; border-radius: var(--radius) 4px var(--radius) var(--radius); }
.msg.chat .subject { font-weight: 400; color: var(--muted); font-size: 12px; }
.msg.chat footer { border-top: 0; padding-top: 0; margin-top: 6px; }

@media (max-width: 800px) {
  .msg { padding: 10px 12px; }
  .msg:not(.chat) header time { width: 100%; }
  .msg:not(.chat) .share { margin-left: 0; width: 100%; }
  .msg.chat { max-width: 92%; }
}
</style>

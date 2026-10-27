<script setup lang="ts">
import BackLink from '../components/BackLink.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, loadMe, session } from '../api';
import Hint from '../components/Hint.vue';
import { vStack } from '../composables';
import { DATE_FORMATS, dateFormat, setDateFormat, type DateFormat } from '../format';
import { currentLang, LANGS, setLocale, type Lang } from '../i18n';
import { liveHints } from '../live';
import { disablePush, enablePush, loadPushStatus, pushStatus, testPush } from '../push';

const { t } = useI18n();
/** opened inside a universe: the sidebar stays, no back link */
const inUni = !!useRoute().params.uni;
const newUsername = ref(session.me?.user?.username ?? '');
const usernamePassword = ref('');
const oldPassword = ref('');
const newPassword = ref('');
const lang = ref<Lang>(currentLang());
const msg = ref('');
const error = ref('');

async function run(fn: () => Promise<unknown>, ok: () => string) {
  msg.value = error.value = '';
  try {
    await fn();
    msg.value = ok();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const saveUsername = () =>
  run(async () => {
    await api('/auth/username', { body: { username: newUsername.value, password: usernamePassword.value } });
    usernamePassword.value = '';
    await loadMe();
  }, () => t('account.usernameChanged'));

const savePassword = () =>
  run(async () => {
    await api('/auth/password', { body: { oldPassword: oldPassword.value, newPassword: newPassword.value } });
    oldPassword.value = newPassword.value = '';
  }, () => t('account.passwordChanged'));

/** Fleet movements shared with the other members (game mission ids, as the server's SHARE_MISSIONS). */
const MISSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17];
const share = ref<{ enabled: boolean; hidden: number[]; history: boolean } | null>(null);
/** Player messages shared with the other members (off: only the user sees them). */
const messageShare = ref<{ enabled: boolean } | null>(null);
const showOnline = ref<{ enabled: boolean } | null>(null);
const shareActivity = ref<{ enabled: boolean } | null>(null);
const shareSyncs = ref<{ enabled: boolean } | null>(null);

/** Which notifications are pushed (all devices of the user, server: push.ts); this browser is switched on separately. */
interface PushPrefs {
  attackSelf: boolean;
  attackOthers: boolean;
  invites: boolean;
  comments: boolean;
  launch: boolean;
  buildings: boolean;
  fleets: boolean;
  storage: boolean;
  accessRequests: boolean;
  leadMinutes: number;
}
const ALL_PUSH_KINDS = ['attackSelf', 'attackOthers', 'invites', 'comments', 'buildings', 'storage', 'fleets', 'launch', 'accessRequests'] as const;
/** access requests only concern global admins */
const PUSH_KINDS = computed(() => ALL_PUSH_KINDS.filter((k) => k !== 'accessRequests' || session.me?.user?.isAdmin));
const LEAD_MINUTES = [1, 2, 5, 10, 15, 30];
const pushPrefs = ref<PushPrefs | null>(null);
const pushBusy = ref(false);
const savePushPrefs = () =>
  run(async () => {
    pushPrefs.value = await api('/auth/push-settings', { body: pushPrefs.value });
  }, () => t('account.pushSaved'));
async function togglePush() {
  pushBusy.value = true;
  try {
    await run(async () => {
      if (pushStatus.value === 'on') return await disablePush();
      let status;
      try {
        status = await enablePush();
      } catch (e) {
        throw new Error(t('account.pushSubscribeFailed', { error: (e as Error).message }));
      }
      if (status === 'denied') throw new Error(t('account.pushDeniedHint'));
    }, () => t(pushStatus.value === 'on' ? 'account.pushEnabledMsg' : 'account.pushDisabledMsg'));
  } finally {
    pushBusy.value = false;
  }
}
const sendTestPush = () =>
  run(async () => {
    const devices = await testPush();
    if (!devices) throw new Error(t('account.pushTestNone'));
  }, () => t('account.pushTestSent'));

/** The user's own Discord webhook (server: discord.ts): only its start comes back, settings separate from push. */
interface DiscordSettings {
  webhook: string | null;
  userId: string | null;
  prefs: PushPrefs;
}
const discord = ref<DiscordSettings | null>(null);
const discordWebhook = ref('');
const discordUserId = ref('');
async function saveDiscord(body: Record<string, unknown>, ok: string) {
  await run(async () => {
    discord.value = await api<DiscordSettings>('/auth/discord', { body });
    discordWebhook.value = '';
    discordUserId.value = discord.value.userId ?? '';
  }, () => t(ok));
}
const saveDiscordWebhook = () => saveDiscord({ webhook: discordWebhook.value.trim() }, 'account.discordSaved');
const removeDiscordWebhook = () => saveDiscord({ webhook: null }, 'account.discordRemoved');
const saveDiscordUserId = () => saveDiscord({ userId: discordUserId.value.trim() || null }, 'account.discordSaved');
const saveDiscordPrefs = () => saveDiscord({ prefs: discord.value!.prefs }, 'account.pushSaved');
const sendTestDiscord = () => run(() => api('/auth/discord/test', { method: 'POST' }), () => t('account.discordTestSent'));

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';
const openapiUrl = `${apiBase}/openapi.json`;
const apiOrigin = typeof window !== 'undefined' ? window.location.origin : '';
interface ApiTokenRow {
  id: number;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}
const apiTokens = ref<ApiTokenRow[]>([]);
const newTokenName = ref('');
const revealedToken = ref<string | null>(null);

async function loadApiTokens() {
  apiTokens.value = await api<ApiTokenRow[]>('/auth/tokens');
}

async function createApiToken() {
  await run(async () => {
    const created = await api<{ token: string }>('/auth/tokens', { body: { name: newTokenName.value || t('account.apiTokenDefaultName') } });
    revealedToken.value = created.token;
    newTokenName.value = '';
    await loadApiTokens();
  }, () => t('account.apiTokenCreatedMsg'));
}

async function revokeApiToken(id: number, name: string) {
  if (!confirm(t('account.apiTokenRevokeConfirm', { name }))) return;
  await run(async () => {
    await api(`/auth/tokens/${id}`, { method: 'DELETE' });
    await loadApiTokens();
  }, () => t('account.apiTokenRevoked'));
}

async function copyRevealedToken() {
  if (!revealedToken.value) return;
  try {
    await navigator.clipboard.writeText(revealedToken.value);
    msg.value = t('account.apiTokenCopied');
  } catch {
    error.value = t('account.apiTokenCopyFailed');
  }
}

function formatTokenTime(sec: number | null) {
  if (sec == null) return '—';
  return new Date(sec * 1000).toLocaleString();
}

onMounted(async () => {
  try {
    const [fleetShare, messages, online, activity, syncs, prefs, discordSettings] = await Promise.all([
      api('/auth/fleet-share'),
      api('/auth/message-share'),
      api('/auth/show-online'),
      api<{ enabled: boolean }>('/auth/share-activity'),
      api<{ enabled: boolean }>('/auth/share-syncs'),
      api<PushPrefs>('/auth/push-settings'),
      api<DiscordSettings>('/auth/discord'),
      loadApiTokens(),
      loadPushStatus(),
    ]);
    pushPrefs.value = prefs;
    discord.value = discordSettings;
    discordUserId.value = discordSettings.userId ?? '';
    share.value = fleetShare;
    messageShare.value = messages;
    showOnline.value = online;
    shareActivity.value = activity;
    shareSyncs.value = syncs;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const saveShareActivity = () =>
  run(async () => {
    shareActivity.value = await api('/auth/share-activity', { body: shareActivity.value });
  }, () => t('account.shareActivitySaved'));
const saveShareSyncs = () =>
  run(async () => {
    shareSyncs.value = await api('/auth/share-syncs', { body: shareSyncs.value });
  }, () => t('account.shareSyncsSaved'));
const saveShowOnline = () =>
  run(async () => {
    showOnline.value = await api('/auth/show-online', { body: showOnline.value });
  }, () => t('account.showOnlineSaved'));
function toggleMission(id: number) {
  const s = share.value!;
  s.hidden = s.hidden.includes(id) ? s.hidden.filter((m) => m !== id) : [...s.hidden, id];
  saveShare();
}
const saveShare = () =>
  run(async () => {
    share.value = await api('/auth/fleet-share', { body: share.value });
  }, () => t('account.fleetShareSaved'));
const saveMessageShare = () =>
  run(async () => {
    messageShare.value = await api('/auth/message-share', { body: messageShare.value });
  }, () => t('account.fleetShareSaved'));

// switch right away, then store it on the account (applies on other devices after the next login/reload)
const saveLang = () =>
  run(async () => {
    setLocale(lang.value);
    await api('/auth/lang', { body: { lang: lang.value } });
    if (session.me?.user) session.me.user.lang = lang.value;
  }, () => t('account.languageChanged'));

// same as the language: applies right away, stored on the account
const format = ref<DateFormat>(dateFormat.value);
const saveDateFormat = () =>
  run(async () => {
    setDateFormat(format.value);
    await api('/auth/date-format', { body: { dateFormat: format.value } });
    if (session.me?.user) session.me.user.dateFormat = format.value;
  }, () => t('account.dateFormatChanged'));
</script>

<template>
  <div class="account" :class="{ standalone: !inUni }">
    <BackLink v-if="!inUni" to="/" :label="t('common.back')" />
    <h1>{{ t('account.title', { name: session.me?.user?.username }) }}</h1>
    <div v-if="msg" class="ok status">{{ msg }}</div>
    <div v-if="error" class="error status">{{ error }}</div>
    <div class="account-grid">
      <section class="card">
        <h2>{{ t('account.general') }}</h2>
        <div class="field">
          <span class="field-label">{{ t('account.language') }} <Hint>{{ t('account.languageHint') }}</Hint></span>
          <select v-model="lang" @change="saveLang">
            <option v-for="l in LANGS" :key="l" :value="l">{{ t(`languages.${l}`) }}</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">{{ t('account.dateFormat') }} <Hint>{{ t('account.dateFormatHint') }}</Hint></span>
          <select v-model="format" @change="saveDateFormat">
            <option v-for="f in DATE_FORMATS" :key="f" :value="f">{{ t(`account.dateFormats.${f}`) }}</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">{{ t('account.hints') }}</span>
          <label class="check"><input v-model="liveHints" type="checkbox" /> {{ t('account.liveHints') }}</label>
        </div>
        <div v-if="showOnline" class="field">
          <span class="field-label">{{ t('account.showOnline') }} <Hint>{{ t('account.showOnlineHint') }}</Hint></span>
          <label class="check"><input v-model="showOnline.enabled" type="checkbox" @change="saveShowOnline" /> {{ t('account.showOnlineEnabled') }}</label>
        </div>
        <div v-if="shareActivity" class="field">
          <span class="field-label">{{ t('account.shareActivity') }} <Hint>{{ t('account.shareActivityHint') }}</Hint></span>
          <label class="check"><input v-model="shareActivity.enabled" type="checkbox" @change="saveShareActivity" /> {{ t('account.shareActivityEnabled') }}</label>
        </div>
        <div v-if="shareSyncs" class="field">
          <span class="field-label">{{ t('account.shareSyncs') }} <Hint>{{ t('account.shareSyncsHint') }}</Hint></span>
          <label class="check"><input v-model="shareSyncs.enabled" type="checkbox" @change="saveShareSyncs" /> {{ t('account.shareSyncsEnabled') }}</label>
        </div>
      </section>
      <section class="card">
        <h2>{{ t('account.push') }} <Hint>{{ t('account.pushHint') }}</Hint></h2>
        <div class="field">
          <span class="field-label">{{ t('account.pushDevice') }}</span>
          <p class="muted small push-status">{{ t(`account.pushStatus.${pushStatus}`) }}</p>
          <div v-if="pushStatus === 'on' || pushStatus === 'off'" class="row">
            <button type="button" :class="{ primary: pushStatus === 'off' }" :disabled="pushBusy" @click="togglePush">
              {{ pushStatus === 'on' ? t('account.pushDisable') : t('account.pushEnable') }}
            </button>
            <button v-if="pushStatus === 'on'" type="button" @click="sendTestPush">{{ t('account.pushTest') }}</button>
          </div>
        </div>
        <div v-if="pushPrefs && pushStatus !== 'disabled'" class="field">
          <span class="field-label">{{ t('account.pushKinds') }} <Hint>{{ t('account.pushKindsHint') }}</Hint></span>
          <label v-for="k in PUSH_KINDS" :key="k" class="check">
            <input v-model="pushPrefs[k]" type="checkbox" @change="savePushPrefs" /> {{ t(`account.pushKind.${k}`) }}
          </label>
          <label class="push-lead" :class="{ off: !pushPrefs.launch }">
            {{ t('account.pushLead') }}
            <select v-model.number="pushPrefs.leadMinutes" :disabled="!pushPrefs.launch" @change="savePushPrefs">
              <option v-for="m in LEAD_MINUTES" :key="m" :value="m">{{ t('account.pushLeadMinutes', { n: m }) }}</option>
            </select>
          </label>
        </div>
        <p class="muted small">{{ t('account.pushPasted') }}</p>
        <p class="muted small">{{ t('account.pushIos') }}</p>
      </section>
      <section v-if="discord" class="card">
        <h2>{{ t('account.discord') }} <Hint>{{ t('account.discordHint') }}</Hint></h2>
        <div class="field">
          <span class="field-label">{{ t('account.discordWebhook') }} <Hint>{{ t('account.discordWebhookHint') }}</Hint></span>
          <p v-if="discord.webhook" class="muted small push-status">{{ t('account.discordWebhookSet', { hint: discord.webhook }) }}</p>
          <form class="row" @submit.prevent="saveDiscordWebhook">
            <input v-model="discordWebhook" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" />
            <button type="submit" class="primary" :disabled="!discordWebhook.trim()">{{ t('common.save') }}</button>
          </form>
          <div v-if="discord.webhook" class="row">
            <button type="button" @click="sendTestDiscord">{{ t('account.pushTest') }}</button>
            <button type="button" class="danger" @click="removeDiscordWebhook">{{ t('account.discordRemove') }}</button>
          </div>
        </div>
        <div v-if="discord.webhook" class="field">
          <span class="field-label">{{ t('account.pushKinds') }}</span>
          <label v-for="k in PUSH_KINDS" :key="k" class="check">
            <input v-model="discord.prefs[k]" type="checkbox" @change="saveDiscordPrefs" /> {{ t(`account.pushKind.${k}`) }}
          </label>
          <label class="push-lead" :class="{ off: !discord.prefs.launch }">
            {{ t('account.pushLead') }}
            <select v-model.number="discord.prefs.leadMinutes" :disabled="!discord.prefs.launch" @change="saveDiscordPrefs">
              <option v-for="m in LEAD_MINUTES" :key="m" :value="m">{{ t('account.pushLeadMinutes', { n: m }) }}</option>
            </select>
          </label>
        </div>
        <div class="field">
          <span class="field-label">{{ t('account.discordUserId') }} <Hint>{{ t('account.discordUserIdHint') }}</Hint></span>
          <form class="row" @submit.prevent="saveDiscordUserId">
            <input v-model="discordUserId" inputmode="numeric" autocomplete="off" placeholder="123456789012345678" />
            <button type="submit">{{ t('common.save') }}</button>
          </form>
        </div>
      </section>
      <section v-if="share || messageShare" class="card">
        <h2>{{ t('account.sharing') }}</h2>
        <div v-if="share" class="field">
          <span class="field-label">{{ t('account.fleetShare') }} <Hint>{{ t('account.fleetShareHint') }}</Hint></span>
          <label class="check"><input v-model="share.enabled" type="checkbox" @change="saveShare" /> {{ t('account.fleetShareEnabled') }}</label>
          <label class="check" :class="{ off: !share.enabled }">
            <input v-model="share.history" type="checkbox" :disabled="!share.enabled" @change="saveShare" /> {{ t('account.fleetShareHistory') }}
          </label>
          <div class="share-missions" :class="{ off: !share.enabled }">
            <label v-for="id in MISSIONS" :key="id" class="check">
              <input type="checkbox" :checked="!share.hidden.includes(id)" :disabled="!share.enabled" @change="toggleMission(id)" />
              {{ t(`game.missions.${id}`) }}
            </label>
          </div>
        </div>
        <div v-if="messageShare" class="field">
          <span class="field-label">{{ t('account.messageShare') }} <Hint>{{ t('account.messageShareHint') }}</Hint></span>
          <label class="check"><input v-model="messageShare.enabled" type="checkbox" @change="saveMessageShare" /> {{ t('account.messageShareEnabled') }}</label>
        </div>
      </section>
      <section class="card">
        <h2>{{ t('common.username') }}</h2>
        <form class="stack" @submit.prevent="saveUsername">
          <label>{{ t('account.newUsername') }} <input v-model="newUsername" autocomplete="username" /></label>
          <label>{{ t('common.password') }} <input v-model="usernamePassword" type="password" autocomplete="current-password" /></label>
          <button class="primary">{{ t('common.change') }}</button>
        </form>
      </section>
      <section class="card">
        <h2>{{ t('common.password') }}</h2>
        <form class="stack" @submit.prevent="savePassword">
          <label>{{ t('account.oldPassword') }} <input v-model="oldPassword" type="password" autocomplete="current-password" /></label>
          <label>{{ t('account.newPassword') }} <input v-model="newPassword" type="password" autocomplete="new-password" /></label>
          <button class="primary">{{ t('common.change') }}</button>
        </form>
      </section>
      <section class="card api-tokens">
        <h2>{{ t('account.apiTokens') }} <Hint>{{ t('account.apiTokensHint') }}</Hint></h2>
        <p class="api-doc"><a :href="openapiUrl" target="_blank" rel="noopener">{{ t('account.apiOpenApi') }}</a></p>
        <div v-if="revealedToken" class="token-reveal">
          <p>{{ t('account.apiTokenReveal') }}</p>
          <code class="token-value">{{ revealedToken }}</code>
          <div class="token-actions">
            <button type="button" class="primary" @click="copyRevealedToken">{{ t('account.apiTokenCopy') }}</button>
            <button type="button" @click="revealedToken = null">{{ t('account.apiTokenDismiss') }}</button>
          </div>
        </div>
        <form class="stack token-create" @submit.prevent="createApiToken">
          <label>{{ t('account.apiTokenName') }} <input v-model="newTokenName" maxlength="64" :placeholder="t('account.apiTokenDefaultName')" /></label>
          <button class="primary">{{ t('account.apiTokenCreate') }}</button>
        </form>
        <div v-if="apiTokens.length" class="table-wrap flat token-wrap">
          <table v-stack class="data">
            <thead>
              <tr>
                <th>{{ t('account.apiTokenName') }}</th>
                <th>{{ t('account.apiTokenPrefix') }}</th>
                <th>{{ t('account.apiTokenCreatedAt') }}</th>
                <th>{{ t('account.apiTokenLastUsed') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tok in apiTokens" :key="tok.id">
                <td>{{ tok.name }}</td>
                <td><code>{{ tok.prefix }}…</code></td>
                <td>{{ formatTokenTime(tok.createdAt) }}</td>
                <td>{{ formatTokenTime(tok.lastUsedAt) }}</td>
                <td><button type="button" class="danger" @click="revokeApiToken(tok.id, tok.name)">{{ t('account.apiTokenRevoke') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">{{ t('account.apiTokenNone') }}</p>
        <pre class="curl-hint">{{ t('account.apiCurlHint', { url: `${apiOrigin}${apiBase}`, group: session.me?.groups[0]?.id ?? 1 }) }}</pre>
      </section>
    </div>
  </div>
</template>

<style scoped>
.account { max-width: 1000px; }
.account.standalone { margin: 6vh auto; padding: 0 16px; }
.status { margin: 0 0 10px; }
.account-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 14px; align-items: start; }
.account-grid .card { margin: 0; min-width: 0; }
.card h2 { margin-top: 0; }
.field + .field { margin-top: 16px; }
.field-label { display: block; margin-bottom: 6px; font-weight: 600; }
.check { display: flex; gap: 8px; align-items: center; }
.share-missions { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 2px 12px; margin: 8px 0 0 24px; }
.share-missions.off, .check.off, .push-lead.off { opacity: 0.5; }
.push-lead { display: flex; gap: 8px; align-items: center; margin: 4px 0 0 24px; }
.push-status { margin: 0 0 6px; }
.stack { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.stack label { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.stack input { width: 100%; }
.api-doc { margin: 0 0 12px; }
.token-reveal {
  margin: 0 0 14px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.token-value { display: block; word-break: break-all; margin: 8px 0; font-family: var(--mono); }
.token-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.token-wrap { margin-top: 12px; }
.curl-hint {
  margin-top: 14px;
  padding: 10px;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text);
  overflow-x: auto;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  white-space: pre-wrap;
}
.muted { opacity: 0.75; margin: 8px 0 0; }
@media (max-width: 800px) {
  .account-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>

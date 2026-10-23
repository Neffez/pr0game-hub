<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, loadMe, session } from '../api';
import { currentLang, LANGS, setLocale, type Lang } from '../i18n';
import { liveHints } from '../live';

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
const MISSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15];
const share = ref<{ enabled: boolean; hidden: number[] } | null>(null);
/** Player messages shared with the other members (off: only the user sees them). */
const messageShare = ref<{ enabled: boolean } | null>(null);
onMounted(async () => {
  try {
    [share.value, messageShare.value] = await Promise.all([api('/auth/fleet-share'), api('/auth/message-share')]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
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
</script>

<template>
  <div class="card" :class="inUni ? 'account-box' : 'center-box'">
    <p v-if="!inUni"><RouterLink to="/">{{ t('common.back') }}</RouterLink></p>
    <h1>{{ t('account.title', { name: session.me?.user?.username }) }}</h1>
    <h2>{{ t('account.language') }}</h2>
    <select v-model="lang" @change="saveLang">
      <option v-for="l in LANGS" :key="l" :value="l">{{ t(`languages.${l}`) }}</option>
    </select>
    <p class="muted small">{{ t('account.languageHint') }}</p>
    <h2>{{ t('account.hints') }}</h2>
    <label><input v-model="liveHints" type="checkbox" /> {{ t('account.liveHints') }}</label>
    <template v-if="share">
      <h2>{{ t('account.fleetShare') }}</h2>
      <label><input v-model="share.enabled" type="checkbox" @change="saveShare" /> {{ t('account.fleetShareEnabled') }}</label>
      <div class="share-missions" :class="{ off: !share.enabled }">
        <label v-for="id in MISSIONS" :key="id">
          <input type="checkbox" :checked="!share.hidden.includes(id)" :disabled="!share.enabled" @change="toggleMission(id)" />
          {{ t(`game.missions.${id}`) }}
        </label>
      </div>
      <p class="muted small">{{ t('account.fleetShareHint') }}</p>
    </template>
    <template v-if="messageShare">
      <h2>{{ t('account.messageShare') }}</h2>
      <label><input v-model="messageShare.enabled" type="checkbox" @change="saveMessageShare" /> {{ t('account.messageShareEnabled') }}</label>
      <p class="muted small">{{ t('account.messageShareHint') }}</p>
    </template>
    <h2>{{ t('common.username') }}</h2>
    <form @submit.prevent="saveUsername">
      <label>{{ t('account.newUsername') }}</label>
      <input v-model="newUsername" autocomplete="username" />
      <label>{{ t('common.password') }}</label>
      <input v-model="usernamePassword" type="password" autocomplete="current-password" />
      <button class="primary">{{ t('common.change') }}</button>
    </form>
    <h2>{{ t('common.password') }}</h2>
    <form @submit.prevent="savePassword">
      <label>{{ t('account.oldPassword') }}</label>
      <input v-model="oldPassword" type="password" autocomplete="current-password" />
      <label>{{ t('account.newPassword') }}</label>
      <input v-model="newPassword" type="password" autocomplete="new-password" />
      <button class="primary">{{ t('common.change') }}</button>
    </form>
    <div v-if="msg" class="ok">{{ msg }}</div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<style scoped>
.share-missions { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 2px 12px; margin-top: 6px; }
.share-missions.off { opacity: 0.5; }
</style>

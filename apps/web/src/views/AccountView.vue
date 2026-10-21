<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, loadMe, session } from '../api';
import { currentLang, LANGS, setLocale, type Lang } from '../i18n';

const { t } = useI18n();
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

// switch right away, then store it on the account (applies on other devices after the next login/reload)
const saveLang = () =>
  run(async () => {
    setLocale(lang.value);
    await api('/auth/lang', { body: { lang: lang.value } });
    if (session.me?.user) session.me.user.lang = lang.value;
  }, () => t('account.languageChanged'));
</script>

<template>
  <div class="center-box card">
    <p><RouterLink to="/">{{ t('common.back') }}</RouterLink></p>
    <h1>{{ t('account.title', { name: session.me?.user?.username }) }}</h1>
    <h2>{{ t('account.language') }}</h2>
    <select v-model="lang" @change="saveLang">
      <option v-for="l in LANGS" :key="l" :value="l">{{ t(`languages.${l}`) }}</option>
    </select>
    <p class="muted small">{{ t('account.languageHint') }}</p>
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

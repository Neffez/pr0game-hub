<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { currentLang } from '../i18n';

const { t } = useI18n();
const username = ref('');
const password = ref('');
const message = ref('');
const error = ref('');
const sent = ref(false);

async function submit() {
  error.value = '';
  try {
    await api('/access-requests', { body: { username: username.value, password: password.value, message: message.value, lang: currentLang() } });
    sent.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="center-box card">
    <h1>{{ t('requestAccess.title') }}</h1>
    <template v-if="sent">
      <p>{{ t('requestAccess.sent') }}</p>
      <router-link to="/login">{{ t('requestAccess.toLogin') }}</router-link>
    </template>
    <form v-else @submit.prevent="submit">
      <p class="muted small">{{ t('requestAccess.intro') }}</p>
      <label for="request-user">{{ t('common.username') }}</label>
      <input id="request-user" v-model="username" autocomplete="username" autofocus />
      <label for="request-password">{{ t('invite.passwordHint') }}</label>
      <input id="request-password" v-model="password" type="password" autocomplete="new-password" />
      <label for="request-message">{{ t('requestAccess.message') }}</label>
      <textarea id="request-message" v-model="message" rows="4" maxlength="500" :placeholder="t('requestAccess.messageHint')" />
      <div v-if="error" class="error">{{ error }}</div>
      <button class="primary" type="submit">{{ t('requestAccess.submit') }}</button>
    </form>
    <p v-if="!sent" class="muted small"><router-link to="/login">{{ t('requestAccess.toLogin') }}</router-link></p>
  </div>
</template>

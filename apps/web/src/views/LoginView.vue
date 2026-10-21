<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, loadMe } from '../api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');

async function submit() {
  error.value = '';
  try {
    await api('/auth/login', { body: { username: username.value, password: password.value } });
    await loadMe();
    router.replace(String(route.query.next ?? '/'));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="center-box card">
    <h1>pr0game <span style="color: var(--accent)">Hub</span></h1>
    <form @submit.prevent="submit">
      <label>{{ t('common.username') }}</label>
      <input v-model="username" autocomplete="username" autofocus />
      <label>{{ t('common.password') }}</label>
      <input v-model="password" type="password" autocomplete="current-password" />
      <div v-if="error" class="error">{{ error }}</div>
      <button class="primary" type="submit">{{ t('login.submit') }}</button>
    </form>
    <p class="muted small">{{ t('login.inviteOnly') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api, loadMe, session } from '../api';

const newUsername = ref(session.me?.user?.username ?? '');
const usernamePassword = ref('');
const oldPassword = ref('');
const newPassword = ref('');
const msg = ref('');
const error = ref('');

async function run(fn: () => Promise<unknown>, ok: string) {
  msg.value = error.value = '';
  try {
    await fn();
    msg.value = ok;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const saveUsername = () =>
  run(async () => {
    await api('/auth/username', { body: { username: newUsername.value, password: usernamePassword.value } });
    usernamePassword.value = '';
    await loadMe();
  }, 'Benutzername geändert.');

const savePassword = () =>
  run(async () => {
    await api('/auth/password', { body: { oldPassword: oldPassword.value, newPassword: newPassword.value } });
    oldPassword.value = newPassword.value = '';
  }, 'Passwort geändert.');
</script>

<template>
  <div class="center-box card">
    <p><RouterLink to="/">← zurück</RouterLink></p>
    <h1>Konto: {{ session.me?.user?.username }}</h1>
    <h2>Benutzername</h2>
    <form @submit.prevent="saveUsername">
      <label>Neuer Benutzername</label>
      <input v-model="newUsername" autocomplete="username" />
      <label>Passwort</label>
      <input v-model="usernamePassword" type="password" autocomplete="current-password" />
      <button class="primary">Ändern</button>
    </form>
    <h2>Passwort</h2>
    <form @submit.prevent="savePassword">
      <label>Altes Passwort</label>
      <input v-model="oldPassword" type="password" autocomplete="current-password" />
      <label>Neues Passwort</label>
      <input v-model="newPassword" type="password" autocomplete="new-password" />
      <button class="primary">Ändern</button>
    </form>
    <div v-if="msg" class="ok">{{ msg }}</div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

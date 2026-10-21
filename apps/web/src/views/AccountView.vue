<script setup lang="ts">
import { ref } from 'vue';
import { api, session } from '../api';

const oldPassword = ref('');
const newPassword = ref('');
const msg = ref('');
const error = ref('');

async function save() {
  msg.value = error.value = '';
  try {
    await api('/auth/password', { body: { oldPassword: oldPassword.value, newPassword: newPassword.value } });
    msg.value = 'Passwort geändert.';
    oldPassword.value = newPassword.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="center-box card">
    <p><RouterLink to="/">← zurück</RouterLink></p>
    <h1>Konto: {{ session.me?.user?.username }}</h1>
    <form @submit.prevent="save">
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

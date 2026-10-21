<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, loadMe, session } from '../api';

const route = useRoute();
const router = useRouter();
const token = String(route.params.token);
const info = ref<{ group: { name: string; universe: string } | null; role: string } | null>(null);
const username = ref('');
const password = ref('');
const error = ref('');

onMounted(async () => {
  try {
    info.value = await api(`/invites/${token}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function accept() {
  error.value = '';
  try {
    await api(`/invites/${token}/accept`, { body: session.me?.user ? {} : { username: username.value, password: password.value } });
    await loadMe();
    router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="center-box card">
    <h1>Einladung</h1>
    <template v-if="info">
      <p>
        Du wurdest in die Allianz <b>{{ info.group?.name }}</b> ({{ info.group?.universe }}) eingeladen.
      </p>
      <form @submit.prevent="accept">
        <template v-if="!session.me?.user">
          <label>Benutzername</label>
          <input v-model="username" autocomplete="username" />
          <label>Passwort (min. 8 Zeichen)</label>
          <input v-model="password" type="password" autocomplete="new-password" />
        </template>
        <p v-else class="muted">Angemeldet als {{ session.me.user.username }} – die Allianz wird deinem Konto hinzugefügt.</p>
        <button class="primary" type="submit">Beitreten</button>
      </form>
    </template>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

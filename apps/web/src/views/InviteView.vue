<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, loadMe, session } from '../api';
import { currentLang } from '../i18n';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const token = String(route.params.token);
const info = ref<{ group: { name: string; universe: string } | null; role: string; member?: { name: string } } | null>(null);
const username = ref('');
const password = ref('');
const error = ref('');

onMounted(async () => {
  try {
    info.value = await api(`/invites/${token}`);
    if (info.value?.member?.name && !session.me?.user) username.value = info.value.member.name;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function accept() {
  error.value = '';
  try {
    await api(`/invites/${token}/accept`, { body: session.me?.user ? {} : { username: username.value, password: password.value, lang: currentLang() } });
    await loadMe();
    router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="center-box card">
    <h1>{{ t('invite.title') }}</h1>
    <template v-if="info">
      <i18n-t v-if="info.member" keypath="invite.claim" tag="p">
        <template #name><b>{{ info.member.name }}</b></template>
        <template #group><b>{{ info.group?.name }}</b></template>
        <template #universe>{{ info.group?.universe }}</template>
      </i18n-t>
      <i18n-t v-else keypath="invite.invited" tag="p">
        <template #group><b>{{ info.group?.name }}</b></template>
        <template #universe>{{ info.group?.universe }}</template>
      </i18n-t>
      <form @submit.prevent="accept">
        <template v-if="!session.me?.user">
          <label>{{ t('common.username') }}</label>
          <input v-model="username" autocomplete="username" />
          <label>{{ t('invite.passwordHint') }}</label>
          <input v-model="password" type="password" autocomplete="new-password" />
        </template>
        <p v-else class="muted">{{
          info.member
            ? t('invite.claimMerge', { user: session.me.user.username, name: info.member.name })
            : t('invite.addToAccount', { name: session.me.user.username })
        }}</p>
        <button class="primary" type="submit">{{ t('invite.join') }}</button>
      </form>
    </template>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

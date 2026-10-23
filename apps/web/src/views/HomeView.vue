<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, session } from '../api';
import { disablePush } from '../push';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const universes = computed(() => {
  const map = new Map<string, { slug: string; name: string; groups: string[] }>();
  for (const g of session.me?.groups ?? []) {
    const u = map.get(g.universe) ?? { slug: g.universe, name: g.universe_name, groups: [] };
    u.groups.push(g.name);
    map.set(g.universe, u);
  }
  return [...map.values()];
});

// With a single universe go straight there, unless the list was opened explicitly from the menu (?list).
onMounted(() => {
  if (universes.value.length === 1 && route.query.list === undefined) router.replace(`/${universes.value[0].slug}/overview`);
});

async function logout() {
  // the next user of this browser must not get this user's notifications
  await disablePush().catch(() => {});
  await api('/auth/logout', { body: {} });
  location.href = import.meta.env.BASE_URL + 'login';
}
</script>

<template>
  <div class="center-box">
    <div class="card">
      <h1>pr0game <span style="color: var(--accent)">Hub</span></h1>
      <p class="muted">{{ t('common.loggedInAs', { name: session.me?.user?.username }) }}</p>
      <div v-for="u in universes" :key="u.slug" style="margin: 8px 0">
        <RouterLink :to="`/${u.slug}/overview`">{{ u.name }}</RouterLink>
        <span class="muted small"> – {{ u.groups.join(', ') }}</span>
        <RouterLink v-if="session.me?.user?.isAdmin" :to="{ path: '/admin', query: { uni: u.slug } }" class="small"> · {{ t('home.settings') }}</RouterLink>
      </div>
      <p v-if="!universes.length" class="muted">{{ t('home.noGroup') }}</p>
      <div class="row" style="margin-top: 14px">
        <RouterLink v-if="session.me?.user?.isAdmin || session.me?.groups.some((g) => g.role === 'admin')" to="/admin">{{ t('nav.admin') }}</RouterLink>
        <RouterLink to="/account">{{ t('home.account') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('nav.changelog') }}</RouterLink>
        <a href="#" @click.prevent="logout">{{ t('home.logout') }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../components/Icon.vue';
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, session } from '../api';
import { disablePush } from '../push';
import { dateTime } from '../format';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const universes = computed(() => {
  const map = new Map<string, { slug: string; name: string; ended: boolean; startsAt: number | null; groups: string[] }>();
  const now = Math.floor(Date.now() / 1000);
  for (const g of session.me?.groups ?? []) {
    const u = map.get(g.universe) ?? { slug: g.universe, name: g.universe_name, ended: g.universe_ended_at != null && g.universe_ended_at <= now, startsAt: g.universe_starts_at != null && g.universe_starts_at > now ? g.universe_starts_at : null, groups: [] };
    u.groups.push(g.name);
    map.set(g.universe, u);
  }
  return [...map.values()];
});

// Go straight to the default universe set by an admin (when the user is a member), else to the only universe,
// unless the list was opened explicitly from the menu (?list).
onMounted(() => {
  if (route.query.list !== undefined) return;
  const def = universes.value.find((u) => u.slug === session.me?.defaultUniverse);
  if (def) router.replace(`/${def.slug}/overview`);
  else if (universes.value.length === 1) router.replace(`/${universes.value[0].slug}/overview`);
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
      <div class="unis">
        <div v-for="u in universes" :key="u.slug" class="uni">
          <RouterLink :to="`/${u.slug}/overview`" class="uni-link">
            <Icon name="universes" :size="18" />
            <span class="uni-text"><b>{{ u.name }}<span v-if="u.ended" class="badge" style="margin-left: 6px">{{ t('admin.endedBadge') }}</span><span v-else-if="u.startsAt" class="badge" style="margin-left: 6px">{{ t('admin.startsAt', { time: dateTime(u.startsAt) }) }}</span></b><span class="muted small">{{ u.groups.join(', ') }}</span></span>
            <Icon name="chevronRight" class="muted" />
          </RouterLink>
          <RouterLink v-if="session.me?.user?.isAdmin" :to="{ path: '/admin', query: { uni: u.slug } }" class="small">{{ t('home.settings') }}</RouterLink>
        </div>
      </div>
      <p v-if="!universes.length" class="muted">{{ t('home.noGroup') }}</p>
      <div class="row" style="margin-top: 14px">
        <RouterLink v-if="session.me?.user?.isAdmin || session.me?.groups.some((g) => g.role === 'admin')" to="/admin">{{ t('nav.admin') }}</RouterLink>
        <RouterLink to="/account">{{ t('home.account') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('nav.changelog') }}</RouterLink>
        <span class="grow" />
        <button class="btn-icon" @click="logout"><Icon name="logout" />{{ t('home.logout') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unis { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.uni { display: flex; flex-direction: column; gap: 2px; }
.uni-link {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); color: var(--text);
}
.uni-link:hover { border-color: var(--accent); text-decoration: none; }
.uni-link > .icon:first-child { color: var(--accent); }
.uni-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.uni > .small { align-self: flex-end; }
</style>

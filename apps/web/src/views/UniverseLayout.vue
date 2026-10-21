<script setup lang="ts">
import NavIcon from '../components/NavIcon.vue';
import PlayerDialog from '../components/PlayerDialog.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { selectGroup, selectedGroup, session, uniApi } from '../api';
import { provideUni, type UniContext } from '../composables';

const { t } = useI18n();
const route = useRoute();
const uni = computed(() => String(route.params.uni));
const ctx = ref<UniContext | null>(null);
const error = ref('');
const groups = computed(() => session.me?.groups.filter((g) => g.universe === uni.value) ?? []);
const group = ref<number | null>(null);
const reloadKey = ref(0);

provideUni(ctx);

async function load() {
  error.value = '';
  try {
    group.value = selectedGroup(uni.value);
    ctx.value = await uniApi(uni.value, '/context');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function changeGroup() {
  if (group.value) selectGroup(uni.value, group.value);
  ctx.value = null;
  reloadKey.value++;
  load();
}

watch(uni, load, { immediate: true });

/** Sidebar: `label`/`section` are message keys below nav.* */
const links = [
  { to: 'paste', label: 'sync', icon: 'sync' },
  { section: 'start' },
  { to: 'overview', label: 'overview', icon: 'overview' },
  { to: 'imperium', label: 'imperium', icon: 'imperium' },
  { to: 'stats', label: 'stats', icon: 'stats' },
  { section: 'recon' },
  { to: 'browse', label: 'galaxy', icon: 'galaxy' },
  { to: 'spy', label: 'spy', icon: 'spy' },
  { to: 'hostile', label: 'hostile', icon: 'hostile' },
  { to: 'activity', label: 'activity', icon: 'activity' },
  { section: 'alliance' },
  { to: 'planets', label: 'planets', icon: 'planets' },
  { to: 'fleet', label: 'fleet', icon: 'fleet' },
  { to: 'research', label: 'research', icon: 'research' },
  { section: 'combat' },
  { to: 'raids', label: 'raids', icon: 'raids' },
  { to: 'battle-hall', label: 'battleHall', icon: 'battleHall' },
  { to: 'expeditions', label: 'expeditions', icon: 'expeditions' },
  { to: 'deck', label: 'deck', icon: 'deck' },
];
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">pr0game <span>Hub</span></div>
      <div class="section">{{ ctx?.universe.name ?? uni }}</div>
      <select v-if="groups.length > 1" v-model="group" @change="changeGroup">
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <div v-else-if="ctx" class="muted small" style="padding: 0 10px">{{ t('nav.allianceName', { name: ctx.group.name }) }}</div>
      <nav>
        <template v-for="l in links" :key="l.to ?? l.section">
          <div v-if="l.section" class="section">{{ t(`nav.${l.section}`) }}</div>
          <RouterLink v-else :to="`/${uni}/${l.to}`"><NavIcon :name="l.icon!" />{{ t(`nav.${l.label}`) }}</RouterLink>
        </template>
        <div class="section">{{ t('nav.account') }}</div>
        <RouterLink :to="{ path: '/', query: { list: null } }"><NavIcon name="universes" />{{ t('nav.universes') }}</RouterLink>
        <RouterLink v-if="session.me?.user?.isAdmin || ctx?.group.role === 'admin'" to="/admin"><NavIcon name="admin" />{{ t('nav.admin') }}</RouterLink>
        <RouterLink to="/account"><NavIcon name="user" />{{ t('nav.user') }}</RouterLink>
      </nav>
    </aside>
    <main class="main">
      <div v-if="error" class="error">{{ error }}</div>
      <template v-else-if="ctx">
        <RouterView :key="reloadKey" />
        <PlayerDialog />
      </template>
    </main>
  </div>
</template>

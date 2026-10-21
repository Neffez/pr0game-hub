<script setup lang="ts">
import NavIcon from '../components/NavIcon.vue';
import PlayerDialog from '../components/PlayerDialog.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { selectGroup, selectedGroup, session, uniApi } from '../api';
import { provideUni, type UniContext } from '../composables';

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

const links = [
  { to: 'paste', label: 'Synchronisieren', icon: 'sync' },
  { section: 'Start' },
  { to: 'overview', label: 'Übersicht', icon: 'overview' },
  { to: 'imperium', label: 'Mein Imperium', icon: 'imperium' },
  { to: 'stats', label: 'Statistik', icon: 'stats' },
  { section: 'Aufklärung' },
  { to: 'browse', label: 'Galaxie', icon: 'galaxy' },
  { to: 'spy', label: 'Spionageberichte', icon: 'spy' },
  { to: 'hostile', label: 'Fremdspionage', icon: 'hostile' },
  { to: 'activity', label: 'Aktivität', icon: 'activity' },
  { to: 'galaxy', label: 'Gala-Aktualität', icon: 'freshness' },
  { section: 'Allianz' },
  { to: 'planets', label: 'Planeten', icon: 'planets' },
  { to: 'fleet', label: 'Flotten', icon: 'fleet' },
  { to: 'research', label: 'Forschung', icon: 'research' },
  { section: 'Kämpfe & Expos' },
  { to: 'raids', label: 'Raids', icon: 'raids' },
  { to: 'battle-hall', label: 'Battle Hall', icon: 'battleHall' },
  { to: 'expeditions', label: 'Expeditionen', icon: 'expeditions' },
  { to: 'deck', label: 'Expo-Deck', icon: 'deck' },
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
      <div v-else-if="ctx" class="muted small" style="padding: 0 10px">Allianz: {{ ctx.group.name }}</div>
      <nav>
        <template v-for="l in links" :key="l.to ?? l.section">
          <div v-if="l.section" class="section">{{ l.section }}</div>
          <RouterLink v-else :to="`/${uni}/${l.to}`"><NavIcon :name="l.icon!" />{{ l.label }}</RouterLink>
        </template>
        <div class="section">Konto</div>
        <RouterLink :to="{ path: '/', query: { list: null } }"><NavIcon name="universes" />Universen</RouterLink>
        <RouterLink v-if="session.me?.user?.isAdmin || ctx?.group.role === 'admin'" to="/admin"><NavIcon name="admin" />Admin-Panel</RouterLink>
        <RouterLink to="/account"><NavIcon name="user" />Benutzer</RouterLink>
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

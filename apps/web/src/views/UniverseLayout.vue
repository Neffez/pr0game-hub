<script setup lang="ts">
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
  { to: 'paste', label: '📋 Einfügen' },
  { to: 'universe-json', label: '📂 universe.json' },
  { to: 'overview', label: 'Übersicht' },
  { to: 'imperium', label: 'Imperium' },
  { to: 'browse', label: 'Galaxie-Browser' },
  { to: 'activity', label: 'Aktivitätslog' },
  { to: 'battle-hall', label: 'Battle Hall' },
  { section: 'Allianz' },
  { to: 'planets', label: 'Planeten' },
  { to: 'fleet', label: 'Flotten' },
  { to: 'research', label: 'Forschung' },
  { to: 'spy', label: 'Spionage-Verlauf' },
  { to: 'galaxy', label: 'Gala-Aktualität' },
  { to: 'hostile', label: 'Fremdspionage' },
  { to: 'raids', label: 'Raids' },
  { to: 'expeditions', label: 'Expeditionen' },
  { section: 'Eigene' },
  { to: 'deck', label: 'Expo-Deck' },
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
          <RouterLink v-else :to="`/${uni}/${l.to}`">{{ l.label }}</RouterLink>
        </template>
        <div class="section">Konto</div>
        <RouterLink to="/">Universen</RouterLink>
        <RouterLink v-if="session.me?.user?.isAdmin || ctx?.group.role === 'admin'" to="/admin">Admin</RouterLink>
        <RouterLink to="/account">{{ session.me?.user?.username }}</RouterLink>
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

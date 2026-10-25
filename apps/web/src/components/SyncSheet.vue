<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import Sheet from './Sheet.vue';
import SyncPanel from './SyncPanel.vue';

/** Quick sync from the bottom tab bar (mobile): paste a game page without leaving the current page. */
const { t } = useI18n();
const { uni } = useUni();
const open = defineModel<boolean>({ required: true });
</script>

<template>
  <Sheet v-model="open" :title="t('nav.quickSync')">
    <template #head>
      <RouterLink :to="`/${uni}/paste`" class="small" @click="open = false">{{ t('nav.openSyncPage') }}</RouterLink>
    </template>
    <!-- remounted on every open: no stale preview from the last sync -->
    <SyncPanel compact />
  </Sheet>
</template>

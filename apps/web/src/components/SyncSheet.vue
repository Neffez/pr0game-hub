<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useScrollLock, useUni } from '../composables';
import SyncPanel from './SyncPanel.vue';

/** Quick sync from the bottom tab bar (mobile): paste a game page without leaving the current page. */
const { t } = useI18n();
const { uni } = useUni();
const open = defineModel<boolean>({ required: true });

useScrollLock(open);

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') open.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sheet-backdrop" @click.self="open = false">
      <div class="sheet" role="dialog" aria-modal="true" :aria-label="t('nav.quickSync')">
        <div class="sheet-head">
          <b>{{ t('nav.quickSync') }}</b>
          <span class="grow" />
          <RouterLink :to="`/${uni}/paste`" class="small" @click="open = false">{{ t('nav.openSyncPage') }}</RouterLink>
          <button class="sheet-close" :title="t('nav.close')" :aria-label="t('nav.close')" @click="open = false">✕</button>
        </div>
        <!-- remounted on every open: no stale preview from the last sync -->
        <SyncPanel compact />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop { position: fixed; inset: 0; z-index: 45; display: flex; align-items: flex-end; background: rgba(0, 0, 0, 0.55); }
.sheet {
  width: 100%; max-height: 88dvh; overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 12px calc(16px + env(safe-area-inset-bottom));
  background: var(--bg); border-top: 1px solid var(--border); border-radius: 14px 14px 0 0; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
}
.sheet-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.sheet-close { padding: 6px 12px; }
.sheet :deep(.card) { margin-bottom: 10px; }
</style>

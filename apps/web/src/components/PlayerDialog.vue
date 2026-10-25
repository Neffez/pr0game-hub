<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePlayerDialog, useScrollLock, useUni } from '../composables';
import PlayerDetail from './PlayerDetail.vue';

/** Player details as a dialog above the current page (opened by PlayerLink). */
const { t } = useI18n();
const { id, close } = usePlayerDialog();
const { uni } = useUni();

function onKey(e: KeyboardEvent) {
  if (id.value != null && e.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
// no page scrolling behind the dialog
useScrollLock(computed(() => id.value != null));
</script>

<template>
  <Teleport to="body">
    <div v-if="id != null" class="modal-backdrop" @click.self="close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-tools">
          <RouterLink :to="`/${uni}/player/${id}`" class="small" :title="t('playerDialog.openPageTitle')">{{ t('playerDialog.openPage') }} <Icon name="external" :size="12" /></RouterLink>
          <button class="icon-btn" :title="t('playerDialog.close')" :aria-label="t('playerDialog.close')" @click="close"><Icon name="close" /></button>
        </div>
        <PlayerDetail :id="id" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: flex-start;
  padding: 40px 16px; overflow-y: auto; background: rgba(0, 0, 0, 0.6);
}
.modal {
  position: relative; width: 100%; max-width: 1100px; padding: 18px 22px 24px;
  background: var(--bg, var(--surface)); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.modal-tools { position: absolute; top: 14px; right: 16px; display: flex; align-items: center; gap: 12px; }
.modal-close { padding: 2px 9px; }
.modal :deep(h1) { padding-right: 170px; }
@media (max-width: 600px) {
  .modal-backdrop { padding: 0; }
  .modal { min-height: 100%; border-radius: 0; border: 0; padding: 12px 12px 24px; padding-top: max(12px, env(safe-area-inset-top)); }
  /* tools in their own row above the title instead of overlapping it */
  .modal-tools { position: static; justify-content: flex-end; margin-bottom: 8px; }
  .modal :deep(h1) { padding-right: 0; }
  .modal-close { padding: 6px 12px; }
}
</style>

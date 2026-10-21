<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { usePlayerDialog, useUni } from '../composables';
import PlayerDetail from './PlayerDetail.vue';

/** Player details as a dialog above the current page (opened by PlayerLink). */
const { id, close } = usePlayerDialog();
const { uni } = useUni();

function onKey(e: KeyboardEvent) {
  if (id.value != null && e.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
// no page scrolling behind the dialog
watch(id, (v) => (document.body.style.overflow = v != null ? 'hidden' : ''), { immediate: true });
onBeforeUnmount(() => (document.body.style.overflow = ''));
</script>

<template>
  <Teleport to="body">
    <div v-if="id != null" class="modal-backdrop" @click.self="close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-tools">
          <RouterLink :to="`/${uni}/player/${id}`" class="small" title="Als eigene Seite öffnen">Seite öffnen ↗</RouterLink>
          <button class="modal-close" title="Schließen (Esc)" @click="close">✕</button>
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
  .modal { min-height: 100%; border-radius: 0; border: 0; }
}
</style>

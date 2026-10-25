<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useScrollLock } from '../composables';
import Icon from './Icon.vue';

/**
 * Dialog for forms: a centred dialog on desktop, a bottom sheet on mobile. Esc and a click on the backdrop close it;
 * the first field gets the focus. `footer`: the actions, sticky at the bottom (cancel left, primary right).
 */
withDefaults(defineProps<{ title: string; wide?: boolean }>(), { wide: false });
const open = defineModel<boolean>({ required: true });
const { t } = useI18n();
const panel = ref<HTMLElement | null>(null);

useScrollLock(open);
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') open.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
watch(open, async (v) => {
  // touch screens: no focus, the keyboard would cover the sheet right away
  if (!v || !window.matchMedia('(hover: hover)').matches) return;
  await nextTick();
  (panel.value?.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select') as HTMLElement | null)?.focus({ preventScroll: true });
}, { immediate: true });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sheet-backdrop" @click.self="open = false">
      <div ref="panel" class="sheet" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet-head">
          <b class="sheet-title">{{ title }}</b>
          <slot name="head" />
          <span class="grow" />
          <button type="button" class="icon-btn" :title="t('common.close')" :aria-label="t('common.close')" @click="open = false"><Icon name="close" /></button>
        </div>
        <div class="sheet-body"><slot /></div>
        <div v-if="$slots.footer" class="sheet-footer"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 45; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  background: rgba(0, 0, 0, 0.55);
}
.sheet {
  display: flex; flex-direction: column; width: 100%; max-width: 560px; max-height: calc(100dvh - 48px);
  background: var(--bg); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.sheet.wide { max-width: 860px; }
.sheet-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px 10px; border-bottom: 1px solid var(--border); }
.sheet-title { font-size: 15px; }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px; }
.sheet-body :deep(.card) { margin-bottom: 10px; }
.sheet-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
@media (max-width: 800px) {
  .sheet-backdrop { align-items: flex-end; padding: 0; }
  .sheet { max-width: none; max-height: 92dvh; border-width: 1px 0 0; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5); }
  .sheet-footer { padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
  .sheet-footer :deep(button) { flex: 1 1 auto; }
  .sheet-body { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
</style>

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MenuItem } from './components/ActionMenu.vue';
import { useMobile } from './composables';

/**
 * The quick sync sheet of the universe layout (bottom tab bar on mobile, a dialog on desktop): pages open it to have
 * a page pasted without leaving them. `quickSyncAvailable`: the universe is running (the layout sets it).
 */
export const quickSyncOpen = ref(false);
export const quickSyncAvailable = ref(false);

/**
 * The page header's "Sync now" entry: on desktop only (on a phone the tab bar has it) and while the universe runs.
 * `PageHeader` shows it as a button (`sync`); a page with an overflow menu in its header adds this item instead.
 */
export function useQuickSyncItem() {
  const { t } = useI18n();
  const mobile = useMobile();
  return computed<MenuItem | false>(
    () => quickSyncAvailable.value && !mobile.value && { label: t('nav.syncNow'), icon: 'sync', onClick: () => (quickSyncOpen.value = true) },
  );
}

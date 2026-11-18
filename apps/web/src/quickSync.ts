import { ref } from 'vue';

/**
 * The quick sync sheet of the universe layout (bottom tab bar on mobile, a dialog on desktop): pages open it to have
 * a page pasted without leaving them. `quickSyncAvailable`: the universe is running (the layout sets it).
 */
export const quickSyncOpen = ref(false);
export const quickSyncAvailable = ref(false);

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePlayerDialog, useUni } from '../composables';
import NavIcon from './NavIcon.vue';

/** Small profile icon next to a player name: opens the player dialog; Ctrl/Cmd/middle click the full page in a new tab. */
const props = defineProps<{ id: number; name: string }>();
const { t } = useI18n();
const { uni } = useUni();
const dialog = usePlayerDialog();
const href = computed(() => `${import.meta.env.BASE_URL}${uni.value}/player/${props.id}`);

function onClick(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  dialog.open(props.id);
}
</script>

<template>
  <a class="profile-link" :href="href" :title="t('messages.profile', { name })" :aria-label="t('messages.profile', { name })" @click.stop="onClick">
    <NavIcon name="user" />
  </a>
</template>

<style scoped>
.profile-link { display: inline-flex; align-self: center; color: var(--muted); padding: 0 2px; }
.profile-link:hover { color: var(--text); }
.profile-link :deep(svg) { width: 14px; height: 14px; }
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { usePlayerDialog, useUni } from '../composables';

/** Player name that opens the player dialog; Ctrl/Cmd/middle click opens the full page in a new tab. */
const props = defineProps<{ id: number; name: string }>();
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
  <a :href="href" @click.stop="onClick">{{ name }}</a>
</template>

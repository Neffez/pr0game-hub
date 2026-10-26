<script setup lang="ts">
import { computed } from 'vue';
import { useProtection } from '../composables';
import { STATUS_LABEL, STATUS_TITLE } from '../format';

/** points: the player's total points; with them weak/strong follow the own points (universe's noob protection) */
const props = defineProps<{ status: string[]; points?: number | null }>();
const protection = useProtection();
const shown = computed(() => (props.points === undefined ? props.status : protection(props.status, props.points)));
</script>

<template>
  <span v-for="s in shown" :key="s" :class="['badge', s]" :title="STATUS_TITLE[s] ?? s">{{ STATUS_LABEL[s] ?? s }}</span>
</template>

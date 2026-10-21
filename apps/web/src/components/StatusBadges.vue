<script setup lang="ts">
import { STATUS_LABEL } from '../format';

defineProps<{ status: string[] }>();
</script>

<template>
  <span v-for="s in status" :key="s" :class="['badge', s]" :title="s">{{ STATUS_LABEL[s] ?? s }}</span>
</template>

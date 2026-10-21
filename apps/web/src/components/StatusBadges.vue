<script setup lang="ts">
import { STATUS_LABEL, STATUS_TITLE } from '../format';

defineProps<{ status: string[] }>();
</script>

<template>
  <span v-for="s in status" :key="s" :class="['badge', s]" :title="STATUS_TITLE[s] ?? s">{{ STATUS_LABEL[s] ?? s }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { playerIdOf } from '../composables';
import PlayerDetail from '../components/PlayerDetail.vue';

const route = useRoute();
const id = computed(() => playerIdOf(route.params.id));
</script>

<template>
  <PlayerDetail v-if="id != null" :id="id" />
</template>

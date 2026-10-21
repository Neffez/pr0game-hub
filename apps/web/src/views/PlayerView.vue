<script setup lang="ts">
import { useRoute } from 'vue-router';
import PlayerDetail from '../components/PlayerDetail.vue';

const route = useRoute();
</script>

<template>
  <PlayerDetail :id="Number(route.params.id)" />
</template>

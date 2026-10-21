<script setup lang="ts">
const model = defineModel<number>({ required: true });
</script>

<template>
  <label>
    Zeitraum
    <select v-model.number="model">
      <option :value="1">24 h</option>
      <option :value="3">3 Tage</option>
      <option :value="7">7 Tage</option>
      <option :value="30">30 Tage</option>
      <option :value="3650">alles</option>
    </select>
  </label>
</template>

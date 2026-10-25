<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';

/** Below a list cut by useLimit: shows the rest. */
defineProps<{ limit: { hidden: { value: number }; total: { value: number }; showAll: () => void } }>();
const { t } = useI18n();
</script>

<template>
  <button v-if="limit.hidden.value" type="button" class="show-more btn-icon" @click="limit.showAll()">
    <Icon name="chevronDown" :size="14" />
    {{ t('common.showAll', { n: limit.total.value }) }}
  </button>
</template>

<style scoped>
.show-more { display: flex; width: 100%; justify-content: center; margin: 6px 0 14px; }
</style>

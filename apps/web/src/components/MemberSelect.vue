<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';

/**
 * Member filter: the whole alliance (null, label `allLabel`), the viewer, or another member. Without `allLabel` a
 * member is always picked (own entry first).
 */
withDefaults(defineProps<{ allLabel?: string; label?: string }>(), { allLabel: undefined, label: undefined });
const model = defineModel<number | null>({ required: true });
const { t } = useI18n();
const { ctx } = useUni();
const others = computed(() => (ctx.value?.members ?? []).filter((m) => m.id !== ctx.value?.me.id));
</script>

<template>
  <label class="member-select">
    {{ label ?? t('common.player') }}
    <select v-model="model">
      <option v-if="allLabel" :value="null">{{ allLabel }}</option>
      <option :value="ctx!.me.id">{{ t('raids.onlyMine') }}</option>
      <option v-for="m in others" :key="m.id" :value="m.id">{{ m.name }}</option>
    </select>
  </label>
</template>

<style scoped>
.member-select select { max-width: 60vw; }
</style>

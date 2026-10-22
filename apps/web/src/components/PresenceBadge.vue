<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { presence } from '../live';

/** Other members looking at the same galaxy system or player right now. */
const props = defineProps<{ g?: number; s?: number; player?: number }>();
const { t } = useI18n();
const { ctx } = useUni();

const names = computed(() =>
  presence.value
    .filter((p) => p.userId !== ctx.value?.me.id)
    .filter((p) => (props.player ? p.player === props.player : p.page === 'browse' && p.g === props.g && p.s === props.s))
    .map((p) => ctx.value?.members.find((m) => m.id === p.userId)?.name ?? '?'),
);
</script>

<template>
  <span v-if="names.length" class="presence-badge small" :title="t('presence.viewing', { names: names.join(', ') })">
    👁 {{ names.join(', ') }}
  </span>
</template>

<style scoped>
.presence-badge { color: var(--info); white-space: nowrap; }
</style>

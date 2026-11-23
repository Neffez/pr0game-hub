<script setup lang="ts">
import Icon from './Icon.vue';
import RankInsignia from './RankInsignia.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { presence } from '../live';

/** Other members looking at the same galaxy system or player right now. */
const props = defineProps<{ g?: number; s?: number; player?: number }>();
const { t } = useI18n();
const { ctx } = useUni();

const viewers = computed(() =>
  presence.value
    .filter((p) => p.userId !== ctx.value?.me.id)
    .filter((p) => (props.player ? p.player === props.player : p.page === 'browse' && p.g === props.g && p.s === props.s))
    .map((p) => ({ id: p.userId, name: ctx.value?.members.find((m) => m.id === p.userId)?.name ?? '?' })),
);
const names = computed(() => viewers.value.map((v) => v.name));
</script>

<template>
  <span v-if="names.length" class="presence-badge small" :title="t('presence.viewing', { names: names.join(', ') })">
    <Icon name="spy" :size="13" />
    <template v-for="(v, i) in viewers" :key="`${v.id}-${i}`">{{ i ? ', ' : ' ' }}<RankInsignia :user-id="v.id" :size="12" />{{ v.name }}</template>
  </span>
</template>

<style scoped>
.presence-badge { color: var(--info); white-space: nowrap; }
</style>

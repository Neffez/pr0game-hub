<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { nowSec } from '../clock';
import { useUni } from '../composables';
import { dateTime, INACTIVE_DAYS, type PointsStall } from '../format';
import Icon from './Icon.vue';

/**
 * No points since a stat update: when the game flags the player inactive (the last login was before that update).
 * `icon` next to a name in lists (left out once the game shows the player inactive), otherwise a line of text.
 */
const props = defineProps<{ stall: PointsStall | null | undefined; status?: string[]; icon?: boolean }>();
const { t } = useI18n();
const { ctx } = useUni();

const text = computed(() => {
  if (!props.stall) return '';
  const days = Number(ctx.value?.universe.settings.inactiveDays) || INACTIVE_DAYS;
  const inactiveAt = props.stall.time + days * 86400;
  const key = `${props.stall.atLeast ? 'player.noPointsAtLeast' : 'player.noPoints'}${inactiveAt <= nowSec() ? 'Past' : ''}`;
  return t(key, { time: dateTime(props.stall.time), inactive: dateTime(inactiveAt) });
});
const shown = computed(() => !!props.stall && !(props.icon && props.status?.some((s) => s === 'inactive' || s === 'longinactive')));
</script>

<template>
  <template v-if="shown">
    <Icon v-if="icon" name="sleep" :size="13" class="warn stall" :label="text" />
    <p v-else class="small warn m-0">{{ text }}</p>
  </template>
</template>

<style scoped>
.stall { vertical-align: -2px; margin-left: 3px; }
</style>

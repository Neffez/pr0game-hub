<script setup lang="ts">
import Icon from './Icon.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Badge } from '../apiTypes';
import { fmt } from '../format';
import { BADGE_ICONS, levelColor } from '../achievements';

/**
 * A badge as an icon in the colour of its level (bronze, silver, gold, then platinum, sapphire, amethyst, ruby); not
 * reached yet: faint. The tooltip names the badge, its level and the way to the next one. `size` in px.
 */
const props = withDefaults(defineProps<{ badge: Badge; size?: number; label?: boolean }>(), { size: 14, label: false });
const { t } = useI18n();

const color = computed(() => levelColor(props.badge.level) ?? 'var(--faint)');
const title = computed(() => {
  const b = props.badge;
  const name = t(`badges.${b.key}.name`);
  const what = t(`badges.${b.key}.what`, { n: fmt(b.count) });
  const level = b.level ? t('badges.level', { n: b.level, of: b.levels }) : t('badges.notYet');
  const next = b.next != null ? t('badges.next', { n: fmt(b.next) }) : t('badges.top');
  return `${name} – ${level}\n${what}\n${next}`;
});
</script>

<template>
  <span class="badge-icon" :class="{ off: !badge.level }" :style="{ color }" :title="title" :aria-label="title" role="img">
    <Icon :name="BADGE_ICONS[badge.key]" :size="size" />
    <span v-if="label" class="badge-name">{{ t(`badges.${badge.key}.name`) }}<template v-if="badge.level"> {{ badge.level }}</template></span>
  </span>
</template>

<style scoped>
.badge-icon { display: inline-flex; align-items: center; gap: 4px; flex: none; cursor: help; }
.badge-icon.off { opacity: 0.45; }
.badge-name { font-size: 12px; }
</style>

<script setup lang="ts">
import Icon from './Icon.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Badge } from '../apiTypes';
import { useLongPress } from '../composables';
import { fmt } from '../format';
import { BADGE_ICONS, badgeColor, isManualBadge } from '../achievements';

/**
 * A badge as an icon in the colour of its level (bronze, silver, gold, then platinum, sapphire, amethyst, ruby; gold
 * for one awarded by hand); not reached yet: faint. The tooltip names the badge, its level and the way to the next
 * one (a badge awarded by hand: only what it stands for); on touch devices a long press shows it as a sheet above the
 * tab bar. `size` in px.
 */
const props = withDefaults(defineProps<{ badge: Badge; size?: number; label?: boolean }>(), { size: 14, label: false });
const { t } = useI18n();
const { open, handlers } = useLongPress();

const color = computed(() => badgeColor(props.badge) ?? 'var(--faint)');
/** heading and lines of the tooltip */
const tip = computed(() => {
  const b = props.badge;
  const name = t(`badges.${b.key}.name`);
  if (isManualBadge(b.key)) return { head: `${name} – ${b.level ? t('badges.awarded') : t('badges.notAwarded')}`, lines: [t(`badges.${b.key}.what`)] };
  const what = t(`badges.${b.key}.what`, { n: fmt(b.count) });
  const level = b.level ? t('badges.level', { n: b.level, of: b.levels }) : t('badges.notYet');
  const next = b.next != null ? t('badges.next', { n: fmt(b.next) }) : t('badges.top');
  return { head: `${name} – ${level}`, lines: [what, next] };
});
const title = computed(() => [tip.value.head, ...tip.value.lines].join('\n'));
</script>

<template>
  <span class="badge-icon" :class="{ off: !badge.level }" :style="{ color }" :title="title" :aria-label="title" role="img" v-on="handlers">
    <Icon :name="BADGE_ICONS[badge.key]" :size="size" />
    <span v-if="label" class="badge-name">{{ t(`badges.${badge.key}.name`) }}<template v-if="badge.level && !isManualBadge(badge.key)"> {{ badge.level }}</template></span>
    <Teleport v-if="open" to="body">
      <div class="touch-tip" role="tooltip">
        <div class="touch-tip-head" :style="{ color }"><Icon :name="BADGE_ICONS[badge.key]" :size="16" /> <b>{{ tip.head }}</b></div>
        <div v-for="(line, i) in tip.lines" :key="i">{{ line }}</div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
/* no text selection or callout menu on a long press */
.badge-icon { display: inline-flex; align-items: center; gap: 4px; flex: none; cursor: help; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.badge-icon.off { opacity: 0.45; }
.badge-name { font-size: 12px; }
.touch-tip-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.touch-tip-head b { color: var(--text); }
</style>

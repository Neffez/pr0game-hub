<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateTime } from '../format';
import Icon from './Icon.vue';

/** How sure the hub is that a player is inactive (server: repo/inactivity.ts). */
export interface Inactivity {
  score: number;
  level: 'inactive' | 'likely' | 'possible' | 'active' | 'unknown';
  since: number | null;
  atLeast: boolean;
  status: 'inactive' | 'longinactive' | null;
  stall: number | null;
  lastActive: number | null;
}

/**
 * The inactivity score: `chip` a small badge with the percentage (lists; hidden for active players and, with
 * `hideFlagged`, for players the game already flags), otherwise a line of text (player details). The tooltip names
 * the signals.
 */
const props = defineProps<{ value: Inactivity | null | undefined; chip?: boolean; hideFlagged?: boolean }>();
const { t } = useI18n();

const shown = computed(() => {
  const v = props.value;
  if (!v || v.level === 'active' || v.level === 'unknown') return false;
  return !(props.hideFlagged && v.status);
});
const summary = computed(() => {
  const v = props.value!;
  const since = v.since ? t(v.atLeast ? 'inactivity.sinceAtLeast' : 'inactivity.since', { time: dateTime(v.since) }) : '';
  return `${t(`inactivity.level.${v.level}`, { score: v.score })}${since ? ` ${since}` : ''}`;
});
const reasons = computed(() => {
  const v = props.value!;
  return [
    v.status ? t(`inactivity.status.${v.status}`) : '',
    v.stall ? t('inactivity.stall', { time: dateTime(v.stall) }) : '',
    v.lastActive ? t('inactivity.lastActive', { time: dateTime(v.lastActive) }) : '',
  ].filter(Boolean);
});
const title = computed(() => (shown.value ? [summary.value, ...reasons.value].join('\n') : ''));
</script>

<template>
  <template v-if="shown">
    <span v-if="chip" class="badge inactivity" :class="`inactivity-${value!.level}`" :title="title" :aria-label="title">
      <Icon name="sleep" :size="11" /> {{ value!.score }} %
    </span>
    <p v-else class="small m-0" :class="value!.level === 'possible' ? 'muted' : 'warn'" :title="reasons.join('\n')">
      <Icon name="sleep" :size="13" /> {{ summary }}
    </p>
  </template>
</template>

<style scoped>
.inactivity { display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; white-space: nowrap; }
.inactivity-inactive { color: var(--pos); }
.inactivity-likely { color: var(--warn); }
.inactivity-possible { color: var(--muted); }
</style>

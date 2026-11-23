<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { upcoming, useClock } from '../clock';
import { dateTime } from '../format';
import Countdown from './Countdown.vue';
import Icon from './Icon.vue';

/**
 * Own attacks against the bash limit on a player or a planet: "3/10", red once the limit is reached. `resets` are the
 * times the counted attacks stop counting (server: repo/bash.ts); past ones drop out on their own. Without `compact`
 * the next reset (or, at the limit, the next possible attack) follows as a countdown; the tooltip lists them all.
 * Nothing is shown for a limit of 0 or, with `hideZero`, without counted attacks.
 */
const props = defineProps<{ resets: number[]; limit: number; kind: 'player' | 'planet'; compact?: boolean; hideZero?: boolean }>();
const { t } = useI18n();
const clock = useClock();
const active = upcoming(toRef(props, 'resets'), (r) => r, clock);

const count = computed(() => active.value.length);
const full = computed(() => count.value >= props.limit);
/** when the next attack is allowed again (at the limit) or the count goes down next */
const next = computed(() => (full.value ? active.value[count.value - props.limit] : active.value[0]) ?? null);
const title = computed(() =>
  [
    t(`bash.${props.kind}Title`, { n: count.value, limit: props.limit }),
    ...active.value.map((r) => t('bash.resetAt', { time: dateTime(r) })),
  ].join('\n'),
);
</script>

<template>
  <span v-if="limit > 0 && (count > 0 || !hideZero)" class="bash small" :class="{ full }" :title="title">
    <Icon v-if="compact && kind === 'planet'" name="attack" :size="11" class="faint" />
    <span class="bash-count">{{ t(`bash.${kind}`, { n: count, limit }) }}</span>
    <span v-if="!compact && next" class="faint">
      · {{ t(full ? 'bash.freeIn' : 'bash.downIn') }} <Countdown :to="next" />
    </span>
  </span>
</template>

<style scoped>
.bash { white-space: nowrap; }
.bash-count { font-variant-numeric: tabular-nums; color: var(--muted); }
.full .bash-count { color: var(--neg); font-weight: 600; }
</style>

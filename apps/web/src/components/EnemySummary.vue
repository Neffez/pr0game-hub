<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { coords, duration } from '../format';
import { intlLocale } from '../i18n';
import type { PlanEnemy } from '../plans';
import Icon from './Icon.vue';

/**
 * The hostile attack of a retime or hold plan at a glance: whom it hits, route, impact (with a delay) and the ships
 * (default slot: own content, e.g. the fleet to follow). `actions`: links on the right of the title.
 */
const props = defineProps<{ enemy: PlanEnemy }>();
const { t } = useI18n();
const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
const delay = computed(() => props.enemy.arrival - props.enemy.first_seen);
</script>

<template>
  <div class="enemy-summary">
    <div class="enemy-title">
      <Icon name="attack" class="neg" />
      <b>{{ t('retime.onMember', { member: enemy.member ?? coords(enemy.to.g, enemy.to.s, enemy.to.p) }) }}</b>
      <slot name="hint" />
      <span class="grow" />
      <slot name="actions" />
    </div>
    <dl class="enemy-facts">
      <div>
        <dt>{{ t('retime.impact') }}</dt>
        <dd>
          <b class="mono">{{ clock(enemy.arrival) }}</b>
          <span v-if="delay > 0" class="warn small"> · {{ t('retime.delayed', { t: duration(delay), first: clock(enemy.first_seen) }) }}</span>
        </dd>
      </div>
      <div>
        <dt>{{ t('retime.route') }}</dt>
        <dd class="mono">
          {{ coords(enemy.from.g, enemy.from.s, enemy.from.p) }}
          <Icon name="arrowRight" :size="12" class="faint" />
          {{ coords(enemy.to.g, enemy.to.s, enemy.to.p) }}
        </dd>
      </div>
      <div class="ships">
        <dt>{{ t('plans.ships') }}</dt>
        <dd><slot /></dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.enemy-summary { display: flex; flex-direction: column; gap: 8px; }
.enemy-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.enemy-facts { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 0; }
.enemy-facts > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.enemy-facts .ships { flex: 1 1 220px; }
.enemy-facts dt { color: var(--muted); font-size: 12px; }
.enemy-facts dd { margin: 0; }
</style>

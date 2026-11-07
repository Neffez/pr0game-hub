<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { fmt, short } from '../format';
import PlayerLink from './PlayerLink.vue';

/**
 * Raid risk (server: `GET /defense-risk`): per own planet and moon the most profitable known attack on it as it is,
 * full fleet or heavy ships only. A row opens the defense advisor for the body. `auto` loads at once (defense tab);
 * otherwise a button starts it (empire page), since the first calculation runs many battles.
 */
interface C3 { g: number; s: number; p: number }
interface Body {
  key: string;
  name: string;
  coords: C3;
  type: 'planet' | 'moon';
  threats: number;
  skipped: number;
  worst: { key: string; player: { id: number | null; name: string }; heavy: boolean; profit: number; wins: number } | null;
}
interface Risk { planets: Body[]; runs: number | null; battles: number | null; cached: boolean; error: string | null }

const props = defineProps<{ auto?: boolean; ships?: boolean; debris?: boolean; loot?: 'now' | 'full'; current?: string | null }>();
const { t } = useI18n();
const { uni } = useUni();
const data = ref<Risk | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const q = new URLSearchParams({ ships: props.ships === false ? '0' : '1', debris: props.debris === false ? '0' : '1', loot: props.loot ?? 'now' });
    data.value = await uniApi<Risk>(uni.value, `/defense-risk?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([() => props.ships, () => props.debris, () => props.loot], () => (props.auto || data.value) && load(), { immediate: true });

/** the bodies by risk, the most profitable attack first; bodies without threats last */
const rows = computed(() => [...(data.value?.planets ?? [])].sort((a, b) => (b.worst?.profit ?? -Infinity) - (a.worst?.profit ?? -Infinity)));
const level = (b: Body) => (!b.worst ? 'none' : b.worst.profit <= 0 ? 'low' : b.worst.wins >= 0.5 ? 'high' : 'medium');
const link = (b: Body) => ({ path: `/${uni.value}/build`, query: { tab: 'defense', c: `${b.coords.g}:${b.coords.s}:${b.coords.p}`, type: b.type } });
</script>

<template>
  <div class="risk">
    <div v-if="!data && !auto" class="row small">
      <button class="small" :disabled="loading" @click="load">{{ loading ? t('defense.running') : t('risk.run') }}</button>
      <span class="faint">{{ t('risk.runHint') }}</span>
    </div>
    <p v-if="error" class="error small">{{ error }}</p>
    <p v-if="data?.error" class="error small">{{ t('defense.error', { code: data.error }) }}</p>
    <p v-if="loading && auto && !data" class="muted small m-0">{{ t('defense.running') }}</p>
    <template v-if="data && !data.error">
      <div class="risk-list">
        <RouterLink v-for="b in rows" :key="b.key" :to="link(b)" class="risk-row small" :class="[level(b), { current: b.key === current }]">
          <span class="risk-name">
            <b>{{ b.name }}</b> <span class="faint mono">{{ b.coords.g }}:{{ b.coords.s }}:{{ b.coords.p }}</span>
            <span v-if="b.type === 'moon'" class="faint"> · {{ t('common.moon') }}</span>
          </span>
          <span class="risk-score">
            <template v-if="b.worst">
              <b :class="b.worst.profit > 0 ? 'neg' : 'pos'">{{ b.worst.profit > 0 ? '+' : '' }}{{ short(b.worst.profit) }} D</b>
              <span class="muted">
                · <PlayerLink v-if="b.worst.player.id" :id="b.worst.player.id" :name="b.worst.player.name" /><template v-else>{{ b.worst.player.name }}</template>
                <template v-if="b.worst.heavy"> ({{ t('defense.heavyShort') }})</template>
                · {{ t('risk.wins', { n: fmt(b.worst.wins * 100) }) }}
              </span>
            </template>
            <span v-else class="faint">{{ b.threats ? t('risk.skipped') : t('risk.noThreats') }}</span>
          </span>
          <span class="risk-level">{{ t(`risk.level.${level(b)}`) }}</span>
        </RouterLink>
      </div>
      <p class="faint small m-0 risk-foot">
        {{ t('risk.basis', { battles: fmt(data.battles ?? 0), runs: data.runs ?? 0 }) }}<template v-if="data.cached"> · {{ t('risk.cached') }}</template>
        · <button class="link small" :disabled="loading" @click="load">{{ t('risk.reload') }}</button>
      </p>
    </template>
  </div>
</template>

<style scoped>
.risk-list { display: flex; flex-direction: column; gap: 4px; }
.risk-row { display: grid; grid-template-columns: minmax(140px, 1fr) 2fr auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); color: inherit; text-decoration: none; border-left: 3px solid transparent; }
.risk-row:hover { filter: brightness(1.1); }
.risk-row.current { outline: 1px solid var(--border-strong); }
.risk-row.high { border-left-color: var(--neg, #e5484d); }
.risk-row.medium { border-left-color: var(--warn, #f5a524); }
.risk-row.low { border-left-color: var(--pos, #46a758); }
.risk-level { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
.risk-foot { margin-top: 6px; }
@media (max-width: 799px) {
  .risk-row { grid-template-columns: 1fr auto; }
  .risk-score { grid-column: 1 / -1; grid-row: 2; }
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { coords, distance, flightCalcLink, type Coords3 } from '../format';

/** Action menu for a planet/moon: links into the game, the flight calculator and the spy history. */
const props = defineProps<{ g: number; s: number; p: number; type: 'planet' | 'moon'; from?: Coords3 | null; label?: string }>();

const { t } = useI18n();
const { ctx, uni } = useUni();
const open = ref(false);
const menuStyle = ref<Record<string, string>>({});
const button = ref<HTMLButtonElement | null>(null);

const settings = computed(() => ctx.value!.universe.settings);
const gameUrl = computed(() => settings.value.gameUrl?.replace(/\/?$/, '/') ?? '');
const target = computed<Coords3>(() => [props.g, props.s, props.p]);

/** Start for the flight time: given origin, otherwise the nearest own planet (empire page). */
const start = computed<{ c: Coords3; label: string } | null>(() => {
  if (props.from) return { c: props.from, label: coords(...props.from) };
  let best: { c: Coords3; label: string; d: number } | null = null;
  for (const pl of ctx.value?.own?.planets ?? []) {
    const c: Coords3 = [pl.coords.g, pl.coords.s, pl.coords.p];
    const d = distance(settings.value, c, target.value);
    if (!best || d < best.d) best = { c, label: `${pl.name} ${coords(...c)}`, d };
  }
  return best;
});

const fleet = (mission: number) =>
  `${gameUrl.value}game.php?page=fleetTable&galaxy=${props.g}&system=${props.s}&planet=${props.p}&planettype=${props.type === 'moon' ? 3 : 1}&target_mission=${mission}`;

const items = computed(() => {
  const list: { label: string; href?: string; to?: object; hint?: string }[] = [];
  if (gameUrl.value) {
    list.push({ label: t('actions.spy'), href: fleet(6), hint: t('actions.fleetPage') });
    list.push({ label: t('actions.attack'), href: fleet(1), hint: t('actions.fleetPage') });
  }
  list.push({
    label: t('actions.flightTime'),
    href: flightCalcLink(settings.value, start.value?.c ?? null, target.value, ctx.value?.own?.research),
    hint: start.value ? t('actions.flightFrom', { from: start.value.label }) : t('actions.flightNoStart'),
  });
  if (gameUrl.value) list.push({ label: t('actions.galaxy'), href: `${gameUrl.value}game.php?page=galaxy&galaxy=${props.g}&system=${props.s}`, hint: t('actions.inGame') });
  list.push({ label: t('actions.spyHistory'), to: { path: `/${uni.value}/spy`, query: { c: `${props.g}:${props.s}:${props.p}`, type: props.type } } });
  return list;
});

function toggle() {
  if (open.value) return close();
  // fixed position: table containers scroll and would clip an absolute menu
  const r = button.value!.getBoundingClientRect();
  const below = window.innerHeight - r.bottom > 220;
  menuStyle.value = {
    right: `${Math.max(8, window.innerWidth - r.right)}px`,
    ...(below ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
  };
  open.value = true;
  setTimeout(() => {
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  });
}
function close() {
  open.value = false;
  document.removeEventListener('click', close);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
}
onBeforeUnmount(close);
</script>

<template>
  <button ref="button" class="actions-btn" :class="{ active: open }" :title="t('common.actions')" @click.stop="toggle">{{ label ?? t('common.actions') }} ▾</button>
  <Teleport to="body">
    <div v-if="open" class="actions-menu" :style="menuStyle" @click.stop>
      <template v-for="it in items" :key="it.label">
        <RouterLink v-if="it.to" :to="it.to" @click="close">{{ it.label }}</RouterLink>
        <a v-else :href="it.href" target="_blank" rel="noopener" @click="close">
          {{ it.label }}<span v-if="it.hint" class="hint-text">{{ it.hint }}</span>
        </a>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.actions-btn { padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.actions-btn.active { border-color: var(--accent); color: var(--accent); }
.actions-menu {
  position: fixed; z-index: 50; min-width: 200px; padding: 4px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
}
.actions-menu a { display: block; padding: 6px 10px; border-radius: 6px; color: var(--text); font-size: 13px; }
.actions-menu a:hover { background: var(--accent-soft); text-decoration: none; }
.hint-text { display: block; font-size: 11px; color: var(--muted); }
</style>

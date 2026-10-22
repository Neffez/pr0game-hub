<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { CLAIM_KINDS, CLAIM_MINUTES, claimOf, loadClaims, remaining } from '../claims';
import { useUni } from '../composables';
import { coords, distance, flightCalcLink, type Coords3 } from '../format';

/** Action menu for a planet/moon: links into the game, the flight calculator and the spy history; claiming the target. */
const props = defineProps<{ g: number; s: number; p: number; type: 'planet' | 'moon'; from?: Coords3 | null; label?: string }>();

const { t } = useI18n();
const { ctx, uni } = useUni();
const open = ref(false);
const menuStyle = ref<Record<string, string>>({});
const button = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);

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

/** Claim of this target (by anyone in the alliance); shown on the button and managed in the menu. */
const claim = computed(() => claimOf(props.g, props.s, props.p, props.type));
const mine = computed(() => claim.value?.user_id === ctx.value?.me.id);
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || ctx.value?.me.isAdmin);
const kind = ref<(typeof CLAIM_KINDS)[number]>('farm');
const minutes = ref(120);
const note = ref('');
const claimError = ref('');

async function claimRequest(fn: () => Promise<unknown>) {
  claimError.value = '';
  try {
    await fn();
    await loadClaims(uni.value);
  } catch (e) {
    claimError.value = (e as Error).message;
  }
}
const claimTarget = (force = false) =>
  claimRequest(() =>
    uniApi(uni.value, '/claims', {
      body: { g: props.g, s: props.s, p: props.p, type: props.type, kind: kind.value, minutes: minutes.value, note: note.value, force },
    }),
  );
const extend = () => claimRequest(() => uniApi(uni.value, `/claims/${claim.value!.id}`, { method: 'PUT', body: { minutes: minutes.value } }));
const release = () => claimRequest(() => uniApi(uni.value, `/claims/${claim.value!.id}`, { method: 'DELETE' }));
const durationLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

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
  claimError.value = '';
  // the opening click stops at the button (@click.stop), so it doesn't reach this listener
  document.addEventListener('click', close);
  window.addEventListener('scroll', closeUnlessTyping, true);
  window.addEventListener('resize', closeUnlessTyping);
}
/** The on-screen keyboard of a phone resizes and scrolls the page: the menu stays while one of its fields has focus. */
function closeUnlessTyping() {
  if (!menu.value?.contains(document.activeElement)) close();
}
function close() {
  open.value = false;
  document.removeEventListener('click', close);
  window.removeEventListener('scroll', closeUnlessTyping, true);
  window.removeEventListener('resize', closeUnlessTyping);
}
onBeforeUnmount(close);
</script>

<template>
  <span
    v-if="claim"
    class="claim-flag"
    :class="{ mine }"
    :title="t('claims.by', { name: claim.member, kind: t(`claims.kinds.${claim.kind}`), left: remaining(claim) }) + (claim.note ? ` – ${claim.note}` : '')"
    >🎯 {{ mine ? t('claims.you') : claim.member }}</span
  >
  <button ref="button" class="actions-btn" :class="{ active: open }" :title="t('common.actions')" @click.stop="toggle">{{ label ?? t('common.actions') }} ▾</button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="actions-menu" :style="menuStyle" @click.stop>
      <template v-for="it in items" :key="it.label">
        <RouterLink v-if="it.to" :to="it.to" @click="close">{{ it.label }}</RouterLink>
        <a v-else :href="it.href" target="_blank" rel="noopener" @click="close">
          {{ it.label }}<span v-if="it.hint" class="hint-text">{{ it.hint }}</span>
        </a>
      </template>
      <div class="claim-box">
        <template v-if="claim">
          <div class="small">
            🎯 {{ t('claims.by', { name: mine ? t('claims.you') : claim.member, kind: t(`claims.kinds.${claim.kind}`), left: remaining(claim) }) }}
            <div v-if="claim.note" class="hint-text">{{ claim.note }}</div>
          </div>
          <div v-if="mine || isAdmin" class="claim-row">
            <select v-model.number="minutes" :aria-label="t('claims.duration')">
              <option v-for="m in CLAIM_MINUTES" :key="m" :value="m">{{ durationLabel(m) }}</option>
            </select>
            <button @click="extend">{{ t('claims.extend') }}</button>
            <button @click="release">{{ t('claims.release') }}</button>
          </div>
        </template>
        <template v-if="!claim || (!mine && isAdmin)">
          <div class="claim-row">
            <select v-model="kind" :aria-label="t('claims.kind')">
              <option v-for="k in CLAIM_KINDS" :key="k" :value="k">{{ t(`claims.kinds.${k}`) }}</option>
            </select>
            <select v-model.number="minutes" :aria-label="t('claims.duration')">
              <option v-for="m in CLAIM_MINUTES" :key="m" :value="m">{{ durationLabel(m) }}</option>
            </select>
          </div>
          <input v-model="note" maxlength="200" :placeholder="t('claims.note')" />
          <button class="primary" @click="claimTarget(!!claim)">{{ claim ? t('claims.takeOver') : t('claims.claim') }}</button>
        </template>
        <div v-if="claimError" class="error small">{{ claimError }}</div>
      </div>
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
.claim-flag { margin-right: 4px; font-size: 11px; color: var(--warn); white-space: nowrap; }
.claim-flag.mine { color: var(--pos); }
.claim-box { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 8px 10px 6px; border-top: 1px solid var(--border); }
.claim-row { display: flex; gap: 6px; }
.claim-row > * { flex: 1; min-width: 0; }
@media (max-width: 800px) {
  .actions-btn { padding: 4px 10px; }
  .actions-menu { min-width: min(240px, calc(100vw - 16px)); }
  .actions-menu a { padding: 11px 12px; font-size: 14px; }
}
</style>

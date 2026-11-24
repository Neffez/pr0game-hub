<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { HubActivity } from '../apiTypes';
import { nowSec } from '../clock';
import { useLoader, useStored, useUni } from '../composables';
import { coords, dateTime, fmt, numDate, weekday } from '../format';
import { intlLocale } from '../i18n';
import { tables, useLiveReload } from '../live';
import Icon from './Icon.vue';
import RangePicker from './RangePicker.vue';
import PlayerLink from './PlayerLink.vue';
import Section from './Section.vue';

/**
 * What members did in the hub (`GET /api/{uni}/hub-activity`): syncs that brought something new (bundled), comments,
 * raid plans and target claims, newest first and per day; filterable by kind and member.
 */
type Entry = HubActivity['entries'][number];

/** label: hubActivity.kinds.<kind>; icon: name in Icon.vue */
const KINDS: { kind: Entry['kind']; icon: string; color: string }[] = [
  { kind: 'sync', icon: 'sync', color: 'var(--info)' },
  { kind: 'comment', icon: 'comment', color: 'var(--pos)' },
  { kind: 'plan', icon: 'attack', color: 'var(--neg)' },
  { kind: 'claim', icon: 'target', color: 'var(--warn)' },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
const SYNC_ICONS: Record<string, string> = {
  galaxy: 'galaxy', universe: 'galaxy', spy: 'spy', stats: 'stats', battle: 'raids', combat: 'raids', hostile: 'hostile',
  playerCard: 'user', battleHall: 'battleHall', market: 'market',
};

const { t } = useI18n();
const { uni } = useUni();
const days = useStored('hubActivity.days', 3);
const hidden = useStored<string[]>('hubActivity.hidden', []);
/** member filter: user id, '' for all */
const member = useStored<string>('hubActivity.member', '');
const { data, error, load } = useLoader(() => uniApi<HubActivity>(uni.value, `/hub-activity?from=${nowSec() - days.value * 86400}`));
defineExpose({ ready: computed(() => !!data.value) });
onMounted(load);
useLiveReload(load, tables('galaxy_systems', 'spy_reports', 'player_scores', 'battle_reports', 'combat_reports', 'player_cards', 'market_offers', 'comments', 'attack_plans', 'target_claims'));
watch(days, load);

function toggle(kind: string) {
  hidden.value = hidden.value.includes(kind) ? hidden.value.filter((k) => k !== kind) : [...hidden.value, kind];
}

const counts = computed(() => {
  const out: Record<string, number> = {};
  for (const e of data.value?.entries ?? []) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
});
/** members with entries, by name */
const members = computed(() => {
  const m = new Map<number, string>();
  for (const e of data.value?.entries ?? []) if (e.user_id != null && e.member) m.set(e.user_id, e.member);
  return [...m].sort((a, b) => a[1].localeCompare(b[1]));
});
const entries = computed(() =>
  (data.value?.entries ?? []).filter((e) => !hidden.value.includes(e.kind) && (!member.value || String(e.user_id) === member.value)),
);

const days_ = computed(() => {
  const out: { day: string; entries: Entry[] }[] = [];
  for (const e of entries.value) {
    const d = new Date(e.end * 1000);
    const day = `${weekday(d, 'long')}, ${numDate(d)}`;
    if (out.at(-1)?.day !== day) out.push({ day, entries: [] });
    out.at(-1)!.entries.push(e);
  }
  return out;
});

const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' });
const time = (e: Entry) => (e.end - e.time >= 60 ? `${clock(e.time)}–${clock(e.end)}` : clock(e.end));
const icon = (e: Entry) => (e.kind === 'sync' ? (SYNC_ICONS[e.what ?? ''] ?? 'sync') : META[e.kind].icon);

/** A galaxy system (`g:s`) or coordinates (`g:s:p`, maybe with a suffix) as a link into the galaxy browser. */
function itemLink(item: string) {
  const m = /(\d+):(\d+)(?::(\d+))?/.exec(item);
  return m ? { path: `/${uni.value}/browse`, query: { g: m[1], s: m[2] } } : null;
}
const itemText = (e: Entry, item: string) => {
  if (e.what !== 'stats') return item;
  const [who, type] = item.split(':');
  return `${t(`hubActivity.statsWho.${who}`)} · ${t(`hubActivity.statsType.${type}`)}`;
};
/** a few labels that cover all of the entry stand in its line, more behind "Details" */
const inline = (e: Entry) => e.kind === 'sync' && e.items.length > 0 && e.items.length <= 3 && (e.what === 'stats' || e.count === e.items.length);
const linked = (e: Entry) => e.what !== 'stats' && e.what !== 'playerCard';

function text(e: Entry) {
  const n = { n: fmt(e.count) };
  switch (e.kind) {
    case 'sync':
      return t(`hubActivity.sync.${e.what}`, n, e.count);
    case 'comment':
      return t(`hubActivity.comment.${e.what}`);
    case 'plan':
      return t(e.what === 'hold' ? 'hubActivity.planHold' : 'hubActivity.planAttack', { time: dateTime(e.target_time) });
    case 'claim':
      return t(`hubActivity.claim.${e.what}`, n, e.count);
  }
  return e.kind;
}
const target = (e: Entry) => (e.g != null ? { path: `/${uni.value}/browse`, query: { g: e.g, s: e.s } } : null);
const planLink = (e: Entry) => (e.plan_id == null ? null : e.kind === 'comment' ? `/${uni.value}/raid-planner/${e.plan_id}/loot` : `/${uni.value}/raid-planner/${e.plan_id}`);
</script>

<template>
  <div class="card">
    <div class="row" data-tour="activity-hub-range">
      <RangePicker v-model="days" />
      <label>
        {{ t('hubActivity.member') }}
        <select v-model="member">
          <option value="">{{ t('hubActivity.allMembers') }}</option>
          <option v-for="[id, name] in members" :key="id" :value="String(id)">{{ name }}</option>
        </select>
      </label>
    </div>
    <div class="row chips" data-tour="activity-hub-kinds">
      <button
        v-for="k in KINDS"
        :key="k.kind"
        class="chip"
        :class="{ off: hidden.includes(k.kind) }"
        :aria-pressed="!hidden.includes(k.kind)"
        :title="hidden.includes(k.kind) ? t('activity.show') : t('activity.hide')"
        @click="toggle(k.kind)"
      >
        <Icon :name="k.icon" :size="13" :style="{ color: k.color }" /> {{ t(`hubActivity.kinds.${k.kind}`) }}
        <span class="faint">{{ counts[k.kind] ?? 0 }}</span>
      </button>
    </div>
    <p class="muted small" style="margin: 8px 0 0">{{ t('hubActivity.note') }}</p>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !entries.length" class="card muted">{{ t('activity.empty') }}</div>

  <Section v-for="(d, i) in days_" :key="d.day" data-tour="activity-hub-days" :title="d.day" :count="d.entries.length" :card="false" :default-open="i === 0" class="day">
    <div class="card" style="padding: 4px 0">
      <div v-for="e in d.entries" :key="e.id" class="entry">
        <span class="mono small faint">{{ time(e) }}</span>
        <span class="kind-icon" :style="{ color: META[e.kind]?.color }"><Icon :name="icon(e)" :size="15" :label="t(`hubActivity.kinds.${e.kind}`)" /></span>
        <span class="who">
          <b v-if="e.member">{{ e.member }}</b>
          <span v-else class="muted" :title="e.hidden ? t('hubActivity.hiddenHint') : undefined">{{ t(e.hidden ? 'hubActivity.hidden' : 'hubActivity.unknown') }}</span>
        </span>
        <span class="what">
          {{ text(e) }}
          <template v-if="e.player_id">
            · <PlayerLink :id="e.player_id" :name="e.player_name ?? '?'" />
          </template>
          <q v-if="e.text" class="muted">{{ e.text }}</q>
          <span v-if="inline(e)" class="items-inline">
            <span v-for="item in e.items" :key="item" class="item small">
              <RouterLink v-if="linked(e) && itemLink(item)" class="mono" :to="itemLink(item)!">{{ item }}</RouterLink>
              <template v-else>{{ itemText(e, item) }}</template>
            </span>
          </span>
          <details v-else-if="e.items.length && (e.kind === 'sync' || e.count > 1)" class="items">
            <summary class="small muted">{{ t('hubActivity.details', { n: e.items.length }, e.items.length) }}</summary>
            <span v-for="item in e.items" :key="item" class="item small">
              <RouterLink v-if="linked(e) && itemLink(item)" class="mono" :to="itemLink(item)!">{{ item }}</RouterLink>
              <template v-else>{{ itemText(e, item) }}</template>
            </span>
            <span v-if="e.count > e.items.length && e.what !== 'stats'" class="small faint">{{ t('hubActivity.more', { n: fmt(e.count - e.items.length) }) }}</span>
          </details>
        </span>
        <RouterLink v-if="planLink(e)" class="small" :to="planLink(e)!">{{ t(e.kind === 'comment' ? 'hubActivity.toLoot' : 'hubActivity.toPlan') }}</RouterLink>
        <RouterLink v-else-if="target(e)" class="mono small" :to="target(e)!" :title="t('activity.showInBrowser')">
          <Icon v-if="e.planet_type === 'moon'" name="moon" :size="12" :label="t('common.moon')" />
          <Icon v-else-if="e.planet_type === 'debris'" name="debris" :size="12" />
          {{ coords(e.g!, e.s!, e.p!) }}
        </RouterLink>
        <span v-else />
      </div>
    </div>
  </Section>
</template>

<style scoped>
.chips { margin-top: 10px; gap: 6px; }
.chip.off { opacity: 0.4; text-decoration: line-through; }
.day :deep(.section-title) { font-size: 13px; color: var(--muted); text-transform: capitalize; }
.entry { display: grid; grid-template-columns: 88px 20px minmax(120px, 200px) 1fr auto; align-items: center; gap: 10px; padding: 6px 16px; }
.entry + .entry { border-top: 1px solid var(--border); }
.kind-icon { display: flex; justify-content: center; }
q { display: block; margin-top: 2px; font-style: italic; }
.items summary { cursor: pointer; }
.items-inline { margin-left: 6px; }
.items-inline .item + .item::before { content: '· '; color: var(--faint, var(--muted)); }
.items[open] { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.items[open] summary { flex-basis: 100%; }
@media (max-width: 800px) {
  .entry { grid-template-columns: 44px 20px 1fr; }
  .what, .entry > a { grid-column: 3; }
}
</style>

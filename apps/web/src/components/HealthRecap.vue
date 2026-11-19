<script setup lang="ts">
import BadgeIcon from './BadgeIcon.vue';
import Hint from './Hint.vue';
import Icon from './Icon.vue';
import Loading from './Loading.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ApiResponse } from '@pr0hub/api-types';
import { api, uniApi } from '../api';
import type { Recap, RecapText } from '../apiTypes';
import { achievements, badgeAt, loadAchievements } from '../achievements';
import { useStored, useUni } from '../composables';
import { dateTime, fmt, fmtSigned, numDate } from '../format';
import { tables, useLiveReload } from '../live';
import { blobBase64, recapPng, recapSvg, type RecapImageTexts } from '../recapImage';
import { toast } from '../toast';

/**
 * Health page, tab "Recap": the alliance's look back on this week, last week or the last 30 days (server: repo/recap.ts)
 * with the span before for comparison. To share: a PNG card (recapImage.ts), the text as Markdown (server:
 * recapText.ts), and for the alliance's admins straight to the Discord channel.
 */
type Period = Recap['period'];
type HighlightKey = Recap['highlights'][number]['key'];
const PERIODS: Period[] = ['week', 'lastWeek', 'days30'];
const HIGHLIGHT_ICONS: Record<HighlightKey, string> = { top: 'medal', riser: 'rankUp', cartographer: 'galaxy', scout: 'spy', streak: 'bolt', badges: 'sparkle' };

const { t, locale } = useI18n();
const { uni, ctx } = useUni();
const period = useStored<Period>('health.recapPeriod', 'week');
const data = ref<Recap | null>(null);
const error = ref('');
const busy = ref<'' | 'image' | 'copy' | 'discord'>('');

async function load() {
  try {
    data.value = await uniApi<Recap>(uni.value, `/recap?period=${PERIODS.includes(period.value) ? period.value : 'week'}`);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(period, () => {
  data.value = null;
  load();
}, { immediate: true });
useLiveReload(load, tables('galaxy_systems', 'spy_reports', 'battle_reports', 'expeditions', 'empire', 'overview', 'fleets', 'player_scores'), 10000);
// the levels of each badge for the icons' tooltips
loadAchievements(uni.value);
const steps = (key: Recap['badges'][number]['key']) => achievements.value?.[0]?.badges.find((b) => b.key === key)?.steps ?? [];

// the channel: only the alliance's admins can read and post to it
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || !!ctx.value?.me.isAdmin);
const channel = ref<ApiResponse<'/api/admin/groups/{id}/discord'> | null>(null);
watch(
  () => isAdmin.value && ctx.value?.group.id,
  async (id) => {
    channel.value = null;
    if (!id) return;
    try {
      channel.value = await api<ApiResponse<'/api/admin/groups/{id}/discord'>>(`/admin/groups/${id}/discord`);
    } catch {
      /* optional */
    }
  },
  { immediate: true },
);

const day = (d: string) => numDate(new Date(`${d}T12:00:00`), 'none');
const range = computed(() => (data.value ? `${day(data.value.from)} – ${day(data.value.to)}` : ''));
const pct = (a: number, b: number) => {
  const p = b ? Math.round((100 * a) / b) : 0;
  return !p && a > 0 ? '< 1 %' : `${p} %`;
};
/** change against the span before: arrow and percent, null without a value before or without a change */
function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before || now === before) return null;
  const p = Math.round((100 * (now - before)) / before);
  return p ? { text: t('recap.change', { arrow: p > 0 ? '▲' : '▼', n: Math.abs(p) }), up: p > 0 } : null;
}

const kpis = computed(() => {
  const r = data.value;
  if (!r) return [];
  return [
    { key: 'syncs', value: fmt(r.syncs.now), before: fmt(r.syncs.before), change: change(r.syncs.now, r.syncs.before) },
    { key: 'active', value: `${r.active.now} / ${r.members}`, before: String(r.active.before), change: change(r.active.now, r.active.before) },
    { key: 'points', value: fmt(r.points.now), before: fmt(r.points.before), change: change(r.points.now, r.points.before) },
    { key: 'badges', value: fmt(r.newBadges), before: null, change: null },
  ];
});
const kinds = computed(() => (data.value?.kinds ?? []).filter((k) => k.points > 0));
const topKind = computed(() => Math.max(1, ...kinds.value.map((k) => k.points)));
const topDay = computed(() => Math.max(1, ...(data.value?.days ?? []).map((d) => d.points)));
const quiet = computed(() => !!data.value && !data.value.points.now && !data.value.syncs.now);
const badges = computed(() => (data.value?.badges ?? []).map((b) => ({ ...b, badge: badgeAt(b.key, b.level, steps(b.key)) })));

const open = computed(() => {
  const r = data.value;
  if (!r) return { galaxy: null, lines: [] as string[] };
  const g = r.open.galaxy;
  const lines: string[] = [];
  if (r.open.idle) lines.push(t('recap.idle', { n: r.open.idle, of: r.members }));
  if (r.open.noEmpire) lines.push(t('recap.noEmpire', { n: r.open.noEmpire }, r.open.noEmpire));
  if (r.open.goals.total) lines.push(t('recap.goals', { n: r.open.goals.reached, of: r.open.goals.total }));
  const galaxy =
    g.total && g.fresh < g.total
      ? {
          text: `${t('recap.galaxy', { pct: pct(g.fresh, g.total), days: g.days })}${g.weakest ? ` · ${t('recap.weakest', { g: g.weakest.g, pct: pct(g.weakest.fresh, g.weakest.total) })}` : ''}`,
          share: g.fresh / g.total,
        }
      : null;
  return { galaxy, lines };
});
const allGood = computed(() => !!data.value && !open.value.galaxy && !data.value.open.idle && !data.value.open.noEmpire && data.value.open.goals.reached === data.value.open.goals.total);

const highlightValue = (key: HighlightKey, n: number) => t(`recap.highlightValue.${key}`, { n: fmt(n) }, n);
const rows = computed(() => data.value?.rows ?? []);

// ---------------------------------------------------------------- sharing

/** "Recap KW 47" / "Recap week 47" / the 30 days */
function isoWeek(d: string): number {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 3 - ((x.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((x.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
const cardTitle = computed(() => {
  const r = data.value;
  if (!r) return '';
  return r.period === 'days30' ? range.value : `${locale.value === 'en' ? 'Week' : 'KW'} ${isoWeek(r.from)} · ${range.value}`;
});

function imageTexts(r: Recap): RecapImageTexts {
  const group = ctx.value?.group;
  const MAX_BADGES = 12;
  return {
    label: `Recap · ${t(`ranking.period.${r.period}`)}`,
    title: cardTitle.value,
    alliance: group ? `${group.tag ? `[${group.tag}] ` : ''}${group.name}` : '',
    kpis: kpis.value.map((k) => ({ value: k.value, label: t(`recap.kpi.${k.key}`), change: k.change })),
    highlightsTitle: t('recap.highlights'),
    highlights: r.highlights.map((h) => ({ icon: HIGHLIGHT_ICONS[h.key], text: `${t(`recap.highlight.${h.key}`)} · ${highlightValue(h.key, h.value)}`, name: h.name })),
    kindsTitle: t('recap.kinds'),
    kinds: kinds.value.slice(0, Math.max(4, r.highlights.length)).map((k) => ({ label: t(`ranking.kinds.${k.kind}`), value: fmt(k.units), share: k.points / topKind.value })),
    badgesTitle: t('recap.badges'),
    badges: r.badges.slice(0, MAX_BADGES).map((b) => ({ key: b.key, level: b.level, name: b.name, badge: t('recap.badgeLevel', { badge: t(`badges.${b.key}.name`), n: b.level }) })),
    moreBadges: r.badges.length > MAX_BADGES ? t('recap.moreBadges', { n: r.badges.length - MAX_BADGES }) : null,
    openTitle: t('recap.open'),
    galaxy: open.value.galaxy,
    open: open.value.lines,
    footer: t('recap.footer', { date: dateTime(Math.floor(Date.now() / 1000)) }),
  };
}

async function png(): Promise<Blob> {
  return recapPng(recapSvg(imageTexts(data.value!)));
}

async function downloadImage() {
  if (!data.value || busy.value) return;
  busy.value = 'image';
  try {
    const url = URL.createObjectURL(await png());
    const a = document.createElement('a');
    a.href = url;
    a.download = `recap-${uni.value}-${data.value.from}-${data.value.to}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    toast((e as Error).message, 'warn');
  } finally {
    busy.value = '';
  }
}

async function copyText() {
  if (!data.value || busy.value) return;
  busy.value = 'copy';
  try {
    const { text } = await uniApi<RecapText>(uni.value, `/recap/text?period=${data.value.period}&lang=${locale.value === 'en' ? 'en' : 'de'}`);
    await navigator.clipboard.writeText(text);
    toast(t('recap.copied'));
  } catch (e) {
    toast((e as Error).message, 'warn');
  } finally {
    busy.value = '';
  }
}

async function sendDiscord() {
  if (!data.value || busy.value || !channel.value?.webhook) return;
  if (!confirm(t('recap.confirmSend', { range: range.value }))) return;
  busy.value = 'discord';
  try {
    const image = await blobBase64(await png()).catch(() => undefined);
    await uniApi(uni.value, '/recap/discord', { method: 'POST', body: { period: data.value.period, image } });
    toast(t('recap.sent'));
  } catch (e) {
    toast((e as Error).message, 'warn');
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div class="card row" data-tour="health-recap-actions">
    <div class="seg">
      <button v-for="p in PERIODS" :key="p" :class="{ active: period === p }" @click="period = p">{{ t(`ranking.period.${p}`) }}</button>
    </div>
    <span v-if="data" class="small">
      <b>{{ range }}</b>
      <span class="muted"> · {{ t('recap.compared', { from: day(data.previous.from), to: day(data.previous.to) }) }}</span>
    </span>
    <span class="grow" />
    <button type="button" :disabled="!data || !!busy" @click="downloadImage"><Icon name="download" :size="14" /> {{ t('recap.image') }}</button>
    <button type="button" :disabled="!data || !!busy" @click="copyText"><Icon name="messages" :size="14" /> {{ t('recap.copy') }}</button>
    <button
      v-if="isAdmin"
      type="button"
      class="primary"
      :disabled="!data || !!busy || !channel?.webhook"
      :title="channel && !channel.webhook ? t('recap.noChannel') : undefined"
      @click="sendDiscord"
    >
      <Icon name="external" :size="14" /> {{ t('recap.discord') }}
    </button>
    <Hint><p>{{ t('recap.hint') }}</p></Hint>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <template v-else>
    <div class="rc-kpis" data-tour="health-recap-kpis">
      <div v-for="k in kpis" :key="k.key" class="card rc-kpi">
        <div class="rc-kpi-value mono">{{ k.value }}</div>
        <div class="muted">{{ t(`recap.kpi.${k.key}`) }}</div>
        <div class="small">
          <span v-if="k.change" :class="k.change.up ? 'pos' : 'neg'">{{ k.change.text }}</span>
          <span v-if="k.before != null" class="muted">{{ k.change ? ' · ' : '' }}{{ t('recap.before', { n: k.before }) }}</span>
        </div>
      </div>
    </div>

    <p v-if="quiet" class="card muted">{{ t('recap.quiet') }}</p>

    <div class="rc-grid" data-tour="health-recap-highlights">
      <section class="card">
        <h3>{{ t('recap.highlights') }}</h3>
        <p v-if="!data.highlights.length" class="muted small">{{ t('recap.noHighlights') }}</p>
        <ul class="rc-highlights">
          <li v-for="h in data.highlights" :key="h.key" :class="{ me: h.userId === ctx?.me.id }">
            <span class="rc-hl-icon"><Icon :name="HIGHLIGHT_ICONS[h.key]" :size="18" /></span>
            <span>
              <span class="muted small">{{ t(`recap.highlight.${h.key}`) }}</span><br />
              <b class="rc-name">{{ h.name }}</b> <span class="muted small">{{ highlightValue(h.key, h.value) }}</span>
            </span>
          </li>
        </ul>
      </section>

      <section class="card">
        <h3>{{ t('recap.kinds') }}</h3>
        <ul class="rc-kinds">
          <li v-for="k in kinds" :key="k.kind" :title="`${fmt(k.points)} ${t('recap.kpi.points')} · ${t('recap.before', { n: fmt(k.before) })}`">
            <span>{{ t(`ranking.kinds.${k.kind}`) }}</span>
            <span class="mono muted">{{ fmt(k.units) }}</span>
            <span class="rc-bar"><span :style="{ width: `${(100 * k.points) / topKind}%` }" /></span>
          </li>
        </ul>
        <h3>{{ t('recap.days') }}</h3>
        <div class="rc-days" :class="{ dense: data.days.length > 10 }">
          <div v-for="d in data.days" :key="d.day" class="rc-day" :title="t('recap.dayTip', { day: day(d.day), points: fmt(d.points), syncs: fmt(d.syncs) })">
            <span class="rc-day-bar" :style="{ height: `${Math.max(2, (100 * d.points) / topDay)}%` }" />
            <span v-if="data.days.length <= 10" class="rc-day-label small muted">{{ day(d.day) }}</span>
          </div>
        </div>
      </section>

      <section class="card rc-wide">
        <h3>{{ t('recap.badges') }}</h3>
        <p v-if="!badges.length" class="muted small">{{ t('recap.noBadges') }}</p>
        <ul class="rc-badges">
          <li v-for="b in badges" :key="`${b.userId}-${b.key}`" :class="{ me: b.userId === ctx?.me.id }">
            <BadgeIcon :badge="b.badge" :size="18" />
            <span><b class="rc-name">{{ b.name }}</b> <span class="muted small">{{ t('recap.badgeLevel', { badge: t(`badges.${b.key}.name`), n: b.level }) }}</span></span>
          </li>
        </ul>
      </section>
    </div>

    <section class="card" data-tour="health-recap-open">
      <h3>{{ t('recap.open') }} <span class="muted small">· {{ t('recap.openNow') }}</span></h3>
      <p v-if="allGood" class="pos">{{ t('recap.allGood') }}</p>
      <div v-if="open.galaxy" class="rc-galaxy">
        <span>{{ open.galaxy.text }}</span>
        <span class="rc-bar"><span :style="{ width: `${100 * open.galaxy.share}%` }" /></span>
      </div>
      <ul class="rc-open">
        <li v-for="line in open.lines" :key="line">{{ line }}</li>
      </ul>
    </section>

    <section class="card">
      <h3>{{ t('recap.members') }}</h3>
      <div class="scroll-x">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('recap.col.name') }}</th>
              <th class="num">{{ t('recap.col.points') }}</th>
              <th class="num">{{ t('recap.col.change') }}</th>
              <th class="num">{{ t('recap.col.syncs') }}</th>
              <th class="num">{{ t('recap.col.streak') }}</th>
              <th class="num">{{ t('recap.col.badges') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.userId" :class="{ dim: !r.points && !r.syncs }">
              <td :class="{ 'rc-me': r.userId === ctx?.me.id }">{{ r.name }}</td>
              <td class="num">{{ fmt(r.points) }}</td>
              <td class="num" :class="r.points > r.before ? 'pos' : r.points < r.before ? 'neg' : 'muted'">{{ r.points === r.before ? '–' : fmtSigned(r.points - r.before) }}</td>
              <td class="num">{{ fmt(r.syncs) }}</td>
              <td class="num">{{ r.streak || '–' }}</td>
              <td class="num">{{ r.badges ? `+${r.badges}` : '–' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.rc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.rc-kpi { margin: 0; display: flex; flex-direction: column; gap: 2px; }
.rc-kpi-value { font-size: 26px; font-weight: 700; line-height: 1.2; }
.rc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.rc-grid .rc-wide { grid-column: 1 / -1; }
.card h3 { margin-top: 0; }
.card h3 + h3, .rc-kinds + h3 { margin-top: 16px; }
.rc-highlights, .rc-kinds, .rc-badges, .rc-open { list-style: none; padding: 0; margin: 0; }
.rc-highlights { display: flex; flex-direction: column; gap: 10px; }
.rc-highlights li { display: flex; gap: 10px; align-items: center; }
.rc-hl-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); flex: none; }
.rc-highlights li.me .rc-name, .rc-badges li.me .rc-name, .rc-me { color: var(--accent); }
.rc-kinds { display: flex; flex-direction: column; gap: 8px; }
.rc-kinds li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; cursor: help; }
.rc-kinds .rc-bar { grid-column: 1 / -1; }
.rc-bar { display: block; height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; }
.rc-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.rc-days { display: flex; align-items: flex-end; gap: 6px; height: 110px; }
.rc-days.dense { gap: 2px; height: 80px; }
.rc-day { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; cursor: help; min-width: 0; }
.rc-day-bar { display: block; width: 100%; max-width: 40px; background: var(--accent); border-radius: 3px 3px 0 0; opacity: 0.85; }
.rc-day-label { white-space: nowrap; }
.rc-days:not(.dense) .rc-day { padding-bottom: 0; }
.rc-badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 16px; }
.rc-badges li { display: flex; gap: 8px; align-items: center; }
.rc-galaxy { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.rc-open { display: flex; flex-direction: column; gap: 4px; }
.rc-open li::before { content: '•'; color: var(--accent); margin-right: 8px; }
.scroll-x { overflow-x: auto; }
@media (max-width: 799px) {
  .rc-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rc-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>

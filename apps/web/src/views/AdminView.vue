<script setup lang="ts">
import { startTour, useAutoTour } from '../tours';
import Section from '../components/Section.vue';
import Sheet from '../components/Sheet.vue';
import UnitEditor from '../components/UnitEditor.vue';
import Icon from '../components/Icon.vue';
import SortBar from '../components/SortBar.vue';
import SortMark from '../components/SortMark.vue';
import BackLink from '../components/BackLink.vue';
import { useMobile, useSort, vStack } from '../composables';
import CopyField from '../components/CopyField.vue';
import Hint from '../components/Hint.vue';
import DateTimeInput from '../components/DateTimeInput.vue';
import { fromLocalInput, toLocalInput } from '../plans';
import InactivityCheck from '../components/InactivityCheck.vue';
import SystemMonitor from '../components/SystemMonitor.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, loadMe, selectedGroup, session } from '../api';
import { clockTime, coords, dateTime, fmt, STATS_CATEGORIES } from '../format';

type FleetAttackRow = {
  userId: number;
  member: string;
  key: string;
  owner: string;
  arrival: number;
  from: { g: number; s: number; p: number; type: string };
  to: { g: number; s: number; p: number; type: string };
  mission: number | null;
  fleets: number;
};

const { t } = useI18n();
const route = useRoute();
/** set when opened inside a universe (sidebar stays, its alliance is preselected) */
const uni = route.params.uni ? String(route.params.uni) : null;
const isAdmin = computed(() => !!session.me?.user?.isAdmin);
const me = computed(() => session.me?.user?.id);
const mobile = useMobile();
const error = ref('');
const msg = ref('');

// ---------------------------------------------------------------- universes
const universes = ref<any[]>([]);
const newUni = ref({ slug: '', name: '', startsAt: '' });
const createOpen = ref(false);
type DeckCard = { type: string; size: string; count: number };
/** `startsAt`/`endedAt`: browser-local "YYYY-MM-DDTHH:mm" of the scheduled start and end, '' = none */
const editUni = ref<{ slug: string; name: string; isDefault: boolean; startsAt: string; endedAt: string; settings: Record<string, any>; deck: DeckCard[] } | null>(null);
const editOpen = computed({ get: () => !!editUni.value, set: (v) => { if (!v) editUni.value = null; } });
/** the real time: inside an ended universe the hub's clock stands still at its end */
const realNow = () => Math.floor(Date.now() / 1000);
const isEnded = (u: { endedAt?: number | null }) => u.endedAt != null && u.endedAt <= realNow();
const isScheduled = (u: { startsAt?: number | null }) => u.startsAt != null && u.startsAt > realNow();
const localOf = (epoch: number | null | undefined) => (epoch != null ? toLocalInput(epoch).slice(0, 16) : '');
const epochOf = (local: string) => (local ? fromLocalInput(local) : null);
const deckTotal = computed(() => editUni.value?.deck.reduce((sum, c) => sum + (Number(c.count) || 0), 0) ?? 0);

/** One row of the universe settings: `key` in `settings`, label `admin.<label>`, tooltip `admin.<label>Hint` with `hint`. */
type UniField = { key: string; label: string; hint?: boolean; type?: 'number' | 'text' | 'check'; min?: number; max?: number; step?: number | 'any'; placeholder?: string };
type UniGroup = { id: string; hint?: string; fields: UniField[] };
/** The settings dialog groups them like the game configuration; `general` also holds name and default flag, `deck` the deck table. */
const UNI_GROUPS: UniGroup[] = [
  { id: 'general', fields: [
    { key: 'gameUrl', label: 'gameUrl', hint: true, type: 'text' },
    { key: 'pr0planUrl', label: 'pr0planUrl', hint: true, type: 'text', placeholder: 'https://pr0sync.pages.dev/' },
    { key: 'timezone', label: 'timezone', hint: true, type: 'text', placeholder: 'Europe/Berlin' },
    { key: 'inactiveDays', label: 'inactiveDays', hint: true, min: 0, step: 'any', placeholder: '7' },
  ] },
  { id: 'schedule', fields: [] },
  { id: 'size', hint: 'admin.distanceHint', fields: [
    { key: 'galaxies', label: 'galaxies', min: 1 },
    { key: 'systems', label: 'systems', min: 1 },
    { key: 'positions', label: 'positions', hint: true, min: 1 },
    { key: 'circularGalaxies', label: 'circularGalaxies', hint: true, type: 'check' },
    { key: 'circularSystems', label: 'circularSystems', hint: true, type: 'check' },
    { key: 'galaxyDistanceFactor', label: 'galaxyFactor', hint: true, min: 0 },
    { key: 'systemDistanceFactor', label: 'systemFactor', hint: true, min: 0 },
    { key: 'systemDistance', label: 'systemBase', hint: true, min: 0 },
    { key: 'planetDistanceFactor', label: 'planetFactor', hint: true, min: 0 },
    { key: 'planetDistance', label: 'planetBase', hint: true, min: 0 },
  ] },
  { id: 'speed', fields: [
    { key: 'fleetSpeed', label: 'fleetSpeed', hint: true, min: 1 },
    { key: 'buildingSpeed', label: 'buildingSpeed', hint: true, min: 0 },
    { key: 'researchSpeed', label: 'researchSpeed', hint: true, min: 0 },
    { key: 'shipyardSpeed', label: 'shipyardSpeed', hint: true, min: 0 },
  ] },
  { id: 'economy', fields: [
    { key: 'resourceMultiplier', label: 'resourceMultiplier', hint: true, min: 0 },
    { key: 'storageMultiplier', label: 'storageMultiplier', hint: true, min: 1, step: 1, placeholder: '1' },
    { key: 'universityFactor', label: 'universityFactor', hint: true, min: 0, max: 100 },
  ] },
  { id: 'combat', fields: [
    { key: 'fleetDebrisPercent', label: 'fleetDebrisPercent', hint: true, min: 0, max: 100, placeholder: '40' },
    { key: 'defenseDebrisPercent', label: 'defenseDebrisPercent', hint: true, min: 0, max: 100, placeholder: '0' },
    { key: 'bigShields', label: 'bigShields', hint: true, type: 'check' },
    { key: 'missileRangeFactor', label: 'missileRangeFactor', hint: true, min: 0, step: 'any', placeholder: '1' },
    { key: 'phalanxRangeFactor', label: 'phalanxRangeFactor', hint: true, min: 0, step: 'any', placeholder: '1' },
    { key: 'debrisCleanupDay', label: 'debrisCleanupDay', hint: true, min: 0, max: 6, placeholder: '6' },
    { key: 'debrisCleanupHour', label: 'debrisCleanupHour', hint: true, min: 0, max: 23, placeholder: '2' },
    { key: 'debrisCleanupMinute', label: 'debrisCleanupMinute', hint: true, min: 0, max: 59, placeholder: '45' },
  ] },
  { id: 'noob', fields: [
    { key: 'noobLimit', label: 'noobLimit', hint: true, min: 0, placeholder: '0' },
    { key: 'noobFactor', label: 'noobFactor', hint: true, min: 0, step: 'any', placeholder: '5' },
    { key: 'noobInactives', label: 'noobInactives', hint: true, type: 'check' },
  ] },
  { id: 'colonize', hint: 'admin.colonizeHint', fields: [
    { key: 'planetSizeFactor', label: 'planetSizeFactor', hint: true, min: 0, step: 'any', placeholder: '1' },
  ] },
  { id: 'deck', hint: 'admin.deckHint', fields: [] },
  { id: 'units', hint: 'admin.unitsHint', fields: [] },
];
/** the unit editor of the open universe (saved together with the settings) */
const unitEditor = ref<InstanceType<typeof UnitEditor> | null>(null);

/** Speed values of the game configuration: 2500 = 1x; 0 or empty = unknown. */
const speed = (v: unknown) => (Number(v) > 0 ? `×${+(Number(v) / 2500).toFixed(2)}` : '–');
const orDefault = (v: unknown, def: string | number) => (v === '' || v == null ? def : v);
/** Short state of a group, shown in its header so a closed group still tells what is set. */
function groupSummary(id: string): string {
  const s = editUni.value?.settings ?? {};
  switch (id) {
    case 'general': {
      let host = '';
      try { host = s.gameUrl ? new URL(s.gameUrl).host + new URL(s.gameUrl).pathname.replace(/\/$/, '') : ''; } catch { host = s.gameUrl; }
      return [host, s.timezone].filter(Boolean).join(' · ');
    }
    case 'schedule': {
      if (editedUni.value && isEnded(editedUni.value)) return t('admin.endedBadge');
      const [from, to] = [editUni.value?.startsAt, editUni.value?.endedAt].map((v) => (v ? dateTime(epochOf(v)!) : '…'));
      return from === '…' && to === '…' ? '–' : `${from} – ${to}`;
    }
    case 'size': return `${s.galaxies ?? '?'} × ${s.systems ?? '?'} × ${s.positions ?? '?'}`;
    case 'speed': return [s.fleetSpeed, s.buildingSpeed, s.researchSpeed, s.shipyardSpeed].map(speed).join(' / ');
    case 'economy': return `${speed(s.resourceMultiplier)} · ${orDefault(s.universityFactor, 8)} %`;
    case 'combat': return `${orDefault(s.fleetDebrisPercent, 40)} % / ${orDefault(s.defenseDebrisPercent, 0)} %`;
    case 'noob': return Number(s.noobLimit) > 0 ? fmt(Number(s.noobLimit)) : '–';
    case 'colonize': {
      const n = bonusRows.value.filter((r) => r.some((x) => Number(x))).length;
      return n ? t('admin.bonusSummary', { n }) : '–';
    }
    case 'deck': return String(deckTotal.value);
    case 'units': return unitEditor.value?.changedCount ? t('admin.units.summary', { n: unitEditor.value.changedCount }) : '–';
  }
  return '';
}

// ------------------------------------------------------------------- groups
const groups = ref<any[]>([]);
const newGroup = ref({ universe: '', name: '', tag: '' });
const groupId = ref<number | null>(null);
const members = ref<any[]>([]);
const ingests = ref<any[]>([]);
/** Parser samples members sent (E-4, hub admins). */
interface Sample { id: number; group_name: string; universe: string; username: string | null; code: string; page: string | null; note: string | null; created_at: number }
const samples = ref<Sample[]>([]);
const BASE_URL = import.meta.env.BASE_URL;
const loadSamples = async () => {
  if (isAdmin.value) samples.value = await api<Sample[]>('/admin/parser-samples');
};
async function deleteSample(id: number) {
  await api(`/admin/parser-samples/${id}`, { method: 'DELETE' });
  await loadSamples();
}
const fleetAttacks = ref<FleetAttackRow[]>([]);
const newMemberName = ref('');
/** existing accounts (e.g. from the alliance in another universe) that can join this alliance */
type Candidate = { id: number; username: string; account: boolean; ingameName: string | null; groups: string[] };
const candidates = ref<Candidate[]>([]);
const assignUserId = ref<number | null>(null);
const assignIngame = ref('');
watch(assignUserId, (id) => (assignIngame.value = candidates.value.find((c) => c.id === id)?.ingameName ?? ''));
const candidateLabel = (c: Candidate) =>
  [c.username, c.ingameName && c.ingameName !== c.username ? c.ingameName : '', c.account ? '' : t('admin.noAccount'), c.groups.join(', ')]
    .filter(Boolean)
    .join(' · ');
const merge = ref({ from: null as number | null, into: null as number | null });
const group = computed(() => groups.value.find((g) => g.id === groupId.value));
const groupName = ref('');
const groupTag = ref('');
watch(group, (g) => { groupName.value = g?.name ?? ''; groupTag.value = g?.tag ?? ''; }, { immediate: true });

/** The alliance's Discord channel (server: discord.ts): only the webhook's start comes back. */
interface ChannelPrefs {
  attacks: boolean;
  plans: boolean;
  launch: boolean;
  leadMinutes: number;
  lang: 'de' | 'en';
}
const CHANNEL_KINDS = ['attacks', 'plans', 'launch'] as const;
const LEAD_MINUTES = [1, 2, 5, 10, 15, 30];
const discord = ref<{ webhook: string | null; prefs: ChannelPrefs } | null>(null);
const discordWebhook = ref('');

/** `ok`: message key shown on success */
async function run(fn: () => Promise<unknown>, ok = '') {
  error.value = msg.value = '';
  try {
    await fn();
    msg.value = ok && t(ok);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function loadAll() {
  universes.value = await api('/universes');
  groups.value = await api('/admin/groups');
  if (!groupId.value && groups.value.length) {
    const own = uni && selectedGroup(uni);
    groupId.value = groups.value.some((g) => g.id === own) ? own : groups.value[0].id;
  }
}

/** only the answer for the newest group selection is applied (switching alliances quickly, like `useLoader`) */
let groupLoad = 0;
async function loadGroup() {
  if (!groupId.value) return;
  const id = ++groupLoad;
  const res = await Promise.all([
    api(`/admin/groups/${groupId.value}/members`),
    // sync history is technical administration: global admins only
    isAdmin.value ? api(`/admin/groups/${groupId.value}/ingests`) : [],
    api(`/admin/groups/${groupId.value}/discord`),
    isAdmin.value ? api<FleetAttackRow[]>(`/admin/groups/${groupId.value}/fleet-attacks`) : [],
    api<Candidate[]>(`/admin/groups/${groupId.value}/candidates`),
  ]);
  if (id !== groupLoad) return;
  [members.value, ingests.value, discord.value, fleetAttacks.value, candidates.value] = res;
  if (!candidates.value.some((c) => c.id === assignUserId.value)) assignUserId.value = null;
  discordWebhook.value = '';
  undo.value = null;
}

onMounted(() =>
  run(async () => {
    await loadAll();
    await loadAccess();
    // /admin?uni=u8 opens the universe settings directly (link from the start page)
    const u = universes.value.find((x) => x.slug === route.query.uni);
    if (u) startEdit(u);
  }),
);
watch(groupId, () => run(loadGroup));
// hub admins see the universes, alliance admins their alliances
useAutoTour('admin', () => universes.value.length > 0 || groups.value.length > 0);

/** a new universe opens in the settings right away: URL, size and speeds usually need adjusting */
const createUni = () =>
  run(async () => {
    const { startsAt, ...rest } = newUni.value;
    await api('/admin/universes', { body: { ...rest, startsAt: epochOf(startsAt) } });
    const slug = rest.slug;
    newUni.value = { slug: '', name: '', startsAt: '' };
    createOpen.value = false;
    await loadAll();
    const u = universes.value.find((x) => x.slug === slug);
    if (u) startEdit(u);
  }, 'admin.universeCreated');

function startEdit(u: any) {
  error.value = msg.value = '';
  editUni.value = { slug: u.slug, name: u.name, isDefault: !!u.isDefault, startsAt: localOf(u.startsAt), endedAt: localOf(u.endedAt), settings: { ...u.settings }, deck: u.deck.map((c: DeckCard) => ({ ...c })) };
  // position bonuses as one row per position (colonization planner)
  const stored = (u.settings.positionBonus ?? {}) as Record<string, number[]>;
  bonusRows.value = Array.from({ length: Number(u.settings.positions) || 15 }, (_, i) => [...(stored[String(i + 1)] ?? [0, 0, 0])]);
}

/** Production bonus per position (metal, crystal, deuterium in %) of the universe being edited. */
const bonusRows = ref<number[][]>([]);
const saveUni = () =>
  run(async () => {
    const e = editUni.value!;
    // a cleared optional number field (v-model.number leaves '') is removed and falls back to its default
    const bonus = Object.fromEntries(bonusRows.value.map((r, i) => [String(i + 1), r.map((x) => Number(x) || 0)]).filter(([, r]) => (r as number[]).some((x) => x !== 0)));
    const settings = {
      ...Object.fromEntries(Object.entries(e.settings).map(([k, v]) => [k, v === '' ? null : v])),
      gameUrl: String(e.settings.gameUrl ?? '').trim(), pr0planUrl: String(e.settings.pr0planUrl ?? '').trim(),
      positionBonus: Object.keys(bonus).length ? bonus : null,
    };
    await api(`/admin/universes/${e.slug}`, { method: 'PUT', body: { name: e.name, settings, deck: e.deck, isDefault: e.isDefault, startsAt: epochOf(e.startsAt), endedAt: epochOf(e.endedAt) } });
    if (unitEditor.value?.dirty) await unitEditor.value.save();
    editUni.value = null;
    await loadAll();
    await loadMe();
  }, 'deck.saved');

/** The stored universe being edited. */
const editedUni = computed(() => universes.value.find((x: { slug: string }) => x.slug === editUni.value?.slug));

/** Ends the universe now (frozen, read-only) or lets an ended one run again (without an end). */
function toggleEnded(u: { slug: string; name: string; endedAt?: number | null }) {
  const ended = !isEnded(u);
  if (!confirm(t(ended ? 'admin.endUniverseConfirm' : 'admin.reopenUniverseConfirm', { name: u.name }))) return;
  return run(async () => {
    await api(`/admin/universes/${u.slug}`, { method: 'PUT', body: { ended } });
    editUni.value = null;
    await loadAll();
    await loadMe();
  }, ended ? 'admin.universeEnded' : 'admin.universeReopened');
}

/** Drops the custom deck so the universe falls back to the game's default deck. */
const resetDeck = () =>
  run(async () => {
    const slug = editUni.value!.slug;
    await api(`/admin/universes/${slug}`, { method: 'PUT', body: { deck: null } });
    await loadAll();
    editUni.value!.deck = universes.value.find((x) => x.slug === slug).deck.map((c: DeckCard) => ({ ...c }));
  }, 'admin.deckRestored');

const createGroup = () =>
  run(async () => {
    const res = await api('/admin/groups', { body: newGroup.value });
    newGroup.value.name = '';
    newGroup.value.tag = '';
    await loadAll();
    await loadMe();
    groupId.value = res.id;
  }, 'admin.groupCreated');

const renameGroup = () =>
  run(async () => {
    await api(`/admin/groups/${groupId.value}`, { method: 'PUT', body: { name: groupName.value, tag: groupTag.value } });
    await loadAll();
    await loadMe();
  }, 'admin.groupRenamed');

const saveDiscord = (body: Record<string, unknown>, ok: string) =>
  run(async () => {
    discord.value = await api(`/admin/groups/${groupId.value}/discord`, { method: 'PUT', body });
    discordWebhook.value = '';
  }, ok);
const sendTestDiscord = () => run(() => api(`/admin/groups/${groupId.value}/discord/test`, { method: 'POST' }), 'account.discordTestSent');

const memberSort = useSort(
  members,
  (m: any, k) => ({ user: m.username.toLowerCase(), role: m.role, ingame: m.ingame_name?.toLowerCase(), joined: m.joined_at, login: m.last_login_at, onboarding: m.onboarding?.length ?? 0 })[k],
  'user',
  false,
);

/** Onboarding steps (D-4): done ones per member, the open ones in the tooltip. */
const ONBOARDING = ['empire', 'stats', 'overview', 'research', 'galaxy', 'messages', 'buildings'];
const onboardingTitle = (m: { onboarding?: string[] }) => {
  const open = ONBOARDING.filter((k) => !m.onboarding?.includes(k));
  return open.length ? t('onboarding.open', { steps: open.map((k) => t(`onboarding.steps.${k}`)).join(', ') }) : t('onboarding.finished');
};
const inviteUrl = (token: string) => `${location.origin}${import.meta.env.BASE_URL}invite/${token}`;
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => (msg.value = t('admin.linkCopied')));

const bodyCoords = (b: FleetAttackRow['from']) => `${coords(b.g, b.s, b.p)}${b.type === 'moon' ? ` (${t('common.moon')})` : ''}`;
const missionLabel = (id: number | null) => (id != null ? t(`game.missions.${id}`) : '–');
const ownerLabel = (o: string) => (o === 'own' ? t('admin.fleetOwnerOwn') : o === 'hostile' ? t('imperium.hostile') : t('imperium.foreign'));
const removeFleetAttack = (a: FleetAttackRow) => {
  if (!confirm(t('admin.fleetAttackRemoveConfirm', { member: a.member, route: `${bodyCoords(a.from)} → ${bodyCoords(a.to)}` }))) return;
  run(async () => {
    await api(`/admin/groups/${groupId.value}/fleet-attacks/remove`, { body: { userId: a.userId, key: a.key, arrival: a.arrival } });
    fleetAttacks.value = await api(`/admin/groups/${groupId.value}/fleet-attacks`);
  }, 'admin.fleetAttackRemoved');
};

const setRole = (m: any, role: string) => run(async () => {
  await api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'PUT', body: { role } });
  await loadGroup();
});
const setIngame = (m: any) => run(() => api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'PUT', body: { ingameName: m.ingame_name } }), 'deck.saved');
const renameUser = (m: any) => run(async () => {
  try {
    await api(`/admin/users/${m.id}`, { method: 'PUT', body: { username: m.username } });
  } finally {
    await loadGroup();
  }
  if (m.id === session.me?.user?.id) await loadMe();
}, 'account.usernameChanged');
const addMember = () =>
  run(async () => {
    const res = await api<{ id: number; token: string }>(`/admin/groups/${groupId.value}/members`, { body: { name: newMemberName.value } });
    freshInvites.value = { ...freshInvites.value, [res.id]: res.token };
    newMemberName.value = '';
    await loadGroup();
  }, 'deck.saved');

const assignMember = () =>
  run(async () => {
    await api(`/admin/groups/${groupId.value}/members`, { body: { userId: assignUserId.value, ingameName: assignIngame.value.trim() || null } });
    assignUserId.value = null;
    assignIngame.value = '';
    await loadGroup();
  }, 'deck.saved');

/** Links created in this session by member id: the server keeps only their hash, so it shows them only once. */
const freshInvites = ref<Record<number, string>>({});
const memberInvite = (m: any) =>
  run(async () => {
    const res = await api<{ token: string }>(`/admin/groups/${groupId.value}/members/${m.id}/invite`, { body: {} });
    freshInvites.value = { ...freshInvites.value, [m.id]: res.token };
    copy(inviteUrl(res.token));
    await loadGroup();
  });

const removeMember = (m: any) => {
  // a placeholder that is still in other alliances (other universes) keeps its account and data there
  const key = m.account || m.other_groups ? 'admin.removeConfirm' : 'admin.removePlaceholderConfirm';
  const name = m.ingame_name || m.username;
  if (!confirm(t(key, { name }))) return;
  run(async () => {
    await api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'DELETE' });
    await loadGroup();
  });
};
/** access requests from the login page (global admins) and the players without an account to assign them to */
type AccessRequests = {
  requests: { id: number; username: string; message: string; created_at: number }[];
  placeholders: { id: number; name: string; group: string; universe: string }[];
};
const access = ref<AccessRequests>({ requests: [], placeholders: [] });
const accessTarget = ref<Record<number, number | ''>>({});
/** alliance admins assign requests to players of their alliances; rejecting is up to global admins */
const loadAccess = async () => {
  if (isAdmin.value || groups.value.length) access.value = await api('/admin/access-requests');
};
const assignRequest = (r: AccessRequests['requests'][number]) =>
  run(async () => {
    await api(`/admin/access-requests/${r.id}/assign`, { body: { userId: accessTarget.value[r.id] } });
    await Promise.all([loadAccess(), loadGroup()]);
    msg.value = t('admin.accessAssigned', { name: r.username });
  });
const rejectRequest = (r: AccessRequests['requests'][number]) => {
  if (!confirm(t('admin.accessRejectConfirm', { name: r.username }))) return;
  run(async () => {
    await api(`/admin/access-requests/${r.id}`, { method: 'DELETE' });
    await loadAccess();
  });
};
const reparse = (id: number) => run(async () => {
  const res = await api(`/admin/ingests/${id}/reparse`, { body: {} });
  msg.value = 'Reparse: ' + JSON.stringify(res.counts);
});
/** battle report crawler status (global admins) */
const crawler = ref<any>(null);
const loadCrawler = async () => {
  if (isAdmin.value) crawler.value = await api('/admin/crawler');
};
onMounted(() => run(loadCrawler));
onMounted(() => run(loadSamples));
const retryCrawler = () =>
  run(async () => {
    const res = await api('/admin/crawler/retry', { body: {} });
    await loadCrawler();
    msg.value = t('admin.crawlerRetried', { n: res.reset });
  });
const backfill = () =>
  run(async () => {
    const res = await api(`/admin/groups/${groupId.value}/activity/backfill`, { body: {} });
    msg.value = t('admin.backfillDone', { n: res.added });
  });
/** content of a sync per record kind: "Statistik Spieler · Punkte (100): A, B, C" */
type About = { kind: string; count: number; sample: string[]; who?: string; type?: number | null };
const aboutText = (a: About) => {
  const kind = a.kind === 'stats'
    ? [t(`admin.about.stats_${a.who}`), a.type ? STATS_CATEGORIES[a.type] : null].filter(Boolean).join(' · ')
    : t(`admin.about.${a.kind}`);
  const more = a.count > 1 && a.kind !== 'stats' ? ` (${a.count})` : '';
  return `${kind}${more}${a.sample.length ? ': ' + a.sample.join(', ') : ''}`;
};

const contentOf = (i: any): string[] => {
  const about: About[] = i.summary?.about ?? [];
  const text = about.length ? about.map(aboutText) : [i.page_type];
  return i.source === 'upload' ? ['universe.json', ...text] : text;
};
const ingestSort = useSort(
  ingests,
  (i: any, k) => ({ time: i.created_at, user: i.username?.toLowerCase(), content: contentOf(i)[0].toLowerCase() })[k],
  'time',
);
const ingestSorts = ['time', 'user', 'content'] as const;
const ingestLabel = (k: string) => t(k === 'time' ? 'common.time' : k === 'user' ? 'nav.user' : 'admin.content');

/** dry run of taking a sync back, shown under its row until confirmed */
type Undo = {
  id: number; snapshots: number; scores: number; activity: number; players: string[]; alliances: string[]; kept: string[];
  empires: number; overviews: number; fleets: number; spyReports: number; skipped: string[];
};
const undo = ref<Undo | null>(null);
const previewUndo = (id: number) =>
  run(async () => {
    undo.value = { ...(await api<Omit<Undo, 'id'>>(`/admin/ingests/${id}/delete`, { body: { dryRun: true } })), id };
  });
const runUndo = () =>
  run(async () => {
    await api(`/admin/ingests/${undo.value!.id}/delete`, { body: {} });
    await loadGroup();
  }, 'admin.undoDone');
const doMerge = () => run(async () => {
  await api(`/admin/groups/${groupId.value}/players/merge`, { body: merge.value });
  merge.value = { from: null, into: null };
}, 'admin.merged');
</script>

<template>
  <div class="admin" :class="{ main: !uni }" style="max-width: 1100px" :style="{ margin: uni ? undefined : '0 auto' }">
    <BackLink v-if="!uni" to="/" :label="t('common.back')" />
    <h1>
      {{ t('admin.title') }}
      <button type="button" class="tour-btn" :title="t('tours.start')" :aria-label="t('tours.start')" @click="startTour('admin')">?</button>
    </h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <template v-if="isAdmin">
      <Section data-tour="admin-universes" :title="t('nav.universes')" :count="universes.length" store-key="admin.universes">
        <div class="scroll-x">
        <table v-stack class="data">
          <tr><th>{{ t('admin.slug') }}</th><th>{{ t('common.name') }}</th><th>{{ t('admin.gameUrl') }}</th><th>{{ t('admin.size') }}</th><th>{{ t('admin.timezone') }}</th><th /></tr>
          <tr v-for="u in universes" :key="u.slug">
            <td class="mono">{{ u.slug }}</td>
            <td>{{ u.name }}<span v-if="u.isDefault" class="badge" style="margin-left: 6px">{{ t('admin.defaultBadge') }}</span><span v-if="isEnded(u)" class="badge" style="margin-left: 6px" :title="t('admin.endedAt', { time: dateTime(u.endedAt) })">{{ t('admin.endedBadge') }}</span><span v-else-if="isScheduled(u)" class="badge" style="margin-left: 6px" :title="t('admin.startsAt', { time: dateTime(u.startsAt) })">{{ t('admin.scheduledBadge') }}</span><span v-if="!isEnded(u) && u.endedAt != null" class="muted small" style="margin-left: 6px">{{ t('admin.endsAt', { time: dateTime(u.endedAt) }) }}</span></td>
            <td class="small">{{ u.settings.gameUrl || '–' }}</td>
            <td class="small">{{ u.settings.galaxies }} × {{ u.settings.systems }} × {{ u.settings.positions }}</td>
            <td class="small">{{ u.settings.timezone }}</td>
            <td><button @click="startEdit(u)">{{ t('admin.edit') }}</button></td>
          </tr>
        </table>
        </div>
        <div class="row" style="margin-top: 10px">
          <button class="primary" @click="error = msg = ''; createOpen = true">+ {{ t('admin.createUniverse') }}</button>
        </div>
      </Section>

      <Sheet v-model="createOpen" :title="t('admin.createUniverse')">
        <form id="uni-create" class="uni-create" @submit.prevent="createUni">
          <div v-if="error" class="error">{{ error }}</div>
          <label>{{ t('admin.slug') }} <input v-model="newUni.slug" :placeholder="t('admin.slugPlaceholder')" autocomplete="off" /></label>
          <label>{{ t('common.name') }} <input v-model="newUni.name" :placeholder="newUni.slug || t('common.name')" /></label>
          <label><span>{{ t('admin.startTime') }} <Hint>{{ t('admin.startTimeHint') }}</Hint></span> <DateTimeInput v-model="newUni.startsAt" /></label>
          <p class="muted small">{{ t('admin.createUniverseHint') }}</p>
        </form>
        <template #footer>
          <button type="button" @click="createOpen = false">{{ t('common.cancel') }}</button>
          <button type="submit" form="uni-create" class="primary" :disabled="!newUni.slug.trim()">{{ t('common.create') }}</button>
        </template>
      </Sheet>

      <Sheet v-if="editUni" v-model="editOpen" :title="t('admin.editTitle', { slug: editUni.slug })">
        <div v-if="error" class="error">{{ error }}</div>
        <Section
          v-for="g in UNI_GROUPS"
          :key="g.id"
          :title="t(`admin.uniGroups.${g.id}`)"
          :default-open="g.id === 'general'"
          :store-key="`admin.uniCfg.${g.id}`"
          class="uni-group"
        >
          <template v-if="g.hint" #hint><Hint>{{ t(g.hint) }}</Hint></template>
          <template #actions><span class="muted small mono uni-summary">{{ groupSummary(g.id) }}</span></template>
          <UnitEditor v-if="g.id === 'units'" :ref="(el) => (unitEditor = el as InstanceType<typeof UnitEditor> | null)" :slug="editUni.slug" />
          <template v-else-if="g.id === 'deck'">
            <table class="data uni-deck">
              <thead><tr><th>{{ t('expeditions.event') }}</th><th>{{ t('admin.cardSize') }}</th><th class="num">{{ t('admin.count') }}</th></tr></thead>
              <tbody>
                <tr v-for="(c, i) in editUni.deck" :key="i">
                  <td>{{ c.type }}</td>
                  <td>{{ c.size }}</td>
                  <td class="num"><input v-model.number="c.count" type="number" min="0" /></td>
                </tr>
              </tbody>
              <tfoot><tr><th colspan="2">{{ t('common.total') }}</th><th class="num">{{ deckTotal }}</th></tr></tfoot>
            </table>
            <button style="margin-top: 8px" @click="resetDeck">{{ t('admin.restoreDeck') }}</button>
          </template>
          <table v-else class="uni-config">
            <template v-if="g.id === 'general'">
              <tr class="text-row">
                <th><label for="uni-name">{{ t('common.name') }}</label></th>
                <td><input id="uni-name" v-model="editUni.name" class="wide" /></td>
              </tr>
              <tr>
                <th><label for="uni-isDefault">{{ t('admin.defaultUniverse') }}</label> <Hint>{{ t('admin.defaultUniverseHint') }}</Hint></th>
                <td><input id="uni-isDefault" v-model="editUni.isDefault" type="checkbox" /></td>
              </tr>
            </template>
            <template v-if="g.id === 'schedule'">
              <tr>
                <th><label>{{ t('admin.startTime') }}</label> <Hint>{{ t('admin.startTimeHint') }}</Hint></th>
                <td><DateTimeInput v-model="editUni.startsAt" /></td>
              </tr>
              <tr>
                <th><label>{{ t('admin.endTime') }}</label> <Hint>{{ t('admin.endTimeHint') }}</Hint></th>
                <td><DateTimeInput v-model="editUni.endedAt" /></td>
              </tr>
              <tr v-if="editedUni">
                <th><label>{{ isEnded(editedUni) ? t('admin.endedBadge') : t('admin.endUniverse') }}</label> <Hint>{{ t('admin.endUniverseHint') }}</Hint></th>
                <td>
                  <button :class="{ danger: !isEnded(editedUni) }" @click="toggleEnded(editedUni)">{{ t(!isEnded(editedUni) ? 'admin.endUniverse' : 'admin.reopenUniverse') }}</button>
                </td>
              </tr>
            </template>
            <template v-if="g.id === 'colonize'">
              <tr>
                <th>{{ t('admin.positionBonus') }} <Hint>{{ t('admin.positionBonusHint') }}</Hint></th>
                <td>
                  <table class="data uni-bonus">
                    <thead><tr><th>{{ t('colonize.position') }}</th><th>{{ t('colonize.res.901') }}</th><th>{{ t('colonize.res.902') }}</th><th>{{ t('colonize.res.903') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, i) in bonusRows" :key="i">
                        <td class="num">{{ i + 1 }}</td>
                        <td v-for="j in 3" :key="j"><input v-model.number="r[j - 1]" type="number" min="-100" max="1000" step="any" :aria-label="`${i + 1} ${t(`colonize.res.${900 + j}`)}`" /></td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
            <tr v-for="f in g.fields" :key="f.key" :class="{ 'text-row': f.type === 'text' }">
              <th><label :for="`uni-${f.key}`">{{ t(`admin.${f.label}`) }}</label> <Hint v-if="f.hint">{{ t(`admin.${f.label}Hint`) }}</Hint></th>
              <td>
                <input v-if="f.type === 'check'" :id="`uni-${f.key}`" v-model="editUni.settings[f.key]" type="checkbox" />
                <input
                  v-else-if="f.type === 'text'"
                  :id="`uni-${f.key}`"
                  v-model="editUni.settings[f.key]"
                  class="wide"
                  :placeholder="f.key === 'gameUrl' ? `https://pr0game.com/uni${editUni.slug.replace(/\D/g, '')}/` : f.placeholder"
                />
                <input
                  v-else
                  :id="`uni-${f.key}`"
                  v-model.number="editUni.settings[f.key]"
                  type="number"
                  :min="f.min"
                  :max="f.max"
                  :step="f.step"
                  :placeholder="f.placeholder"
                />
              </td>
            </tr>
          </table>
        </Section>
        <template #footer>
          <button @click="editUni = null">{{ t('common.cancel') }}</button>
          <button class="primary" @click="saveUni">{{ t('common.save') }}</button>
        </template>
      </Sheet>
    </template>

    <Section v-if="isAdmin || groups.length" data-tour="admin-access" :title="t('admin.accessRequests')" :count="access.requests.length" store-key="admin.access">
      <template #hint><Hint>{{ t('admin.accessRequestsHint') }}</Hint></template>
      <p v-if="!access.requests.length" class="muted small">{{ t('admin.accessRequestsNone') }}</p>
      <div v-for="r in access.requests" :key="r.id" class="access-request">
        <div>
          <b>{{ r.username }}</b> <span class="muted small">{{ dateTime(r.created_at) }}</span>
          <div v-if="r.message" class="small access-message">{{ r.message }}</div>
        </div>
        <div class="row">
          <select v-model="accessTarget[r.id]">
            <option value="" disabled>{{ t('admin.accessAssign') }}</option>
            <option v-for="p in access.placeholders" :key="p.id" :value="p.id">{{ p.universe }} · {{ p.group }} · {{ p.name }}</option>
          </select>
          <button class="primary" :disabled="!accessTarget[r.id]" @click="assignRequest(r)">{{ t('admin.accessAssignButton') }}</button>
          <button v-if="isAdmin" class="danger" @click="rejectRequest(r)">{{ t('admin.accessReject') }}</button>
        </div>
      </div>
    </Section>

    <Section data-tour="admin-groups" :title="t('stats.alliances')" :count="groups.length" store-key="admin.groups">
      <div class="row">
        <select v-model="groupId">
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.universe }} · {{ g.name }} ({{ g.members }})</option>
        </select>
        <form v-if="group" class="row" @submit.prevent="renameGroup">
          <input v-model="groupName" :placeholder="t('admin.groupName')" />
          <input v-model="groupTag" class="tag-input" maxlength="10" :placeholder="t('admin.groupTag')" :title="t('admin.groupTagHint')" />
          <button :disabled="!groupName.trim() || (groupName.trim() === group.name && groupTag.trim() === (group.tag ?? ''))">{{ t('common.save') }}</button>
        </form>
      </div>
      <form v-if="isAdmin" class="row" style="margin-top: 10px" @submit.prevent="createGroup">
        <select v-model="newGroup.universe">
          <option value="" disabled>{{ t('admin.universe') }}</option>
          <option v-for="u in universes" :key="u.slug" :value="u.slug">{{ u.slug }}</option>
        </select>
        <input v-model="newGroup.name" :placeholder="t('admin.groupName')" />
        <input v-model="newGroup.tag" class="tag-input" maxlength="10" :placeholder="t('admin.groupTag')" :title="t('admin.groupTagHint')" />
        <button class="primary">{{ t('admin.createGroup') }}</button>
      </form>
    </Section>

    <template v-if="group">
      <Section v-if="discord" data-tour="admin-discord" :title="t('admin.discord')" :default-open="false" store-key="admin.discord" class="discord">
        <template #hint><Hint>{{ t('admin.discordHint') }}</Hint></template>
        <p v-if="discord.webhook" class="muted small">{{ t('account.discordWebhookSet', { hint: discord.webhook }) }}</p>
        <form class="row" @submit.prevent="saveDiscord({ webhook: discordWebhook.trim() }, 'account.discordSaved')">
          <input v-model="discordWebhook" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" style="flex: 1; min-width: 200px" />
          <button type="submit" class="primary" :disabled="!discordWebhook.trim()">{{ t('common.save') }}</button>
          <Hint>{{ t('account.discordWebhookHint') }}</Hint>
        </form>
        <template v-if="discord.webhook">
          <div class="row" style="margin-top: 6px">
            <button type="button" @click="sendTestDiscord">{{ t('account.pushTest') }}</button>
            <button type="button" class="danger" @click="saveDiscord({ webhook: null }, 'account.discordRemoved')">{{ t('account.discordRemove') }}</button>
          </div>
          <label v-for="k in CHANNEL_KINDS" :key="k" class="check">
            <input v-model="discord.prefs[k]" type="checkbox" @change="saveDiscord({ prefs: discord.prefs }, 'account.pushSaved')" /> {{ t(`admin.discordKind.${k}`) }}
          </label>
          <div class="row">
            <label :class="{ off: !discord.prefs.launch }">
              {{ t('account.pushLead') }}
              <select v-model.number="discord.prefs.leadMinutes" :disabled="!discord.prefs.launch" @change="saveDiscord({ prefs: discord.prefs }, 'account.pushSaved')">
                <option v-for="m in LEAD_MINUTES" :key="m" :value="m">{{ t('account.pushLeadMinutes', { n: m }) }}</option>
              </select>
            </label>
            <label>
              {{ t('admin.discordLang') }}
              <select v-model="discord.prefs.lang" @change="saveDiscord({ prefs: discord.prefs }, 'account.pushSaved')">
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </template>
        <p class="muted small">{{ t('admin.discordMentions') }}</p>
      </Section>
      <Section v-if="isAdmin" data-tour="admin-fleet-attacks" :title="t('admin.fleetAttacks')" :count="fleetAttacks.length" :default-open="false" store-key="admin.fleetAttacks">
        <template #hint><Hint>{{ t('admin.fleetAttacksHint') }}</Hint></template>
        <p v-if="!fleetAttacks.length" class="muted small">{{ t('admin.fleetAttacksNone') }}</p>
        <div v-else class="table-wrap">
          <table v-stack="2" class="data">
            <thead>
              <tr>
                <th>{{ t('nav.user') }}</th>
                <th>{{ t('admin.fleetOwnerCol') }}</th>
                <th>{{ t('imperium.mission') }}</th>
                <th>{{ t('admin.fleetRoute') }}</th>
                <th>{{ t('imperium.arrival') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in fleetAttacks" :key="`${a.userId}:${a.key}:${a.arrival}`">
                <td>{{ a.member }}</td>
                <td class="small">{{ ownerLabel(a.owner) }}</td>
                <td class="small">{{ missionLabel(a.mission) }}<span v-if="a.fleets > 1" class="muted"> · ACS {{ a.fleets }}</span></td>
                <td class="small mono">{{ bodyCoords(a.from) }} → {{ bodyCoords(a.to) }}</td>
                <td class="mono small">{{ clockTime(new Date(a.arrival * 1000), true) }}</td>
                <td><button class="danger small" @click="removeFleetAttack(a)">{{ t('admin.remove') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section data-tour="admin-members" :title="t('admin.members', { name: group.name })" :count="memberSort.sorted.value.length" store-key="admin.members">
      <form class="row" style="margin-bottom: 10px" @submit.prevent="addMember">
        <input v-model="newMemberName" :placeholder="t('admin.ingameName')" style="flex: 1; min-width: 140px" />
        <button class="primary" type="submit" :disabled="!newMemberName.trim()">{{ t('admin.addMember') }}</button>
        <Hint>{{ t('admin.addMemberHint') }}</Hint>
      </form>
      <form v-if="candidates.length" class="row" style="margin-bottom: 10px" @submit.prevent="assignMember">
        <select v-model="assignUserId" style="flex: 2; min-width: 180px">
          <option :value="null" disabled>{{ t('admin.chooseUser') }}</option>
          <option v-for="c in candidates" :key="c.id" :value="c.id">{{ candidateLabel(c) }}</option>
        </select>
        <input v-model="assignIngame" :placeholder="t('admin.ingameName')" style="flex: 1; min-width: 120px" />
        <button class="primary" type="submit" :disabled="!assignUserId">{{ t('admin.assignUser') }}</button>
        <Hint>{{ t('admin.assignUserHint') }}</Hint>
      </form>
      <div class="table-wrap flat">
        <table v-stack class="data">
          <thead>
            <tr>
              <th class="sortable" @click="memberSort.sortBy('user')">{{ t('nav.user') }}<SortMark :dir="memberSort.direction('user')" /></th>
              <th class="sortable" @click="memberSort.sortBy('role')">{{ t('admin.role') }}<SortMark :dir="memberSort.direction('role')" /></th>
              <th class="sortable" @click="memberSort.sortBy('ingame')">{{ t('admin.ingameName') }}<SortMark :dir="memberSort.direction('ingame')" /></th>
              <th class="sortable" @click="memberSort.sortBy('joined')">{{ t('admin.joined') }}<SortMark :dir="memberSort.direction('joined')" /></th>
              <th class="sortable" @click="memberSort.sortBy('login')">{{ t('admin.login') }}<SortMark :dir="memberSort.direction('login')" /></th>
              <th class="sortable" :title="t('onboarding.adminHint')" @click="memberSort.sortBy('onboarding')">{{ t('onboarding.column') }}<SortMark :dir="memberSort.direction('onboarding')" /></th>
              <th class="invite-col">{{ t('admin.memberInvite') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in memberSort.sorted.value" :key="m.id">
              <td v-if="isAdmin && m.account"><input v-model="m.username" style="width: 140px" @change="renameUser(m)" /></td>
              <td v-else-if="!m.account">
                {{ m.ingame_name || m.username }}
                <span class="badge faint">{{ t('admin.noAccount') }}</span>
              </td>
              <td v-else>{{ m.username }}</td>
              <td>
                <span v-if="m.global_admin">{{ t('admin.hubAdmin') }}</span>
                <select v-else :value="m.role" :disabled="m.owner" @change="setRole(m, ($event.target as HTMLSelectElement).value)">
                  <option value="member">{{ t('admin.roles.member') }}</option>
                  <option value="admin">{{ t('admin.roles.admin') }}</option>
                </select>
              </td>
              <td><input v-model="m.ingame_name" style="width: 140px" @change="setIngame(m)" /></td>
              <td class="small">{{ dateTime(m.joined_at) }}</td>
              <td class="small">{{ m.account ? dateTime(m.last_login_at) : '–' }}</td>
              <td class="small" :title="onboardingTitle(m)" :class="{ ok: m.onboarding?.length === ONBOARDING.length }">{{ m.onboarding?.length ?? 0 }}/{{ ONBOARDING.length }}</td>
              <td class="invite-col">
                <div v-if="m.invite_expires_at && freshInvites[m.id]" class="invite-row">
                  <CopyField :value="inviteUrl(freshInvites[m.id])" @copied="msg = t('admin.linkCopied')" />
                  <button type="button" class="small invite-renew" :title="t('admin.renewInvite')" :aria-label="t('admin.renewInvite')" @click="memberInvite(m)">
                    <Icon name="sync" />
                  </button>
                </div>
                <div v-else-if="m.invite_expires_at" class="invite-row">
                  <span class="small muted" :title="t('admin.inviteOpenHint')">{{ t('admin.inviteOpen', { date: dateTime(m.invite_expires_at) }) }}</span>
                  <button type="button" class="small invite-renew" :title="t('admin.renewInvite')" :aria-label="t('admin.renewInvite')" @click="memberInvite(m)">
                    <Icon name="sync" />
                  </button>
                </div>
                <span v-else-if="m.account && !isAdmin" class="faint small">–</span>
                <button v-else type="button" class="small" @click="memberInvite(m)">{{
                  m.account ? t('admin.passwordInvite') : t('admin.memberInvite')
                }}</button>
              </td>
              <td>
                <button v-if="m.id !== me && !m.owner" class="danger" @click="removeMember(m)">{{ t('admin.remove') }}</button>
                <span v-else-if="m.owner" class="faint small">{{ t('admin.owner') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </Section>

      <Section v-if="group" data-tour="admin-inactivity" :title="t('inactivityCheck.title')" :default-open="false" store-key="admin.inactivity">
        <template #hint><Hint>{{ t('inactivityCheck.hint') }}</Hint></template>
        <InactivityCheck :key="group.id" :universe="group.universe" :group-id="group.id" />
      </Section>

      <Section v-if="crawler" data-tour="admin-crawler" :title="t('admin.crawler')" :default-open="false" store-key="admin.crawler">
        <template #hint><Hint>{{ t('admin.crawlerHint') }}</Hint></template>
        <div class="row">
          <span>{{ crawler.enabled ? t('admin.crawlerRunning') : t('admin.crawlerOff') }}</span>
          <span class="muted small">{{ t('admin.crawlerState', { archived: crawler.archived ?? 0, pending: crawler.pending ?? 0, failed: crawler.failed ?? 0, gone: crawler.gone ?? 0, lost: crawler.lost ?? 0 }) }}</span>
          <span class="grow" />
          <button @click="retryCrawler">{{ t('admin.crawlerRetry') }}</button>
        </div>
        <div v-for="u in crawler.universes.filter((u: any) => u.stopped || u.nextAttempt > Date.now())" :key="u.universe" class="warn small crawler-warn">
          {{
            u.stopped ? t('admin.crawlerStopped', { universe: u.universe, time: dateTime(u.failingSince / 1000), error: u.lastError })
            : t('admin.crawlerPaused', { universe: u.universe, time: dateTime(u.nextAttempt / 1000), error: u.lastError })
          }}
        </div>
      </Section>

      <template v-if="isAdmin">
      <Section data-tour="admin-system" :title="t('admin.system.title')" :default-open="false" store-key="admin.system">
        <template #hint><Hint>{{ t('admin.system.hint') }}</Hint></template>
        <SystemMonitor />
      </Section>

      <Section :title="t('admin.samples.title')" :count="samples.length" :default-open="false" store-key="admin.samples">
        <template #hint><Hint>{{ t('admin.samples.hint') }}</Hint></template>
        <p v-if="!samples.length" class="muted small">{{ t('admin.samples.none') }}</p>
        <div v-else class="table-wrap">
          <table v-stack class="data">
            <thead>
              <tr>
                <th>{{ t('admin.samples.when') }}</th>
                <th>{{ t('admin.samples.from') }}</th>
                <th>{{ t('admin.samples.why') }}</th>
                <th>{{ t('admin.samples.note') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in samples" :key="x.id">
                <td class="nowrap">{{ dateTime(x.created_at) }}</td>
                <td>{{ x.username ?? '?' }} <span class="muted small">{{ x.group_name }} · {{ x.universe }}</span></td>
                <td>{{ x.code }}<span v-if="x.page" class="mono small"> {{ x.page }}</span></td>
                <td class="m-wide">{{ x.note ?? '' }}</td>
                <td class="nowrap">
                  <a :href="`${BASE_URL}api/admin/parser-samples/${x.id}`" download>{{ t('admin.samples.download') }}</a>
                  <button class="danger" style="margin-left: 6px" @click="deleteSample(x.id)">{{ t('admin.samples.delete') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section data-tour="admin-backfill" :title="t('admin.backfill')" :default-open="false" store-key="admin.backfill">
        <template #hint><Hint>{{ t('admin.backfillHint') }}</Hint></template>
      <div class="row">
        <button @click="backfill">{{ t('admin.backfillButton') }}</button>
      </div>
      </Section>

      <Section data-tour="admin-merge" :title="t('admin.merge')" :default-open="false" store-key="admin.merge">
        <template #hint><Hint>{{ t('admin.mergeHint') }}</Hint></template>
      <div class="row">
        <label>{{ t('common.from') }} <input v-model.number="merge.from" type="number" /></label>
        <label>{{ t('admin.into') }} <input v-model.number="merge.into" type="number" /></label>
        <button :disabled="!merge.from || !merge.into" @click="doMerge">{{ t('admin.mergeButton') }}</button>
      </div>
      </Section>

      <Section data-tour="admin-ingests" :title="t('admin.ingests')" :default-open="false" store-key="admin.ingests">
        <template #hint><Hint>{{ t('admin.ingestsHint') }}</Hint></template>
      <SortBar
        v-if="mobile"
        v-model:desc="ingestSort.descending.value"
        :sort-key="ingestSort.key.value"
        :options="ingestSorts.map((k) => ({ key: k, label: ingestLabel(k) }))"
        @sort="ingestSort.sortBy"
      />
      <div class="table-wrap">
        <table v-stack="2" class="data ingests">
          <thead>
            <tr>
              <th v-for="k in ingestSorts" :key="k" class="sortable" @click="ingestSort.sortBy(k)">{{ ingestLabel(k) }}<SortMark :dir="ingestSort.direction(k)" /></th>
              <th>{{ t('admin.result') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="i in ingestSort.sorted.value" :key="i.id">
              <tr>
                <td class="small">{{ dateTime(i.created_at) }}</td>
                <td>{{ i.username }}<div v-if="i.synced_by" class="small muted">{{ t('admin.syncedBy', { name: i.synced_by }) }}</div></td>
                <td class="small content">
                  <div v-for="(c, n) in contentOf(i)" :key="n">{{ c }}</div>
                </td>
                <td class="small muted content">
                  <div v-for="(c, k) in i.summary?.counts" :key="k">{{ k }}: {{ t('admin.counts', { new: c.new, duplicate: c.duplicate }) }}</div>
                  <div v-for="w in i.summary?.warnings" :key="w" class="warn"><Icon name="warning" :size="13" /> {{ w }}</div>
                </td>
                <td>
                  <div v-if="i.html_size || i.text_size" class="actions">
                    <button @click="reparse(i.id)">Reparse</button>
                    <button class="danger" @click="previewUndo(i.id)">{{ t('admin.undo') }}</button>
                  </div>
                </td>
              </tr>
              <tr v-if="undo && undo.id === i.id">
                <td colspan="5" class="small content">
                  <p>{{ t('admin.undoPreview', undo) }}</p>
                  <p v-if="undo.players.length"><b>{{ t('admin.undoPlayers') }} ({{ undo.players.length }}):</b> {{ undo.players.join(', ') }}</p>
                  <p v-if="undo.alliances.length"><b>{{ t('admin.undoAlliances') }} ({{ undo.alliances.length }}):</b> {{ undo.alliances.join(', ') }}</p>
                  <p v-if="undo.kept.length" class="warn"><b>{{ t('admin.undoKept') }} ({{ undo.kept.length }}):</b> {{ undo.kept.join(', ') }}</p>
                  <p v-if="undo.skipped.length" class="warn">{{ t('admin.undoSkipped', { kinds: undo.skipped.join(', ') }) }}</p>
                  <div class="actions" style="justify-content: flex-start">
                    <button class="danger" @click="runUndo">{{ t('admin.undoRun') }}</button>
                    <button @click="undo = null">{{ t('common.cancel') }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      </Section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.tag-input { width: 110px; }
.access-request { padding: 8px 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.access-request:first-of-type { border-top: 0; }
.access-message { white-space: pre-wrap; overflow-wrap: anywhere; }
.crawler-warn { margin-top: 8px; }
.discord .check { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
.discord .off { opacity: 0.5; }
.discord label + label { margin-left: 12px; }
:deep(td.invite-col), :deep(th.invite-col) { white-space: normal; width: 280px; max-width: 360px; }
.invite-row { display: flex; align-items: stretch; gap: 4px; }
.invite-row .copy-field { flex: 1; min-width: 0; }
.invite-renew { flex-shrink: 0; width: 34px; padding: 0; }
.actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: nowrap; }
table.ingests td.content { white-space: normal; min-width: 220px; }
/* universe settings dialog: one card per group, label left and value right */
.uni-create { display: flex; flex-direction: column; gap: 10px; }
.uni-create label { display: flex; flex-direction: column; gap: 4px; }
.uni-create input, .uni-create :deep(input) { width: 100%; box-sizing: border-box; margin: 0; }
.uni-summary { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.uni-config { width: 100%; border-collapse: collapse; }
table.uni-config th, table.uni-config td { padding: 6px 0; border-bottom: 1px solid var(--border); vertical-align: middle; }
table.uni-config tr:last-child > * { border-bottom: 0; }
table.uni-config th { text-align: left; font-weight: 400; }
table.uni-config td { width: 1%; padding-left: 12px; text-align: right; white-space: nowrap; }
table.uni-config input[type='number'] { width: 110px; text-align: right; }
table.uni-config input.wide { width: 300px; }
table.uni-config input[type='checkbox'] { width: 18px; height: 18px; margin: 0; vertical-align: middle; }
table.uni-deck { width: auto; }
table.uni-deck input { width: 80px; text-align: right; }
@media (max-width: 800px) {
  /* text settings: input full width below the label */
  table.uni-config, table.uni-config > tbody { display: block; }
  table.uni-config tr { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  table.uni-config tr:last-child { border-bottom: 0; }
  table.uni-config th, table.uni-config td { padding: 0; border: 0; }
  table.uni-config th { flex: 1; min-width: 0; }
  table.uni-config td { width: auto; }
  table.uni-config tr.text-row > td { flex-basis: 100%; text-align: left; }
  table.uni-config tr.text-row input.wide { width: 100%; box-sizing: border-box; }
  table.uni-config input[type='number'] { width: 96px; }
  table.uni-deck { width: 100%; }
  .uni-summary { max-width: 140px; }
  /* forms: one field per line, full width */
  .admin .row > input,
  .admin .row > select,
  .admin .row > label,
  .admin .row > form { flex: 1 1 100%; }
  .admin .row input:not([type='checkbox']),
  .admin .row select,
  .admin table.data.stack input,
  .admin table.data.stack select { width: 100% !important; box-sizing: border-box; }
  /* content and result: label above, one entry per line */
  table.ingests td.content { display: block; min-width: 0; flex-basis: 100%; text-align: left; }
  table.ingests td.content::before { display: block; }
  .admin .sortbar > label { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; }
  .admin .sortbar select { width: auto !important; flex: 1; }
}
.uni-bonus input { width: 70px; }
</style>

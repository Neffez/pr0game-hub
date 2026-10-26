<script setup lang="ts">
import Section from '../components/Section.vue';
import Icon from '../components/Icon.vue';
import SortBar from '../components/SortBar.vue';
import SortMark from '../components/SortMark.vue';
import BackLink from '../components/BackLink.vue';
import { useMobile, useSort, vStack } from '../composables';
import CopyField from '../components/CopyField.vue';
import Hint from '../components/Hint.vue';
import SystemMonitor from '../components/SystemMonitor.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, loadMe, selectedGroup, session } from '../api';
import { dateTime, STATS_CATEGORIES } from '../format';

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
const newUni = ref({ slug: '', name: '' });
type DeckCard = { type: string; size: string; count: number };
const editUni = ref<{ slug: string; name: string; settings: Record<string, any>; deck: DeckCard[] } | null>(null);
const deckTotal = computed(() => editUni.value?.deck.reduce((sum, c) => sum + (Number(c.count) || 0), 0) ?? 0);

// ------------------------------------------------------------------- groups
const groups = ref<any[]>([]);
const newGroup = ref({ universe: '', name: '' });
const groupId = ref<number | null>(null);
const members = ref<any[]>([]);
const ingests = ref<any[]>([]);
const newMemberName = ref('');
const merge = ref({ from: null as number | null, into: null as number | null });
const group = computed(() => groups.value.find((g) => g.id === groupId.value));
const groupName = ref('');
watch(group, (g) => (groupName.value = g?.name ?? ''), { immediate: true });

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

async function loadGroup() {
  if (!groupId.value) return;
  [members.value, ingests.value, discord.value] = await Promise.all([
    api(`/admin/groups/${groupId.value}/members`),
    // sync history is technical administration: global admins only
    isAdmin.value ? api(`/admin/groups/${groupId.value}/ingests`) : [],
    api(`/admin/groups/${groupId.value}/discord`),
  ]);
  discordWebhook.value = '';
  undo.value = null;
}

onMounted(() =>
  run(async () => {
    await loadAll();
    // /admin?uni=u8 opens the universe settings directly (link from the start page)
    const u = universes.value.find((x) => x.slug === route.query.uni);
    if (u) startEdit(u);
  }),
);
watch(groupId, () => run(loadGroup));

const createUni = () =>
  run(async () => {
    await api('/admin/universes', { body: newUni.value });
    newUni.value = { slug: '', name: '' };
    await loadAll();
  }, 'admin.universeCreated');

function startEdit(u: any) {
  editUni.value = { slug: u.slug, name: u.name, settings: { ...u.settings }, deck: u.deck.map((c: DeckCard) => ({ ...c })) };
}

const saveUni = () =>
  run(async () => {
    const e = editUni.value!;
    const settings = { ...e.settings, gameUrl: String(e.settings.gameUrl ?? '').trim() };
    await api(`/admin/universes/${e.slug}`, { method: 'PUT', body: { name: e.name, settings, deck: e.deck } });
    editUni.value = null;
    await loadAll();
  }, 'deck.saved');

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
    await loadAll();
    await loadMe();
    groupId.value = res.id;
  }, 'admin.groupCreated');

const renameGroup = () =>
  run(async () => {
    await api(`/admin/groups/${groupId.value}`, { method: 'PUT', body: { name: groupName.value } });
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
  (m: any, k) => ({ user: m.username.toLowerCase(), role: m.role, ingame: m.ingame_name?.toLowerCase(), joined: m.joined_at, login: m.last_login_at })[k],
  'user',
  false,
);

const inviteUrl = (token: string) => `${location.origin}${import.meta.env.BASE_URL}invite/${token}`;
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => (msg.value = t('admin.linkCopied')));

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
    await api(`/admin/groups/${groupId.value}/members`, { body: { name: newMemberName.value } });
    newMemberName.value = '';
    await loadGroup();
  }, 'deck.saved');

const memberInvite = (m: any) =>
  run(async () => {
    const res = await api<{ token: string }>(`/admin/groups/${groupId.value}/members/${m.id}/invite`, { body: {} });
    copy(inviteUrl(res.token));
    await loadGroup();
  });

const removeMember = (m: any) => {
  const key = m.account ? 'admin.removeConfirm' : 'admin.removePlaceholderConfirm';
  const name = m.ingame_name || m.username;
  if (!confirm(t(key, { name }))) return;
  run(async () => {
    await api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'DELETE' });
    await loadGroup();
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
    <h1>{{ t('admin.title') }}</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <template v-if="isAdmin">
      <Section :title="t('nav.universes')" :count="universes.length" store-key="admin.universes">
        <div class="scroll-x">
        <table v-stack class="data">
          <tr><th>Slug</th><th>{{ t('common.name') }}</th><th>{{ t('admin.gameUrl') }}</th><th>{{ t('admin.size') }}</th><th>{{ t('admin.timezone') }}</th><th /></tr>
          <tr v-for="u in universes" :key="u.slug">
            <td class="mono">{{ u.slug }}</td>
            <td>{{ u.name }}</td>
            <td class="small">{{ u.settings.gameUrl || '–' }}</td>
            <td class="small">{{ u.settings.galaxies }} × {{ u.settings.systems }} × {{ u.settings.positions }}</td>
            <td class="small">{{ u.settings.timezone }}</td>
            <td><button @click="startEdit(u)">{{ t('admin.edit') }}</button></td>
          </tr>
        </table>
        </div>
        <form class="row" style="margin-top: 10px" @submit.prevent="createUni">
          <input v-model="newUni.slug" :placeholder="t('admin.slugPlaceholder')" style="width: 120px" />
          <input v-model="newUni.name" :placeholder="t('common.name')" />
          <button class="primary">{{ t('admin.createUniverse') }}</button>
        </form>
        <div v-if="editUni" style="margin-top: 12px">
          <h3>{{ t('admin.editTitle', { slug: editUni.slug }) }}</h3>
          <div class="row">
            <label>{{ t('common.name') }} <input v-model="editUni.name" /></label>
            <label>
              {{ t('admin.gameUrl') }}
              <Hint>{{ t('admin.gameUrlHint') }}</Hint>
              <input v-model="editUni.settings.gameUrl" :placeholder="`https://pr0game.com/uni${editUni.slug.replace(/\D/g, '')}/`" style="width: 260px" />
            </label>
          </div>
          <div class="row" style="margin-top: 8px">
            <label>{{ t('admin.galaxies') }} <input v-model.number="editUni.settings.galaxies" type="number" min="1" style="width: 70px" /></label>
            <label>{{ t('admin.systems') }} <input v-model.number="editUni.settings.systems" type="number" min="1" style="width: 80px" /></label>
            <label>{{ t('admin.positions') }} <input v-model.number="editUni.settings.positions" type="number" min="1" style="width: 70px" /></label>
            <label>
              {{ t('admin.fleetSpeed') }}
              <Hint>{{ t('admin.fleetSpeedHint') }}</Hint>
              <input v-model.number="editUni.settings.fleetSpeed" type="number" min="1" style="width: 90px" />
            </label>
            <label>
              {{ t('admin.buildingSpeed') }}
              <Hint>{{ t('admin.buildingSpeedHint') }}</Hint>
              <input v-model.number="editUni.settings.buildingSpeed" type="number" min="0" style="width: 90px" />
            </label>
            <label>
              {{ t('admin.researchSpeed') }}
              <Hint>{{ t('admin.researchSpeedHint') }}</Hint>
              <input v-model.number="editUni.settings.researchSpeed" type="number" min="0" style="width: 90px" />
            </label>
            <label>
              {{ t('admin.universityFactor') }}
              <Hint>{{ t('admin.universityFactorHint') }}</Hint>
              <input v-model.number="editUni.settings.universityFactor" type="number" min="0" max="100" style="width: 60px" />
            </label>
            <label>
              {{ t('admin.missileRangeFactor') }}
              <Hint>{{ t('admin.missileRangeFactorHint') }}</Hint>
              <input v-model.number="editUni.settings.missileRangeFactor" type="number" min="0" step="any" placeholder="1" style="width: 70px" />
            </label>
            <label>
              {{ t('admin.fleetDebrisPercent') }}
              <Hint>{{ t('admin.fleetDebrisPercentHint') }}</Hint>
              <input v-model.number="editUni.settings.fleetDebrisPercent" type="number" min="0" max="100" placeholder="30" style="width: 60px" />
            </label>
            <label>
              {{ t('admin.defenseDebrisPercent') }}
              <Hint>{{ t('admin.defenseDebrisPercentHint') }}</Hint>
              <input v-model.number="editUni.settings.defenseDebrisPercent" type="number" min="0" max="100" placeholder="0" style="width: 60px" />
            </label>
            <label>
              {{ t('admin.timezone') }}
              <Hint>{{ t('admin.timezoneHint') }}</Hint>
              <input v-model="editUni.settings.timezone" style="width: 140px" />
            </label>
          </div>
          <h4>
            {{ t('admin.distance') }}
            <Hint>{{ t('admin.distanceHint') }}</Hint>
          </h4>
          <div class="row">
            <label><input v-model="editUni.settings.circularGalaxies" type="checkbox" /> {{ t('admin.circularGalaxies') }}</label>
            <label><input v-model="editUni.settings.circularSystems" type="checkbox" /> {{ t('admin.circularSystems') }}</label>
          </div>
          <div class="row" style="margin-top: 8px">
            <label>{{ t('admin.galaxyFactor') }} <input v-model.number="editUni.settings.galaxyDistanceFactor" type="number" min="0" style="width: 90px" /></label>
            <label>{{ t('admin.systemFactor') }} <input v-model.number="editUni.settings.systemDistanceFactor" type="number" min="0" style="width: 70px" /></label>
            <label>{{ t('admin.systemBase') }} <input v-model.number="editUni.settings.systemDistance" type="number" min="0" style="width: 80px" /></label>
            <label>{{ t('admin.planetFactor') }} <input v-model.number="editUni.settings.planetDistanceFactor" type="number" min="0" style="width: 70px" /></label>
            <label>{{ t('admin.planetBase') }} <input v-model.number="editUni.settings.planetDistance" type="number" min="0" style="width: 80px" /></label>
          </div>
          <h4>
            {{ t('nav.deck') }}
            <Hint>{{ t('admin.deckHint') }}</Hint>
          </h4>
          <div class="scroll-x">
          <table class="data" style="width: auto">
            <thead><tr><th>{{ t('expeditions.event') }}</th><th>{{ t('admin.cardSize') }}</th><th>{{ t('admin.count') }}</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in editUni.deck" :key="i">
                <td>{{ c.type }}</td>
                <td>{{ c.size }}</td>
                <td><input v-model.number="c.count" type="number" min="0" style="width: 80px" /></td>
              </tr>
            </tbody>
            <tfoot><tr><th colspan="2">{{ t('common.total') }}</th><th>{{ deckTotal }}</th></tr></tfoot>
          </table>
          </div>
          <button style="margin: 6px 0 12px" @click="resetDeck">{{ t('admin.restoreDeck') }}</button>
          <div>
            <button class="primary" @click="saveUni">{{ t('common.save') }}</button>
            <button @click="editUni = null">{{ t('common.cancel') }}</button>
          </div>
        </div>
      </Section>
    </template>

    <Section :title="t('stats.alliances')" :count="groups.length" store-key="admin.groups">
      <div class="row">
        <select v-model="groupId">
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.universe }} · {{ g.name }} ({{ g.members }})</option>
        </select>
        <form v-if="group" class="row" @submit.prevent="renameGroup">
          <input v-model="groupName" :placeholder="t('admin.groupName')" />
          <button :disabled="!groupName.trim() || groupName.trim() === group.name">{{ t('admin.rename') }}</button>
        </form>
      </div>
      <form v-if="isAdmin" class="row" style="margin-top: 10px" @submit.prevent="createGroup">
        <select v-model="newGroup.universe">
          <option value="" disabled>{{ t('admin.universe') }}</option>
          <option v-for="u in universes" :key="u.slug" :value="u.slug">{{ u.slug }}</option>
        </select>
        <input v-model="newGroup.name" :placeholder="t('admin.groupName')" />
        <button class="primary">{{ t('admin.createGroup') }}</button>
      </form>
    </Section>

    <template v-if="group">
      <Section v-if="discord" :title="t('admin.discord')" :default-open="false" store-key="admin.discord" class="discord">
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
      <Section :title="t('admin.members', { name: group.name })" :count="memberSort.sorted.value.length" store-key="admin.members">
      <form class="row" style="margin-bottom: 10px" @submit.prevent="addMember">
        <input v-model="newMemberName" :placeholder="t('admin.ingameName')" style="flex: 1; min-width: 140px" />
        <button class="primary" type="submit" :disabled="!newMemberName.trim()">{{ t('admin.addMember') }}</button>
        <Hint>{{ t('admin.addMemberHint') }}</Hint>
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
              <td class="invite-col">
                <div v-if="m.invite" class="invite-row">
                  <CopyField :value="inviteUrl(m.invite)" @copied="msg = t('admin.linkCopied')" />
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

      <Section v-if="crawler" :title="t('admin.crawler')" :default-open="false" store-key="admin.crawler">
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
      <Section :title="t('admin.system.title')" :default-open="false" store-key="admin.system">
        <template #hint><Hint>{{ t('admin.system.hint') }}</Hint></template>
        <SystemMonitor />
      </Section>

      <Section :title="t('admin.backfill')" :default-open="false" store-key="admin.backfill">
        <template #hint><Hint>{{ t('admin.backfillHint') }}</Hint></template>
      <div class="row">
        <button @click="backfill">{{ t('admin.backfillButton') }}</button>
      </div>
      </Section>

      <Section :title="t('admin.merge')" :default-open="false" store-key="admin.merge">
        <template #hint><Hint>{{ t('admin.mergeHint') }}</Hint></template>
      <div class="row">
        <label>{{ t('common.from') }} <input v-model.number="merge.from" type="number" /></label>
        <label>{{ t('admin.into') }} <input v-model.number="merge.into" type="number" /></label>
        <button :disabled="!merge.from || !merge.into" @click="doMerge">{{ t('admin.mergeButton') }}</button>
      </div>
      </Section>

      <Section :title="t('admin.ingests')" :default-open="false" store-key="admin.ingests">
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
@media (max-width: 799px) {
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
</style>

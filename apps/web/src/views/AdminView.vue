<script setup lang="ts">
import { vStack } from '../composables';
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, loadMe, selectedGroup, session } from '../api';
import { dateTime } from '../format';

const { t } = useI18n();
const route = useRoute();
/** set when opened inside a universe (sidebar stays, its alliance is preselected) */
const uni = route.params.uni ? String(route.params.uni) : null;
const isAdmin = computed(() => !!session.me?.user?.isAdmin);
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
const invites = ref<any[]>([]);
const ingests = ref<any[]>([]);
const inviteRole = ref('member');
const merge = ref({ from: null as number | null, into: null as number | null });
const group = computed(() => groups.value.find((g) => g.id === groupId.value));

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
  [members.value, invites.value, ingests.value] = await Promise.all([
    api(`/admin/groups/${groupId.value}/members`),
    api(`/admin/groups/${groupId.value}/invites`),
    api(`/admin/groups/${groupId.value}/ingests`),
  ]);
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

const createInvite = () =>
  run(async () => {
    await api(`/admin/groups/${groupId.value}/invites`, { body: { role: inviteRole.value } });
    await loadGroup();
  });

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
const removeMember = (m: any) => {
  if (!confirm(t('admin.removeConfirm', { name: m.username }))) return;
  run(async () => {
    await api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'DELETE' });
    await loadGroup();
  });
};
const deleteInvite = (token: string) => run(async () => {
  await api(`/admin/invites/${token}`, { method: 'DELETE' });
  await loadGroup();
});
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
const doMerge = () => run(async () => {
  await api(`/admin/groups/${groupId.value}/players/merge`, { body: merge.value });
  merge.value = { from: null, into: null };
}, 'admin.merged');
</script>

<template>
  <div :class="{ main: !uni }" style="max-width: 1100px" :style="{ margin: uni ? undefined : '0 auto' }">
    <p v-if="!uni"><RouterLink to="/">{{ t('common.back') }}</RouterLink></p>
    <h1>{{ t('admin.title') }}</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <template v-if="isAdmin">
      <h2>{{ t('nav.universes') }}</h2>
      <div class="card">
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
      </div>
    </template>

    <h2>{{ t('stats.alliances') }}</h2>
    <div class="card">
      <div class="row">
        <select v-model="groupId">
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.universe }} · {{ g.name }} ({{ g.members }})</option>
        </select>
        <template v-if="isAdmin">
          <span class="grow" />
          <select v-model="newGroup.universe">
            <option value="" disabled>{{ t('admin.universe') }}</option>
            <option v-for="u in universes" :key="u.slug" :value="u.slug">{{ u.slug }}</option>
          </select>
          <input v-model="newGroup.name" :placeholder="t('admin.groupName')" />
          <button class="primary" @click="createGroup">{{ t('admin.createGroup') }}</button>
        </template>
      </div>
    </div>

    <template v-if="group">
      <h2>{{ t('admin.members', { name: group.name }) }}</h2>
      <div class="table-wrap" style="max-height: none">
        <table v-stack class="data">
          <thead><tr><th>{{ t('nav.user') }}</th><th>{{ t('admin.role') }}</th><th>{{ t('admin.ingameName') }}</th><th>{{ t('admin.joined') }}</th><th>{{ t('admin.login') }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td v-if="isAdmin"><input v-model="m.username" style="width: 140px" @change="renameUser(m)" /></td>
              <td v-else>{{ m.username }}</td>
              <td>
                <select :value="m.role" @change="setRole(m, ($event.target as HTMLSelectElement).value)">
                  <option value="member">{{ t('admin.roles.member') }}</option>
                  <option value="admin">{{ t('admin.roles.admin') }}</option>
                </select>
              </td>
              <td><input v-model="m.ingame_name" style="width: 140px" @change="setIngame(m)" /></td>
              <td class="small">{{ dateTime(m.joined_at) }}</td>
              <td class="small">{{ dateTime(m.last_login_at) }}</td>
              <td><button @click="removeMember(m)">{{ t('admin.remove') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>{{ t('admin.invites') }}</h2>
      <div class="card">
        <div class="row">
          <select v-model="inviteRole">
            <option value="member">{{ t('admin.roles.member') }}</option>
            <option value="admin">{{ t('admin.roles.admin') }}</option>
          </select>
          <button class="primary" @click="createInvite">{{ t('admin.createInvite') }}</button>
        </div>
        <div class="scroll-x">
        <table v-stack class="data" style="margin-top: 10px">
          <tr v-for="i in invites" :key="i.token">
            <td class="mono small">
              <a v-if="!i.used_at" href="#" @click.prevent="copy(inviteUrl(i.token))">{{ inviteUrl(i.token) }}</a>
              <span v-else class="faint">{{ i.token.slice(0, 8) }}…</span>
            </td>
            <td class="small">{{ t(`admin.roles.${i.role}`) }}</td>
            <td class="small">{{ i.used_at ? t('admin.usedBy', { name: i.used_by }) : t('admin.validUntil', { time: dateTime(i.expires_at) }) }}</td>
            <td><button v-if="!i.used_at" @click="deleteInvite(i.token)">{{ t('common.delete') }}</button></td>
          </tr>
        </table>
        </div>
      </div>

      <template v-if="crawler">
        <h2>{{ t('admin.crawler') }} <Hint>{{ t('admin.crawlerHint') }}</Hint></h2>
        <div class="card row">
          <span>{{ crawler.enabled ? t('admin.crawlerRunning') : t('admin.crawlerOff') }}</span>
          <span class="muted small">{{ t('admin.crawlerState', { archived: crawler.archived ?? 0, pending: crawler.pending ?? 0, failed: crawler.failed ?? 0, gone: crawler.gone ?? 0, lost: crawler.lost ?? 0 }) }}</span>
          <span class="grow" />
          <button @click="retryCrawler">{{ t('admin.crawlerRetry') }}</button>
        </div>
        <div v-for="u in crawler.universes.filter((u: any) => u.stopped || u.nextAttempt > Date.now())" :key="u.universe" class="card warn small">
          {{
            u.stopped ? t('admin.crawlerStopped', { universe: u.universe, time: dateTime(u.failingSince / 1000), error: u.lastError })
            : t('admin.crawlerPaused', { universe: u.universe, time: dateTime(u.nextAttempt / 1000), error: u.lastError })
          }}
        </div>
      </template>

      <h2>
        {{ t('admin.backfill') }}
        <Hint>{{ t('admin.backfillHint') }}</Hint>
      </h2>
      <div class="card row">
        <button @click="backfill">{{ t('admin.backfillButton') }}</button>
      </div>

      <h2>{{ t('admin.merge') }} <Hint>{{ t('admin.mergeHint') }}</Hint></h2>
      <div class="card row">
        <label>{{ t('common.from') }} <input v-model.number="merge.from" type="number" /></label>
        <label>{{ t('admin.into') }} <input v-model.number="merge.into" type="number" /></label>
        <button :disabled="!merge.from || !merge.into" @click="doMerge">{{ t('admin.mergeButton') }}</button>
      </div>

      <h2>{{ t('admin.ingests') }}</h2>
      <div class="table-wrap">
        <table v-stack="2" class="data">
          <thead><tr><th>{{ t('common.time') }}</th><th>{{ t('nav.user') }}</th><th>{{ t('admin.source') }}</th><th>{{ t('admin.page') }}</th><th>{{ t('admin.result') }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="i in ingests" :key="i.id">
              <td class="small">{{ dateTime(i.created_at) }}</td>
              <td>{{ i.username }}</td>
              <td class="small">{{ i.source }}</td>
              <td class="small">{{ i.page_type }}</td>
              <td class="small muted">
                <span v-for="(c, k) in i.summary?.counts" :key="k">{{ k }}: {{ c.new }}/{{ c.duplicate }} </span>
                <span v-for="w in i.summary?.warnings" :key="w" class="warn">⚠ {{ w }} </span>
              </td>
              <td><button v-if="i.html_size || i.text_size" @click="reparse(i.id)">Reparse</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

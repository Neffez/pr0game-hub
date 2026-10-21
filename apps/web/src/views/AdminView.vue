<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, loadMe, session } from '../api';
import { dateTime } from '../format';

const route = useRoute();
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

async function run(fn: () => Promise<unknown>, ok = '') {
  error.value = msg.value = '';
  try {
    await fn();
    msg.value = ok;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function loadAll() {
  universes.value = await api('/universes');
  groups.value = await api('/admin/groups');
  if (!groupId.value && groups.value.length) groupId.value = groups.value[0].id;
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
  }, 'Universum angelegt');

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
  }, 'Gespeichert');

/** Drops the custom deck so the universe falls back to the game's default deck. */
const resetDeck = () =>
  run(async () => {
    const slug = editUni.value!.slug;
    await api(`/admin/universes/${slug}`, { method: 'PUT', body: { deck: null } });
    await loadAll();
    editUni.value!.deck = universes.value.find((x) => x.slug === slug).deck.map((c: DeckCard) => ({ ...c }));
  }, 'Standard-Deck wiederhergestellt');

const createGroup = () =>
  run(async () => {
    const res = await api('/admin/groups', { body: newGroup.value });
    newGroup.value.name = '';
    await loadAll();
    await loadMe();
    groupId.value = res.id;
  }, 'Allianz angelegt');

const createInvite = () =>
  run(async () => {
    await api(`/admin/groups/${groupId.value}/invites`, { body: { role: inviteRole.value } });
    await loadGroup();
  });

const inviteUrl = (token: string) => `${location.origin}${import.meta.env.BASE_URL}invite/${token}`;
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => (msg.value = 'Link kopiert'));

const setRole = (m: any, role: string) => run(async () => {
  await api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'PUT', body: { role } });
  await loadGroup();
});
const setIngame = (m: any) => run(() => api(`/admin/groups/${groupId.value}/members/${m.id}`, { method: 'PUT', body: { ingameName: m.ingame_name } }), 'Gespeichert');
const renameUser = (m: any) => run(async () => {
  try {
    await api(`/admin/users/${m.id}`, { method: 'PUT', body: { username: m.username } });
  } finally {
    await loadGroup();
  }
  if (m.id === session.me?.user?.id) await loadMe();
}, 'Benutzername geändert');
const removeMember = (m: any) => {
  if (!confirm(`${m.username} aus der Allianz entfernen?`)) return;
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
const backfill = () =>
  run(async () => {
    const res = await api(`/admin/groups/${groupId.value}/activity/backfill`, { body: {} });
    msg.value = `Aktivitätslog: ${res.added} Einträge ergänzt`;
  });
const doMerge = () => run(async () => {
  await api(`/admin/groups/${groupId.value}/players/merge`, { body: merge.value });
  merge.value = { from: null, into: null };
}, 'Zusammengeführt');
</script>

<template>
  <div class="main" style="max-width: 1100px; margin: 0 auto">
    <p><RouterLink to="/">← zurück</RouterLink></p>
    <h1>Admin</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <template v-if="isAdmin">
      <h2>Universen</h2>
      <div class="card">
        <table class="data">
          <tr><th>Slug</th><th>Name</th><th>Spiel-URL</th><th>Größe</th><th>Zeitzone</th><th /></tr>
          <tr v-for="u in universes" :key="u.slug">
            <td class="mono">{{ u.slug }}</td>
            <td>{{ u.name }}</td>
            <td class="small">{{ u.settings.gameUrl || '–' }}</td>
            <td class="small">{{ u.settings.galaxies }} × {{ u.settings.systems }} × {{ u.settings.positions }}</td>
            <td class="small">{{ u.settings.timezone }}</td>
            <td><button @click="startEdit(u)">Bearbeiten</button></td>
          </tr>
        </table>
        <form class="row" style="margin-top: 10px" @submit.prevent="createUni">
          <input v-model="newUni.slug" placeholder="slug (z. B. u8)" style="width: 120px" />
          <input v-model="newUni.name" placeholder="Name" />
          <button class="primary">Universum anlegen</button>
        </form>
        <div v-if="editUni" style="margin-top: 12px">
          <h3>{{ editUni.slug }} bearbeiten</h3>
          <div class="row">
            <label>Name <input v-model="editUni.name" /></label>
            <label>
              Spiel-URL
              <Hint>Adresse des Universums im Spiel, z. B. https://pr0game.com/uni8/. Aktiviert die Links ins Spiel (Galaxie, Flottenseite, Simulator).</Hint>
              <input v-model="editUni.settings.gameUrl" :placeholder="`https://pr0game.com/uni${editUni.slug.replace(/\D/g, '')}/`" style="width: 260px" />
            </label>
          </div>
          <div class="row" style="margin-top: 8px">
            <label>Galaxien <input v-model.number="editUni.settings.galaxies" type="number" min="1" style="width: 70px" /></label>
            <label>Systeme <input v-model.number="editUni.settings.systems" type="number" min="1" style="width: 80px" /></label>
            <label>Positionen <input v-model.number="editUni.settings.positions" type="number" min="1" style="width: 70px" /></label>
            <label>
              Flottengeschw.
              <Hint>Wie in der Spielkonfiguration: 2500 = 1-fache Geschwindigkeit. Wird für Flugzeiten verwendet.</Hint>
              <input v-model.number="editUni.settings.fleetSpeed" type="number" min="1" style="width: 90px" />
            </label>
            <label>
              Zeitzone
              <Hint>Zeitzone der Zeitangaben im Spiel (Statistik, Berichte), normalerweise Europe/Berlin.</Hint>
              <input v-model="editUni.settings.timezone" style="width: 140px" />
            </label>
          </div>
          <h4>
            Entfernung &amp; Flugzeit
            <Hint>Wie in der Spielkonfiguration. Entfernung zwischen Galaxien = Differenz × Galaxie-Faktor; zwischen Systemen = Differenz × System-Faktor + System-Grundwert; im selben System = Differenz × Planeten-Faktor + Planeten-Grundwert.</Hint>
          </h4>
          <div class="row">
            <label><input v-model="editUni.settings.circularGalaxies" type="checkbox" /> Runde Galaxien</label>
            <label><input v-model="editUni.settings.circularSystems" type="checkbox" /> Runde Systeme</label>
          </div>
          <div class="row" style="margin-top: 8px">
            <label>Galaxie-Faktor <input v-model.number="editUni.settings.galaxyDistanceFactor" type="number" min="0" style="width: 90px" /></label>
            <label>System-Faktor <input v-model.number="editUni.settings.systemDistanceFactor" type="number" min="0" style="width: 70px" /></label>
            <label>System-Grundwert <input v-model.number="editUni.settings.systemDistance" type="number" min="0" style="width: 80px" /></label>
            <label>Planeten-Faktor <input v-model.number="editUni.settings.planetDistanceFactor" type="number" min="0" style="width: 70px" /></label>
            <label>Planeten-Grundwert <input v-model.number="editUni.settings.planetDistance" type="number" min="0" style="width: 80px" /></label>
          </div>
          <h4>
            Expo-Deck
            <Hint>Anzahl der Karten je Ereignis und Größe im Expeditions-Deck des Universums.</Hint>
          </h4>
          <table class="data" style="width: auto">
            <thead><tr><th>Ereignis</th><th>Größe</th><th>Anzahl</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in editUni.deck" :key="i">
                <td>{{ c.type }}</td>
                <td>{{ c.size }}</td>
                <td><input v-model.number="c.count" type="number" min="0" style="width: 80px" /></td>
              </tr>
            </tbody>
            <tfoot><tr><th colspan="2">Summe</th><th>{{ deckTotal }}</th></tr></tfoot>
          </table>
          <button style="margin: 6px 0 12px" @click="resetDeck">Standard-Deck wiederherstellen</button>
          <div>
            <button class="primary" @click="saveUni">Speichern</button>
            <button @click="editUni = null">Abbrechen</button>
          </div>
        </div>
      </div>
    </template>

    <h2>Allianzen</h2>
    <div class="card">
      <div class="row">
        <select v-model="groupId">
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.universe }} · {{ g.name }} ({{ g.members }})</option>
        </select>
        <template v-if="isAdmin">
          <span class="grow" />
          <select v-model="newGroup.universe">
            <option value="" disabled>Universum</option>
            <option v-for="u in universes" :key="u.slug" :value="u.slug">{{ u.slug }}</option>
          </select>
          <input v-model="newGroup.name" placeholder="Allianzname" />
          <button class="primary" @click="createGroup">Allianz anlegen</button>
        </template>
      </div>
    </div>

    <template v-if="group">
      <h2>Mitglieder – {{ group.name }}</h2>
      <div class="table-wrap" style="max-height: none">
        <table class="data">
          <thead><tr><th>Benutzer</th><th>Rolle</th><th>Ingame-Name</th><th>Beigetreten</th><th>Login</th><th /></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td v-if="isAdmin"><input v-model="m.username" style="width: 140px" @change="renameUser(m)" /></td>
              <td v-else>{{ m.username }}</td>
              <td>
                <select :value="m.role" @change="setRole(m, ($event.target as HTMLSelectElement).value)">
                  <option value="member">Mitglied</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td><input v-model="m.ingame_name" style="width: 140px" @change="setIngame(m)" /></td>
              <td class="small">{{ dateTime(m.joined_at) }}</td>
              <td class="small">{{ dateTime(m.last_login_at) }}</td>
              <td><button @click="removeMember(m)">Entfernen</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Einladungen</h2>
      <div class="card">
        <div class="row">
          <select v-model="inviteRole">
            <option value="member">Mitglied</option>
            <option value="admin">Admin</option>
          </select>
          <button class="primary" @click="createInvite">Einladungslink erzeugen (7 Tage)</button>
        </div>
        <table class="data" style="margin-top: 10px">
          <tr v-for="i in invites" :key="i.token">
            <td class="mono small">
              <a v-if="!i.used_at" href="#" @click.prevent="copy(inviteUrl(i.token))">{{ inviteUrl(i.token) }}</a>
              <span v-else class="faint">{{ i.token.slice(0, 8) }}…</span>
            </td>
            <td class="small">{{ i.role }}</td>
            <td class="small">{{ i.used_at ? `benutzt von ${i.used_by}` : `gültig bis ${dateTime(i.expires_at)}` }}</td>
            <td><button v-if="!i.used_at" @click="deleteInvite(i.token)">Löschen</button></td>
          </tr>
        </table>
      </div>

      <h2>
        Aktivitätslog nachfüllen
        <Hint>Erzeugt Einträge aus bereits gespeicherten Daten: Punkte-/Flottenverluste und fehlender Zuwachs aus den Statistik-Ständen, Phalanx-Änderungen aus den Mondberichten. Neue Planeten/Monde/Trümmerfelder lassen sich nicht nachträglich ermitteln. Mehrfaches Ausführen erzeugt keine doppelten Einträge.</Hint>
      </h2>
      <div class="card row">
        <button @click="backfill">Aus vorhandenen Daten nachfüllen</button>
      </div>

      <h2>Spieler zusammenführen <Hint>Bei Umbenennungen ohne ID (Plaintext): interne Spieler-ID aus der URL der Spielerseite im Hub.</Hint></h2>
      <div class="card row">
        <label>von <input v-model.number="merge.from" type="number" /></label>
        <label>in <input v-model.number="merge.into" type="number" /></label>
        <button :disabled="!merge.from || !merge.into" @click="doMerge">Zusammenführen</button>
      </div>

      <h2>Eingänge</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Zeit</th><th>Benutzer</th><th>Quelle</th><th>Seite</th><th>Ergebnis</th><th /></tr></thead>
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
              <td><button @click="reparse(i.id)">Reparse</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

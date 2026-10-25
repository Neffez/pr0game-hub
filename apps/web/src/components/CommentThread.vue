<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useUni } from '../composables';
import { dateTime } from '../format';
import { tables, useLiveReload } from '../live';

/** Alliance discussion on a player, a plan's loot settlement or a planet/moon: oldest first, the own comments editable. */
const props = defineProps<{ player?: number; plan?: number; g?: number; s?: number; p?: number; type?: 'planet' | 'moon' }>();
const { t } = useI18n();
const { uni, ctx } = useUni();

interface Comment {
  id: number;
  user_id: number | null;
  member: string | null;
  body: string;
  created_at: number;
  edited_at: number | null;
}

const query = computed(() => (props.player ? `player=${props.player}` : props.plan ? `plan=${props.plan}` : `c=${props.g}:${props.s}:${props.p}&type=${props.type ?? 'planet'}`));
const { data, error, load } = useLoader(() => uniApi<Comment[]>(uni.value, `/comments?${query.value}`));
onMounted(load);
watch(query, load);
useLiveReload(load, tables('comments'), 300);

const text = ref('');
const editing = ref<number | null>(null);
const editText = ref('');
const actionError = ref('');
const isAdmin = computed(() => ctx.value?.group.role === 'admin' || ctx.value?.me.isAdmin);
const mine = (c: Comment) => c.user_id === ctx.value?.me.id;

async function run(fn: () => Promise<unknown>) {
  actionError.value = '';
  try {
    await fn();
    await load();
  } catch (e) {
    actionError.value = (e as Error).message;
  }
}
const target = () => (props.player ? { player: props.player } : props.plan ? { plan: props.plan } : { c: `${props.g}:${props.s}:${props.p}`, type: props.type ?? 'planet' });
const post = () =>
  run(async () => {
    await uniApi(uni.value, '/comments', { body: { ...target(), body: text.value } });
    text.value = '';
  });
function startEdit(c: Comment) {
  editing.value = c.id;
  editText.value = c.body;
}
const saveEdit = (c: Comment) =>
  run(async () => {
    await uniApi(uni.value, `/comments/${c.id}`, { method: 'PUT', body: { body: editText.value } });
    editing.value = null;
  });
const remove = (c: Comment) => confirm(t('comments.confirmDelete')) && run(() => uniApi(uni.value, `/comments/${c.id}`, { method: 'DELETE' }));
</script>

<template>
  <div class="comments">
    <div v-if="error" class="error">{{ error }}</div>
    <p v-else-if="data && !data.length" class="muted small">{{ t('comments.none') }}</p>
    <div v-for="c in data ?? []" :key="c.id" class="comment">
      <div class="head small">
        <b>{{ c.member ?? t('common.unknown') }}</b>
        <span class="muted">{{ dateTime(c.created_at) }}<template v-if="c.edited_at"> · {{ t('comments.edited') }}</template></span>
        <span class="grow" />
        <template v-if="editing !== c.id">
          <button v-if="mine(c)" class="link" @click="startEdit(c)">{{ t('common.change') }}</button>
          <button v-if="mine(c) || isAdmin" class="link danger" @click="remove(c)">{{ t('common.delete') }}</button>
        </template>
      </div>
      <form v-if="editing === c.id" class="edit" @submit.prevent="saveEdit(c)">
        <textarea v-model="editText" rows="3" maxlength="2000" />
        <div class="row">
          <button class="primary">{{ t('common.save') }}</button>
          <button type="button" @click="editing = null">{{ t('common.cancel') }}</button>
        </div>
      </form>
      <div v-else class="body">{{ c.body }}</div>
    </div>
    <form class="edit" @submit.prevent="post">
      <textarea v-model="text" rows="2" maxlength="2000" :placeholder="t('comments.placeholder')" />
      <div class="row">
        <button class="primary" :disabled="!text.trim()">{{ t('comments.post') }}</button>
        <span v-if="actionError" class="error small">{{ actionError }}</span>
      </div>
    </form>
  </div>
</template>

<style scoped>
.comment { padding: 8px 0; border-bottom: 1px solid var(--border); }
.head { display: flex; align-items: baseline; gap: 8px; }
.body { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
.edit { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.edit textarea { width: 100%; resize: vertical; }
button.link { padding: 0; border: 0; background: none; color: var(--muted); font-size: 12px; }
button.link:hover { color: var(--accent); }
button.link.danger:hover { color: var(--neg); }
</style>

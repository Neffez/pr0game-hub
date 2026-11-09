<script setup lang="ts">
/**
 * Which notifications a channel gets (push or the own Discord webhook; server: push.ts) with their rules: espionage
 * as an attack, comments only when mentioned, the launch lead time.
 * The object is changed in place; `change` asks the parent to save it.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { session } from '../api';

export interface NotifyPrefs {
  attackSelf: boolean;
  attackOthers: boolean;
  invites: boolean;
  comments: boolean;
  launch: boolean;
  buildings: boolean;
  fleets: boolean;
  storage: boolean;
  buildOrder: boolean;
  phalanx: boolean;
  settlements: boolean;
  accessRequests: boolean;
  leadMinutes: number;
  spying: boolean;
  mentionsOnly: boolean;
  quiet: { from: string; to: string; tz: string; except: string[] } | null;
}

defineProps<{ prefs: NotifyPrefs }>();
const emit = defineEmits<{ change: [] }>();
const { t } = useI18n();

const ALL_KINDS = ['attackSelf', 'attackOthers', 'invites', 'comments', 'buildings', 'buildOrder', 'storage', 'phalanx', 'fleets', 'launch', 'settlements', 'accessRequests'] as const;
/** access requests only concern global admins */
const kinds = computed(() => ALL_KINDS.filter((k) => k !== 'accessRequests' || session.me?.user?.isAdmin));
const LEAD_MINUTES = [1, 2, 5, 10, 15, 30];
</script>

<template>
  <div class="kinds">
    <template v-for="k in kinds" :key="k">
      <label class="check"><input v-model="prefs[k]" type="checkbox" @change="emit('change')" /> {{ t(`account.pushKind.${k}`) }}</label>
      <label v-if="k === 'attackOthers'" class="check rule" :class="{ off: !prefs.attackSelf && !prefs.attackOthers }">
        <input v-model="prefs.spying" type="checkbox" :disabled="!prefs.attackSelf && !prefs.attackOthers" @change="emit('change')" /> {{ t('account.rules.spying') }}
      </label>
      <label v-if="k === 'comments'" class="check rule" :class="{ off: !prefs.comments }">
        <input v-model="prefs.mentionsOnly" type="checkbox" :disabled="!prefs.comments" @change="emit('change')" /> {{ t('account.rules.mentionsOnly') }}
      </label>
      <label v-if="k === 'launch'" class="rule" :class="{ off: !prefs.launch }">
        {{ t('account.pushLead') }}
        <select v-model.number="prefs.leadMinutes" :disabled="!prefs.launch" @change="emit('change')">
          <option v-for="m in LEAD_MINUTES" :key="m" :value="m">{{ t('account.pushLeadMinutes', { n: m }) }}</option>
        </select>
      </label>
      <slot v-if="k === 'storage'" name="storage" />
    </template>
  </div>
</template>

<style scoped>
.check { display: flex; gap: 8px; align-items: center; }
.rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 2px 0 4px 24px; }
.rule.off { opacity: 0.5; }
</style>

<script setup lang="ts">
/**
 * Quiet hours of a push device or a Discord webhook (server: notify.ts): nothing is sent between the two times of
 * day, except the kinds ticked; what was held back comes when they end. The time zone is this browser's.
 */
import { useI18n } from 'vue-i18n';

export interface QuietHours {
  from: string;
  to: string;
  tz: string;
  except: string[];
}

const props = defineProps<{ modelValue: QuietHours | null }>();
const emit = defineEmits<{ 'update:modelValue': [QuietHours | null] }>();
const { t } = useI18n();

const BREAKS = ['attackSelf', 'launch', 'fleets'] as const;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function toggle(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked ? { from: '23:00', to: '07:00', tz: zone(), except: [...BREAKS] } : null);
}
/** A change takes this browser's time zone (the times are meant where the user is now). */
function set(patch: Partial<QuietHours>) {
  const next = { ...props.modelValue!, ...patch, tz: zone() };
  if (/^\d\d:\d\d$/.test(next.from) && /^\d\d:\d\d$/.test(next.to) && next.from !== next.to) emit('update:modelValue', next);
}
function toggleBreak(k: string) {
  const list = props.modelValue!.except;
  set({ except: list.includes(k) ? list.filter((x) => x !== k) : [...list, k] });
}
</script>

<template>
  <div class="quiet">
    <label class="check"><input type="checkbox" :checked="!!modelValue" @change="toggle" /> {{ t('account.quiet.enable') }}</label>
    <template v-if="modelValue">
      <div class="quiet-times">
        <label>{{ t('account.quiet.from') }} <input type="time" :value="modelValue.from" required @change="set({ from: ($event.target as HTMLInputElement).value })" /></label>
        <label>{{ t('account.quiet.to') }} <input type="time" :value="modelValue.to" required @change="set({ to: ($event.target as HTMLInputElement).value })" /></label>
        <span class="muted small">{{ modelValue.tz }}</span>
      </div>
      <div class="quiet-breaks">
        <span class="small">{{ t('account.quiet.except') }}</span>
        <label v-for="k in BREAKS" :key="k" class="check">
          <input type="checkbox" :checked="modelValue.except.includes(k)" @change="toggleBreak(k)" /> {{ t(`account.quiet.break.${k}`) }}
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.check { display: flex; gap: 8px; align-items: center; }
.quiet-times { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 6px 0 0 24px; }
.quiet-times label { display: flex; gap: 6px; align-items: center; }
.quiet-breaks { margin: 6px 0 0 24px; }
</style>

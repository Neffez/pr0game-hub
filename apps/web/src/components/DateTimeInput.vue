<script setup lang="ts">
import { VueDatePicker } from '@vuepic/vue-datepicker';
import '@vuepic/vue-datepicker/dist/main.css';
import { de, enGB } from 'date-fns/locale';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile } from '../composables';
import { datePattern } from '../format';
import { toLocalInput } from '../plans';

/**
 * Date or date and time with the value of a native `<input type="date|datetime-local">` ("2026-10-23",
 * "2026-10-23T14:05", "2026-10-23T14:05:09"). On mobile the native field (the system's own picker); on desktop a
 * picker in the hub's date format (account setting), since the native one follows the browser's locale.
 */
const model = defineModel<string>({ required: true });
const props = withDefaults(defineProps<{ precision?: 'day' | 'minute' | 'second'; disabled?: boolean }>(), { precision: 'minute' });
const emit = defineEmits<{ input: [] }>();
const { t, locale } = useI18n();
const mobile = useMobile();

const displayFormat = computed(() =>
  props.precision === 'day' ? datePattern() : `${datePattern()} ${props.precision === 'second' ? 'HH:mm:ss' : 'HH:mm'}`,
);

/** "2026-10-23" is UTC for `new Date`, the native fields mean browser time */
const asDate = computed(() => {
  if (!model.value) return null;
  const d = new Date(model.value.includes('T') ? model.value : `${model.value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
});

function set(value: string | null) {
  model.value = value ?? '';
  emit('input');
}
function pick(d: Date | null) {
  if (!d) return set(null);
  const local = toLocalInput(Math.floor(d.getTime() / 1000));
  set(props.precision === 'day' ? local.slice(0, 10) : local);
}
</script>

<template>
  <input
    v-if="mobile"
    :value="model"
    :type="precision === 'day' ? 'date' : 'datetime-local'"
    :step="precision === 'second' ? 1 : precision === 'minute' ? 60 : undefined"
    :disabled="disabled"
    @input="set(($event.target as HTMLInputElement).value)"
  />
  <VueDatePicker
    v-else
    class="dt-input"
    :class="precision"
    :model-value="asDate"
    :formats="{ input: displayFormat, preview: displayFormat }"
    :text-input="{ format: displayFormat, enterSubmit: true, tabSubmit: true, selectOnFocus: true }"
    :time-config="{ enableTimePicker: precision !== 'day', enableSeconds: precision === 'second', is24: true }"
    :action-row="{ selectBtnLabel: t('common.apply'), cancelBtnLabel: t('common.cancel'), nowBtnLabel: t('common.now'), showNow: true }"
    :input-attrs="{ clearable: false, hideInputIcon: true }"
    :locale="locale === 'de' ? de : enGB"
    :week-start="1"
    :disabled="disabled"
    :auto-apply="precision === 'day'"
    teleport
    dark
    @update:model-value="pick"
  />
</template>

<style>
/* hub colors (style.css); the menu is teleported to body, so these are global */
.dp--theme-dark {
  --dp-background-color: var(--surface-2);
  --dp-text-color: var(--text);
  --dp-hover-color: var(--border);
  --dp-hover-text-color: var(--text);
  --dp-hover-icon-color: var(--text);
  --dp-primary-color: var(--accent);
  --dp-primary-disabled-color: var(--accent-soft);
  --dp-primary-text-color: #fff;
  --dp-secondary-color: var(--faint);
  --dp-border-color: var(--border);
  --dp-menu-border-color: var(--border-strong);
  --dp-border-color-hover: var(--border-strong);
  --dp-border-color-focus: var(--accent);
  --dp-disabled-color: var(--surface);
  --dp-disabled-color-text: var(--faint);
  --dp-scroll-bar-background: var(--surface);
  --dp-scroll-bar-color: var(--border-strong);
  --dp-icon-color: var(--muted);
  --dp-danger-color: var(--neg);
  --dp-highlight-color: var(--accent-soft);
  --dp-font-family: var(--sans);
  --dp-font-size: 14px;
  --dp-border-radius: 6px;
  --dp-input-padding: 5px 8px;
}
.dt-input { display: inline-block; vertical-align: middle; width: auto; }
.dt-input.day { width: 125px; }
.dt-input.minute { width: 160px; }
.dt-input.second { width: 180px; }
.dt-input .dp__input { font-variant-numeric: tabular-nums; line-height: 1.45; }
label > .dt-input { margin-left: 4px; }
</style>

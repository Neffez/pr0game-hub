<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** Read-only text with an attached copy action (single control, not two separate widgets). */
const props = defineProps<{ value: string }>();
const emit = defineEmits<{ copied: [] }>();
const { t } = useI18n();

const copy = () =>
  navigator.clipboard?.writeText(props.value).then(() => emit('copied'));

const selectAll = (e: FocusEvent) => (e.target as HTMLInputElement).select();
</script>

<template>
  <div class="copy-field">
    <input class="mono" type="text" readonly :value="value" :title="value" @focus="selectAll" />
    <button type="button" :aria-label="t('admin.copyInvite')" @click="copy">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="M15 2H9a1 1 0 0 0-1 1v2h8V3a1 1 0 0 0-1-1z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.copy-field {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-width: 220px;
  max-width: 360px;
}
.copy-field input {
  flex: 1;
  min-width: 0;
  margin: 0;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.copy-field button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  padding: 0;
  margin: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.copy-field:focus-within input,
.copy-field:focus-within button {
  border-color: var(--accent);
}
.copy-field:focus-within input {
  outline: 1px solid var(--accent);
  outline-offset: 0;
}
</style>

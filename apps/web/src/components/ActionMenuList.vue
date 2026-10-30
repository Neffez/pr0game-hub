<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import Icon from './Icon.vue';

/** Same shape as MenuItem in ActionMenu.vue (keep in sync). */
export interface ListItem {
  label: string;
  icon?: string;
  onClick?: () => unknown;
  to?: RouteLocationRaw;
  href?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

defineProps<{ items: ListItem[] }>();
const emit = defineEmits<{ close: []; pick: [item: ListItem] }>();
</script>

<template>
  <template v-for="(it, i) in items" :key="i">
    <div v-if="it.divider" class="menu-divider" role="separator" />
    <RouterLink v-if="it.to" :to="it.to" role="menuitem" class="menu-item" :class="{ danger: it.danger }" @click="emit('close')">
      <Icon v-if="it.icon" :name="it.icon" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
    </RouterLink>
    <a v-else-if="it.href" :href="it.href" target="_blank" rel="noopener" role="menuitem" class="menu-item" @click="emit('close')">
      <Icon :name="it.icon ?? 'external'" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
    </a>
    <button
      v-else
      type="button"
      role="menuitem"
      class="menu-item"
      :class="{ danger: it.danger }"
      :aria-disabled="it.disabled || undefined"
      @click="emit('pick', it)"
    >
      <Icon v-if="it.icon" :name="it.icon" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
    </button>
  </template>
</template>

<style scoped>
.menu-item {
  display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 0; padding: 7px 10px; border: 0; border-radius: 6px;
  background: none; color: var(--text); font-size: 13px; text-align: left; text-decoration: none;
}
.menu-item .icon { flex: none; margin-top: 1px; color: var(--muted); }
.menu-item:hover, .menu-item:focus-visible { background: var(--accent-soft); text-decoration: none; outline: none; }
.menu-item.danger, .menu-item.danger .icon { color: var(--neg); }
.menu-item[aria-disabled='true'] { opacity: .45; cursor: default; }
.menu-item small { display: block; font-size: 11px; color: var(--muted); }
.menu-divider { height: 1px; margin: 4px 6px; background: var(--border); }
@media (max-width: 800px) {
  .menu-item { padding: 10px 12px; font-size: 14px; }
}
</style>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import Icon from './Icon.vue';

export interface MenuItem {
  label: string;
  icon?: string;
  /** action, link in the hub or link elsewhere (new tab) */
  onClick?: () => unknown;
  to?: RouteLocationRaw;
  href?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** a line above the item */
  divider?: boolean;
}

/**
 * Overflow menu (three dots, or `label`): fixed position next to its button so scrolling containers don't clip it,
 * closes on a click elsewhere, Esc, scrolling or picking an item. Arrow keys move between the items.
 */
const props = withDefaults(defineProps<{ items: (MenuItem | false | null | undefined)[]; label?: string; icon?: string; title?: string }>(), {
  label: undefined,
  icon: 'more',
  title: undefined,
});
const { t } = useI18n();
const open = ref(false);
const style = ref<Record<string, string>>({});
const button = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const shown = () => props.items.filter((x): x is MenuItem => !!x);

async function toggle() {
  if (open.value) return close();
  const r = button.value!.getBoundingClientRect();
  const below = window.innerHeight - r.bottom > Math.min(320, shown().length * 40 + 16);
  style.value = {
    right: `${Math.max(8, window.innerWidth - r.right)}px`,
    ...(below ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
  };
  open.value = true;
  document.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  await nextTick();
  (menu.value?.querySelector('[role=menuitem]:not([aria-disabled=true])') as HTMLElement | null)?.focus({ preventScroll: true });
}
function close() {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('click', close);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close();
    button.value?.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const all = [...(menu.value?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  }
}
function pick(it: MenuItem) {
  if (it.disabled) return;
  close();
  it.onClick?.();
}
onBeforeUnmount(close);
</script>

<template>
  <button
    ref="button"
    type="button"
    class="menu-btn"
    :class="{ 'icon-btn': !label, active: open }"
    aria-haspopup="menu"
    :aria-expanded="open"
    :title="title ?? t('common.more')"
    :aria-label="title ?? label ?? t('common.more')"
    @click.stop="toggle"
  >
    <Icon :name="icon" />
    <span v-if="label">{{ label }}</span>
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="menu" role="menu" :style="style" @click.stop>
      <template v-for="(it, i) in shown()" :key="i">
        <div v-if="it.divider" class="menu-divider" role="separator" />
        <RouterLink v-if="it.to" :to="it.to" role="menuitem" class="menu-item" :class="{ danger: it.danger }" @click="close">
          <Icon v-if="it.icon" :name="it.icon" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
        </RouterLink>
        <a v-else-if="it.href" :href="it.href" target="_blank" rel="noopener" role="menuitem" class="menu-item" @click="close">
          <Icon :name="it.icon ?? 'external'" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
        </a>
        <button
          v-else
          type="button"
          role="menuitem"
          class="menu-item"
          :class="{ danger: it.danger }"
          :aria-disabled="it.disabled || undefined"
          @click="pick(it)"
        >
          <Icon v-if="it.icon" :name="it.icon" /><span>{{ it.label }}<small v-if="it.hint">{{ it.hint }}</small></span>
        </button>
      </template>
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style scoped>
.menu-btn { display: inline-flex; align-items: center; gap: 6px; }
.menu-btn.active { border-color: var(--accent); color: var(--accent); }
.menu {
  position: fixed; z-index: 50; min-width: 200px; max-width: min(320px, calc(100vw - 16px)); max-height: 70vh; overflow-y: auto; padding: 4px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
}
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

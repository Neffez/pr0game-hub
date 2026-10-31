<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { useMobile } from '../composables';
import ActionMenuList from './ActionMenuList.vue';
import Icon from './Icon.vue';
import Sheet from './Sheet.vue';

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
 * Overflow menu (three dots, or `label` / `#button` slot). On a phone this is the shared bottom sheet;
 * on desktop a fixed popover next to the trigger, clamped to the viewport.
 */
const props = withDefaults(defineProps<{ items: (MenuItem | false | null | undefined)[]; label?: string; icon?: string; title?: string }>(), {
  label: undefined,
  icon: 'more',
  title: undefined,
});
const emit = defineEmits<{ opened: [] }>();
const { t } = useI18n();
const mobile = useMobile();
const open = ref(false);
const style = ref<Record<string, string>>({});
const anchor = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const shown = () => props.items.filter((x): x is MenuItem => !!x);
const sheetTitle = computed(() => props.title ?? props.label ?? t('common.more'));
const trigger = () => anchor.value?.querySelector('button') ?? null;

function place(r: DOMRect) {
  const pad = 8;
  const vh = window.innerHeight;
  const spaceBelow = vh - r.bottom - pad;
  const spaceAbove = r.top - pad;
  const below = spaceBelow >= spaceAbove;
  const maxH = Math.max(160, below ? spaceBelow : spaceAbove);
  style.value = {
    maxHeight: `${maxH}px`,
    ...(below ? { top: `${r.bottom + 4}px`, bottom: 'auto' } : { bottom: `${vh - r.top + 4}px`, top: 'auto' }),
  };
}

function bindPopover() {
  document.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', closeUnlessTyping, true);
  window.addEventListener('resize', closeUnlessTyping);
}

function unbindPopover() {
  document.removeEventListener('click', close);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', closeUnlessTyping, true);
  window.removeEventListener('resize', closeUnlessTyping);
}

/** A form field of the slot (claim box): typing there, not a menu key */
const isField = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest('input, select, textarea');

/** The on-screen keyboard of a tablet resizes and scrolls the page: the menu stays while one of its fields has focus. */
function closeUnlessTyping() {
  const el = document.activeElement;
  if (!(isField(el) && menu.value?.contains(el))) close();
}

async function openPopover() {
  const btn = trigger();
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  place(r);
  open.value = true;
  await nextTick();
  const w = menu.value?.offsetWidth ?? 200;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  style.value = { ...style.value, left: `${Math.max(8, left)}px`, right: 'auto' };
  bindPopover();
  if (!window.matchMedia('(hover: hover)').matches) return;
  await nextTick();
  menu.value?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus({ preventScroll: true });
}

async function toggle() {
  if (open.value) return close();
  emit('opened');
  if (mobile.value) {
    open.value = true;
    return;
  }
  await openPopover();
}

function close() {
  if (!open.value) return;
  open.value = false;
  unbindPopover();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close();
    trigger()?.focus();
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isField(e.target)) {
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

watch(mobile, () => {
  if (open.value) close();
});
onBeforeUnmount(close);
</script>

<template>
  <span ref="anchor" class="menu-wrap">
    <slot name="button" :open="open" :toggle="toggle">
      <button
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
    </slot>
  </span>
  <Sheet v-if="mobile && open" v-model="open" :title="sheetTitle">
    <div ref="menu" class="menu-list" role="menu">
      <ActionMenuList :items="shown()" @close="close" @pick="pick" />
      <slot :close="close" />
    </div>
  </Sheet>
  <Teleport v-else-if="open" to="body">
    <div ref="menu" class="menu" role="menu" :style="style" @click.stop>
      <ActionMenuList :items="shown()" @close="close" @pick="pick" />
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style scoped>
.menu-wrap { display: inline-flex; align-items: center; }
.menu-btn { display: inline-flex; align-items: center; gap: 6px; }
.menu-btn.active { border-color: var(--accent); color: var(--accent); }
.menu {
  position: fixed; z-index: 50; min-width: 200px; max-width: min(320px, calc(100vw - 16px)); max-height: 70vh; overflow-y: auto; padding: 4px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
}
.menu-list { display: flex; flex-direction: column; }
</style>

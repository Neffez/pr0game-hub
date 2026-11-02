<script setup lang="ts">
/** Info icon with the explanation as tooltip (hover, or tap/focus on touch devices). */
import { onBeforeUnmount, ref } from 'vue';

defineProps<{ warn?: boolean }>();

const root = ref<HTMLElement>();
const body = ref<HTMLElement>();
/** Touch phones show the tooltip as a sheet above the tab bar (style.css); there it keeps the CSS position. */
const touchSheet = window.matchMedia('(hover: none) and (max-width: 800px)');

/** Fixed to the viewport, so a scrolling dialog or card does not cut it off: below the icon, above it near the
 *  bottom edge, and shifted left near the right edge. */
function place() {
  const el = root.value;
  const b = body.value;
  if (!el || !b) return;
  if (touchSheet.matches) {
    b.style.cssText = '';
    return;
  }
  b.style.cssText = 'position: fixed; left: 0; top: 0; display: block';
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  const left = Math.max(8, Math.min(r.left - 10, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  b.style.cssText = `position: fixed; left: ${left}px; top: ${top}px`;
}

function show() {
  place();
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
}

function hide() {
  if (root.value?.matches(':hover, :focus')) return;
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
}

onBeforeUnmount(() => {
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <span ref="root" class="hint" :class="{ warn }" tabindex="0" role="note" @mouseenter="show" @focus="show" @mouseleave="hide" @blur="hide">
    {{ warn ? '!' : 'i' }}
    <span ref="body" class="hint-body"><slot /></span>
  </span>
</template>

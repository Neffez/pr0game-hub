<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMobile, useStored } from '../composables';
import Icon from './Icon.vue';

/**
 * Collapsible section: a header button with chevron, title, optional count and actions on the right. With `storeKey`
 * the open state is remembered per device; without a stored choice `defaultOpen` (desktop) / `defaultOpenMobile` apply.
 * `card`: framed like a .card, otherwise a plain heading row.
 */
const props = withDefaults(
  defineProps<{ title: string; storeKey?: string; defaultOpen?: boolean; defaultOpenMobile?: boolean; count?: number | null; card?: boolean; level?: 2 | 3 }>(),
  { storeKey: undefined, defaultOpen: true, defaultOpenMobile: undefined, count: null, card: true, level: 3 },
);
const mobile = useMobile();
const fallback = () => (mobile.value && props.defaultOpenMobile !== undefined ? props.defaultOpenMobile : props.defaultOpen);
// stored: null = no choice yet (follows the defaults), otherwise the viewer's choice
const stored = props.storeKey ? useStored<boolean | null>(`section.${props.storeKey}`, null) : ref<boolean | null>(null);
const open = computed(() => stored.value ?? fallback());
const toggle = () => (stored.value = !open.value);
defineExpose({ open: () => (stored.value = true) });
</script>

<template>
  <section class="section" :class="{ card, open }">
    <div class="section-head" :class="`h${level}`">
      <button type="button" class="section-toggle" :aria-expanded="open" @click="toggle">
        <Icon :name="open ? 'chevronDown' : 'chevronRight'" :size="14" class="section-chevron" />
        <span class="section-title">{{ title }}</span>
        <span v-if="count != null" class="badge section-count">{{ count }}</span>
      </button>
      <slot name="hint" />
      <!-- on the right; below the title when the row is too narrow -->
      <div v-if="$slots.actions" class="section-actions"><slot name="actions" /></div>
    </div>
    <div v-if="open" class="section-body"><slot /></div>
  </section>
</template>

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { useFocusTrap } from '../src/composables';

const tab = (shiftKey = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true }));

describe('useFocusTrap', () => {
  it('moves focus in, cycles Tab inside and gives the focus back on close', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const open = ref(false);
    const Comp = defineComponent({
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useFocusTrap(panel, open);
        return () => h('div', { ref: panel, tabindex: -1 }, [h('button', { id: 'a' }, 'a'), h('button', { id: 'b' }, 'b')]);
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(Comp);
    app.mount(host);
    // happy-dom lays nothing out: count every element as visible
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return document.body; } });

    open.value = true;
    await nextTick();
    await nextTick();
    expect(document.activeElement?.id).toBe('a');
    document.getElementById('b')!.focus();
    tab();
    expect(document.activeElement?.id).toBe('a');
    tab(true);
    expect(document.activeElement?.id).toBe('b');

    open.value = false;
    await nextTick();
    expect(document.activeElement).toBe(outside);
    app.unmount();
  });
});

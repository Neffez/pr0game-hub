// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import Hint from '../src/components/Hint.vue';

function setTouch(on: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: on ? 390 : 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: on ? 844 : 800 });
  window.matchMedia = ((query: string) => {
    const matches = on && query.includes('hover: none') && query.includes('max-width: 800px');
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    };
  }) as typeof window.matchMedia;
}

function mountHint(opts: { touch: boolean; bodyHeight: number }) {
  setTouch(opts.touch);
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(defineComponent({
    setup() {
      return () => h(Hint, null, { default: () => h('p', 'long hint') });
    },
  }));
  app.mount(root);
  const hint = root.querySelector<HTMLElement>('.hint')!;
  const body = root.querySelector<HTMLElement>('.hint-body')!;
  hint.getBoundingClientRect = () => ({
    x: 100, y: 40, width: 16, height: 16, top: 40, left: 100, right: 116, bottom: 56, toJSON() {},
  });
  Object.defineProperty(body, 'offsetWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(body, 'offsetHeight', { configurable: true, get: () => opts.bodyHeight });
  return { app, hint, body };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Hint', () => {
  it('the touch sheet CSS caps height and scrolls', () => {
    const css = readFileSync(join(process.cwd(), 'src/style.css'), 'utf8');
    const block = css.split('@media (hover: none) and (max-width: 800px)')[1] ?? '';
    expect(block).toContain('max-height:');
    expect(block).toContain('overflow-y: auto');
    expect(block).toContain('overscroll-behavior: contain');
  });

  it('on desktop clamps a tooltip taller than the viewport', async () => {
    const { hint, body, app } = mountHint({ touch: false, bodyHeight: 900 });
    hint.dispatchEvent(new Event('mouseenter'));
    await nextTick();
    expect(body.style.position).toBe('fixed');
    expect(body.style.top).toBe('8px');
    expect(body.style.maxHeight).toBe('784px');
    expect(body.style.overflowY).toBe('auto');
    app.unmount();
  });

  it('on desktop places a short tooltip below the icon', async () => {
    const { hint, body, app } = mountHint({ touch: false, bodyHeight: 80 });
    hint.dispatchEvent(new Event('mouseenter'));
    await nextTick();
    expect(body.style.top).toBe('62px');
    expect(body.style.maxHeight).toBe('');
    app.unmount();
  });

  it('on a touch phone leaves position to CSS', async () => {
    const { hint, body, app } = mountHint({ touch: true, bodyHeight: 900 });
    hint.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(body.style.cssText).toBe('');
    app.unmount();
  });
});

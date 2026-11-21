// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import BadgeIcon from '../src/components/BadgeIcon.vue';
import { i18n } from '../src/i18n';

const badge = { key: 'scout' as const, count: 120, level: 1, levels: 7, next: 200, steps: [100, 200, 500, 1000, 2500, 5000, 10000] };

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const onLink = vi.fn();
  createApp(defineComponent({ setup: () => () => h('a', { onClick: onLink }, [h(BadgeIcon, { badge })]) }))
    .use(i18n)
    .mount(root);
  return { icon: root.querySelector<HTMLElement>('.badge-icon')!, onLink };
}
const press = (el: Element, type: string, pointerType = 'touch') =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, clientX: 10, clientY: 10 }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('BadgeIcon', () => {
  it('shows its tooltip as a sheet on a long press with a finger and swallows the click after it', async () => {
    const { icon, onLink } = mount();
    press(icon, 'pointerdown');
    vi.advanceTimersByTime(500);
    await nextTick();
    const tip = document.body.querySelector('.touch-tip');
    expect(tip?.textContent).toContain('120');
    expect(tip?.textContent).toContain('200');
    press(icon, 'pointerup');
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onLink).not.toHaveBeenCalled();
    // the next touch anywhere closes it
    press(document.body, 'pointerdown');
    await nextTick();
    expect(document.body.querySelector('.touch-tip')).toBeNull();
  });

  it('opens nothing on a short tap or with a mouse', async () => {
    const { icon, onLink } = mount();
    press(icon, 'pointerdown');
    vi.advanceTimersByTime(200);
    press(icon, 'pointerup');
    vi.advanceTimersByTime(500);
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onLink).toHaveBeenCalledTimes(1);
    press(icon, 'pointerdown', 'mouse');
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(document.body.querySelector('.touch-tip')).toBeNull();
  });
});

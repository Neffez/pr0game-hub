// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import BashBadge from '../src/components/BashBadge.vue';
import { i18n } from '../src/i18n';

const T0 = 1_800_000_000;
const apps: App[] = [];

function mount(props: { resets: number[]; limit: number; kind: 'player' | 'planet'; compact?: boolean; hideZero?: boolean }) {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(defineComponent({ setup: () => () => h(BashBadge, props) })).use(i18n);
  app.mount(root);
  apps.push(app);
  return root;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 * 1000);
  i18n.global.locale.value = 'de';
});
afterEach(() => {
  // the shared clock stops with its last user and starts again at the next test's time
  for (const app of apps.splice(0)) app.unmount();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('BashBadge', () => {
  it('counts the attacks still within the window and shows when the next one drops out', async () => {
    const root = mount({ resets: [T0 - 60, T0 + 3600, T0 + 7200], limit: 10, kind: 'player' });
    expect(root.querySelector('.bash-count')?.textContent).toBe('Bash 2/10');
    expect(root.textContent).toContain('−1 in 1:00:00');
    expect(root.querySelector('.bash')?.classList.contains('full')).toBe(false);
    // the first one runs out: the count goes down by itself
    vi.advanceTimersByTime(3601 * 1000);
    await nextTick();
    expect(root.querySelector('.bash-count')?.textContent).toBe('Bash 1/10');
  });

  it('marks a reached limit and tells when the next attack is allowed again', () => {
    const root = mount({ resets: [T0 + 600, T0 + 1200, T0 + 1800], limit: 3, kind: 'planet' });
    expect(root.querySelector('.bash-count')?.textContent).toBe('3/3');
    expect(root.querySelector('.bash')?.classList.contains('full')).toBe(true);
    expect(root.textContent).toContain('wieder frei in 0:10:00');
  });

  it('hides without attacks when asked and for a limit of 0', () => {
    expect(mount({ resets: [T0 - 1], limit: 3, kind: 'planet', hideZero: true }).querySelector('.bash')).toBeNull();
    expect(mount({ resets: [T0 + 60], limit: 0, kind: 'player' }).querySelector('.bash')).toBeNull();
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ActionMenu from '../src/components/ActionMenu.vue';
import { i18n, setLocale } from '../src/i18n';

function setMobile(on: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: on ? 390 : 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: on ? 844 : 800 });
  window.matchMedia = ((query: string) => {
    const max = query.match(/max-width:\s*(\d+)px/);
    const matches = max ? (on ? Number(max[1]) >= 800 : window.innerWidth <= Number(max[1])) : query.includes('hover: hover') ? !on : false;
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

function mountMenu(onMobile: boolean, extra?: { left?: number }) {
  setMobile(onMobile);
  setLocale('de');
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });
  const root = document.createElement('div');
  document.body.append(root);
  const picked: string[] = [];
  const Shell = defineComponent({
    setup() {
      return () =>
        h(ActionMenu, {
          title: 'Aktionen',
          items: [
            { label: 'Spionieren', href: 'https://example.test/spy' },
            { label: 'Angreifen', onClick: () => picked.push('attack') },
          ],
        });
    },
  });
  const app = createApp(Shell).use(router).use(i18n);
  app.mount(root);
  const btn = root.querySelector('button')!;
  if (extra?.left != null) {
    btn.getBoundingClientRect = () => ({ x: extra.left!, y: 80, width: 40, height: 24, top: 80, left: extra.left!, right: extra.left! + 40, bottom: 104, toJSON() {} });
  }
  return { root, app, picked, btn };
}

async function open(btn: HTMLButtonElement) {
  btn.click();
  await nextTick();
  await nextTick();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('action menu', () => {
  it('opens a popover on desktop and closes after a pick', async () => {
    const { app, picked, btn } = mountMenu(false);
    await open(btn);
    const pop = document.body.querySelector('.menu')!;
    expect(pop).not.toBeNull();
    expect(document.body.querySelector('.sheet-backdrop')).toBeNull();
    expect(pop.textContent).toContain('Spionieren');
    expect(pop.textContent).toContain('Angreifen');
    [...pop.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent!.includes('Angreifen'))!.click();
    await nextTick();
    expect(picked).toEqual(['attack']);
    expect(document.body.querySelector('.menu')).toBeNull();
    app.unmount();
  });

  it('keeps the desktop popover inside the viewport when the button is on the left', async () => {
    const { app, btn } = mountMenu(false, { left: 4 });
    await open(btn);
    const pop = document.body.querySelector('.menu') as HTMLElement;
    const left = Number.parseFloat(pop.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    app.unmount();
  });

  it('opens a bottom sheet on mobile with the title, not a popover', async () => {
    const { app, btn } = mountMenu(true);
    await open(btn);
    expect(document.body.querySelector('.menu')).toBeNull();
    const sheet = document.body.querySelector('.sheet')!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Aktionen');
    expect(sheet.textContent).toContain('Spionieren');
    expect(sheet.textContent).toContain('Angreifen');
    expect(document.body.querySelector('.sheet-backdrop')).not.toBeNull();
    app.unmount();
  });
});

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

let admin: Record<string, string>;
const groups: Record<string, number> = {};
const call = (method: string, url: string, payload?: object, headers = admin) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });

/** Shipyard 6 on [1:1:1]: enough for the default Optimized Recycler (6/6/6), not for Universe 7's 8/8/9. */
const empire = {
  kind: 'empire', research: { 110: 8, 117: 9 },
  planets: [{
    name: 'Home', coords: { g: 1, s: 1, p: 1 }, type: 'planet', values: { 21: 6 }, fields: { used: 10, max: 163 },
    resources: { 901: 1e6, 902: 1e6, 903: 1e6 }, perHour: { 901: 0, 902: 0, 903: 0 }, building: null, temp: 40,
  }],
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
  admin = { cookie: `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}` };
  for (const slug of ['u7', 'u8']) {
    await call('POST', '/admin/universes', { slug, name: slug });
    groups[slug] = (await call('POST', '/admin/groups', { universe: slug, name: 'A' })).json().id;
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, 1)').run(groups[slug]);
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, ?)').run(groups[slug], Math.floor(Date.now() / 1000), JSON.stringify(empire));
  }
});

const ships = async (slug: string) => {
  const res = await call('GET', `/${slug}/buildings`, undefined, { ...admin, 'x-hub-group': String(groups[slug]) });
  expect(res.json().units).toBeUndefined();
  return res;
};

describe('units per universe', () => {
  it('starts with the defaults', async () => {
    const res = (await call('GET', '/admin/universes/u8/units')).json();
    expect(res.overrides).toEqual({});
    expect(res.units[227].req).toEqual({ 21: 6, 110: 6, 117: 6 });
    expect(res.defaults[231].name.de).toBe('Behemoth');
  });

  it('stores validated changes of one universe and leaves the others alone', async () => {
    expect((await call('PUT', '/admin/universes/u8/units', { units: { 227: { cost: [1] } } })).json()).toMatchObject({ code: 'units_invalid' });
    expect((await call('PUT', '/admin/universes/u7/units', { units: { 227: { req: { 21: 8, 110: 8, 117: 9 } } } })).statusCode).toBe(200);
    const res = await call('PUT', '/admin/universes/u8/units', {
      units: {
        231: { hidden: true },
        233: { name: { de: 'Sternenbrecher', en: 'Star Breaker' }, cost: [1500000, 750000, 250000], req: { 21: 10 } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().units[231]).toBeUndefined();
    expect(res.json().units[233].cost).toEqual([1500000, 750000, 250000]);
    expect((await call('GET', '/admin/universes/u7/units')).json().units[227].req).toEqual({ 21: 8, 110: 8, 117: 9 });
    const ctx = (await call('GET', '/u8/context', undefined, { ...admin, 'x-hub-group': String(groups.u8) })).json();
    expect(ctx.universe.units[231]).toEqual({ hidden: true });
  });

  it('the ships tab follows the universe: requirements, hidden and new units', async () => {
    // the ships tab is computed in the web app; the server's ship list feeds the build order notifications
    const { planetShips, buildingsState } = await import('../src/repo/buildings.js');
    const { resolveGroup, getUniverse } = await import('../src/context.js');
    const user = { id: 1, username: 'admin', isAdmin: true } as never;
    const tab = (slug: string) => {
      const ctx = resolveGroup(db, user, getUniverse(db, slug), groups[slug]);
      const state = buildingsState(db, ctx, 1);
      return planetShips(state, state.planets[0], ctx.now);
    };
    await ships('u8');
    const u8 = tab('u8');
    const u7 = tab('u7');
    expect(u8.find((s) => s.id === 227)?.state).not.toBe('requirements');
    expect(u7.find((s) => s.id === 227)?.state).toBe('requirements');
    expect(u8.some((s) => s.id === 231)).toBe(false);
    expect(u7.some((s) => s.id === 231)).toBe(true);
    expect(u8.find((s) => s.id === 233)?.cost).toEqual({ 901: 1500000, 902: 750000, 903: 250000 });
  });

  it('parses pasted pages; an info page finds a new unit by an earlier name', async () => {
    const yard = (await call('POST', '/admin/universes/u7/units/parse', { html: fixture('shipyard-template.html') })).json();
    expect(yard).toMatchObject({ kind: 'shipyard', units: [{ id: 202 }, { id: 233, name: 'Sternenbrecher' }] });
    const info = (name: string) => fixture('info-222-template.html').replace('<th>Schwerer Kreuzer</th>', `<th>${name}</th>`);
    expect((await call('POST', '/admin/universes/u7/units/parse', { html: info('Nebelkreuzer') })).json()).toMatchObject({ units: [], unknown: ['Nebelkreuzer'] });
    const named = await call('POST', '/admin/universes/u7/units/parse', { html: info('Nebelkreuzer'), names: { Nebelkreuzer: 234 } });
    expect(named.json().units[0]).toMatchObject({ id: 234, attack: 620 });
    // u8 has the name among its units (ids are the same in every universe, so u7 finds it too)
    expect((await call('POST', '/admin/universes/u8/units/parse', { html: info('Sternenbrecher') })).json().units[0]).toMatchObject({ id: 233 });
    expect((await call('POST', '/admin/universes/u7/units/parse', { html: info('Sternenbrecher') })).json().units[0]).toMatchObject({ id: 233 });
    expect((await call('POST', '/admin/universes/u8/units/parse', { html: '<p>x</p>' })).json()).toMatchObject({ code: 'units_page_unknown' });
  });

  it('needs a global admin', async () => {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)').run('carol', hashPassword('carolpass'));
    const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'carol', password: 'carolpass' } });
    const carol = { cookie: `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}` };
    expect((await call('GET', '/admin/universes/u8/units', undefined, carol)).statusCode).toBe(403);
    expect((await call('PUT', '/admin/universes/u8/units', { units: {} }, carol)).statusCode).toBe(403);
  });
});

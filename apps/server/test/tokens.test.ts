import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'hub_session')!;
  return { cookie: `hub_session=${cookie.value}` };
}

let admin: { cookie: string };
let groupA: number;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  admin = await login('admin', 'adminpass');
  const h = { headers: admin };
  expect((await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h })).statusCode).toBe(200);
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
});

describe('api tokens', () => {
  it('serves OpenAPI without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(doc.paths['/api/{uni}/imperium']).toBeTruthy();
    expect(doc.paths['/api/catalog']).toBeTruthy();
  });

  it('creates, uses and revokes a read-only token', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/hub/api/auth/tokens',
      headers: admin,
      payload: { name: 'test' },
    });
    expect(create.statusCode).toBe(200);
    const { token, id } = create.json();
    expect(token).toMatch(/^hubpat_/);

    const bearer = { authorization: `Bearer ${token}` };
    const me = await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: bearer });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('admin');

    const overview = await app.inject({
      method: 'GET',
      url: '/hub/api/u8/overview',
      headers: { ...bearer, 'x-hub-group': String(groupA) },
    });
    expect(overview.statusCode).toBe(200);

    const catalog = await app.inject({ method: 'GET', url: '/hub/api/catalog', headers: bearer });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().names.de).toBeTruthy();

    const write = await app.inject({
      method: 'POST',
      url: '/hub/api/u8/ingest',
      headers: { ...bearer, 'x-hub-group': String(groupA) },
      payload: { text: 'x' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe('read_only_token');

    const manage = await app.inject({
      method: 'POST',
      url: '/hub/api/auth/tokens',
      headers: bearer,
      payload: { name: 'nope' },
    });
    expect(manage.statusCode).toBe(403);
    expect(manage.json().code).toBe('read_only_token');

    const del = await app.inject({ method: 'DELETE', url: `/hub/api/auth/tokens/${id}`, headers: admin });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/hub/api/u8/overview',
      headers: { ...bearer, 'x-hub-group': String(groupA) },
    });
    expect(after.statusCode).toBe(401);
  });

  it('lists tokens without secrets', async () => {
    const created = await app.inject({ method: 'POST', url: '/hub/api/auth/tokens', headers: admin, payload: { name: 'listed' } });
    const list = await app.inject({ method: 'GET', url: '/hub/api/auth/tokens', headers: admin });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.some((r: { name: string; token?: string }) => r.name === 'listed' && r.token === undefined)).toBe(true);
    await app.inject({ method: 'DELETE', url: `/hub/api/auth/tokens/${created.json().id}`, headers: admin });
  });
});

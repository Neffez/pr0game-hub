import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { anonymizePage } = await import('../src/repo/samples.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let admin: Record<string, string>;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}

const SHIPYARD = `<html lang="de"><head><script>var token="abc";</script></head><body id="shipyard">
  <a href="game.php?page=shipyard&session=s3cr3t">Schiffswerft</a> CarolInGame baut <input name="fmenge[202]" value="25"> Kleine Transporter
  carol@example.org</body></html>`;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid;
  const adminCookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie: adminCookie } });
  const group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie: adminCookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'CarolInGame')").run(group, carolId);
  admin = { cookie: adminCookie };
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('explained pastes and parser samples (E-4)', () => {
  it('explains a page without data in the preview', async () => {
    const res = (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { html: SHIPYARD, dryRun: true } })).json();
    expect(res.pageType).toBe('unknown');
    expect(res.explain).toEqual({ code: 'unsupported_page', page: 'shipyard' });
    const text = (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { text: 'kein Spiel hier, nur ein ganz normaler Satz über nichts', dryRun: true } })).json();
    expect(text.explain).toEqual({ code: 'not_game' });
  });

  it('stores an anonymized sample that only hub admins see', async () => {
    const sent = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest/sample', headers: carol, payload: { html: SHIPYARD, note: 'Werft' } });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().explain.code).toBe('unsupported_page');
    expect((await app.inject({ method: 'GET', url: '/hub/api/admin/parser-samples', headers: carol })).statusCode).toBe(403);
    const list = (await app.inject({ method: 'GET', url: '/hub/api/admin/parser-samples', headers: admin })).json();
    expect(list).toEqual([expect.objectContaining({ username: 'carol', code: 'unsupported_page', page: 'shipyard', note: 'Werft', universe: 'u8' })]);
    const page = (await app.inject({ method: 'GET', url: `/hub/api/admin/parser-samples/${list[0].id}`, headers: admin })).body;
    expect(page).not.toMatch(/s3cr3t|token="abc"|CarolInGame|carol@example|value="25"/);
    expect(page).toContain('Sender baut');
    expect(page).toContain('<body id="shipyard">');
    await app.inject({ method: 'DELETE', url: `/hub/api/admin/parser-samples/${list[0].id}`, headers: admin });
    expect((await app.inject({ method: 'GET', url: '/hub/api/admin/parser-samples', headers: admin })).json()).toEqual([]);
  });

  it('replaces whole names only', () => {
    expect(anonymizePage('Bob und Bobby, Bob.', ['Bob'])).toBe('Sender und Bobby, Sender.');
  });
});

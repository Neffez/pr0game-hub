import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { statSlots } = await import('../src/domain/stats.js');

const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

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
let groupB: number;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  admin = await login('admin', 'adminpass');
  const h = { headers: admin };
  expect((await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h })).statusCode).toBe(200);
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
});

describe('api', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('ingests stats and computes deltas', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const html = fixture('stats-player.html');
    // Older snapshot (type 2, 6h earlier) with lower points via text edit of the fixture.
    const older = html.replace('12:00:03', '06:00:03').replace('1.234.567', '1.000.000');
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: older } });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.player_scores).toEqual({ new: 3, duplicate: 0 });
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    expect(res.json().counts.player_scores).toEqual({ new: 3, duplicate: 0 });
    // Same paste again -> duplicates only.
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    expect(res.json().counts.player_scores).toEqual({ new: 0, duplicate: 3 });

    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const alpha = ov.players.find((p: any) => p.name === 'Alpha');
    expect(alpha.ingame_id).toBe(1234);
    expect(alpha.ally_name).toBe('Die Allianz');
    expect(alpha.scores[2]).toMatchObject({ points: 1234567, rankChange: 3 });
    expect(alpha.scores[2].deltas['6h']).toMatchObject({ delta: 234567, partial: false });
    // Only 6h of history: the 24h delta falls back to the oldest snapshot.
    expect(alpha.scores[2].deltas['24h']).toMatchObject({ delta: 234567, partial: true });
    // FF-Hub style slots per statistics update: newest update against the one before; no older update yet
    expect(alpha.scores[2].slots[0]).toMatchObject({ delta: 234567 });
    expect(alpha.scores[2].slots[1]).toBeNull();
  });

  it('matches plain-text players by name to existing ids', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('stats-player.txt') } });
    expect(res.json().counts.player_scores.new).toBe(3);
    const players = db.prepare('SELECT COUNT(*) FROM players WHERE group_id = ?').pluck().get(groupA);
    expect(players).toBe(3);
  });

  it('ingests messages and serves spy history, expeditions and deck', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } });
    expect(res.json().counts).toMatchObject({
      spy_reports: { new: 1 }, battle_reports: { new: 1 }, expeditions: { new: 3 }, hostile_spying: { new: 1 }, recycle_reports: { new: 1 },
    });
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/1/234/5', headers })).json();
    expect(spy.total).toBe(1);
    expect(spy.reports[0].sections['900']['901']).toBe(1234567);

    const deck = (await app.inject({ method: 'GET', url: '/hub/api/u8/deck', headers })).json();
    expect(deck.state.drawnInDeck).toBe(3);

    const raids = (await app.inject({ method: 'GET', url: '/hub/api/u8/raids', headers })).json();
    expect(raids.perUser[0]).toMatchObject({ raids: 1, metal: 600000 });
    expect(raids.recyclePerUser[0]).toMatchObject({ runs: 1, metal: 80000, crystal: 25000, left: 3895000 });
    const activity = (await app.inject({ method: 'GET', url: '/hub/api/u8/activity?kinds=debris_shrunk', headers })).json();
    expect(activity.entries[0].data).toMatchObject({ metal: 2920000, crystal: 975000, collected: { metal: 80000, crystal: 25000 }, by: 'admin' });

    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const planet = ov.planets.find((p: any) => p.g === 1 && p.s === 234 && p.p === 5);
    expect(planet).toMatchObject({ type: 'planet', name: 'Heimat' });
    // 15 small cargos at 4000 resources each
    expect(planet.spy).toMatchObject({ res: { 901: 1234567 }, fleet: 60, defense: 0 });
  });

  it('imports universe.json without overwriting fresher views', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const text = fixture('universe.json');
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text } });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.galaxy_systems).toEqual({ new: 2, duplicate: 0 });
    const planet = db.prepare('SELECT * FROM planets WHERE group_id = ? AND g = 1 AND s = 234 AND p = 5').get(groupA) as any;
    expect(planet).toMatchObject({ name: 'Heimat', has_moon: 1 });
    // An older export is skipped
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: text.replaceAll('"timepoint": 1792', '"timepoint": 1791') } });
    expect(res.json().counts.galaxy_systems).toEqual({ new: 0, duplicate: 2 });
    // Names from an export older than the stats don't rename the player, they become aliases.
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: text.replaceAll('"Alpha"', '"AltAlpha"').replaceAll('"timepoint": 1792569600000', '"timepoint": 1792570000000') } });
    const alpha = db.prepare('SELECT id, name FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupA) as any;
    expect(alpha.name).toBe('Alpha');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(alpha.id)).toContain('AltAlpha');
    // universe browser: system view and the per-galaxy navigation strip
    const sys = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/234', headers })).json();
    expect(sys.view.seen_at).toBe(1792570000);
    expect(sys.rows.find((r: any) => r.p === 5)).toMatchObject({ name: 'Heimat', has_moon: 1, player_name: 'Alpha', ally_name: 'Die Allianz' });
    const strip = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1', headers })).json();
    expect(strip.planets['234']).toBe(2);
    expect(strip.seen['235']).toBe(1792483200);
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: '{}' } });
    expect(res.statusCode).toBe(400);
  });

  it('serves the latest empire and overview page for the live imperium view', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    for (const f of ['empire-real-source.html', 'overview.html']) {
      const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture(f) } });
      expect(res.statusCode).toBe(200);
    }
    const im = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    // page times (Berlin) become the snapshot times
    expect(im.empire.time).toBe(Date.UTC(2026, 9, 21, 11, 43, 45) / 1000);
    expect(im.empire.data.planets[0].perHour).toEqual({ 901: 38369 });
    expect(im.overview.time).toBe(Date.UTC(2026, 9, 21, 12, 0, 0) / 1000);
    expect(im.overview.data.queues).toHaveLength(5);
  });

  it('lists phalanxes that reach a system', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const empire = { kind: 'empire', research: {}, planets: [
      { name: 'Mondi', coords: { g: 1, s: 200, p: 4 }, type: 'moon', values: { 41: 4, 42: 3 } },
    ] };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, ?)').run(groupA, 1893456000, JSON.stringify(empire));
    // level 3: (9 - 1) = 8 systems in both directions
    const near = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/208', headers })).json();
    expect(near.phalanx).toEqual([expect.objectContaining({ s: 200, p: 4, level: 3, range: 8, from: 192, to: 208, source: 'empire', own: true })]);
    const far = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/209', headers })).json();
    expect(far.phalanx).toEqual([]);
  });

  it('shows known research and moon phalanx levels on the player page', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const alpha = db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupA) as { id: number };
    const insert = db.prepare(
      `INSERT INTO spy_reports (group_id, user_id, g, s, p, planet_type, player_name, player_id, report_time, sections) VALUES (?, 1, 1, 234, 5, ?, 'Alpha', ?, ?, ?)`,
    );
    insert.run(groupA, 'planet', alpha.id, 1792500000, JSON.stringify({ 900: {}, 100: { 109: 12, 118: 7 } }));
    insert.run(groupA, 'moon', alpha.id, 1792510000, JSON.stringify({ 900: {}, 0: { 41: 3, 42: 4 } }));
    const res = (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${alpha.id}`, headers })).json();
    expect(res.research).toEqual({ values: { 109: 12, 118: 7 }, time: 1792500000, source: 'spy' });
    expect(res.phalanx['1:234:5']).toEqual({ level: 4, time: 1792510000, source: 'spy' });
  });

  it('writes the activity log while syncing', async () => {
    const groupC = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'C' }, headers: admin })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupC) };
    const ingest = async (payload: object) => {
      const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload });
      expect(res.statusCode).toBe(200);
    };

    // galaxy: system known without the planet, then with planet + moon
    const galaxy = fixture('galaxy.html');
    await ingest({ html: galaxy.replace(/<div class="galaxy-grid-row even" data-info="p_5">[\s\S]*?(?=<div class="galaxy-grid-row empty odd" data-info="p_7">)/, '') });
    await ingest({ html: galaxy });

    // total points: same for 6 h (no growth), then a loss
    const stats = (time: string, points: string) =>
      fixture('stats-player.html')
        .replace('12:00:03', time)
        .replace('1.234.567', points)
        .replace('<option value="1">Punkte</option><option value="2" selected="selected">Flotte</option>', '<option value="1" selected="selected">Punkte</option><option value="2">Flotte</option>');
    await ingest({ html: stats('00:00:03', '1.000.000') });
    await ingest({ html: stats('06:00:03', '1.000.000') });
    await ingest({ html: stats('12:00:03', '900.000') });

    // phalanx: first seen with level 2, later level 4
    const spyMoon = (time: string, level: number) =>
      `<div id="message_9${level}" class="message-item"><div class="message-date">21. Okt 2026, ${time}</div><div class="message-content"><div class="spyRaport">` +
      `<div class="spyRaportHead"><a>Spionagebericht vom Mond Mondi (Alpha) [1:234:5] am 21. Okt 2026, ${time}</a></div>` +
      `<div class="spyRaportContainer"><div class="spyRaportContainerHead spyRaportContainerHeadClass0">Gebäude</div>` +
      `<div class="spyRaportContainerRow"><div class="spyRaportContainerCell">Sensorphalanx</div><div class="spyRaportContainerCell" data-info="0_42">${level}</div></div></div>` +
      `</div></div></div>`;
    await ingest({ html: spyMoon('08:00:00', 2) });
    await ingest({ html: spyMoon('09:00:00', 4) });

    // debris: grown, then reduced, then gone
    await ingest({ html: galaxy.replace('1.2K', '2.5K') });
    await ingest({ html: galaxy.replace('1.2K', '900') });
    await ingest({ html: galaxy.replace('1.2K / 300', '') });

    const log = (await app.inject({ method: 'GET', url: '/hub/api/u8/activity', headers })).json();
    const kinds = log.entries.map((e: any) => [e.kind, e.player_name, e.data.hours ?? e.data.level ?? e.data.delta ?? null]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['planet_new', 'Alpha', null],
        ['moon_new', 'Alpha', null],
        ['no_growth', 'Alpha', 6],
        ['no_growth', 'Alpha', 12],
        ['points_loss', 'Alpha', -100000],
        ['phalanx_new', 'Alpha', 2],
        ['phalanx_up', 'Alpha', 4],
      ]),
    );
    const debris = log.entries.filter((e: any) => e.kind.startsWith('debris_')).map((e: any) => [e.kind, e.data.metal ?? null]).reverse();
    expect(debris).toEqual([
      ['debris_new', 1200],
      ['debris_grown', 2500],
      ['debris_shrunk', 900],
      ['debris_cleared', null],
    ]);
    expect(log.counts.no_growth).toBe(2);
    // filter by kind
    const only = (await app.inject({ method: 'GET', url: '/hub/api/u8/activity?kinds=phalanx_new,phalanx_up', headers })).json();
    expect(only.entries.map((e: any) => e.kind).sort()).toEqual(['phalanx_new', 'phalanx_up']);

    // backfill recreates the stats/spy based entries (galaxy changes can't be replayed)
    db.prepare("DELETE FROM activity_log WHERE group_id = ? AND kind NOT IN ('planet_new', 'moon_new', 'debris_new')").run(groupC);
    const res = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupC}/activity/backfill`, headers: admin, payload: {} });
    expect(res.json().added).toBe(5);
    const again = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupC}/activity/backfill`, headers: admin, payload: {} });
    expect(again.json().added).toBe(0);
  });

  it('archives battle hall reports and pages through them', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('battlehall.html') } });
    expect(res.json().counts.battle_hall).toEqual({ new: 4, duplicate: 0 });
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('battlehall.html') } });
    expect(res.json().counts.battle_hall).toEqual({ new: 0, duplicate: 4 });
    const hall = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall', headers })).json();
    expect(hall).toMatchObject({ total: 4, pages: 1 });
    expect(hall.entries.map((e: any) => e.units)).toEqual([1075302000, 276316000, 260583000, 25541000]);
    const anda = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall?q=Anda&sort=time', headers })).json();
    expect(anda.entries.map((e: any) => e.report_id.slice(0, 4))).toEqual(['778f', '4a2c']);
  });

  it('archives battle reports with the background worker', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const { step, crawlerState } = await import('../src/crawler.js');
    const log = { info: () => {}, warn: () => {} };
    await app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers: admin, payload: { settings: { gameUrl: 'https://pr0game.com/uni8/' } } });
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return { ok: true, text: async () => (url.includes('93a44dd0') ? fixture('raport-public.html') : 'Invalid Battle Report ID') };
    }) as unknown as typeof fetch;
    // newest hall entry first (20 Oct), then the others are already deleted in the game
    // game unreachable / maintenance page: pause without spending the report's tries
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const maintenance = (async () => ({ ok: true, text: async () => '<title>Wartung</title>' })) as unknown as typeof fetch;
    expect(await step(db, log, down)).toBe('transient');
    // the universe is paused now and skipped; other universes would keep going
    expect(crawlerState.get(1)).toMatchObject({ failures: 1, lastError: 'ECONNREFUSED', stopped: false });
    expect(await step(db, log, fetcher)).toBe('idle');
    crawlerState.clear();
    expect(await step(db, log, maintenance)).toBe('transient');
    expect(crawlerState.get(1)?.lastError).toBe('no report page (maintenance?)');
    crawlerState.clear();
    // attacker shot down in the first round: no report in the game, final instead of pausing
    const lostContact = (async () => ({
      ok: true,
      text: async () => '<title>Info - Universum 8</title> Contact with the attacking fleet was lost (i.e. it was shot down in the first round).',
    })) as unknown as typeof fetch;
    expect(await step(db, log, lostContact)).toBe('done');
    expect(crawlerState.size).toBe(0);
    const lost = db.prepare("SELECT report_id FROM battle_hall WHERE group_id = ? AND report_status = 'lost'").pluck().all(groupA) as string[];
    expect(lost).toHaveLength(1);
    db.prepare('UPDATE battle_hall SET report_status = NULL, report_tries = 0 WHERE group_id = ?').run(groupA);
    expect(db.prepare("SELECT MAX(report_tries) FROM battle_hall WHERE group_id = ?").pluck().get(groupA)).toBe(0);
    // the same report in the hall of another alliance of the universe is fetched once
    db.prepare(
      `INSERT INTO battle_hall (group_id, report_id, time, attackers, defenders, winner, units)
       SELECT ?, report_id, time, attackers, defenders, winner, units FROM battle_hall WHERE group_id = ? AND report_id LIKE '93a4%'`,
    ).run(groupB, groupA);

    expect(await step(db, log, fetcher)).toBe('done');
    expect(urls[0]).toBe('https://pr0game.com/uni8/game.php?page=raport&raport=93a44dd012ff05992739d1afd749df1d');
    for (let i = 0; i < 3; i++) await step(db, log, fetcher);
    expect(await step(db, log, fetcher)).toBe('idle');
    expect(urls.filter((u) => u.includes('93a44dd0'))).toHaveLength(1);
    expect(db.prepare('SELECT group_id FROM combat_reports ORDER BY group_id').pluck().all()).toEqual([groupA, groupB]);

    const report = (await app.inject({ method: 'GET', url: '/hub/api/u8/combat-reports/93a44dd012ff05992739d1afd749df1d', headers })).json();
    expect(report).toMatchObject({ winner: 'attacker', lost_attacker: 3280000, debris_metal: 3560500, units: 25541000 });
    expect(report.fleets[0]).toMatchObject({ side: 'attacker', name: 'pUsteblUme' });
    expect(report.fleets[0].ships).toContainEqual({ id: 207, before: 6445, after: 6402 });
    const hall = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall', headers })).json();
    expect(hall.entries.map((e: any) => [e.report_id.slice(0, 4), e.archived, e.report_status])).toEqual([
      ['1528', 0, 'gone'], ['4a2c', 0, 'gone'], ['778f', 0, 'gone'], ['93a4', 1, 'archived'],
    ]);
  });

  it('keeps groups isolated', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupB) };
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players).toEqual([]);
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/1/234/5', headers })).json();
    expect(spy.total).toBe(0);
  });

  it('invites a member who only sees their group', async () => {
    const inv = (await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupB}/invites`, headers: admin, payload: {} })).json();
    const res = await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'bob', password: 'bobpass12' } });
    expect(res.statusCode).toBe(200);
    const bob = await login('bob', 'bobpass12');
    const forbidden = await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers: { ...bob, 'x-hub-group': String(groupA) } });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers: bob });
    expect(ok.json().group.id).toBe(groupB);
    // Invite is single use.
    const again = await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'eve', password: 'evepass12' } });
    expect(again.statusCode).toBe(404);
  });

  it('ingests a galaxy view and needs a session', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/hub/api/u8/ingest',
      headers: { ...admin, 'x-hub-group': String(groupA) },
      payload: { html: fixture('galaxy.html') },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pageType).toBe('galaxy');
    const views = (await app.inject({ method: 'GET', url: '/hub/api/u8/galaxy-views', headers: { ...admin, 'x-hub-group': String(groupA) } })).json();
    expect(views).toHaveLength(2); // 1:234 again (newer than the universe.json) and 1:235 from the universe.json
    expect((await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', payload: { html: '<p>x</p>' } })).statusCode).toBe(401);
  });
});

describe('review fixes', () => {
  it('rate limits failed logins', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'nobody', password: 'x' } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('rate limits failed logins per IP across usernames', async () => {
    const attempt = async (username: string) =>
      (await app.inject({ method: 'POST', url: '/hub/api/auth/login', remoteAddress: '10.0.0.9', payload: { username, password: 'x' } })).statusCode;
    for (let i = 0; i < 30; i++) expect(await attempt(`user${i}`)).toBe(401);
    expect(await attempt('another')).toBe(429);
  });

  it('ingests English stats (date without dot, huge points)', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'English' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('stats-en-testserver.html') } });
    expect(res.json().warnings).toEqual([]);
    expect(res.json().counts.player_scores).toEqual({ new: 4, duplicate: 0 });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players.find((p: any) => p.name === 'Gottkaiser')).toMatchObject({ ingame_id: 214 });
    expect(ov.players.find((p: any) => p.name === 'reflex').scores['1'].points).toBeGreaterThan(1.8e18);
    // statistics page: latest snapshot of the category in game order
    const stats = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=1', headers })).json();
    expect(stats.rows.map((r: any) => [r.rank, r.name])).toEqual([[1, 'reflex'], [2, 'Gottkaiser'], [11, 'Virus'], [88, 'test123']]);
    expect(stats.rows[1]).toMatchObject({ ally_name: 'F1337erB0yz', points: 449037461141982, status: [] });
    expect(stats.categories).toEqual([{ who: 'player', type: 1, stat_time: stats.statTime, pages: [0] }]);
    const empty = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=alliance&type=2', headers })).json();
    expect(empty).toMatchObject({ statTime: null, rows: [] });
  });

  it('serves the statistics page: honor points, alliances, changes and own reference', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Stats' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const ingest = async (html: string) => (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } })).json();
    // the admin plays "Gottkaiser" in this alliance
    await app.inject({ method: 'PUT', url: `/hub/api/admin/groups/${groupX}/members/1`, headers: admin, payload: { ingameName: 'Gottkaiser' } });

    expect((await ingest(fixture('stats-honor.html'))).warnings).toEqual([]);
    const honor = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=6', headers })).json();
    expect(honor.rows.map((r: any) => [r.rank, r.rank_change, r.name, r.title, r.points])).toEqual([
      [1, 2, 'Gottkaiser', 'Gott-Imperator', 12345],
      [2, 0, 'Virus', null, 0],
      [3, -3, 'reflex', 'Banditen-Imperator', -4200],
    ]);
    expect(honor.rows[0]).toMatchObject({ own: true, ownAlly: true, member: 1 });

    // total points twice: change against the previous stand, all categories per player
    const en = fixture('stats-en-testserver.html');
    await ingest(en.replace('22:55:25', '16:55:25').replace('449.037.461.141.982', '449.037.461.000.000'));
    await ingest(en);
    const total = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=1', headers })).json();
    const gk = total.rows.find((r: any) => r.name === 'Gottkaiser');
    expect(gk).toMatchObject({ delta: 141982, prev_rank: 2, scores: { 1: 449037461141982 } });
    expect(total.me).toMatchObject({ points: { 1: 449037461141982 } });
    expect(total.prevTime).toBeLessThan(total.statTime);
    expect(total.categories.find((c: any) => c.type === 1)).toMatchObject({ who: 'player', pages: [0] });

    expect((await ingest(fixture('stats-alliance.html'))).warnings).toEqual([]);
    const allys = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=alliance&type=1', headers })).json();
    expect(allys.rows.map((r: any) => [r.rank, r.name, r.members, r.points, r.own])).toEqual([
      [1, 'F1337erB0yz', 12, 1234567, true],
      [2, 'Sinnlos im Weltraum', 3, 45000, false],
    ]);
  });

  it('puts the Δ columns on the 6 h statistics grid, a missed update leaves its column empty', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Grid' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const en = fixture('stats-en-testserver.html');
    // updates at 22:55 (newest), 10:55 and 04:55; the one at 16:55 was not synced
    const at = (time: string, points: string) => en.replace('22:55:25', time).replace('267.637.157', points);
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('04:55:25', '266.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('10:55:25', '267.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: en } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const virus = ov.players.find((p: any) => p.name === 'Virus');
    const [s0, s1, s2, s3] = virus.scores[1].slots;
    expect(s0).toMatchObject({ delta: 637157, ...ov.slots[0] });
    expect(s0.to - s0.from).toBe(12 * 3600);
    expect(s1).toBeNull();
    expect(s2).toMatchObject({ delta: 1000000 });
    expect(s2.to - s2.from).toBe(6 * 3600);
    expect(s3).toBeNull();
    expect(ov.slots[1]).toBeNull();
  });

  it('finds Δ references older than the loaded week of statistics', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Week' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const html = fixture('stats-player.html');
    const at = (time: string, points: string) => html.replace('21. Okt 2026, 12:00:03', time).replace('1.234.567', points);
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('12. Okt 2026, 12:00:03', '1.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('21. Okt 2026, 06:00:03', '1.200.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const { deltas } = ov.players.find((p: any) => p.name === 'Alpha').scores[2];
    expect(deltas['6h']).toMatchObject({ delta: 34567, partial: false });
    expect(deltas['48h']).toMatchObject({ delta: 234567, partial: false });
    expect(deltas['7d']).toMatchObject({ delta: 234567, partial: false });
  });

  it('lists known players in the overview even without synced statistics', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'No stats' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players.length).toBeGreaterThan(0);
    expect(ov.players.every((p: any) => Object.keys(p.scores).length === 0)).toBe(true);
    expect(ov.planets.length).toBeGreaterThan(0);
  });

  it('maps statistics updates onto the 6 h grid', () => {
    const h = 3600;
    const t0 = 1_800_000_000;
    // consecutive updates
    expect(statSlots([t0, t0 - 6 * h, t0 - 12 * h]).map((s) => s && (s.to - s.from) / h)).toEqual([6, 6, null, null]);
    // more frequent updates (test server): the one closest to each grid point counts
    expect(statSlots([t0, t0 - h, t0 - 5 * h, t0 - 6 * h - 60])[0]).toEqual({ from: t0 - 6 * h - 60, to: t0 });
    // off the grid (test server): 14.5 h back belongs to the 12 h point, the change goes into the first column
    expect(statSlots([t0, t0 - 14.5 * h])).toEqual([{ from: t0 - 14.5 * h, to: t0 }, null, null, null]);
    // gap of more than the four columns: nothing to show
    expect(statSlots([t0, t0 - 30 * h])).toEqual([null, null, null, null]);
  });

  it('counts manually added expedition events in the deck', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Deck' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const add = (payload: object) => app.inject({ method: 'POST', url: '/hub/api/u8/deck/events', headers, payload });
    const deck = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/deck', headers })).json();

    const first = await add({ event: 'Res', size: 'Small' });
    expect(first.statusCode).toBe(200);
    expect((await add({ event: 'Nothing', size: 'None', depletion: 'few' })).statusCode).toBe(200);
    expect((await add({ event: 'Res', size: 'Huge' })).statusCode).toBe(400);
    expect((await add({ event: 'Res', size: 'Small', depletion: 'few' })).statusCode).toBe(400);

    let d = await deck();
    expect(d.state.events).toBe(2);
    expect(d.state.cards.find((c: any) => c.key.includes('Res') && c.key.includes('Small')).remaining).toBe(328);
    expect(d.lastEvents[0]).toMatchObject({ event: 'Nothing', depletion: 'few', manual: 1 });

    // only manual entries of the own deck can be removed
    const synced = db.prepare("INSERT INTO expeditions (group_id, user_id, dedupe_key, time, event, size) VALUES (?, 1, 'm1', 1, 'Res', 'Small')").run(groupX).lastInsertRowid;
    expect((await app.inject({ method: 'DELETE', url: `/hub/api/u8/deck/events/${synced}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/hub/api/u8/deck/events/${first.json().id}`, headers })).statusCode).toBe(200);
    d = await deck();
    expect(d.state.events).toBe(2); // the synced one + the manual "Nothing"
  });

  it('keeps moon names from the galaxy view', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Moons' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const moonOf = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/234', headers })).json().rows.find((r: any) => r.p === 5);
    expect(await moonOf()).toMatchObject({ has_moon: 1, moon_name: 'Luna Prime' });
    // a newer universe.json (no moon names) keeps the known name
    const newer = fixture('universe.json').replaceAll('"timepoint": 1792569600000', '"timepoint": 4102444800000');
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: newer } });
    expect(await moonOf()).toMatchObject({ has_moon: 1, moon_name: 'Luna Prime' });
    const alpha = db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = 1234').pluck().get(groupX);
    const detail = (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${alpha}`, headers })).json();
    expect(detail.planets.find((p: any) => p.p === 5).moon_name).toBe('Luna Prime');
  });

  it('exports universe.json in pr0game format', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Export' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json') } });
    const res = await app.inject({ method: 'GET', url: `/hub/api/u8/universe-json?group=${groupX}`, headers: admin });
    expect(res.headers['content-disposition']).toContain('universe.json');
    const [universe, players, allies] = res.json();
    const original = JSON.parse(fixture('universe.json'))[0];
    expect(Object.keys(universe)).toEqual(['1:234', '1:235']);
    expect(Object.keys(universe['1:234'])).toEqual([...Array.from({ length: 15 }, (_, i) => String(i + 1)), 'timepoint']);
    expect(universe['1:234'].timepoint).toBe(original['1:234'].timepoint);
    expect(universe['1:234']['5']).toEqual(original['1:234']['5']);
    expect(universe['1:234']['7']).toMatchObject({ playerid: 55, name: 'Beta Max', allianceid: -1, alliancename: '-', special: 'uIi' });
    expect(universe['1:234']['6']).toBeNull();
    expect(universe['1:235']['3']).toMatchObject({ playerid: 99, name: '-', allianceid: 88, special: 'un' });
    expect(players['1234']).toEqual({ name: 'Alpha', timepoint: 1792569600000 });
    expect(allies['-1'].name).toBe('-');
    // Round trip: importing the export into another group gives the same file.
    const groupD = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Export-Import' } })).json().id;
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers: { ...admin, 'x-hub-group': String(groupD) }, payload: { text: res.body } });
    expect((await app.inject({ method: 'GET', url: `/hub/api/u8/universe-json?group=${groupD}`, headers: admin })).body).toBe(res.body);
  });

  it('renames users', async () => {
    const carol = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
    const c = await login('carol', 'carolpass');
    const rename = (payload: object) => app.inject({ method: 'POST', url: '/hub/api/auth/username', headers: c, payload });
    expect((await rename({ username: 'caroline', password: 'wrong' })).statusCode).toBe(400);
    expect((await rename({ username: 'ADMIN', password: 'carolpass' })).statusCode).toBe(409);
    expect((await rename({ username: 'x', password: 'carolpass' })).statusCode).toBe(400);
    expect((await rename({ username: 'caroline', password: 'carolpass' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: c })).json().user.username).toBe('caroline');

    const byAdmin = (headers: object, username: string) =>
      app.inject({ method: 'PUT', url: `/hub/api/admin/users/${carol}`, headers, payload: { username } });
    expect((await byAdmin(c, 'carl')).statusCode).toBe(403);
    expect((await byAdmin(admin, 'carl')).statusCode).toBe(200);
    await login('carl', 'carolpass');
  });

  it('stores the UI language per user', async () => {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass1'));
    const d = await login('dave', 'davepass1');
    const me = async () => (await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: d })).json().user.lang;
    expect(await me()).toBe('de');
    const setLang = (lang: string) => app.inject({ method: 'POST', url: '/hub/api/auth/lang', headers: d, payload: { lang } });
    expect((await setLang('en')).statusCode).toBe(200);
    expect(await me()).toBe('en');
    const bad = await setLang('fr');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'Invalid language', code: 'lang_invalid' });
    expect(await me()).toBe('en');
  });

  it('stores a message synced as HTML and as text once', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Dedupe' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const ingest = async () => (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } })).json();
    await ingest();
    const tables = ['battle_reports', 'expeditions', 'hostile_spying', 'recycle_reports'];
    const rows = () => tables.map((t) => db.prepare(`SELECT COUNT(*) FROM ${t} WHERE group_id = ?`).pluck().get(groupX));
    const before = rows();
    // as if synced from text: no message/report id, content hash as key
    for (const t of tables) db.prepare(`UPDATE ${t} SET msg_id = NULL, dedupe_key = 'h' || id WHERE group_id = ?`).run(groupX);
    db.prepare("UPDATE battle_reports SET report_id = NULL, outcome = NULL WHERE group_id = ?").run(groupX);
    const res = await ingest();
    expect(res.counts).toMatchObject({
      battle_reports: { new: 0 }, expeditions: { new: 0 }, hostile_spying: { new: 0 }, recycle_reports: { new: 0 },
    });
    expect(rows()).toEqual(before);
    const battle = db.prepare('SELECT msg_id, report_id, outcome FROM battle_reports WHERE group_id = ?').get(groupX) as any;
    expect(battle.msg_id).not.toBeNull();
    expect(battle.report_id).not.toBeNull();
    expect(battle.outcome).not.toBeNull();

    // copies from text stored before (no message id): the migration removes them
    const copy = (key: string, msgId: number | null) =>
      db.prepare(
        `INSERT INTO expeditions (group_id, user_id, dedupe_key, msg_id, time, g, s, p, event, size, factor, depletion, found_resources, found_ships)
         SELECT group_id, user_id, ? || id, ?, time, g, s, p, event, size, factor, depletion, found_resources, found_ships FROM expeditions
         WHERE group_id = ? AND dedupe_key NOT LIKE 'copy%' AND dedupe_key NOT LIKE 'twin%'`,
      ).run(key, msgId, groupX);
    copy('copy', null);
    // an expedition with the same result but its own message id stays
    copy('twin', 999999);
    db.exec(readFileSync(new URL('../migrations/011_dedupe_html_text.sql', import.meta.url), 'utf8'));
    const keys = db.prepare('SELECT dedupe_key FROM expeditions WHERE group_id = ?').pluck().all(groupX) as string[];
    expect(keys.filter((k) => k.startsWith('copy'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('twin'))).toHaveLength(before[1] as number);
    expect(keys).toHaveLength(2 * (before[1] as number));
  });

  it('keeps pasted pages for a while, universe.json uploads not at all', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Raw' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    db.prepare("INSERT INTO raw_ingests (group_id, source, page_type, text_gz, created_at) VALUES (?, 'paste', 'stats', x'00', 1)").run(groupX);
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const raw = db.prepare('SELECT page_type, html_gz IS NOT NULL AS html, text_gz IS NOT NULL AS text FROM raw_ingests WHERE group_id = ? ORDER BY id').all(groupX);
    expect(raw).toEqual([{ page_type: 'galaxy', html: 0, text: 0 }, { page_type: 'galaxy', html: 1, text: 0 }]);
  });

  it('keeps the newest overview page and the empire pages of the last week', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Snapshots' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const day = Math.floor(Date.now() / 1000) - 86400;
    for (const t of [1000, day]) {
      db.prepare("INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, '{}')").run(groupX, t);
      db.prepare("INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, 1, ?, '{}')").run(groupX, t);
    }
    for (const f of ['empire-real-source.html', 'overview.html']) {
      await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture(f) } });
    }
    const empire = db.prepare('SELECT created_at FROM empire_snapshots WHERE group_id = ?').pluck().all(groupX) as number[];
    expect(empire).not.toContain(1000);
    expect(empire).toContain(day);
    const overview = db.prepare('SELECT page_time FROM overview_snapshots WHERE group_id = ?').pluck().all(groupX) as number[];
    expect(overview).toEqual([Math.max(day, Date.UTC(2026, 9, 21, 12, 0, 0) / 1000)]);
  });

  it('replaces placeholder names of players only known by id', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Placeholder' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json').replaceAll('"Alpha"', '"-"') } });
    const alpha = () => db.prepare('SELECT id, name FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupX) as any;
    expect(alpha().name).toBe('Spieler #1234');
    // statistics older than the universe.json still bring the real name
    const stats = fixture('stats-player.html').replace('21. Okt 2026, 12:00:03', '1. Okt 2026, 12:00:03');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: stats } });
    expect(alpha().name).toBe('Alpha');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(alpha().id)).toEqual([]);
    // the export leaves the placeholder out
    const json = (await app.inject({ method: 'GET', url: '/hub/api/u8/universe-json', headers })).body;
    expect(json).toContain('"Alpha"');

    // stored before: the migration restores the real name
    const id = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 77, 'Spieler #77')").run(groupX).lastInsertRowid);
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Old', 1), (?, 'Real', 2)").run(id, id);
    const other = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 78, 'Real78')").run(groupX).lastInsertRowid);
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Spieler #78', 1)").run(other);
    db.exec(readFileSync(new URL('../migrations/013_placeholder_names.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT name FROM players WHERE id = ?').pluck().get(id)).toBe('Real');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id IN (?, ?)').pluck().all(id, other)).toEqual(['Old']);
  });

  it('keeps a position seen later from older spy reports', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Old spy' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const add = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(groupX, name).lastInsertRowid);
    const [alpha, owner] = [add('Former'), add('Owner')];
    // "Alpha" of the report is a former name
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Alpha', 1)").run(alpha);
    const ingest = () => app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } });
    const planet = () => db.prepare('SELECT name, player_id FROM planets WHERE group_id = ? AND g = 1 AND s = 234 AND p = 5').get(groupX) as any;

    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 234, 5, 'New', ?)").run(groupX, owner);
    db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, 1, 234, ?)').run(groupX, Math.floor(Date.now() / 1000));
    await ingest();
    expect(planet()).toEqual({ name: 'New', player_id: owner });
    expect(db.prepare('SELECT player_id FROM spy_reports WHERE group_id = ?').pluck().get(groupX)).toBe(alpha);

    // without a newer view the report is the newest state
    db.prepare('DELETE FROM galaxy_views WHERE group_id = ?').run(groupX);
    db.prepare('DELETE FROM spy_reports WHERE group_id = ?').run(groupX);
    await ingest();
    expect(planet()).toEqual({ name: 'Heimat', player_id: alpha });
  });

  it('shows since when a player is inactive', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Inactive' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const id = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Sleepy')").run(groupX).lastInsertRowid);
    const log = db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?)');
    const since = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json().players.find((p: any) => p.id === id).inactive_since;
    log.run(id, '["inactive"]', 100);
    log.run(id, '["inactive"]', 200);
    expect(await since()).toBe(100);
    // active again, then inactive anew: counts from the new start
    log.run(id, '[]', 300);
    expect(await since()).toBeNull();
    log.run(id, '["inactive"]', 400);
    log.run(id, '["inactive","longinactive"]', 500);
    expect(await since()).toBe(400);
  });

  it('keeps the activity log of merged players', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Merge' } })).json().id;
    const add = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(groupX, name).lastInsertRowid);
    const [from, into] = [add('Old'), add('New')];
    db.prepare("INSERT INTO activity_log (group_id, time, kind, player_id, dedupe_key) VALUES (?, 1, 'planet_new', ?, 'merge')").run(groupX, from);
    const res = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupX}/players/merge`, headers: admin, payload: { from, into } });
    expect(res.statusCode).toBe(200);
    expect(db.prepare("SELECT player_id FROM activity_log WHERE dedupe_key = 'merge'").pluck().get()).toBe(into);
  });

  it('clamps limits and validates notes and deck settings', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    for (let i = 0; i < 2; i++) {
      db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, player_name, sections) VALUES (?, 9, 9, 9, 'planet', ?, 'X', '{}')").run(groupA, 1000 + i);
    }
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/9/9/9?limit=-1', headers })).json();
    expect(spy).toMatchObject({ total: 2 });
    expect(spy.reports).toHaveLength(1);

    const player = db.prepare('SELECT id FROM players WHERE group_id = ? LIMIT 1').pluck().get(groupA);
    const note = (payload: object) => app.inject({ method: 'PUT', url: `/hub/api/u8/players/${player}/note`, headers, payload });
    expect((await note({ note: { x: 1 } })).statusCode).toBe(400);
    expect((await note({ note: 'x'.repeat(5001) })).statusCode).toBe(400);
    expect((await note({ note: 'farm' })).statusCode).toBe(200);

    const deck = (payload: object) => app.inject({ method: 'PUT', url: '/hub/api/u8/deck', headers, payload });
    expect((await deck({ startTime: 'yesterday' })).statusCode).toBe(400);
    expect((await deck({ initialDrawn: { 'Nothing:normal': -1 } })).statusCode).toBe(400);
    expect((await deck({ startTime: 1000, initialDrawn: { 'Nothing:normal': 2 } })).statusCode).toBe(200);
  });

  it('keeps the last admin of an alliance', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Admins' } })).json().id;
    const inv = (await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupX}/invites`, headers: admin, payload: { role: 'admin' } })).json();
    await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'carol', password: 'carolpass' } });
    const carol = await login('carol', 'carolpass');
    const id = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get();
    const url = `/hub/api/admin/groups/${groupX}/members/${id}`;
    // the creator leaves, carol is the only admin
    await app.inject({ method: 'DELETE', url: `/hub/api/admin/groups/${groupX}/members/1`, headers: admin });
    expect((await app.inject({ method: 'PUT', url, headers: carol, payload: { role: 'member' } })).json().code).toBe('last_admin');
    expect((await app.inject({ method: 'DELETE', url, headers: carol })).json().code).toBe('last_admin');
    // the global admin may
    expect((await app.inject({ method: 'PUT', url, headers: admin, payload: { role: 'member' } })).statusCode).toBe(200);
  });

  it('rejects duplicate universes and invalid settings', async () => {
    const h = { headers: admin };
    expect((await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8' }, ...h })).statusCode).toBe(409);
    expect(
      (await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u9', settings: { timezone: 'Mars/Base' } }, ...h })).statusCode,
    ).toBe(400);
    for (const settings of [{ systems: 'many' }, { galaxies: 0 }, { positions: 1.5 }, { circularSystems: 'yes' }, { systemDistanceFactor: -1 }]) {
      const res = await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u9', settings }, ...h });
      expect(res.json().code).toBe('setting_invalid');
    }
  });
});

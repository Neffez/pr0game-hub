import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeDeck, DEFAULT_DECK, localToEpoch, nearestClock, parsePage, type DeckEvent } from '../src/index.js';
import { elementPoints, idByName, idByShortName, sectionPoints } from '../src/tech.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('stats', () => {
  it('parses player stats from HTML with ids, rank change, status and type', () => {
    const res = parsePage({ html: fixture('stats-player.html') });
    expect(res.pageType).toBe('stats');
    expect(res.source).toBe('html');
    const rec = res.records[0];
    if (rec.kind !== 'stats') throw new Error('expected stats');
    expect(rec.who).toBe('player');
    expect(rec.type).toBe(2);
    expect(rec.statTime).toBe('2026-10-21 12:00:03');
    expect(rec.rows).toEqual([
      { rank: 1, rankChange: 3, ingameId: 1234, name: 'Alpha', status: [], allyId: 77, allyName: 'Die Allianz', points: 1234567 },
      { rank: 2, rankChange: -2, ingameId: 55, name: 'Beta Max', status: ['inactive', 'vacation'], allyId: null, allyName: null, points: 987654 },
      { rank: 3, rankChange: 0, ingameId: 9, name: 'Gamma', status: ['longinactive'], allyId: 12, allyName: 'ABC', points: 5 },
    ]);
  });

  it('parses the honor points ranking with titles and negative points', () => {
    const rec = parsePage({ html: fixture('stats-honor.html') }).records[0];
    if (rec.kind !== 'stats') throw new Error('expected stats');
    expect(rec).toMatchObject({ who: 'player', type: 6, statTime: '2026-10-21 22:55:25' });
    expect(rec.rows.map((r) => [r.rank, r.rankChange, r.name, r.title ?? null, r.points])).toEqual([
      [1, 2, 'Gottkaiser', 'Gott-Imperator', 12345],
      [2, 0, 'Virus', null, 0],
      [3, -3, 'reflex', 'Banditen-Imperator', -4200],
    ]);
  });

  it('parses alliance stats with member counts', () => {
    const rec = parsePage({ html: fixture('stats-alliance.html') }).records[0];
    if (rec.kind !== 'stats') throw new Error('expected stats');
    expect(rec).toMatchObject({ who: 'alliance', type: 1 });
    expect(rec.rows).toEqual([
      expect.objectContaining({ rank: 1, rankChange: 1, ingameId: 14, name: 'F1337erB0yz', members: 12, points: 1234567 }),
      expect.objectContaining({ rank: 2, rankChange: -1, ingameId: 7, name: 'Sinnlos im Weltraum', members: 3, points: 45000 }),
    ]);
  });

  it('parses English stats (date without dot after the day)', () => {
    const res = parsePage({ html: fixture('stats-en-testserver.html') });
    const rec = res.records[0];
    if (rec.kind !== 'stats') throw new Error('expected stats');
    expect(rec.statTime).toBe('2026-10-21 22:55:25');
    expect(rec.type).toBe(1);
    expect(rec.rows.map((r) => [r.ingameId, r.name, r.status])).toEqual([
      [179, 'reflex', ['longinactive', 'inactive']],
      [214, 'Gottkaiser', []],
      [303, 'Virus', ['inactive']],
      [299, 'test123', ['longinactive', 'inactive']],
    ]);
    expect(rec.rows[1]).toMatchObject({ allyId: 14, allyName: 'F1337erB0yz', points: 449037461141982 });
  });

  it('parses player stats from plain text by name', () => {
    const res = parsePage({ text: fixture('stats-player.txt') });
    const rec = res.records[0];
    if (rec.kind !== 'stats') throw new Error('expected stats');
    expect(res.source).toBe('text');
    expect(rec.type).toBe(3);
    expect(rec.statTime).toBe('2026-10-21 18:00:02');
    expect(rec.rows.map((r) => [r.rank, r.name, r.status, r.allyName, r.points])).toEqual([
      [1, 'Alpha', [], 'Die Allianz', 1300000],
      [2, 'Beta Max', ['inactive', 'vacation'], null, 990000],
      [3, 'Gamma', ['longinactive'], 'ABC', 7],
    ]);
  });

  it('parses real page source, also when copied from view-source (rendered source as text/html)', () => {
    const source = fixture('stats-real-source.html');
    const viewSourceHtml = `<table><tr><td class="line-content">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td></tr></table>`;
    for (const input of [{ text: source }, { html: viewSourceHtml, text: source }, { html: source }]) {
      const res = parsePage(input);
      const rec = res.records[0];
      if (rec?.kind !== 'stats') throw new Error('expected stats for ' + Object.keys(input).join('+'));
      expect(res.source).toBe('html');
      expect(rec).toMatchObject({ who: 'player', type: 1, statTime: '2026-10-21 06:00:01' });
      expect(rec.rows).toHaveLength(7);
      expect(rec.rows[2]).toMatchObject({ rank: 7, ingameId: 1002848, name: 'Rudolf', allyId: 871, allyName: 'Sinnlos im Weltraum', points: 1360721 });
      expect(rec.rows[4]).toMatchObject({ rankChange: -1, name: 'B0b' });
      expect(rec.rows[5]).toMatchObject({ name: 'Über mir stinken alle', status: ['vacation', 'inactive'] });
      expect(rec.rows[6]).toMatchObject({ name: 'guest', status: ['vacation', 'inactive', 'noob'], allyId: null });
    }
  });

  it('treats page source pasted as text as HTML', () => {
    const res = parsePage({ text: fixture('stats-player.html') });
    expect(res.source).toBe('html');
    expect(res.records[0].kind).toBe('stats');
  });
});

describe('messages', () => {
  it('parses English battle reports (Attack report, Debris field, date without dot)', () => {
    const res = parsePage({ html: fixture('messages-en-battle.html') });
    expect(res.records).toHaveLength(1);
    expect(res.records[0]).toMatchObject({
      kind: 'battle', msgId: 20720, time: '2026-10-21 23:05:31', reportId: '28ecaab5e83b099afc4d850a44094108',
      coords: { g: 1, s: 206, p: 9 }, planetType: 'planet', outcome: 'lose', lostAttacker: 5000, lostDefender: 0,
      loot: { metal: 0, crystal: 0, deuterium: 0 }, debris: { metal: 0, crystal: 2000 },
    });
  });

  it('parses English spy report titles (date without dot)', () => {
    const text = fixture('messages.txt').replace(
      'Spionagebericht vom Planeten Heimat (Alpha) [1:234:5] am 21. Okt 2026, 12:00:30',
      'Spy report from planet Heimat (Alpha) [1:234:5] on 21 Oct 2026, 12:00:30',
    );
    const spy = parsePage({ text }).records.find((r) => r.kind === 'spy');
    expect(spy).toMatchObject({ coords: { g: 1, s: 234, p: 5 }, planetType: 'planet', planetName: 'Heimat', reportTime: '2026-10-21 12:00:30' });
  });

  it('parses spy, battle, expeditions and hostile spying from HTML', () => {
    const res = parsePage({ html: fixture('messages.html') });
    expect(res.pageType).toBe('messages');
    const kinds = res.records.map((r) => r.kind);
    expect(kinds).toEqual(['spy', 'battle', 'expedition', 'hostileSpy', 'expedition', 'expedition', 'recycle']);

    const [spy, battle, expo, hostile, pirates, slow] = res.records as any[];
    expect(spy).toMatchObject({
      msgId: 101,
      coords: { g: 1, s: 234, p: 5 },
      planetType: 'planet',
      planetName: 'Heimat',
      playerName: 'Alpha',
      reportTime: '2026-10-21 12:00:30',
      destroyChance: 3,
      sections: { 900: { 901: 1234567, 902: 500000, 903: 10, 911: -50 }, 200: { 202: 15 }, 400: {} },
    });
    expect(battle).toMatchObject({
      msgId: 102, reportId: 'abcdef0123', outcome: 'win', lostDefender: 12000,
      loot: { metal: 600000, crystal: 250000, deuterium: 5 }, debris: { metal: 3000, crystal: 1000 },
    });
    expect(expo).toMatchObject({
      msgId: 103, event: 'Res', size: 'Small', depletion: 'few', foundResources: { 901: 12345 },
      coords: { g: 1, s: 200, p: 16 }, time: '2026-10-21 14:00:00',
    });
    expect(hostile).toMatchObject({
      fromPlayerName: 'Spion', fromPlanetName: 'Kolonie', fromCoords: { g: 2, s: 3, p: 4 },
      targetCoords: { g: 1, s: 200, p: 4 }, time: '2026-10-21 15:00:00',
    });
    expect(pirates).toMatchObject({ event: 'Pirates', size: 'Small' });
    expect(slow).toMatchObject({ event: 'Slow', size: 'Medium', factor: 3 });
    expect(res.records[6]).toEqual({
      kind: 'recycle', msgId: 107, time: '2026-10-21 16:00:00', coords: { g: 1, s: 234, p: 5 },
      metal: 80000, crystal: 25000, totalMetal: 3000000, totalCrystal: 1000000,
    });
  });

  it('parses messages from plain text', () => {
    const res = parsePage({ text: fixture('messages.txt') });
    const [spy, battle, ships, nothing] = res.records as any[];
    expect(res.records.map((r) => r.kind)).toEqual(['spy', 'battle', 'expedition', 'expedition', 'recycle']);
    expect(res.records[4]).toMatchObject({ time: '2026-10-21 16:00:00', metal: 80000, crystal: 25000, totalMetal: 3000000 });
    expect(spy.sections).toEqual({
      900: { 901: 1234567, 902: 500000, 903: 10, 911: -50 },
      200: { 202: 15, 204: 2 },
      400: {},
      0: { 1: 22, 2: 18 },
    });
    expect(battle).toMatchObject({ time: '2026-10-21 13:10:00', loot: { metal: 600000 } });
    expect(ships).toMatchObject({ event: 'Ships', size: 'Small', foundShips: { 202: 12, 204: 3 }, depletion: 'none' });
    expect(nothing).toMatchObject({ event: 'Nothing', depletion: null, time: '2026-10-21 15:00:00' });
  });
});

describe('battle hall', () => {
  it('parses the hall of fame with winners, draws and empty sides', () => {
    const res = parsePage({ text: fixture('battlehall.html') });
    expect(res.pageType).toBe('battleHall');
    const rec = res.records[0] as any;
    expect(rec.timeframe).toBe(1);
    expect(rec.entries).toEqual([
      { reportId: '1528afec76dd0c472021c32c53277ba7', rank: 1, attackers: ['CredoBono', 'Urinaal', 'Burper'], defenders: ['Toter Schmetterling', 'Reed'], winner: 'draw', time: '2026-10-16 13:33:29', units: 1075302000 },
      { reportId: '93a44dd012ff05992739d1afd749df1d', rank: 2, attackers: ['pUsteblUme'], defenders: ['Arys'], winner: 'attacker', time: '2026-10-20 12:29:25', units: 25541000 },
      { reportId: '778f7e93ac40c40bc90bcbe615be7420', rank: 3, attackers: ['Magglish'], defenders: ['Anda'], winner: 'defender', time: '2026-10-13 13:00:47', units: 260583000 },
      { reportId: '4a2cdacac6d527ed06443e57a93d45c7', rank: 4, attackers: ['Steveboo', 'Anda'], defenders: [], winner: 'attacker', time: '2026-10-04 03:19:12', units: 276316000 },
    ]);
  });
});

describe('combat report', () => {
  it('parses a public battle report (english, coordinates hidden)', () => {
    const res = parsePage({ html: fixture('raport-public.html'), url: 'game.php?page=raport&raport=93a44dd012ff05992739d1afd749df1d' });
    expect(res.pageType).toBe('combatReport');
    expect(res.records[0]).toMatchObject({
      reportId: '93a44dd012ff05992739d1afd749df1d', time: '2026-10-20 10:29:25', winner: 'attacker', rounds: 1,
      lost: { attacker: 3280000, defender: 22261000 }, debris: { metal: 3560500, crystal: 1890000 },
      fleets: [
        { side: 'attacker', name: 'pUsteblUme', start: { 207: 6445, 215: 2245 }, end: { 207: 6402, 215: 2235 } },
        { side: 'defender', name: 'Arys', start: { 203: 42, 207: 20, 401: 607 }, end: { 203: 0, 401: 0 } },
      ],
    });
  });
});

describe('recycling', () => {
  it('parses english recycling reports', () => {
    const res = parsePage({
      text: 'Recycling Report\nOct 21 2026, 16:00:00\nYour recyclers have collected 1,000 Metal and 2,000 Crystal from a total of 5,000 Metal and 6,000 Crystal at coordinates [2:3:4].',
    });
    expect(res.records[0]).toMatchObject({ kind: 'recycle', coords: { g: 2, s: 3, p: 4 }, metal: 1000, crystal: 2000, totalMetal: 5000, totalCrystal: 6000 });
  });
});

describe('galaxy + empire', () => {
  it('parses galaxy rows', () => {
    const res = parsePage({ html: fixture('galaxy.html') });
    const rec = res.records[0] as any;
    expect(res.pageType).toBe('galaxy');
    expect(rec).toMatchObject({ g: 1, s: 234 });
    expect(rec.rows).toEqual([
      {
        position: 5, planetName: 'Heimat', moon: true, moonName: 'Luna Prime', destroyed: false, playerId: 1234, playerName: 'Alpha',
        status: ['inactive'], allyId: 77, allyTag: 'DA', debris: { metal: '1.2K', crystal: '300' },
      },
      {
        position: 7, planetName: '', moon: false, moonName: null, destroyed: true, playerId: null, playerName: null,
        status: [], allyId: null, allyTag: null, debris: null,
      },
    ]);
  });

  it('parses copied galaxy text with the system typed by the user', () => {
    const res = parsePage({ text: fixture('galaxy.txt'), system: '1:3' });
    expect(res).toMatchObject({ pageType: 'galaxy', source: 'text', warnings: [] });
    const rec = res.records[0] as any;
    expect(rec).toMatchObject({ g: 1, s: 3 });
    const row = (position: number, planetName: string, moonName: string | null, playerName: string, status: string[], debris: [string, string] | null, allyTag: string | null = null) => ({
      position, planetName, moon: moonName != null, moonName, destroyed: false, playerId: null, playerName, status,
      allyId: null, allyTag, debris: debris && { metal: debris[0], crystal: debris[1] },
    });
    const ii = ['longinactive', 'inactive'];
    expect(rec.rows).toEqual([
      row(1, '5', 'Mond', 'Anda', ii, ['148K', '444K']),
      row(2, 'Mondspender', 'MV4U', 'Gottkaiser', [], ['133.504M', '106.906M'], '1337'),
      row(4, '4', 'Mond', 'Anda', ii, ['135K', '405K']),
      row(5, '3', 'Mond', 'Anda', ii, ['181K', '543K']),
      row(6, '1', 'Mond', 'Anda', ii, ['1,7B', '1,3B']),
      row(7, 'Kolonie', null, '123', ii, null),
      row(8, 'TestColony1', 'Mond', 'TestUser2', ii, ['478K', '365K']),
      row(9, 'Kolonie', null, 'ConsulVega', ii, null),
      row(11, '2', 'Mond', 'Anda', ii, ['134K', '402K']),
      row(12, 'Hauptplanet', null, 'paul', ii, null),
      row(13, 'Kolonie', null, 'Pseudoephedrin', [], null),
    ]);
  });

  it('asks for galaxy:system when copied galaxy text has none', () => {
    const res = parsePage({ text: fixture('galaxy.txt') });
    expect(res).toMatchObject({ pageType: 'galaxy', records: [], warnings: ['galaxy_position_missing'] });
  });

  it('takes destroyed planets and debris-only positions from galaxy text', () => {
    const text = ['Spieler (Status) [Allianz]', 'Aktion', '1', '2', 'Planet zerstört', '3 K / 1 K', '3', '0 / 5 K', '4', '5'].join('\n');
    const rec = parsePage({ text, system: '[2:15]' }).records[0] as any;
    expect(rec).toMatchObject({ g: 2, s: 15 });
    expect(rec.rows).toMatchObject([
      { position: 2, destroyed: true, playerName: null, debris: { metal: '3K', crystal: '1K' } },
      { position: 3, destroyed: false, playerName: null, debris: { metal: '0', crystal: '5K' } },
    ]);
  });

  it('parses universe.json exports', () => {
    const res = parsePage({ text: fixture('universe.json') });
    expect(res).toMatchObject({ pageType: 'galaxy', source: 'json' });
    expect(res.records).toHaveLength(2);
    const [sys, empty] = res.records as any[];
    expect(sys).toMatchObject({ g: 1, s: 234, seenAt: 1792569600 });
    expect(sys.rows).toEqual([
      { position: 5, planetName: 'Heimat', moon: true, destroyed: false, playerId: 1234, playerName: 'Alpha', status: [], allyId: 77, allyTag: null, allyName: 'Die Allianz', debris: null },
      { position: 7, planetName: '', moon: false, destroyed: false, playerId: 55, playerName: 'Beta Max', status: ['vacation', 'longinactive'], allyId: null, allyTag: null, allyName: null, debris: null },
    ]);
    // "-" = unknown: names come from the player/alliance lists when possible
    expect(empty.rows).toEqual([
      { position: 3, planetName: '', moon: false, destroyed: false, playerId: 99, playerName: null, status: ['vacation', 'noob'], allyId: 88, allyTag: null, allyName: 'Unbekannt', debris: null },
      { position: 4, planetName: '', moon: false, destroyed: false, playerId: 1234, playerName: 'Alpha', status: [], allyId: 77, allyTag: null, allyName: 'Die Allianz', debris: null },
    ]);
  });

  it('parses real empire source with moons sharing planet coordinates', () => {
    const res = parsePage({ text: fixture('empire-real-source.html') });
    const rec = res.records[0] as any;
    expect(res.pageType).toBe('empire');
    expect(rec.research).toEqual({ 110: 13 });
    expect(rec.planets.map((p: any) => [p.name, p.coords, p.type, p.values])).toEqual([
      ['Ares', { g: 1, s: 100, p: 12 }, 'planet', { 1: 25, 22: 7, 41: 0, 203: 0, 215: 38, 401: 0, 502: 0 }],
      ['Osirious', { g: 1, s: 100, p: 12 }, 'moon', { 1: 0, 22: 0, 41: 5, 203: 538, 215: 326, 401: 0, 502: 0 }],
      ['Hephaistos', { g: 3, s: 200, p: 1 }, 'planet', { 1: 25, 22: 6, 41: 0, 203: 13, 215: 0, 401: 36, 502: 0 }],
    ]);
    // live data: resources, production, queues, page time, active planet storage
    const [ares, moon] = rec.planets;
    expect(ares).toMatchObject({
      temp: 42, fields: { used: 168, max: 208 }, resources: { 901: 338566, 911: 35 }, perHour: { 901: 38369 },
      building: { id: 1, level: 26 }, shipyard: { 215: 63 },
    });
    expect(moon).toMatchObject({ temp: 3, resources: { 901: 134160, 911: 0 } });
    expect(moon.perHour).toBeUndefined();
    expect(moon.building).toBeUndefined();
    expect(rec.researchQueue).toEqual({ id: 110, level: 14, coords: { g: 1, s: 100, p: 12 } });
    expect(rec.flying).toEqual({ 901: 2396674 });
    expect(rec.flyingShips).toEqual({ 203: 214 });
    expect(rec.pageTime).toBe('2026-10-21 13:43:45');
    expect(rec.active).toEqual({ coords: { g: 1, s: 100, p: 12 }, type: 'planet', storage: { 901: 4325000, 902: 2350000, 903: 2350000 } });
  });

  it('parses empire', () => {
    const res = parsePage({ html: fixture('empire.html') });
    const rec = res.records[0] as any;
    expect(res.pageType).toBe('empire');
    expect(rec.research).toEqual({ 106: 8 });
    expect(rec.planets).toMatchObject([
      { name: 'Heimat', coords: { g: 1, s: 200, p: 4 }, type: 'planet', values: { 1: 22, 202: 25, 401: 100 }, building: { id: 1, level: 23 } },
      { name: 'Kolonie', coords: { g: 1, s: 201, p: 8 }, type: 'planet', values: { 1: 19, 202: 5, 401: 0 } },
    ]);
  });
});

describe('overview', () => {
  it('parses build, research and shipyard queues with remaining time', () => {
    const res = parsePage({ text: fixture('overview.html') });
    expect(res.pageType).toBe('overview');
    const rec = res.records[0] as any;
    expect(rec.pageTime).toBe('2026-10-21 14:00:00');
    expect(rec.current).toEqual({ coords: { g: 2, s: 2, p: 15 }, type: 'planet' });
    const c = (g: number, s: number, p: number) => ({ g, s, p });
    expect(rec.queues).toEqual([
      { kind: 'building', coords: c(2, 2, 15), type: 'planet', id: 4, level: 27, destroy: false, seconds: 25444 },
      { kind: 'research', coords: c(2, 2, 15), type: 'planet', id: 110, level: 14, destroy: false, seconds: 9364 },
      { kind: 'building', coords: c(2, 2, 15), type: 'moon', id: 41, level: 6, destroy: false, seconds: 3600 },
      { kind: 'building', coords: c(1, 100, 12), type: 'planet', id: 1, level: 24, destroy: true, seconds: 120 },
      { kind: 'building', coords: c(1, 100, 12), type: 'moon', id: 43, level: 2, destroy: false, seconds: 500 },
    ]);
    expect(rec.catchUp).toBe(12.34);
  });

  it('parses the copied overview text of a selected moon', () => {
    const res = parsePage({ text: fixture('overview-moon.txt') });
    expect(res).toMatchObject({ pageType: 'overview', source: 'text' });
    const rec = res.records[0] as any;
    expect(rec.pageTime).toMatch(/^\d{4}-10-22 17:29:38$/);
    expect(rec.current).toEqual({ coords: { g: 1, s: 5, p: 9 }, type: 'moon' });
    expect(rec.queues).toEqual([
      { kind: 'shipyard', coords: { g: 1, s: 5, p: 9 }, type: 'moon', id: 215, level: 938820, destroy: false, seconds: ((10 * 24 + 20) * 60 + 46) * 60 + 59 },
    ]);
    expect(rec.catchUp).toBe(89.95);
  });

  it('parses running queues from copied overview text of a planet', () => {
    const text = [
      'Serverzeit : Okt Do 22 17:29:38',
      'Punkte 1.234.567 (Platz 42 von 300)',
      'Übersicht',
      'Mondi (Mond)', 'Mondi (Mond)', 'Mondbasis (6)', '1h',
      'Quetzalcoatl', 'Quetzalcoatl',
      'Gebäude: Solarkraftwerk (27)', '7h 4m 4s',
      'Forschung: Schildtechnik (14)', '2h 36m 4s',
      'Schiffswerft: Frei',
      'Durchmesser: 12.800 km (100 / 163 Felder)',
      'Position: [2:2:15]',
      'Planeten und Monde',
      'Ares', 'Ares', '[1:100:12]', 'Metallmine Abreißen (24)', '2m',
      'Osirious', 'Osirious', '[1:100:12]', 'Sprungtor (2)', '8m',
      'Mondi', 'Mondi', '[2:2:15]', 'Mondbasis (6)', '1h',
      'Hephaistos', 'Hephaistos', '[3:200:1]', 'Frei',
    ].join('\n');
    const rec = parsePage({ text }).records[0] as any;
    expect(rec.current).toEqual({ coords: { g: 2, s: 2, p: 15 }, type: 'planet' });
    const c = (g: number, s: number, p: number) => ({ g, s, p });
    expect(rec.queues).toEqual([
      { kind: 'building', coords: c(2, 2, 15), type: 'moon', id: 41, level: 6, destroy: false, seconds: 3600 },
      { kind: 'building', coords: c(2, 2, 15), type: 'planet', id: 4, level: 27, destroy: false, seconds: 25444 },
      { kind: 'research', coords: c(2, 2, 15), type: 'planet', id: 110, level: 14, destroy: false, seconds: 9364 },
      { kind: 'building', coords: c(1, 100, 12), type: 'planet', id: 1, level: 24, destroy: true, seconds: 120 },
      { kind: 'building', coords: c(1, 100, 12), type: 'moon', id: 43, level: 2, destroy: false, seconds: 480 },
      { kind: 'building', coords: c(2, 2, 15), type: 'moon', id: 41, level: 6, destroy: false, seconds: 3600 },
    ]);
    expect(rec.catchUp).toBeNull();
  });
});

describe('fleet movements', () => {
  const c = (g: number, s: number, p: number) => ({ g, s, p });
  const lines = [
    ' 00:18:43 | 17m 27s Eine deiner Flotten (1 Leichter Jäger) kehrt vom Mond 1 129 11 [1:129:11] zurück zum Planet Ares [1:100:12]. Mission: Angreifen',
    '02:33:25 | 02h 32m 09s Eine deiner Flotten (7 Großer Transporter; 68 Leichter Jäger; 4 Schlachtschiff; 2 Schlachtkreuzer) vom Planet Domestos [3:100:15] erreicht den Planet Quetzalcoatl [2:2:15]. Mission: Stationieren (Rohstoffe: 0 Metall; 0 Kristall; 180719 Deuterium)',
    '08:30:47 | 08h 29m 31s Eine deiner Flotten (3418 Leichter Jäger; 44 Schwerer Jäger; 1463 Schlachtschiff; 131 Recycler; 4397 Schlachtkreuzer; 1698 Optimierter Recycler) vom Mond Whorus [2:100:15] erreicht den Planet Quetzalcoatl [2:2:15]. Mission: Stationieren',
  ];

  it('parses copied event lines on their own', () => {
    const res = parsePage({ text: lines.join('\n') });
    expect(res).toMatchObject({ pageType: 'fleets', source: 'text' });
    const rec = res.records[0] as any;
    expect(rec.pageTime).toBeNull();
    expect(rec.fleets).toEqual([
      {
        owner: 'own', player: null, mission: 1, missionName: 'Angreifen', phase: 'return',
        from: { coords: c(1, 129, 11), type: 'moon', name: '1 129 11' }, to: { coords: c(1, 100, 12), type: 'planet', name: 'Ares' },
        ships: { 204: 1 }, resources: null, seconds: 17 * 60 + 27, clock: '00:18:43',
      },
      {
        owner: 'own', player: null, mission: 4, missionName: 'Stationieren', phase: 'out',
        from: { coords: c(3, 100, 15), type: 'planet', name: 'Domestos' }, to: { coords: c(2, 2, 15), type: 'planet', name: 'Quetzalcoatl' },
        ships: { 203: 7, 204: 68, 207: 4, 215: 2 }, resources: { 901: 0, 902: 0, 903: 180719 }, seconds: 9129, clock: '02:33:25',
      },
      expect.objectContaining({ from: expect.objectContaining({ type: 'moon', name: 'Whorus' }), resources: null, seconds: 30571 }),
    ]);
    expect(rec.fleets[2].ships).toEqual({ 204: 3418, 205: 44, 207: 1463, 209: 131, 215: 4397, 227: 1698 });
  });

  it('joins clock and timer copied onto lines of their own, also next to the clipboard HTML', () => {
    const [clock, rest] = lines[0].trim().split(' | ');
    const text = [clock, '|', rest.replace(' Eine', '\nEine')].join('\n');
    const html = `<li><span class="statictimer">${clock}</span> | <span class="fleets">17m 27s</span> <span>Eine deiner Flotten</span></li>`;
    const res = parsePage({ html, text });
    expect(res).toMatchObject({ pageType: 'fleets', source: 'text' });
    expect((res.records[0] as any).fleets[0]).toMatchObject({ mission: 1, phase: 'return', seconds: 17 * 60 + 27, clock: '00:18:43' });
  });

  it('adds the fleets of a copied overview page, an empty list only when it was shown', () => {
    const page = (events: string[], button = 'Ausblenden') =>
      ['Planet Ares (Rudolf)', 'Serverzeit : Okt Fr 23 00:01:53', `Ereignisse ${button}`, ...events, 'Übersicht', 'Ares', 'Gebäude: Frei', 'Position: [1:100:12]'].join('\n');
    const res = parsePage({ text: page(lines) });
    expect(res.pageType).toBe('overview');
    expect(res.records.map((r) => r.kind)).toEqual(['overview', 'fleets']);
    expect((res.records[1] as any).pageTime).toMatch(/-10-23 00:01:53$/);
    expect((res.records[1] as any).fleets).toHaveLength(3);
    expect(parsePage({ text: page([]) }).records[1]).toMatchObject({ kind: 'fleets', fleets: [] });
    expect(parsePage({ text: page([], 'Einblenden') }).records.map((r) => r.kind)).toEqual(['overview']);
  });

  it('parses the event list of the overview page source with exact remaining seconds', () => {
    const res = parsePage({ text: fixture('overview-fleets.html') });
    expect(res.pageType).toBe('overview');
    const rec = res.records.find((r) => r.kind === 'fleets') as any;
    expect(rec.pageTime).toBe('2026-10-23 00:02:02');
    expect(rec.fleets.map((f: any) => [f.mission, f.phase, f.seconds, f.from.name, f.to.name])).toEqual([
      [1, 'return', 1001, '1 129 11', 'Ares'],
      [4, 'out', 9083, 'Domestos', 'Quetzalcoatl'],
      [4, 'out', 30525, 'Whorus', 'Quetzalcoatl'],
    ]);
    expect(rec.fleets[1]).toMatchObject({ ships: { 203: 7, 204: 68, 207: 4, 215: 2 }, resources: { 903: 180719 }, clock: null });
  });

  it('places the arrival clock next to the estimated arrival', () => {
    const at = localToEpoch('2026-10-23 00:18:43');
    expect(nearestClock(at + 95, '00:18:43')).toBe(at);
    expect(nearestClock(at - 600, '00:18:43')).toBe(at);
    const late = localToEpoch('2026-10-22 23:59:30');
    expect(nearestClock(late + 60, '23:59:30')).toBe(late);
  });
});

describe('deck', () => {
  const ev = (event: any, size: any = 'None', depletion: any = null): DeckEvent => ({ event, size, depletion });

  it('counts definite cards and resets after a full deck', () => {
    const small = [
      { type: 'Res' as const, size: 'Small' as const, count: 2 },
      { type: 'Nothing' as const, size: 'None' as const, count: 1 },
    ];
    let st = computeDeck(small, [ev('Res', 'Small')]);
    expect(st.remainingTotal).toBe(2);
    expect(st.cards[0].nextProbability).toBeCloseTo(0.5);
    st = computeDeck(small, [ev('Res', 'Small'), ev('Nothing', 'None', 'none'), ev('Res', 'Small')]);
    expect(st.resets).toBe(1);
    expect(st.remainingTotal).toBe(3);
  });

  it('weights depleted nothings by posterior probability', () => {
    const st = computeDeck(DEFAULT_DECK, [ev('Nothing', 'None', 'many')]);
    const nothing = st.cards.find((c) => c.type === 'Nothing')!;
    // P(card | nothing) = (1-pd)q / ((1-pd)q + pd) with q = 0.19, pd = 75/101
    const pd = 75 / 101;
    const p = ((1 - pd) * 0.19) / ((1 - pd) * 0.19 + pd);
    expect(nothing.remaining).toBeCloseTo(190 - p);
    expect(nothing.remainingMin).toBe(189);
    expect(nothing.remainingMax).toBe(190);
    expect(st.uncertainNothing).toBe(1);
  });
});

describe('time', () => {
  it('converts Berlin wall clock to epoch incl. DST', () => {
    expect(localToEpoch('2026-07-01 12:00:00')).toBe(Date.UTC(2026, 6, 1, 10) / 1000);
    expect(localToEpoch('2026-12-01 12:00:00')).toBe(Date.UTC(2026, 11, 1, 11) / 1000);
  });
});

describe('points', () => {
  it('computes points like the game Statbuilder', () => {
    // metal mine: 75 * (1 + 1.5) for two levels
    expect(elementPoints(1, 2)).toBeCloseTo(0.1875);
    // 10 light fighters (3000 + 1000)
    expect(elementPoints(204, 10)).toBe(40);
    expect(sectionPoints({ 1: 2, 204: 10 })).toBeCloseTo(40.1875);
    expect(sectionPoints(undefined)).toBeNull();
  });

  it('knows the costs of shield domes and missiles (rows with NULL class in install.sql)', () => {
    // small / large shield dome, interceptor and interplanetary missile
    expect(elementPoints(407, 4)).toBe(80);
    expect(elementPoints(408, 4)).toBe(400);
    expect(elementPoints(502, 10)).toBe(100);
    expect(elementPoints(503, 40)).toBe(1000);
  });
});

describe('review fixes', () => {
  it('does not crash on an invalid url', () => {
    expect(() => parsePage({ html: '<html><body><p>x</p></body></html>', url: 'http://' })).not.toThrow();
  });

  it('regenerates the deck when a certain Nothing card is drawn but none is left', () => {
    const deck = [
      { type: 'Res' as const, size: 'Small' as const, count: 2 },
      { type: 'Nothing' as const, size: 'None' as const, count: 1 },
    ];
    const ev = (event: DeckEvent['event'], size: DeckEvent['size']): DeckEvent => ({ event, size, depletion: 'none' });
    // the only Nothing card is gone, so a second Nothing means a new deck (2 Res + 0 Nothing left)
    const state = computeDeck(deck, [ev('Nothing', 'None'), ev('Nothing', 'None')]);
    expect(state.resets).toBe(1);
    expect(state.remainingTotal).toBe(2);
  });
});

describe('pirate language (SetSail theme)', () => {
  it('parses the battle report page with pirate ship names', () => {
    const lines = fixture('pirate-combat-report.txt').split('\n');
    const html = `<html><body>${lines.map((l) => `<div>${l}</div>`).join('')}</body></html>`;
    const res = parsePage({ html, url: 'https://pr0game.ddev.site/game.php?page=raport&raport=abc123' });
    expect(res.pageType).toBe('combatReport');
    expect(res.records[0]).toMatchObject({
      reportId: 'abc123', time: '2026-10-22 00:08:11', winner: 'attacker', debris: { metal: 0, crystal: 0 },
      fleets: [{ side: 'attacker', name: 'Gottkaiser', start: { 210: 5 } }],
    });
  });

  it('parses parrot reports (spy reports) of an island (moon)', () => {
    const spy = parsePage({ text: fixture('pirate-spy-report.txt') }).records[0];
    expect(spy).toMatchObject({
      kind: 'spy', planetType: 'moon', planetName: 'Mond', playerName: 'Adman', coords: { g: 1, s: 5, p: 7 },
      reportTime: '2026-10-22 00:08:17', destroyChance: 0,
    });
    if (spy.kind !== 'spy') throw new Error('expected spy');
    expect(spy.sections[100]).toMatchObject({ 106: 12, 108: 10, 109: 10, 110: 10, 124: 7 });
    expect(Object.keys(spy.sections[100])).toHaveLength(13);
  });

  it('parses the empire overview with pirate names, islands as moons', () => {
    const rec = parsePage({ text: fixture('pirate-empire.txt') }).records[0];
    if (rec.kind !== 'empire') throw new Error('expected empire');
    expect(rec.planets).toHaveLength(16);
    expect(rec.planets.filter((p) => p.type === 'moon').map((p) => p.coords.s)).toEqual([3, 5, 197, 206]);
    expect(rec.research).toMatchObject({ 106: 46, 199: 8, 131: 27 });
    const total = (id: number) => rec.planets.reduce((s, p) => s + (p.values[id] ?? 0), 0);
    expect(total(1)).toBe(457); // Sägewerk = metal mine
    expect(total(210)).toBe(587295); // Spähpapagei = espionage probe
    expect(total(215)).toBe(5741617); // Fregatte = battle cruiser
    expect(total(503)).toBe(40); // Brandbombe = interplanetary missile
  });

  it('parses battle summaries, hostile parrots and wreck divers in messages', () => {
    const german = fixture('messages.txt');
    const battle = german
      .replace('Trümmerfeld\tMetall: 3.000 Kristall: 1.000', 'Treibgut-Feld\tHolz: 3.000 Gold: 1.000')
      .replace('Gewinn\tMetall: 600.000 Kristall: 250.000 Deuterium: 5', 'Gewinn\tHolz: 600.000 Gold: 250.000 Rum: 5');
    expect(battle).toContain('Treibgut-Feld');
    expect(parsePage({ text: battle }).records.find((r) => r.kind === 'battle')).toMatchObject({
      loot: { metal: 600000, crystal: 250000, deuterium: 5 }, debris: { metal: 3000, crystal: 1000 },
    });
    const hostile = parsePage({
      html: fixture('messages.html').replace('Feindliche Spionagesonden vom Planeten', 'Feindliche Papageien von der Insel'),
    }).records.find((r) => r.kind === 'hostileSpy');
    expect(hostile).toMatchObject({ fromType: 'moon', fromCoords: { g: 2, s: 3, p: 4 } });
    const recycle = parsePage({
      text:
        'Flottenhauptquartier\nRecyclingbericht\n21. Okt 2026, 16:00:00\n' +
        'Deine Wracktaucher haben an den Koordinaten [2:3:4] 1.000 Holz und 2.000 Gold von insgesamt 5.000 Holz und 6.000 Gold gesammelt.',
    }).records[0];
    expect(recycle).toMatchObject({ kind: 'recycle', coords: { g: 2, s: 3, p: 4 }, metal: 1000, crystal: 2000, totalMetal: 5000, totalCrystal: 6000 });
  });

  it('keeps old English names after the renaming in the game', () => {
    expect(idByName('Deuterium Power Plant')).toBe(12);
    expect(idByName('Fusion Power Plant')).toBe(12);
    expect(idByShortName('Fregatte')).toBe(215);
  });
});

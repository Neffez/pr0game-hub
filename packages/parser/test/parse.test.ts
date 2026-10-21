import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeDeck, DEFAULT_DECK, localToEpoch, parsePage, type DeckEvent } from '../src/index.js';
import { elementPoints, sectionPoints } from '../src/tech.js';

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
        position: 5, planetName: 'Heimat', moon: true, destroyed: false, playerId: 1234, playerName: 'Alpha',
        status: ['inactive'], allyId: 77, allyTag: 'DA', debris: { metal: '1.2K', crystal: '300' },
      },
      {
        position: 7, planetName: '', moon: false, destroyed: true, playerId: null, playerName: null,
        status: [], allyId: null, allyTag: null, debris: null,
      },
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
});

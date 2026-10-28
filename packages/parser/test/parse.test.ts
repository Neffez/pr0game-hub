import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeDeck, DEFAULT_DECK, estimateMarketRate, isPhalanxText, localToEpoch, nearestClock, parseFleetsText, parsePage, phalanxPosition, type DeckEvent } from '../src/index.js';
import { isCombatSimulation, parseCombatReportText, parseRecycleReportsText } from '../src/combat.js';
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

  it('parses player messages from HTML, also when they quote a report', () => {
    const item = (id: number, from: string, subject: string, date: string, to: string, body: string) => `
      <div id="message_${id}" class="message-item">
        <div class="message-actions"><span>Spieler Nachrichten</span><a href="#" onclick="return Dialog.PM([1003464], Message.CreateAnswer('${subject}'), '', 'u_1');"></a></div>
        <div class="message-details" id="msgdetails_${id}">
          <div class="message-from">${from}</div><div class="message-subject">${subject}</div><div class="message-date">${date}</div>
          <div class="message-break"></div>
          <div class="message-receiver">An:&nbsp;
            ${to}
          </div>
        </div>
        <div class="message-content" id="msgcontent_${id}">
          ${body}
        </div>
      </div>`;
    const html = `<div class="messages-container"><div class="message-group">
      ${item(3, 'Bob [1:158:7]', 'Re: Kein Betreff', '22. Okt 2026, 21:51:10', 'Alice [1:100:12];', 'Erste Zeile <br>\nzweite Zeile<br>\n<br>\n<br>\nnach Leerzeile &lt;b&gt;')}
      ${item(2, 'Alice [1:100:12]', 'Kein Betreff', '21. Okt 2026, 16:13:22', 'Bob [1:158:7]; Carol [2:3:4];',
        'Feindliche Spionagesonden vom Mond M (Carol) [3:112:1] wurde in der Nähe von Heim (P) [3:100:15] gesichtet.')}
      ${item(1, 'Alice', 'AKS Einladung', '16. Okt 2026, 14:40:29', 'Bob [1:82:4];', 'Der Spieler Alice lädt dich zu einem AKS ein.')}
    </div></div>`;
    const res = parsePage({ html, url: 'game.php?page=messages&category=1' });
    expect(res.pageType).toBe('messages');
    expect(res.records).toEqual([
      {
        kind: 'playerMessage', msgId: 3, time: '2026-10-22 21:51:10',
        from: { name: 'Bob', coords: { g: 1, s: 158, p: 7 } }, to: [{ name: 'Alice', coords: { g: 1, s: 100, p: 12 } }],
        subject: 'Re: Kein Betreff', body: 'Erste Zeile\nzweite Zeile\n\nnach Leerzeile <b>', thread: 'u_1', partnerId: 1003464,
      },
      {
        kind: 'playerMessage', msgId: 2, time: '2026-10-21 16:13:22',
        from: { name: 'Alice', coords: { g: 1, s: 100, p: 12 } },
        to: [{ name: 'Bob', coords: { g: 1, s: 158, p: 7 } }, { name: 'Carol', coords: { g: 2, s: 3, p: 4 } }],
        subject: 'Kein Betreff',
        body: 'Feindliche Spionagesonden vom Mond M (Carol) [3:112:1] wurde in der Nähe von Heim (P) [3:100:15] gesichtet.',
        thread: 'u_1', partnerId: 1003464,
      },
      {
        kind: 'playerMessage', msgId: 1, time: '2026-10-16 14:40:29', from: { name: 'Alice', coords: null },
        to: [{ name: 'Bob', coords: { g: 1, s: 82, p: 4 } }], subject: 'AKS Einladung', body: 'Der Spieler Alice lädt dich zu einem AKS ein.',
        thread: 'u_1', partnerId: 1003464,
      },
    ]);
  });

  it('parses player messages from plain text', () => {
    const text = [
      'Spieler Nachrichten', '0/72',
      'Spieler Nachrichten', 'Bob [1:158:7]', 'Re: Kein Betreff', '22. Okt 2026, 21:51:10', 'An: Alice [1:100:12];', 'Erste Zeile', 'zweite Zeile',
      'Spieler Nachrichten', 'Alice [1:100:12]', 'Kein Betreff', '21. Okt 2026, 16:13:22', 'An: Bob [1:158:7];',
      'Feindliche Spionagesonden vom Mond M (Carol) [3:112:1] wurde in der Nähe von Heim (P) [3:100:15] gesichtet.',
      'Spionageberichte', 'Spionageabteilung', 'Spionagebericht', '21. Okt 2026, 12:00:00',
      'Spionagebericht vom Planeten Heimat (Alpha) [1:234:5] am 21. Okt 2026, 12:00:30', 'Rohstoffe', 'Metall\t1.234.567',
      'Spieler Nachrichten', 'Alice', 'AKS Einladung', '16. Okt 2026, 14:40:29', 'An:', 'Bob [1:82:4];', 'Der Spieler Alice lädt dich zu einem AKS ein.',
      '[Nur Favoriten anzeigen]', 'Seite: [1] [2] »',
    ].join('\n');
    const res = parsePage({ text });
    expect(res.records.map((r) => r.kind)).toEqual(['playerMessage', 'playerMessage', 'playerMessage', 'spy']);
    const [a, b, c] = res.records as any[];
    expect(a).toMatchObject({ time: '2026-10-22 21:51:10', from: { name: 'Bob' }, to: [{ name: 'Alice' }], subject: 'Re: Kein Betreff', body: 'Erste Zeile\nzweite Zeile' });
    expect(b.body).toMatch(/^Feindliche Spionagesonden.*gesichtet\.$/);
    expect(c).toMatchObject({ from: { name: 'Alice', coords: null }, to: [{ name: 'Bob', coords: { g: 1, s: 82, p: 4 } }], body: 'Der Spieler Alice lädt dich zu einem AKS ein.' });
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
      loot: { metal: 252190, crystal: 376570, deuterium: 225792 }, target: null,
      fleets: [
        { side: 'attacker', name: 'pUsteblUme', start: { 207: 6445, 215: 2245 }, end: { 207: 6402, 215: 2235 } },
        { side: 'defender', name: 'Arys', start: { 203: 42, 207: 20, 401: 607 }, end: { 203: 0, 401: 0 } },
      ],
    });
  });

  it('parses a german moon-destruction battle report', () => {
    const text = fixture('combat-report-moon-de.txt');
    expect(parseCombatReportText(text, null)).toMatchObject({
      moonDestruction: true,
      time: '2026-10-24 16:05:37',
      winner: 'defender',
      lost: { attacker: 69000000, defender: 3676000 },
      debris: { metal: 23878500, crystal: 12459500 },
      target: { coords: { g: 3, s: 141, p: 15 }, type: 'moon' },
      fleets: [
        { side: 'attacker', name: 'iHackdiZamm', start: { 207: 1000, 232: 1 }, end: { 207: 1000, 232: 1 } },
        { side: 'defender', name: 'B0b', start: { 204: 69873, 222: 9843 }, end: { 204: 69873, 222: 9843 } },
      ],
    });
    expect(parsePage({ text })).toMatchObject({ pageType: 'combatReport', records: [{ winner: 'defender' }] });
  });

  it('parses a copied german battle report of an ACS (logged in, coordinates shown)', () => {
    const text = fixture('combat-report-de.txt');
    const r = parseCombatReportText(text, null);
    expect(r).toMatchObject({
      kind: 'combatReport', reportId: null, time: '2026-10-24 13:04:03', winner: 'attacker', rounds: 3,
      lost: { attacker: 11114000, defender: 411433000 }, debris: { metal: 142823000, crystal: 68450500 },
      loot: { metal: 0, crystal: 1343846, deuterium: 690373 },
      target: { coords: { g: 3, s: 195, p: 5 }, type: 'moon' },
    });
    const R = { 109: 13, 110: 14, 111: 14 };
    expect(r!.fleets.filter((f) => f.side === 'attacker')).toEqual([
      { side: 'attacker', name: 'CVXII', from: { coords: { g: 3, s: 26, p: 12 }, type: 'moon' }, research: R, start: { 222: 3544 }, end: { 222: 3521 } },
      { side: 'attacker', name: 'Rudolf', from: { coords: { g: 3, s: 200, p: 1 }, type: 'moon' }, research: R, start: { 207: 2178, 215: 4348 }, end: { 207: 2178, 215: 4348 } },
      { side: 'attacker', name: 'CVXII', from: { coords: { g: 3, s: 160, p: 5 }, type: 'moon' }, research: R, start: { 206: 347, 207: 11799, 215: 4406 }, end: { 206: 323, 207: 11794, 215: 4406 } },
      { side: 'attacker', name: 'Rudolf', from: { coords: { g: 3, s: 200, p: 1 }, type: 'moon' }, research: R, start: { 225: 4821 }, end: { 225: 3901 } },
    ]);
    expect(r!.fleets.find((f) => f.side === 'defender')).toMatchObject({ name: 'Hustensaftdealer', from: { coords: { g: 3, s: 195, p: 5 }, type: 'moon' }, start: { 202: 136, 227: 303 }, end: { 202: 0, 227: 0 } });
    // pasted as text when syncing
    expect(parsePage({ text })).toMatchObject({ pageType: 'combatReport', records: [{ reportId: null, loot: { crystal: 1343846 } }] });
  });

  it('reads a shared battle simulation with research levels from the percentages', () => {
    const r = parseCombatReportText(fixture('combat-sim-de.txt'), null);
    expect(r!.fleets.map((f) => [f.side, f.name, f.research])).toEqual([
      ['attacker', 'Angreifer Nr.1', { 109: 15, 110: 13, 111: 14 }],
      ['attacker', 'Angreifer Nr.2', { 109: 14, 110: 13, 111: 14 }],
      ['attacker', 'Angreifer Nr.3', { 109: 15, 110: 13, 111: 14 }],
      ['defender', 'Verteidiger Nr.1', { 109: 15, 110: 14, 111: 14 }],
    ]);
    expect(isCombatSimulation(r!)).toBe(true);
    expect(isCombatSimulation(parseCombatReportText(fixture('combat-report-de.txt'), null)!)).toBe(false);
    // pasted into the sync it is not stored as a battle
    expect(parsePage({ text: fixture('combat-sim-de.txt') })).toMatchObject({ pageType: 'combatReport', records: [], warnings: ['simulation_use_raid_planner'] });
    expect(r!.fleets[1].start).toEqual({ 206: 152, 207: 579, 215: 4025 });
    expect(r!.fleets[3].start).toEqual({ 202: 884, 203: 1300, 204: 1548, 205: 7165, 207: 8199, 208: 1, 210: 2086, 215: 3404, 225: 8708, 227: 2523 });
  });
});

describe('fleet return messages', () => {
  it('reads what each attack fleet brings home', () => {
    const text = [
      'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:48:06',
      'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 408.133 Kristall und 209.670 Deuterium erbeutet',
      '', 'Es gingen folgende Schiffe verloren:', 'Sturmtransporter: 920', '', 'Favorite', 'Forward', 'System Nachrichten', 'Delete',
      'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:42:23',
      'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 195.136 Kristall und 100.247 Deuterium erbeutet',
    ].join('\n');
    const res = parsePage({ text });
    expect(res.pageType).toBe('messages');
    expect(res.records).toEqual([
      { kind: 'fleetReturn', msgId: null, time: '2026-10-24 13:48:06', target: { g: 3, s: 195, p: 5 }, home: { g: 3, s: 200, p: 1 }, metal: 0, crystal: 408133, deuterium: 209670 },
      { kind: 'fleetReturn', msgId: null, time: '2026-10-24 13:42:23', target: { g: 3, s: 195, p: 5 }, home: { g: 3, s: 200, p: 1 }, metal: 0, crystal: 195136, deuterium: 100247 },
    ]);
    const en = parsePage({
      text: 'Fleet return\n24 Oct 2026, 13:42:23\nOne of your fleets returns from a attack at the planet Rees [3:195:5] to Ra [3:200:1]. You have captured 1,000 Metal, 2,000 Crystal and 3,000 Deuterium',
    });
    expect(en.records[0]).toMatchObject({ kind: 'fleetReturn', target: { g: 3, s: 195, p: 5 }, metal: 1000, crystal: 2000, deuterium: 3000 });
  });
});

describe('recycling', () => {
  it('reads every pasted recycling report with the date above it', () => {
    const text = [
      'Flottenhauptquartier', 'Recyclerbericht', '24. Okt 2026, 13:04:12',
      'Deine Recycler haben an den Koordinaten [3:195:5] 40.219.074 Metall und 19.280.927 Kristall von insgesamt 142.823.000 Metall und 68.469.000 Kristall gesammelt.',
      'Es werden 7.590 Recycler für das Trümmerfeld benötigt.',
      'Recyclerbericht', '24. Okt 2026, 14:00:00',
      'Deine Recycler haben an den Koordinaten [3:195:5] 1.000 Metall und 0 Kristall von insgesamt 1.000 Metall und 0 Kristall gesammelt.',
    ].join('\n');
    expect(parseRecycleReportsText(text)).toMatchObject([
      { time: '2026-10-24 13:04:12', metal: 40219074, crystal: 19280927, totalMetal: 142823000, totalCrystal: 68469000 },
      { time: '2026-10-24 14:00:00', metal: 1000, crystal: 0, totalMetal: 1000 },
    ]);
  });

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
        position: 5, planetName: 'Heimat', moon: true, moonName: 'Luna Prime', moonDiameter: 4560, destroyed: false, playerId: 1234, playerName: 'Alpha',
        status: ['inactive'], allyId: 77, allyTag: 'DA', debris: { metal: '1.2K', crystal: '300' }, activity: 0,
      },
      {
        position: 7, planetName: '', moon: false, moonName: null, moonDiameter: null, destroyed: true, playerId: null, playerName: null,
        status: [], allyId: null, allyTag: null, debris: null, activity: null,
      },
    ]);
  });

  it('parses copied galaxy text with the system typed by the user', () => {
    const res = parsePage({ text: fixture('galaxy.txt'), system: '1:3' });
    expect(res).toMatchObject({ pageType: 'galaxy', source: 'text', warnings: [] });
    const rec = res.records[0] as any;
    expect(rec).toMatchObject({ g: 1, s: 3 });
    const row = (position: number, planetName: string, moonName: string | null, playerName: string, status: string[], debris: [string, string] | null, allyTag: string | null = null, activity: number | null = null) => ({
      position, planetName, moon: moonName != null, moonName, destroyed: false, playerId: null, playerName, status,
      allyId: null, allyTag, debris: debris && { metal: debris[0], crystal: debris[1] }, activity,
    });
    const ii = ['longinactive', 'inactive'];
    expect(rec.rows).toEqual([
      row(1, '5', 'Mond', 'Anda', ii, ['148K', '444K']),
      row(2, 'Mondspender', 'MV4U', 'Gottkaiser', [], ['133.504M', '106.906M'], '1337', 17),
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

  it('reads a copied phalanx, which the sync does not store as own fleets', () => {
    const text = [
      'Serverzeit : Okt Fr 23 18:10:40',
      'Scan Position [3:4:1] (Kolonie)',
      'Momentane Flottenbewegungen',
      '21:25:37\t03h 14m 57s\tEine deiner Flotten (208 Kleiner Transporter; 705 Großer Transporter; 539 Sturmtransporter) vom Mond ἰός [2:154:12] erreicht den Planet Kolonie [3:4:1]. Mission: Transport',
      '00:58:47     06h 48m 07s     Eine deiner Flotten (208 Kleiner Transporter; 705 Großer Transporter; 539 Sturmtransporter) kehrt vom Planet Kolonie [3:4:1] zurück zum Mond ἰός [2:154:12]. Mission: Transport',
    ].join('\n');
    expect(isPhalanxText(text)).toBe(true);
    expect(phalanxPosition(text)).toEqual(c(3, 4, 1));
    expect(isPhalanxText(lines.join('\n'))).toBe(false);
    const res = parsePage({ text });
    expect(res).toMatchObject({ pageType: 'phalanx', records: [], warnings: ['phalanx_use_raid_planner'] });
    const rec = parseFleetsText(text)!;
    expect(rec.pageTime).toMatch(/-10-23 18:10:40$/);
    expect(rec.fleets.map((f) => [f.owner, f.mission, f.phase, f.clock, f.seconds, f.from.coords, f.to?.coords])).toEqual([
      ['own', 3, 'out', '21:25:37', 3 * 3600 + 14 * 60 + 57, c(2, 154, 12), c(3, 4, 1)],
      ['own', 3, 'return', '00:58:47', 6 * 3600 + 48 * 60 + 7, c(3, 4, 1), c(2, 154, 12)],
    ]);
    expect(rec.fleets[0].ships).toEqual({ 202: 208, 203: 705, 225: 539 });
  });

  it('reads the marketplace and transfer missions from copied lines', () => {
    const rec = parseFleetsText([
      '10:00:00 | 01h 00m 00s Eine deiner Flotten (5 Großer Transporter) vom Planet Ares [1:100:12] erreicht den Planet Kolonie [3:4:1]. Mission: Marktplatz',
      '11:00:00 | 02h 00m 00s Eine deiner Flotten (5 Großer Transporter) vom Planet Ares [1:100:12] erreicht den Planet Kolonie [3:4:1]. Mission: Transfer',
    ].join('\n'))!;
    expect(rec.fleets.map((f) => f.mission)).toEqual([16, 17]);
  });

  it('parses any fleet event whose arrival clock shows days (nT HH:MM:SS)', () => {
    const secs = 3 * 86400 + 3600 + 25 * 60 + 12;
    const tail = (sentence: string) => `3T 17:13:37 | 3d 01h 25m 12s ${sentence}`;
    const cases: [string, Partial<{ mission: number; phase: string; owner: string }>][] = [
      [
        'Eine Flotten vom Mond A [3:4:1] erreicht den Mond B [1:82:4]. Mission: Angreifen',
        { mission: 1, phase: 'out', owner: 'hostile' },
      ],
      [
        'Eine deiner Flotten (5 Großer Transporter) vom Planet Ares [1:100:12] erreicht den Planet Kolonie [3:4:1]. Mission: Transport',
        { mission: 3, phase: 'out', owner: 'own' },
      ],
      [
        'Eine deiner Flotten (1 Kolonieschiff) vom Planet Ares [1:100:12] erreicht die Position [4:200:7]. Mission: Kolonisieren',
        { mission: 7, phase: 'out', owner: 'own' },
      ],
      [
        'Eine deiner Flotten (10 Recycler) kehrt vom Trümmerfeld Debris [2:50:8] zurück zum Planet Ares [1:100:12]. Mission: Abbauen',
        { mission: 8, phase: 'return', owner: 'own' },
      ],
      [
        'Eine deiner Flotten (1 Spionagesonde) vom Planet Ares [1:100:12] erreicht die Position [5:5:5]. Mission: Expedition',
        { mission: 15, phase: 'out', owner: 'own' },
      ],
    ];
    for (const [sentence, wanted] of cases) {
      const rec = parseFleetsText(tail(sentence))!;
      expect(rec.fleets).toHaveLength(1);
      expect(rec.fleets[0]).toMatchObject({ ...wanted, clock: '17:13:37', seconds: secs });
    }
    const attack = cases[0][0];
    const [clock, rest] = tail(attack).split(' | ');
    const split = [clock, '|', rest.replace(' Eine', '\nEine')].join('\n');
    expect(parseFleetsText(split)!.fleets[0]).toMatchObject({ mission: 1, seconds: secs, clock: '17:13:37' });
  });

  it('parses copied event lines on their own', () => {
    const res = parsePage({ text: lines.join('\n') });
    expect(res).toMatchObject({ pageType: 'fleets', source: 'text' });
    const rec = res.records[0] as any;
    expect(rec.pageTime).toBeNull();
    expect(rec.fleets).toEqual([
      {
        owner: 'own', player: null, mission: 1, missionName: 'Angreifen', phase: 'return',
        from: { coords: c(1, 129, 11), type: 'moon', name: '1 129 11' }, to: { coords: c(1, 100, 12), type: 'planet', name: 'Ares' },
        ships: { 204: 1 }, resources: null, seconds: 17 * 60 + 27, clock: '00:18:43', acs: null,
      },
      {
        owner: 'own', player: null, mission: 4, missionName: 'Stationieren', phase: 'out',
        from: { coords: c(3, 100, 15), type: 'planet', name: 'Domestos' }, to: { coords: c(2, 2, 15), type: 'planet', name: 'Quetzalcoatl' },
        ships: { 203: 7, 204: 68, 207: 4, 215: 2 }, resources: { 901: 0, 902: 0, 903: 180719 }, seconds: 9129, clock: '02:33:25', acs: null,
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

  // A hostile ACS attack as copied by a member: the game writes attacks on the viewer without player name
  // ("Eine Flotten(…)") and the further ACS fleets below the lead without time.
  const acsText = [
    '13:14:00 | 27m 10s Eine Flotten(1 Spionagesonde) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Angreifen',
    '',
    'Eine Flotten(1773 Schlachtschiff; 2 Schlachtkreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff',
    '',
    'Eine Flotten(1322 Schwerer Kreuzer) vom Mond Mond [1:41:1] erreicht den Planet Immer Online [3:115:8]. Mission: Verbandsangriff',
    '13:14:48 | 27m 58s Eine friedliche Flotten(1193 Zerstörer; 7 Behemoth) vom Spieler Lologolo [PN] vom Mond Ratatoskr [3:193:15] erreicht den Planet Immer Online [3:115:8]. Mission: Halten',
    '13:20:00 | 33m 10s Eine feindliche Flotten(5 Spionagesonde) vom Spieler Späher [PN] vom Planet Nest [2:7:3] erreicht den Planet Immer Online [3:115:8]. Mission: Spionieren',
    '13:30:00 | 43m 10s Eine Flotten(10 Leichter Jäger) vom Planet Solo [4:4:4] erreicht den Planet Immer Online [3:115:8]. Mission: Angreifen',
  ];

  it('keeps a foreign ACS fleet that names the player before the start', () => {
    const line =
      '1h 0m 0s Eine Flotten(1773 Schlachtschiff) vom Spieler Ally [PN] vom Mond Mond [2:50:5] erreicht den Planet Ares [1:100:12]. Mission: Verbandsangriff';
    expect(parseFleetsText(line)!.fleets[0].owner).toBe('foreign');
  });

  it('marks an incoming attack as hostile when the game omits the ship list before "vom"', () => {
    const line =
      '3T 17:13:37 | 3d 01h 25m 12s Eine Flotten vom Mond auch ein Satellit [3:4:1] erreicht den Mond Spicy Noodle [1:82:4]. Mission: Angreifen';
    const f = parseFleetsText(line)!.fleets[0];
    expect(f).toMatchObject({
      owner: 'hostile',
      mission: 1,
      from: { coords: c(3, 4, 1), type: 'moon' },
      to: { coords: c(1, 82, 4), type: 'moon' },
    });
  });

  it('marks attacks on the viewer as hostile and keeps the fleets of an ACS together', () => {
    const rec = parsePage({ text: acsText.join('\n') }).records[0] as any;
    expect(rec.fleets.map((f: any) => [f.owner, f.mission, f.seconds, f.clock, f.acs, f.player])).toEqual([
      ['hostile', 1, 1630, '13:14:00', 0, null],
      ['hostile', 2, 1630, '13:14:00', 0, null],
      ['hostile', 2, 1630, '13:14:00', 0, null],
      ['foreign', 5, 1678, '13:14:48', null, 'Lologolo'],
      ['hostile', 6, 1990, '13:20:00', null, 'Späher'],
      ['hostile', 1, 2590, '13:30:00', null, null],
    ]);
    expect(rec.fleets[1]).toMatchObject({
      ships: { 207: 1773, 215: 2 }, from: { coords: c(1, 41, 1), type: 'moon' }, to: { coords: c(3, 115, 8), type: 'planet' },
    });
    expect(rec.fleets[2].ships).toEqual({ 222: 1322 });
  });

  it('does not join sentences after other lines to the event before', () => {
    const text = [acsText[0], 'Übersicht', acsText[2]].join('\n');
    expect((parsePage({ text }).records[0] as any).fleets).toHaveLength(1);
  });

  it('reads the English templates, and an ACS on someone else as foreign', () => {
    const text = [
      '13:14:00 | 27m 10s A Fleets(1 Spy Probe) from Moon Mond [1:41:1] reached the Planet Home [3:115:8]. Mission: Attack',
      'A Fleets(100 Battleship) from Moon Mond [1:41:1] reached the Planet Home [3:115:8]. Mission: ACS Attack',
      '13:20:00 | 33m 10s One of your Fleets (5 Light Fighter) from Planet Home [3:115:8] reached the Planet Target [5:5:5]. Mission: ACS Attack',
      'A Fleet in ACS(7 Light Fighter) from Planet Friend [3:116:1] reached the Planet Target [5:5:5]. Mission: ACS Attack',
    ].join('\n');
    const rec = parsePage({ text }).records[0] as any;
    expect(rec.fleets.map((f: any) => [f.owner, f.mission, f.acs, f.ships])).toEqual([
      ['hostile', 1, 0, { 210: 1 }],
      ['hostile', 2, 0, { 207: 100 }],
      ['own', 2, 1, { 204: 5 }],
      ['foreign', 2, 1, { 204: 7 }],
    ]);
  });

  it('reads an own ACS attack with friendly fleets and the harvest return to a moon', () => {
    const text = [
      'Ereignisse Ausblenden',
      '    13:03:09 | 49m 36s Eine Verbandsflotte (3544 Schwerer Kreuzer) vom Mond Marquette [3:26:12] erreicht den Mond Rees [3:195:5]. Mission: Verbandsangriff',
      '',
      '    Eine deiner Flotten (2178 Schlachtschiff; 4348 Schlachtkreuzer) vom Mond Ra [3:200:1] erreicht den Mond Rees [3:195:5]. Mission: Verbandsangriff',
      '',
      '    Eine Verbandsflotte (347 Kreuzer; 11799 Schlachtschiff; 4406 Schlachtkreuzer) vom Mond Mount Tsukuba [3:160:5] erreicht den Mond Rees [3:195:5]. Mission: Verbandsangriff',
      '',
      '    Eine deiner Flotten (4821 Sturmtransporter) vom Mond Ra [3:200:1] erreicht den Mond Rees [3:195:5]. Mission: Verbandsangriff',
      '    13:04:12 | 50m 39s Eine deiner Flotten (1700 Optimierter Recycler) vom Mond Ra [3:200:1] erreicht das Trümmerfeld [3:195:5]. Mission: Abbauen',
      '    13:41:29 | 01h 27m 56s Eine deiner Flotten (2178 Schlachtschiff; 4348 Schlachtkreuzer) kehrt vom Mond Rees [3:195:5] zurück zum Mond Ra [3:200:1]. Mission: Verbandsangriff',
      '    14:13:45 | 02h 00m 12s Eine deiner Flotten (1700 Optimierter Recycler) kehrt vom Trümmerfeld [3:195:5] zurück zum Planeten Mond Ra [3:200:1]. Mission: Abbauen',
    ].join('\n');
    const rec = parsePage({ text }).records[0] as any;
    expect(rec.fleets.map((f: any) => [f.owner, f.mission, f.phase, f.seconds, f.acs, f.from.name, f.to.type, f.to.name])).toEqual([
      ['foreign', 2, 'out', 2976, 0, 'Marquette', 'moon', 'Rees'],
      ['own', 2, 'out', 2976, 0, 'Ra', 'moon', 'Rees'],
      ['foreign', 2, 'out', 2976, 0, 'Mount Tsukuba', 'moon', 'Rees'],
      ['own', 2, 'out', 2976, 0, 'Ra', 'moon', 'Rees'],
      ['own', 8, 'out', 3039, null, 'Ra', 'debris', null],
      ['own', 2, 'return', 5276, null, 'Rees', 'moon', 'Ra'],
      ['own', 8, 'return', 7212, null, null, 'moon', 'Ra'],
    ]);
    expect(rec.fleets[2].ships).toEqual({ 206: 347, 207: 11799, 215: 4406 });
    expect(rec.fleets[3].ships).toEqual({ 225: 4821 });
  });

  it('splits an ACS event of the page source into its fleets', () => {
    const sentence = (cls: string, ships: string, mission: string) =>
      `<span class="${cls}">Eine <a href="#" class="tooltip attack">Flotten</a><span class="textForBlind"> (${ships})</span> vom Mond Mond ` +
      `<a href="#">[1:41:1]</a> erreicht den Planet Immer Online <a href="#">[3:115:8]</a>. Mission: <a href="#">${mission}</a></span>`;
    const event = `<li>
      <span data-time="1792707523" class="statictimer"></span> |
      <span class="fleets" data-fleet-end-time="1792707523" data-fleet-time="1630">27m 10s</span>
      <td>${sentence('colorMission1Foreign', '1 Spionagesonde', 'Angreifen')}<br><br>${sentence('colorMission2Foreign', '1322 Schwerer Kreuzer', 'Verbandsangriff')}</td>
    </li>`;
    const page = fixture('overview-fleets.html');
    const start = page.indexOf('id="hidden-div2">') + 'id="hidden-div2">'.length;
    const html = page.slice(0, start) + event + page.slice(page.indexOf('</ul>', start));
    const rec = parsePage({ html }).records.find((r) => r.kind === 'fleets') as any;
    expect(rec.fleets.map((f: any) => [f.owner, f.mission, f.seconds, f.acs, f.ships])).toEqual([
      ['hostile', 1, 1630, 0, { 210: 1 }],
      ['hostile', 2, 1630, 0, { 222: 1322 }],
    ]);
  });

  it('reads an own ACS attack with friendly fleets from the page source', () => {
    const { records } = parsePage({ html: fixture('overview-acs.html') });
    expect(records[0]).toMatchObject({ kind: 'overview', current: { coords: c(3, 200, 1), type: 'moon' } });
    const rec = records.find((r) => r.kind === 'fleets') as any;
    expect(rec.fleets.map((f: any) => [f.owner, f.mission, f.phase, f.seconds, f.acs, f.from.name, f.to.type, f.to.name])).toEqual([
      ['foreign', 2, 'out', 3002, 0, 'Marquette', 'moon', 'Rees'],
      ['own', 2, 'out', 3002, 0, 'Ra', 'moon', 'Rees'],
      ['foreign', 2, 'out', 3002, 0, 'Mount Tsukuba', 'moon', 'Rees'],
      ['own', 2, 'out', 3002, 0, 'Ra', 'moon', 'Rees'],
      ['own', 8, 'out', 3065, null, 'Ra', 'debris', null],
      ['own', 2, 'return', 5302, null, 'Rees', 'moon', 'Ra'],
      ['own', 2, 'return', 5645, null, 'Rees', 'moon', 'Ra'],
      ['own', 8, 'return', 7238, null, null, 'moon', 'Ra'],
      ['own', 4, 'out', 9748, null, 'Whorus', 'moon', 'Ra'],
    ]);
    expect(rec.fleets[2].ships).toEqual({ 206: 347, 207: 11799, 215: 4406 });
    expect(rec.fleets[8].resources).toEqual({ 901: 9966170, 902: 0, 903: 0 });
  });

  it('places the arrival clock next to the estimated arrival', () => {
    const at = localToEpoch('2026-10-23 00:18:43');
    expect(nearestClock(at + 95, '00:18:43')).toBe(at);
    expect(nearestClock(at - 600, '00:18:43')).toBe(at);
    const late = localToEpoch('2026-10-22 23:59:30');
    expect(nearestClock(late + 60, '23:59:30')).toBe(late);
    // estimate after the switch to winter time (03:00 CEST -> 02:00 CET), clock before it
    const summer = localToEpoch('2026-10-25 00:18:43');
    expect(summer).toBe(Date.UTC(2026, 9, 24, 22, 18, 43) / 1000);
    expect(nearestClock(Date.UTC(2026, 9, 25, 1, 2, 0) / 1000, '00:18:43')).toBe(summer);
    // and the other way round in spring (02:00 CET -> 03:00 CEST)
    const winter = localToEpoch('2026-03-29 01:30:00');
    expect(nearestClock(Date.UTC(2026, 2, 29, 2, 0, 0) / 1000, '01:30:00')).toBe(winter);
  });

  it('resolves the hour repeated at the switch to winter time', () => {
    const cest = Date.UTC(2026, 9, 25, 0, 53, 0) / 1000; // 02:53 CEST
    const cet = cest + 3600; // 02:53 CET
    // without a hint the later instant, as before
    expect(localToEpoch('2026-10-25 02:53:00')).toBe(cet);
    // a page copied at 02:53 CEST: its time is not an hour ahead
    expect(localToEpoch('2026-10-25 02:53:00', 'Europe/Berlin', cest + 5)).toBe(cest);
    expect(localToEpoch('2026-10-25 02:53:00', 'Europe/Berlin', cet + 5)).toBe(cet);
    // outside the repeated hour the hint changes nothing
    expect(localToEpoch('2026-10-25 03:10:00', 'Europe/Berlin', cest)).toBe(Date.UTC(2026, 9, 25, 2, 10, 0) / 1000);
    // a spy fleet arriving a minute later at 02:54:29 CEST
    expect(nearestClock(cest + 89, '02:54:29')).toBe(cest + 89);
    expect(nearestClock(cet + 89, '02:54:29')).toBe(cet + 89);
    // estimated just before the switch, arriving just after it (02:00:20 CET)
    const after = Date.UTC(2026, 9, 25, 1, 0, 20) / 1000;
    expect(nearestClock(after - 30, '02:00:20')).toBe(after);
    expect(nearestClock(after + 30, '02:59:50')).toBe(after - 30);
    // a skipped spring time keeps the offset before the switch
    expect(localToEpoch('2026-03-29 02:30:00')).toBe(Date.UTC(2026, 2, 29, 1, 30, 0) / 1000);
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
      loot: { metal: 0, crystal: 0, deuterium: 0 },
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

describe('marketplace', () => {
  const offer = (give: 'm' | 'k' | 'd', giveAmount: number, want: 'm' | 'k' | 'd', wantAmount: number) => ({ give: { res: give, amount: giveAmount }, want: { res: want, amount: wantAmount } });

  it('reads the exact reference rate and the offers from the page source', () => {
    const res = parsePage({ html: fixture('marketplace-real-source.html') });
    expect(res.pageType).toBe('marketplace');
    expect(res.source).toBe('html');
    const rec = res.records[0];
    if (rec.kind !== 'marketplace') throw new Error('expected marketplace');
    expect(rec.rate).toEqual({ m: 4.055148796006, k: 1.43283508019, exact: true });
    expect(rec.pageTime).toBe('2026-10-27 21:04:11');
    expect(rec.offers).toHaveLength(5);
    expect(rec.offers[0]).toMatchObject({ id: 16395715, ...offer('k', 1_000_000, 'd', 650_000), endsIn: 4610, ally: false });
    expect(rec.offers[0].ratio).toBeCloseTo(697918 / 650000, 6);
    expect(rec.offers[2]).toMatchObject({ id: 16395236, ...offer('k', 350_000, 'm', 999_000), endsIn: 8973 });
    expect(rec.offers[4]).toMatchObject({ id: 16395539, ...offer('k', 1_430_000, 'd', 1_000_000), endsIn: 72007, ally: true });
    expect(rec.trades).toHaveLength(2);
    expect(rec.trades[0]).toEqual({ epoch: 1793112911, time: '2026-10-27 15:55:11', ...offer('k', 2_000_000, 'd', 1_300_000) });
    expect(rec.trades[1]).toMatchObject({ epoch: 1792997617, ...offer('m', 999_000, 'k', 333_333) });
  });

  it('detects the page source pasted as text', () => {
    const res = parsePage({ text: fixture('marketplace-real-source.html') });
    expect(res.pageType).toBe('marketplace');
    expect(res.source).toBe('html');
  });

  it('reads the offers of a text copy and estimates the rate from their exchange rates', () => {
    const res = parsePage({ text: fixture('marketplace-de.txt') });
    expect(res.pageType).toBe('marketplace');
    expect(res.source).toBe('text');
    const rec = res.records[0];
    if (rec.kind !== 'marketplace') throw new Error('expected marketplace');
    expect(rec.offers).toHaveLength(5);
    expect(rec.offers[0]).toEqual({ id: null, ...offer('k', 1_000_000, 'd', 650_000), ratio: 1.07, endsIn: 4411, ally: false });
    expect(rec.offers[4]).toMatchObject({ ...offer('k', 1_430_000, 'd', 1_000_000), ratio: 1, endsIn: 19 * 3600 + 56 * 60 + 48 });
    expect(rec.trades).toEqual([
      { epoch: null, time: '2026-10-27 15:55:11', ...offer('k', 2_000_000, 'd', 1_300_000) },
      { epoch: null, time: '2026-10-27 10:17:53', ...offer('d', 500_000, 'k', 599_000) },
      { epoch: null, time: '2026-10-26 07:53:37', ...offer('m', 999_000, 'k', 333_333) },
    ]);
    expect(rec.rate?.exact).toBe(false);
    expect(Math.abs(rec.rate!.m! / 4.055148796006 - 1)).toBeLessThan(0.01);
    expect(Math.abs(rec.rate!.k! / 1.43283508019 - 1)).toBeLessThan(0.01);
  });

  it('leaves a resource unknown that no offer ties to deuterium', () => {
    const rate = estimateMarketRate([{ id: null, ...offer('k', 1_000_000, 'd', 650_000), ratio: 1.07, endsIn: 60, ally: false }]);
    expect(rate?.m).toBeNull();
    expect(rate?.k).toBeCloseTo(1_000_000 / (1.07 * 650_000), 6);
    expect(estimateMarketRate([{ id: null, ...offer('k', 350_000, 'm', 999_000), ratio: 0.99, endsIn: 60, ally: false }])).toBeNull();
    expect(estimateMarketRate([])).toBeNull();
  });
});

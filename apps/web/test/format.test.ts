import { beforeEach, describe, expect, it } from 'vitest';
import { dateFormat, datePattern, dateTime, fmt, ipmCalcLink, ipmStart, moonCalcLink, numDate, fmtSigned, protectionStatus, resText, short, simLinks, toolsIndexUrl, trashSimExport, type UniverseSettings } from '../src/format';
import { setLocale } from '../src/i18n';
import { decompressFromEncodedURIComponent } from 'lz-string';

describe('format', () => {
  beforeEach(() => setLocale('de'));

  it('shows times in 24 hours, also in English', () => {
    setLocale('en');
    const afternoon = new Date(2026, 9, 23, 15, 20).getTime() / 1000;
    expect(dateTime(afternoon)).not.toMatch(/AM|PM/);
    expect(dateTime(afternoon)).toMatch(/[0-2][0-9]:20/);
  });

  it('formats dates per language or the chosen date format', () => {
    const d = new Date(2026, 9, 3, 9, 5, 7);
    const epoch = d.getTime() / 1000;
    dateFormat.value = 'auto';
    expect(dateTime(epoch)).toBe('03.10.26, 09:05');
    expect(numDate(d, 'none')).toBe('03.10.');
    setLocale('en');
    expect(dateTime(epoch)).toBe('03/10/26, 09:05');
    expect(datePattern()).toBe('dd/MM/yyyy');
    dateFormat.value = 'ymd';
    expect(dateTime(epoch)).toBe('2026-10-03, 09:05');
    expect(numDate(d, 'none')).toBe('10-03');
    dateFormat.value = 'dmy.';
    expect(numDate(d)).toBe('03.10.2026');
    expect(datePattern()).toBe('dd.MM.yyyy');
    dateFormat.value = 'auto';
  });

  it('formats numbers per language', () => {
    expect(fmt(1234567)).toBe('1.234.567');
    expect(fmt(1.5, 2)).toBe('1,50');
    expect(fmt(null)).toBe('–');
    expect(fmtSigned(5)).toBe('+5');
    setLocale('en');
    expect(fmt(1234567)).toBe('1,234,567');
    expect(fmt(1.5, 2)).toBe('1.50');
  });

  it('shortens large numbers with the language suffixes', () => {
    expect(short(1_234_567)).toBe('1,23 Mio');
    expect(short(25_000)).toBe('25,0k');
    expect(short(999)).toBe('999');
    setLocale('en');
    expect(short(1_234_567)).toBe('1.23M');
    expect(short(2.5e9)).toBe('2.50B');
  });

  it('formats dates in the current language (cached formatters follow a language switch)', () => {
    const t = Date.UTC(2026, 9, 21, 10, 5) / 1000;
    const de = dateTime(t);
    expect(de).toMatch(/^21\.10\.26/);
    setLocale('en');
    expect(dateTime(t)).toMatch(/^21\/10\/26/);
    expect(dateTime(null)).toBe('–');
  });

  it('links the combat simulators with a spy report like the game', () => {
    const links = simLinks('https://pr0game.com/uni7', { 901: 2023509, 202: 136, 115: 10 });
    expect(links.game).toBe('https://pr0game.com/uni7/game.php?page=battleSimulator&im[115]=10&im[202]=136&im[901]=2023509');
    expect(links.trash).toBe('https://pr0game.com/uni7/battlesim.html?&im[115]=10&im[202]=136&im[901]=2023509');
  });

  it("fills the game simulator's ACS slots with the attacking fleets", () => {
    const links = simLinks('https://pr0game.com/uni7/', { 901: 5 }, [
      { ships: { 207: 1773, 215: 2 }, research: { 109: 12, 110: 11, 111: 13, 115: 10 } },
      { ships: { 204: 100, 202: 0 }, research: {} },
    ]);
    expect(links.game).toBe(
      'https://pr0game.com/uni7/game.php?page=battleSimulator&slots=2'
        + '&battleinput[0][0][109]=12&battleinput[0][0][110]=11&battleinput[0][0][111]=13&battleinput[0][0][207]=1773&battleinput[0][0][215]=2'
        + '&battleinput[1][0][109]=0&battleinput[1][0][110]=0&battleinput[1][0][111]=0&battleinput[1][0][204]=100&im[901]=5',
    );
    expect(links.trash).toMatch(/^https:\/\/pr0game\.com\/uni7\/battlesim\.html\?sim=[\w+$-]+$/);
  });

  it('puts hold fleets on the defender side from the second slot on', () => {
    const links = simLinks(
      'https://pr0game.com/uni7/',
      { 901: 5 },
      [{ ships: { 207: 50 }, research: { 109: 10 } }],
      [1, 2, 3],
      [{ ships: { 204: 100 }, research: { 109: 1, 110: 2, 111: 3 } }, { ships: { 206: 7 }, research: {} }],
    );
    expect(links.game).toBe(
      'https://pr0game.com/uni7/game.php?page=battleSimulator&slots=3'
        + '&battleinput[0][0][109]=10&battleinput[0][0][110]=0&battleinput[0][0][111]=0&battleinput[0][0][207]=50'
        + '&battleinput[1][1][109]=1&battleinput[1][1][110]=2&battleinput[1][1][111]=3&battleinput[1][1][204]=100'
        + '&battleinput[2][1][109]=0&battleinput[2][1][110]=0&battleinput[2][1][111]=0&battleinput[2][1][206]=7&im[901]=5',
    );
    const rows = decompressFromEncodedURIComponent(links.trash.split('sim=')[1]).trim().split('\n');
    expect(rows.map((r) => r.split(' ').slice(0, 2).join(' '))).toEqual(['5 0', '0 0', '1 0', '1 1', '1 2']);
    expect(rows[3].split(' ').length).toBe(rows[2].split(' ').length);
  });

  it('links the battle simulator with the spy report, the attackers and the universe values', async () => {
    const { battleSimLink } = await import('../src/format');
    const { decodeShare } = await import('@pr0hub/battle');
    const u = { galaxies: 4, systems: 400, positions: 15, circularGalaxies: true, circularSystems: false, galaxyDistanceFactor: 20000,
      systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 10000, buildingSpeed: 0,
      researchSpeed: 0, shipyardSpeed: 0, resourceMultiplier: 0, storageMultiplier: 1, universityFactor: 8, timezone: 'Europe/Berlin', gameUrl: '', fleetDebrisPercent: 50, defenseDebrisPercent: 10, bigShields: true } as UniverseSettings;
    // spy values: resources, ships, defense, research (only combat research goes to the planet), a missile
    const values = { 901: 5000, 902: 300, 903: 7, 202: 3, 401: 400, 405: 20, 503: 2, 109: 12, 111: 11, 114: 8 };
    const link = battleSimLink(u, values, [{ ships: { 207: 50, 210: 0 }, research: { 109: 14, 118: 10, 120: 5 }, from: [1, 100, 5], speed: 80, name: 'Neffez' }], [1, 110, 8],
      [{ ships: { 204: 100 }, research: { 110: 3, 117: 6 }, from: [1, 105, 3], speed: 90 }], 'Alpha');
    expect(link.startsWith('/battle-simulator/#')).toBe(true);
    const s = decodeShare(link.split('#')[1]);
    expect(s.attackers).toEqual([{ units: { 207: 50 }, research: { 109: 14, 118: 10 }, from: [1, 100, 5], speed: 80, name: 'Neffez' }]);
    expect(s.defenders).toEqual([
      { units: { 202: 3, 401: 400, 405: 20 }, research: { 109: 12, 111: 11 }, from: null, speed: 100, name: 'Alpha' },
      { units: { 204: 100 }, research: { 110: 3, 117: 6 }, from: [1, 105, 3], speed: 90, name: null },
    ]);
    expect(s.target).toEqual([1, 110, 8]);
    expect(s.resources).toEqual({ metal: 5000, crystal: 300, deuterium: 7 });
    expect(s.uni).toMatchObject({ fd: 50, dd: 10, bs: 1, gs: 4, ut: 1, gt: 0, ms: 400 });
    // without debris settings the simulator keeps its own
    expect(decodeShare(battleSimLink({ ...u, fleetDebrisPercent: undefined, defenseDebrisPercent: undefined } as never, values).split('#')[1]).uni.fd).toBeUndefined();
  });

  it('writes the TrashSim export string like TrashSim itself', () => {
    // spy report and attacker of a real TrashSim export (uni 7)
    const spy = {
      901: 2023509, 902: 3670693, 903: 2828917, 202: 136, 203: 1216, 204: 9208, 205: 55, 206: 7077, 207: 1060, 209: 400, 210: 354, 215: 1007,
      222: 122, 225: 57, 227: 303, 14: 2, 21: 1, 41: 1, 106: 9, 108: 11, 109: 10, 110: 11, 111: 12, 113: 10, 114: 8, 115: 10, 117: 10, 118: 7,
      120: 12, 121: 7, 122: 4, 124: 11, 131: 9, 132: 9, 133: 9, 134: 15,
    };
    const attacker = { ships: { 204: 11, 215: 3000 }, research: { 109: 13, 110: 14, 111: 14, 115: 9, 117: 9, 118: 9, 134: 13 } };
    expect(trashSimExport(spy, null, [attacker])).toBe(
      'EwBmGYFYQTgAnANgOwkTcdgA4cwIzJzQBQIc5+m+ALHLXPE-ZuW-SO1x97-fhUF9u4TsIokBlSgPzAOCovkhDB+TqvbrxlJPWD5EjUNmIrUyJWnY0NUOt21Lg8yEVGtNX3iSA',
    );
  });
});

describe('tools index link', () => {
  it('is the parent of the universe flight calculator, else the public tools', () => {
    expect(toolsIndexUrl({ flightCalculatorUrl: 'https://tools.example/x/flight-calculator/#a=1' } as never)).toBe('https://tools.example/x/');
    expect(toolsIndexUrl({} as never)).toBe('/');
    expect(toolsIndexUrl(null)).toBe('/');
  });
});

describe('loot calculator link', () => {
  it('opens the settlement in the calculator next to the flight calculator', async () => {
    const { lootCalcLink } = await import('../src/format');
    const { decodeShare, emptyState } = await import('@pr0hub/loot');
    const state = { ...emptyState(), participants: [{ id: 'u1', name: 'Carol', flightDeut: 5, recDeut: 0, missiles: 0 }] };
    const u = { flightCalculatorUrl: 'https://tools.example/x/flight-calculator/' } as never;
    const link = lootCalcLink(u, state);
    expect(link.startsWith('https://tools.example/x/acs-loot/#s=')).toBe(true);
    expect(decodeShare(link.split('#s=')[1])).toEqual(state);
    expect(lootCalcLink({} as never, state)).toMatch(/^\/acs-loot\/#s=/);
  });

  it('links the IPM calculator with own research and the defense of a spy report', () => {
    const u = { galaxies: 4, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000,
      systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 5000, buildingSpeed: 0,
      researchSpeed: 0, shipyardSpeed: 0, resourceMultiplier: 0, storageMultiplier: 1, universityFactor: 8, timezone: 'Europe/Berlin', gameUrl: '' } as UniverseSettings;
    const values = { 401: 400, 404: 20, 502: 7, 503: 3, 111: 11, 901: 5000, 202: 3 };
    const link = new URL(ipmCalcLink(u, { from: [1, 100, 5], silo: 6, missiles: 30, to: [1, 110, 8], research: { 117: 6, 109: 12 }, values }), 'http://hub.test');
    expect(link.pathname).toBe('/ipm-calculator/');
    expect(Object.fromEntries(new URLSearchParams(link.hash.slice(1)))).toEqual({
      sg: '1', ss: '100', sp: '5', tg: '1', ts: '110', tp: '8', i: '6', w: '12', sl: '6', n: '30', a: '11', ic: '7', d401: '400', d404: '20', d503: '3', ms: '400', gt: '1', gs: '2',
    });
    // a moon: the planet's interceptors, the range factor of the universe
    const moon = new URLSearchParams(new URL(ipmCalcLink({ ...u, missileRangeFactor: 0.5 } as UniverseSettings, { from: null, to: [1, 110, 8], moon: true, values, planetInterceptors: 4 }), 'http://hub.test').hash.slice(1));
    expect([moon.get('m'), moon.get('ic'), moon.get('mrf'), moon.get('sg')]).toEqual(['1', '4', '0.5', null]);
    const flight = { ...u, flightCalculatorUrl: 'https://tools.example/fc/flight-calculator/' } as UniverseSettings;
    expect(ipmCalcLink(flight, { from: null, to: [1, 1, 1] })).toMatch(/^https:\/\/tools\.example\/fc\/ipm-calculator\/#/);
  });

  it('links the moon destruction calculator with the moon from the galaxy view', () => {
    const u = { systems: 400 } as UniverseSettings;
    const link = new URL(moonCalcLink(u, [3, 200, 1], { name: 'Ra', diameter: 4560 }), 'http://hub.test');
    expect(link.pathname).toBe('/moon-destruction/');
    expect(Object.fromEntries(new URLSearchParams(link.hash.slice(1)))).toEqual({ d: '4560', tg: '3', ts: '200', tp: '1', mn: 'Ra' });
    const flight = { ...u, flightCalculatorUrl: 'https://tools.example/fc/flight-calculator/' } as UniverseSettings;
    expect(moonCalcLink(flight, [1, 2, 3])).toBe('https://tools.example/fc/moon-destruction/#tg=1&ts=2&tp=3');
  });

  it('starts missiles from the nearest planet whose silo launches, else the nearest', () => {
    const u = { galaxies: 4, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000,
      systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500 } as UniverseSettings;
    const planets = [
      { name: 'A', coords: { g: 2, s: 110, p: 8 }, type: 'planet' as const },
      { name: 'B', coords: { g: 1, s: 300, p: 1 }, type: 'planet' as const },
      { name: 'M', coords: { g: 1, s: 111, p: 1 }, type: 'moon' as const },
      { name: 'C', coords: { g: 1, s: 130, p: 4 }, type: 'planet' as const },
    ];
    // without silo data: the nearest planet in the galaxy (moons have no silo)
    expect(ipmStart(u, planets, [1, 110, 8])).toEqual({ c: [1, 130, 4], silo: 0, ipm: 0 });
    expect(ipmStart(u, planets, [3, 1, 1])).toBeNull();
    expect(ipmStart(u, undefined, [1, 1, 1])).toBeNull();
    // a launching silo (4+) wins over a nearer planet without; among those the nearest, across the ring's edge too
    const silos = [
      { coords: { g: 1, s: 112, p: 1 }, type: 'planet' as const, silo: 3, ipm: 0 },
      { coords: { g: 1, s: 150, p: 1 }, type: 'planet' as const, silo: 5, ipm: 20 },
      { coords: { g: 1, s: 395, p: 1 }, type: 'planet' as const, silo: 8, ipm: 40 },
    ];
    expect(ipmStart(u, silos, [1, 110, 8])).toEqual({ c: [1, 150, 1], silo: 5, ipm: 20 });
    expect(ipmStart(u, silos, [1, 5, 8])).toEqual({ c: [1, 395, 1], silo: 8, ipm: 40 });
  });
});

describe('noob protection', () => {
  const u = { noobLimit: 5_000_000, noobFactor: 5 } as unknown as UniverseSettings;
  it('derives weak and strong from the own points like the game', () => {
    // target up to the limit and more than 5x below: weak; the synced view is replaced
    expect(protectionStatus(u, 10_000_000, 1_000_000, ['strong'])).toEqual(['noob']);
    expect(protectionStatus(u, 5_000_000, 1_000_000, [])).toEqual([]);
    // above the limit nobody is protected
    expect(protectionStatus(u, 100_000_000, 6_000_000, ['noob'])).toEqual([]);
    // own points below the limit and the target more than 5x above: strong
    expect(protectionStatus(u, 1_000_000, 6_000_000, ['vacation'])).toEqual(['vacation', 'strong']);
    expect(protectionStatus(u, 6_000_000, 40_000_000, [])).toEqual([]);
  });
  it('leaves banned and inactive players unprotected unless inactive protection is on', () => {
    expect(protectionStatus(u, 10_000_000, 1_000_000, ['banned', 'noob'])).toEqual(['banned']);
    expect(protectionStatus(u, 10_000_000, 1_000_000, ['inactive'])).toEqual(['inactive']);
    expect(protectionStatus(u, 1_000_000, 6_000_000, ['inactive'])).toEqual(['inactive']);
    const inactives = { ...u, noobInactives: true } as UniverseSettings;
    // without points limit for inactive players
    expect(protectionStatus(inactives, 100_000_000, 6_000_000, ['longinactive'])).toEqual(['longinactive', 'noob']);
    expect(protectionStatus(inactives, 1_000_000, 6_000_000, ['inactive'])).toEqual(['inactive']);
  });
  it('keeps the synced status without a limit or points', () => {
    expect(protectionStatus({} as UniverseSettings, 10_000_000, 1_000_000, ['strong'])).toEqual(['strong']);
    expect(protectionStatus(u, undefined, 1_000_000, ['noob'])).toEqual(['noob']);
    expect(protectionStatus(u, 10_000_000, undefined, ['noob'])).toEqual(['noob']);
  });

  it('writes resources in short form, leaving out empty ones', () => {
    setLocale('de');
    expect(resText({ m: 1234567, k: 0, d: 50 })).toBe('1,23 Mio Metall, 50 Deuterium');
    expect(resText({ m: 0, k: 0, d: 0 })).toBe('');
  });
});

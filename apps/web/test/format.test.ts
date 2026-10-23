import { beforeEach, describe, expect, it } from 'vitest';
import { dateFormat, datePattern, dateTime, fmt, numDate, fmtSigned, short, simLinks, trashSimExport } from '../src/format';
import { setLocale } from '../src/i18n';

describe('format', () => {
  beforeEach(() => setLocale('de'));

  it('shows times in 24 hours, also in English', () => {
    setLocale('en');
    expect(dateTime(Date.UTC(2026, 9, 23, 15, 20) / 1000)).not.toMatch(/AM|PM/);
    expect(dateTime(Date.UTC(2026, 9, 23, 15, 20) / 1000)).toMatch(/[0-2][0-9]:20/);
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

import { beforeEach, describe, expect, it } from 'vitest';
import { dateTime, fmt, fmtSigned, short } from '../src/format';
import { setLocale } from '../src/i18n';

describe('format', () => {
  beforeEach(() => setLocale('de'));

  it('shows times in 24 hours, also in English', () => {
    setLocale('en');
    expect(dateTime(Date.UTC(2026, 9, 23, 15, 20) / 1000)).not.toMatch(/AM|PM/);
    expect(dateTime(Date.UTC(2026, 9, 23, 15, 20) / 1000)).toMatch(/[0-2][0-9]:20/);
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
});

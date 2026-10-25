// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTexts, copy, fmtNum, initTexts, lang, setLang, storedLang, t } from '../shared/shell.js';

const TEXTS = { de: { title: 'Rechner', hello: 'Hallo {name}' }, en: { title: 'Calculator', hello: 'Hello {name}', onlyEn: 'English only' } };

describe('tool shell', () => {
  beforeEach(() => localStorage.clear());

  it('takes the stored language, then the one of the loot calculator, then the browser', () => {
    expect(storedLang()).toBe(/^de\b/i.test(navigator.language) ? 'de' : 'en');
    localStorage.setItem('pr0loot.lang.v1', JSON.stringify('de'));
    expect(storedLang()).toBe('de');
    localStorage.setItem('pr0tools.lang', JSON.stringify('en'));
    expect(storedLang()).toBe('en');
    localStorage.setItem('pr0tools.lang', JSON.stringify('xx'));
    expect(storedLang()).toBe('de');
  });

  it('fills placeholders, falls back to English and merges the shared header texts', () => {
    localStorage.setItem('pr0tools.lang', JSON.stringify('de'));
    expect(initTexts(TEXTS)).toBe('de');
    expect(t('hello', { name: 'Rolf' })).toBe('Hallo Rolf');
    expect(t('onlyEn')).toBe('English only');
    expect(t('share')).toBe('Link teilen');
    expect(t('missing')).toBe('missing');
    setLang('en');
    expect(lang()).toBe('en');
    expect(JSON.parse(localStorage.getItem('pr0tools.lang')!)).toBe('en');
    setLang('fr');
    expect(lang()).toBe('en');
  });

  it('applies the static texts of the markup', () => {
    document.body.innerHTML = '<span data-t="title"></span><input data-t-ph="hello"><button data-t-tip="share" data-t-aria="share"></button>'
      + '<div id="langSeg"><button data-lang="de"></button><button data-lang="en"></button></div>';
    initTexts(TEXTS);
    setLang('de');
    applyTexts();
    expect(document.querySelector('span')!.textContent).toBe('Rechner');
    expect(document.querySelector('input')!.placeholder).toBe('Hallo {name}');
    expect(document.querySelector('button')!.getAttribute('data-tip')).toBe('Link teilen');
    expect(document.documentElement.lang).toBe('de');
    expect(document.title).toBe('Rechner · pr0game');
    expect(document.querySelector('[data-lang="de"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('copies without the clipboard API and confirms in the toast', () => {
    document.body.innerHTML = '<div class="toast" id="toast"></div>';
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    copy('https://example.org/#a=1', 'Link copied');
    expect(document.getElementById('toast')!.textContent).toBe('Link copied');
    expect(document.getElementById('toast')!.classList.contains('show')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('formats numbers like the game', () => {
    expect(fmtNum(1234567, 'de')).toBe('1.234.567');
    expect(fmtNum(-1234.4, 'en')).toBe('-1,234');
  });
});

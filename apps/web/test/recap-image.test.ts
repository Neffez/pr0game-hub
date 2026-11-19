import { describe, expect, it } from 'vitest';
import { recapSvg, type RecapImageTexts } from '../src/recapImage';

const base: RecapImageTexts = {
  label: 'Recap · Diese Woche',
  title: 'KW 47 · 16.11. – 19.11.',
  alliance: '[SF] <Sterne> & Co',
  kpis: [
    { value: '96', label: 'Syncs', change: { text: '▲ 52 %', up: true } },
    { value: '5 / 8', label: 'Aktive Mitglieder', change: null },
    { value: '1.201', label: 'Punkte', change: { text: '▼ 3 %', up: false } },
    { value: '2', label: 'Neue Abzeichen', change: null },
  ],
  highlightsTitle: 'Highlights',
  highlights: [{ icon: 'medal', text: 'Meiste Punkte · 556 Punkte', name: 'neffez' }],
  kindsTitle: 'Was eingefügt wurde',
  kinds: [{ label: 'Galaxie', value: '256', share: 1 }],
  badgesTitle: 'Neue Abzeichen',
  badges: [],
  moreBadges: null,
  openTitle: 'Da geht noch was',
  galaxy: null,
  open: [],
  footer: 'Stand 19.11.26',
};

describe('recap image', () => {
  it('escapes names and grows with the content', () => {
    const small = recapSvg(base);
    expect(small.svg).toContain('[SF] &lt;Sterne&gt; &amp; Co');
    expect(small.svg).not.toContain('<Sterne>');
    const badge = { key: 'scout' as const, level: 3, name: 'kalle', badge: 'Späher Stufe 3' };
    const big = recapSvg({ ...base, badges: [badge, badge, badge, badge], galaxy: { text: '40 % der Galaxie', share: 0.4 }, open: ['3 von 8 ohne Punkte'] });
    expect(big.height).toBeGreaterThan(small.height);
    // a reached level in its colour (gold for level 3)
    expect(big.svg).toContain('#d4af37');
  });
});

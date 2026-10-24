import { describe, expect, it } from 'vitest';
import { cleanState, decodeShare, encodeShare, emptyState } from '../src/index.js';

describe('settlement input', () => {
  it('cleans untrusted data', () => {
    const s = cleanState({
      participants: [{ id: 'a', name: ' Rolf ', flightDeut: '1200', missiles: -3 }, ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}` }))],
      helpers: [{ id: 'h', name: 'H', keepPct: 250 }],
      battles: [{ time: 1, loot: { m: 1.6, k: 'x' }, fleets: [{ participant: 'a', start: { 207: 3, abc: 1 }, end: {} }, { participant: 'nobody', start: {}, end: {} }] }],
      recycling: [{ by: 'h', m: 5, k: 6 }, { by: 'ghost', m: 1, k: 1 }],
      settings: { mode: 'investment', rates: { m: 0, k: 2 }, cargoShip: 999 },
      transfers: [{ from: 'a', to: 'h', res: { m: 1 } }],
      evil: '<script>',
    });
    expect(s.participants).toHaveLength(5);
    expect(s.participants[0]).toMatchObject({ id: 'a', name: 'Rolf', flightDeut: 1200, missiles: 0 });
    expect(s.helpers[0].keepPct).toBe(100);
    expect(s.battles[0]).toEqual({ time: 1, loot: { m: 2, k: 0, d: 0 }, fleets: [{ participant: 'a', start: { 207: 3 }, end: {} }] });
    expect(s.recycling).toEqual([{ by: 'h', m: 5, k: 6 }]);
    expect(s.settings).toMatchObject({ mode: 'investment', rates: { m: 2.8, k: 2, d: 1 }, cargoShip: 203 });
    expect(s.transfers).toEqual([{ from: 'a', to: 'h', res: { m: 1, k: 0, d: 0 } }]);
    expect('evil' in s).toBe(false);
  });

  it('round-trips share links, also with umlauts', () => {
    const state = { ...emptyState(), participants: [{ id: 'a', name: 'Jörg', flightDeut: 0, recDeut: 0, missiles: 0 }] };
    const text = encodeShare(state);
    expect(text).toMatch(/^[\w-]+$/);
    expect(decodeShare(text)).toEqual(state);
    expect(decodeShare('not json')).toBeNull();
  });
});

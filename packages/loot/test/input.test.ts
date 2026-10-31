import { describe, expect, it } from 'vitest';
import { cleanState, decodeShare, encodeShare, emptyState } from '../src/index.js';

describe('settlement input', () => {
  it('cleans untrusted data', () => {
    const s = cleanState({
      participants: [{ id: 'a', name: ' Rolf ', flightDeut: '1200', missiles: -3 }, ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}` }))],
      helpers: [{ id: 'h', name: 'H', keepPct: 250 }],
      battles: [{ time: 1, loot: { m: 1.6, k: 'x' }, fleets: [{ participant: 'a', start: { 207: 3, abc: 1 }, end: {} }, { participant: 'nobody', start: {}, end: {} }] }],
      recycling: [{ by: 'h', m: 5, k: 6 }, { by: 'ghost', m: 1, k: 1 }],
      settings: { mode: 'investment', rates: { m: 0, k: 2 }, cargoShip: 999, helperDeut: 'yes' },
      transfers: [{ from: 'a', to: 'h', res: { m: 1 } }],
      evil: '<script>',
    });
    expect(s.participants).toHaveLength(5);
    expect(s.participants[0]).toMatchObject({ id: 'a', name: 'Rolf', flightDeut: 1200, missiles: 0 });
    expect(s.helpers[0]).toEqual({ id: 'h', name: 'H', keepPct: 20, recDeut: 0 });
    expect(s.settings.helperDeut).toBe(false);
    expect(cleanState({ settings: { helperDeut: true } }).settings.helperDeut).toBe(true);
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
    expect(decodeShare('zgarbage')).toBeNull();
  });

  it('packs every field of a settlement into a short link', () => {
    const state = cleanState({
      participants: [
        { id: 'u3', name: 'CVXII', flightDeut: 2098033, recDeut: 475000, missiles: 2, extra: { m: 5, k: 0, d: 7 } },
        { id: 'g1', name: 'Gast', flightDeut: 0, recDeut: 0, missiles: 0 },
      ],
      helpers: [{ id: 'u5', name: 'B0b', keepPct: 15, recDeut: 300 }],
      battles: [
        {
          time: 1792839843, loot: { m: 1, k: 1343846, d: 690373 }, debris: { m: 142823000, k: 68450500 },
          fleets: [
            { participant: 'u3', start: { 207: 11799, 222: 3544 }, end: { 207: 11794, 222: 3521 }, carried: { m: 0, k: 0, d: 50 } },
            { participant: 'g1', start: { 225: 4821 }, end: { 225: 3901 }, loot: { m: 0, k: 603269, d: 309917 } },
          ],
        },
        { time: null, loot: { m: 0, k: 0, d: 0 }, fleets: [] },
      ],
      recycling: [{ by: 'u5', m: 29606647, k: 14193354, field: { m: 49893281, k: 23918717 }, time: 1792848574 }, { by: 'g1', m: 3, k: 4 }],
      settings: { mode: 'investment', rates: { m: 4.05, k: 1.19, d: 1 }, refRates: { m: 2.8, k: 0.8, d: 1 }, deficitMetalShare: 0.25, cargoShip: 202, helperDeut: true },
      transfers: [{ from: 'u5', to: 'u3', res: { m: 10, k: 20, d: 0 } }],
    });
    const text = encodeShare(state);
    expect(text).toMatch(/^z[\w-]+$/);
    expect(decodeShare(text)).toEqual(state);
  });

  it('opens older links and makes them much shorter', () => {
    const old =
      'eyJwYXJ0aWNpcGFudHMiOlt7ImlkIjoidTMiLCJuYW1lIjoiQ1ZYSUkiLCJmbGlnaHREZXV0IjoyMDk4MDMzLCJyZWNEZXV0Ijo0NzUwMDAsIm1pc3NpbGVzIjowfSx7ImlkIjoidTEiLCJuYW1lIjoiUnVkb2xmIiwiZmxpZ2h0RGV1dCI6MzIzOTk3LCJyZWNEZXV0Ijo0MTAwMDAsIm1pc3NpbGVzIjowfV0sImhlbHBlcnMiOlt7ImlkIjoidTUiLCJuYW1lIjoiQjBiIiwia2VlcFBjdCI6MjAsInJlY0RldXQiOjB9XSwiYmF0dGxlcyI6W3sidGltZSI6MTc5MjgzOTg0MywibG9vdCI6eyJtIjowLCJrIjoxMzQzODQ2LCJkIjo2OTAzNzN9LCJmbGVldHMiOlt7InBhcnRpY2lwYW50IjoidTMiLCJzdGFydCI6eyIyMDYiOjM0NywiMjA3IjoxMTc5OSwiMjE1Ijo0NDA2LCIyMjIiOjM1NDR9LCJlbmQiOnsiMjA2IjozMjMsIjIwNyI6MTE3OTQsIjIxNSI6NDQwNiwiMjIyIjozNTIxfX0seyJwYXJ0aWNpcGFudCI6InUxIiwic3RhcnQiOnsiMjA3IjoyMTc4LCIyMTUiOjQzNDgsIjIyNSI6NDgyMX0sImVuZCI6eyIyMDciOjIxNzgsIjIxNSI6NDM0OCwiMjI1IjozOTAxfSwibG9vdCI6eyJtIjowLCJrIjo2MDMyNjksImQiOjMwOTkxN319XSwiZGVicmlzIjp7Im0iOjE0MjgyMzAwMCwiayI6Njg0NTA1MDB9fV0sInJlY3ljbGluZyI6W3siYnkiOiJ1MSIsIm0iOjQwMjE5MDc0LCJrIjoxOTI4MDkyNywiZmllbGQiOnsibSI6MTQyODIzMDAwLCJrIjo2ODQ2OTAwMH0sInRpbWUiOjE3OTI4Mzk4NTJ9LHsiYnkiOiJ1MyIsIm0iOjUyNzEwNjQ1LCJrIjoyNTI2OTM1NiwiZmllbGQiOnsibSI6MTAyNjAzOTI2LCJrIjo0OTE4ODA3M30sInRpbWUiOjE3OTI4NDA4Nzl9LHsiYnkiOiJ1MSIsIm0iOjIwMjg2NjM0LCJrIjo5NzI1MzYzLCJmaWVsZCI6eyJtIjoyMDI4NjYzNCwiayI6OTcyNTM2M30sInRpbWUiOjE3OTI4NDg1NzR9LHsiYnkiOiJ1NSIsIm0iOjI5NjA2NjQ3LCJrIjoxNDE5MzM1NCwiZmllbGQiOnsibSI6NDk4OTMyODEsImsiOjIzOTE4NzE3fX1dLCJzZXR0aW5ncyI6eyJtb2RlIjoiZXF1YWwiLCJyYXRlcyI6eyJtIjo0LjA1LCJrIjoxLjE5LCJkIjoxfSwicmVmUmF0ZXMiOm51bGwsImRlZmljaXRNZXRhbFNoYXJlIjowLCJjYXJnb1NoaXAiOjIwMywiaGVscGVyRGV1dCI6ZmFsc2V9LCJ0cmFuc2ZlcnMiOm51bGx9';
    const state = decodeShare(old)!;
    expect(state.participants.map((p) => p.name)).toEqual(['CVXII', 'Rudolf']);
    expect(state.recycling).toHaveLength(4);
    const text = encodeShare(state);
    expect(decodeShare(text)).toEqual(state);
    expect(text.length).toBeLessThan(old.length / 3);
  });

  it('keeps profit percents in share links, 0 % included', () => {
    const state = cleanState({
      ...emptyState(),
      participants: [{ id: 'a', name: 'A', sharePct: 0 }, { id: 'b', name: 'B', sharePct: 62.5 }, { id: 'c', name: 'C' }],
    });
    expect(state.participants.map((p) => p.sharePct)).toEqual([0, 62.5, undefined]);
    expect(decodeShare(encodeShare(state))).toEqual(state);
    expect(cleanState({ participants: [{ id: 'a', name: 'A', sharePct: 250 }] }).participants[0].sharePct).toBe(100);
  });
});

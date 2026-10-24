import { describe, expect, it } from 'vitest';
import { cleanState, debrisSummary, type Battle } from '../src/index.js';

const battle = (debris?: Battle['debris']): Battle => ({ time: 1, loot: { m: 0, k: 0, d: 0 }, fleets: [], ...(debris ? { debris } : {}) });

describe('debris field of a settlement', () => {
  it('shows how much of the last battle\'s field was recycled and what is left', () => {
    const s = debrisSummary({
      battles: [battle({ m: 50, k: 50 }), battle({ m: 1000, k: 600 })],
      recycling: [{ by: 'a', m: 300, k: 100, field: { m: 1000, k: 600 } }, { by: 'b', m: 100, k: 100 }],
    });
    expect(s).toEqual({ field: { m: 1000, k: 600 }, recycled: { m: 400, k: 200 }, share: 600 / 1600, left: { m: 700, k: 500 }, empty: false, taken: null });
  });

  it('counts what others took of an emptied field', () => {
    const s = debrisSummary({
      battles: [battle({ m: 1000, k: 600 })],
      recycling: [
        { by: 'a', m: 500, k: 300, field: { m: 1000, k: 600 } },
        // others recycled 300 metal and 100 crystal in between, this report empties the rest
        { by: 'b', m: 200, k: 200, field: { m: 200, k: 200 } },
      ],
    });
    expect(s).toMatchObject({ recycled: { m: 700, k: 500 }, left: { m: 0, k: 0 }, empty: true, taken: { m: 300, k: 100 } });
    // fully recycled by the settlement: nothing taken
    expect(debrisSummary({ battles: [battle({ m: 10, k: 0 })], recycling: [{ by: 'a', m: 10, k: 0, field: { m: 10, k: 0 } }] }).taken).toBeNull();
  });

  it('knows nothing without debris or recycling reports', () => {
    expect(debrisSummary({ battles: [battle()], recycling: [{ by: 'a', m: 5, k: 5 }] })).toEqual({
      field: null, recycled: { m: 5, k: 5 }, share: null, left: null, empty: false, taken: null,
    });
  });

  it('keeps the debris and fields in a cleaned state', () => {
    const state = cleanState({
      participants: [{ id: 'a', name: 'A' }],
      battles: [{ loot: {}, fleets: [], debris: { m: '7', k: 3 } }],
      recycling: [{ by: 'a', m: 1, k: 2, field: { m: 9, k: 9 } }],
    });
    expect(state.battles[0].debris).toEqual({ m: 7, k: 3 });
    expect(state.recycling[0].field).toEqual({ m: 9, k: 9 });
  });
});

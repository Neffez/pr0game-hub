import { describe, expect, it } from 'vitest';
import { emptyState, mergeDraft, type LootState } from '../src/index.js';

const person = (id: string, name: string, flightDeut = 0) => ({ id, name, flightDeut, recDeut: 0, missiles: 0 });

describe('update a settlement from fresh hub data', () => {
  it('adds what is new and keeps what was changed by hand', () => {
    const current: LootState = {
      ...emptyState(),
      participants: [person('u1', 'Anna', 500), person('u2', 'Ben')],
      battles: [{ time: 1000, loot: { m: 9, k: 9, d: 9 }, fleets: [{ participant: 'u1', start: { 207: 5 }, end: { 207: 4 } }] }],
      recycling: [{ by: 'u1', m: 100, k: 50, time: 2000 }, { by: 'u2', m: 7, k: 7 }],
    };
    const draft: LootState = {
      ...emptyState(),
      participants: [person('u1', 'Anna', 800), person('u2', 'Ben', 300), person('u3', 'Cleo', 100)],
      helpers: [{ id: 'u9', name: 'Hilde', keepPct: 20, recDeut: 0 }],
      battles: [
        {
          time: 1002, loot: { m: 1, k: 1, d: 1 }, debris: { m: 500, k: 200 },
          fleets: [{ participant: 'u1', start: { 207: 5 }, end: { 207: 5 } }, { participant: 'u3', start: { 204: 9 }, end: { 204: 9 } }],
        },
        { time: 5000, loot: { m: 2, k: 2, d: 2 }, fleets: [{ participant: 'u2', start: { 207: 1 }, end: { 207: 1 } }] },
      ],
      recycling: [
        { by: 'u1', m: 100, k: 50, time: 2000, field: { m: 500, k: 200 } },
        { by: 'u2', m: 7, k: 7, time: 2100, field: { m: 400, k: 150 } },
        { by: 'u9', m: 30, k: 20, time: 2200 },
      ],
    };
    const { state, added } = mergeDraft(current, draft);
    expect(added).toEqual({ participants: 1, helpers: 1, battles: 1, recycling: 1, rates: 0 });
    // flight deuterium entered stays, an empty one is filled
    expect(state.participants.map((p) => [p.id, p.flightDeut])).toEqual([['u1', 500], ['u2', 300], ['u3', 100]]);
    // the known battle keeps its loot and fleets, gains the new participant's fleet and the debris field
    expect(state.battles[0]).toEqual({
      time: 1000, loot: { m: 9, k: 9, d: 9 }, debris: { m: 500, k: 200 },
      fleets: [{ participant: 'u1', start: { 207: 5 }, end: { 207: 4 } }, { participant: 'u3', start: { 204: 9 }, end: { 204: 9 } }],
    });
    expect(state.battles[1].time).toBe(5000);
    // the old row without a time gets the draft's time and field, the helper's report is added
    expect(state.recycling).toEqual([
      { by: 'u1', m: 100, k: 50, time: 2000, field: { m: 500, k: 200 } },
      { by: 'u2', m: 7, k: 7, time: 2100, field: { m: 400, k: 150 } },
      { by: 'u9', m: 30, k: 20, time: 2200 },
    ]);
    // the input is left as it was, and a second update adds nothing
    expect(current.recycling).toHaveLength(2);
    expect(mergeDraft(state, draft).added).toEqual({ participants: 0, helpers: 0, battles: 0, recycling: 0, rates: 0 });
  });

  it('adds a hub row again that was removed by hand', () => {
    const draft: LootState = { ...emptyState(), participants: [person('u1', 'Anna')], recycling: [{ by: 'u1', m: 1, k: 1, time: 10 }] };
    expect(mergeDraft({ ...emptyState(), participants: [person('u1', 'Anna')] }, draft).added.recycling).toBe(1);
  });

  it('takes the market rate unless the rates were changed by hand', () => {
    const draft: LootState = { ...emptyState(), settings: { ...emptyState().settings, rates: { m: 4.06, k: 1.43, d: 1 }, refRates: { m: 4.0551, k: 1.4328, d: 1 } } };
    // still the defaults: rates and reference follow the market
    let res = mergeDraft(emptyState(), draft);
    expect(res.added.rates).toBe(1);
    expect(res.state.settings.rates).toEqual({ m: 4.06, k: 1.43, d: 1 });
    expect(res.state.settings.refRates).toEqual({ m: 4.0551, k: 1.4328, d: 1 });
    // the previous market rate is followed to the new one
    const newer: LootState = { ...draft, settings: { ...draft.settings, refRates: { m: 3.9, k: 1.4, d: 1 } } };
    res = mergeDraft(res.state, newer);
    expect(res.state.settings.rates).toEqual({ m: 3.9, k: 1.4, d: 1 });
    // rates typed in stay, only the reference moves
    const typed: LootState = { ...res.state, settings: { ...res.state.settings, rates: { m: 3, k: 1, d: 1 } } };
    res = mergeDraft(typed, draft);
    expect(res.added.rates).toBe(0);
    expect(res.state.settings.rates).toEqual({ m: 3, k: 1, d: 1 });
    expect(res.state.settings.refRates).toEqual({ m: 4.0551, k: 1.4328, d: 1 });
  });
});

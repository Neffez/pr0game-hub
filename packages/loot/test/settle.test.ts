import { describe, expect, it } from 'vitest';
import { apportion, lootShares, planTransfers, profitPercents, remaining, settle, settled, type SettlementInput } from '../src/index.js';

const settings = { mode: 'equal' as const, rates: { m: 2.8, k: 0.8, d: 1 }, deficitMetalShare: 0, cargoShip: 203 };
const none = { m: 0, k: 0, d: 0 };
const base = (over: Partial<SettlementInput>): SettlementInput => ({
  participants: [
    { id: 'a', name: 'Rolf' },
    { id: 'b', name: 'ballermann' },
  ],
  helpers: [],
  battles: [],
  recycling: [],
  settings,
  ...over,
});
const person = (r: ReturnType<typeof settle>, id: string) => r.people.find((p) => p.id === id)!;

describe('largest remainder', () => {
  it('adds up exactly', () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(10, [0, 0])).toEqual([5, 5]);
    expect(apportion(7, [5, 3])).toEqual([4, 3]);
  });
});

describe('loot shares', () => {
  it('splits by the free cargo space of the surviving ships, without spy probes', () => {
    const shares = lootShares({
      loot: { m: 40000, k: 40000, d: 8000 },
      fleets: [
        { participant: 'a', start: { 203: 10 }, end: { 203: 10 } },
        { participant: 'b', start: { 207: 120, 210: 50 }, end: { 207: 100, 210: 50 } },
      ],
    });
    expect(shares.get('a')).toEqual({ m: 25000, k: 25000, d: 5000 });
    expect(shares.get('b')).toEqual({ m: 15000, k: 15000, d: 3000 });
  });

  it('takes resources already carried off the space and keeps a known loot', () => {
    const shares = lootShares({
      loot: { m: 30000, k: 0, d: 0 },
      fleets: [
        { participant: 'a', start: { 203: 2 }, end: { 203: 2 }, carried: { d: 25000 } },
        { participant: 'b', start: { 203: 1 }, end: { 203: 1 } },
        { participant: 'c', start: { 203: 1 }, end: { 203: 1 }, loot: { m: 10000, k: 0, d: 0 } },
      ],
    });
    expect(shares.get('a')).toEqual({ m: 10000, k: 0, d: 0 });
    expect(shares.get('b')).toEqual({ m: 10000, k: 0, d: 0 });
    expect(shares.get('c')).toEqual({ m: 10000, k: 0, d: 0 });
  });
});

describe('settle', () => {
  it('covers the losses, splits the rest equally and plans one flight', () => {
    const r = settle(
      base({
        battles: [
          {
            time: 1_000_000,
            loot: { m: 1_000_000, k: 500_000, d: 200_000 },
            fleets: [
              { participant: 'a', start: { 207: 20 }, end: { 207: 10 }, loot: { m: 600_000, k: 300_000, d: 100_000 } },
              { participant: 'b', start: { 207: 10 }, end: { 207: 10 }, loot: { m: 400_000, k: 200_000, d: 100_000 } },
            ],
          },
        ],
      }),
    );
    expect(person(r, 'a').costs).toEqual({ m: 450_000, k: 150_000, d: 0 });
    expect(r.profit).toEqual({ m: 550_000, k: 350_000, d: 200_000 });
    expect(person(r, 'a').entitled).toEqual({ m: 725_000, k: 325_000, d: 100_000 });
    expect(person(r, 'b').entitled).toEqual({ m: 275_000, k: 175_000, d: 100_000 });
    expect(person(r, 'a').balance).toEqual({ m: 125_000, k: 25_000, d: 0 });
    expect(r.transfers).toEqual([{ from: 'b', to: 'a', res: { m: 125_000, k: 25_000, d: 0 }, ships: 6 }]);
    expect(r.coverage).toBe(1);
    expect(r.deadline).toBe(1_000_000 + 86400);
    expect(r.warnings).toEqual([]);
  });

  it('splits by investment (70 to 30 battleships)', () => {
    const r = settle(
      base({
        settings: { ...settings, mode: 'investment' },
        battles: [
          {
            loot: { m: 100_000, k: 0, d: 0 },
            fleets: [
              { participant: 'a', start: { 207: 70 }, end: { 207: 70 }, loot: { m: 100_000, k: 0, d: 0 } },
              { participant: 'b', start: { 207: 30 }, end: { 207: 30 }, loot: none },
            ],
          },
        ],
      }),
    );
    expect(person(r, 'a').share).toBeCloseTo(0.7);
    expect(person(r, 'a').entitled.m).toBe(70_000);
    expect(person(r, 'b').entitled.m).toBe(30_000);
    expect(r.transfers).toEqual([{ from: 'a', to: 'b', res: { m: 30_000, k: 0, d: 0 }, ships: 2 }]);
  });

  it('pays deuterium costs back from the captured deuterium, what it lacks in metal and crystal', () => {
    const r = settle(
      base({
        participants: [{ id: 'a', name: 'A', flightDeut: 50_000 }, { id: 'b', name: 'B' }],
        settings: { ...settings, deficitMetalShare: 1 },
        recycling: [{ by: 'b', m: 1_000_000, k: 0 }],
        battles: [{ loot: { m: 0, k: 0, d: 10_000 }, fleets: [{ participant: 'b', start: { 203: 1 }, end: { 203: 1 } }] }],
      }),
    );
    // 10,000 of the 50,000 deuterium in kind, the other 40,000 at 2.8 metal each, all in metal
    expect(person(r, 'a').covered).toEqual({ m: 112_000, k: 0, d: 10_000 });
    const profitM = 1_000_000 - 112_000;
    expect(person(r, 'a').entitled).toEqual({ m: 112_000 + profitM / 2, k: 0, d: 10_000 });
    expect(person(r, 'b').entitled).toEqual({ m: profitM / 2, k: 0, d: 0 });
    // by default in crystal
    const k = settle({ ...base({}), participants: [{ id: 'a', name: 'A', flightDeut: 1_000 }], recycling: [{ by: 'a', m: 0, k: 10_000 }] });
    expect(k.people[0].covered).toEqual({ m: 0, k: 800, d: 0 });
  });

  it('matches the alliance spreadsheet with deuterium compensation when enough deuterium was captured', () => {
    // Rolf loses 10 cruisers and flies for 30k deuterium, ballermann loses 5 battleships and flies for 20k
    const r = settle(
      base({
        participants: [{ id: 'a', name: 'Rolf', flightDeut: 30_000 }, { id: 'b', name: 'ballermann', flightDeut: 20_000 }],
        settings: { ...settings, deficitMetalShare: 0.5 },
        battles: [
          {
            loot: { m: 500_000, k: 250_000, d: 200_000 },
            fleets: [
              { participant: 'a', start: { 206: 10 }, end: {}, loot: { m: 300_000, k: 150_000, d: 120_000 } },
              { participant: 'b', start: { 207: 5 }, end: {}, loot: { m: 200_000, k: 100_000, d: 80_000 } },
            ],
          },
        ],
        recycling: [{ by: 'a', m: 600_000, k: 400_000 }],
      }),
    );
    // each gets their deuterium costs in deuterium, the surplus of 130k is split
    expect(person(r, 'a').entitled).toEqual({ m: 537_500, k: 322_500, d: 115_000 });
    expect(person(r, 'b').entitled).toEqual({ m: 562_500, k: 327_500, d: 85_000 });
    expect(r.profit).toEqual({ m: 675_000, k: 505_000, d: 130_000 });
  });

  it('covers the same share of everyone’s losses when the pot is too small', () => {
    const r = settle(
      base({
        participants: [
          { id: 'a', name: 'A', extra: { m: 300_000 } },
          { id: 'b', name: 'B', extra: { m: 100_000 } },
        ],
        recycling: [{ by: 'a', m: 100_000, k: 0 }],
      }),
    );
    expect(r.coverage).toBeCloseTo(0.25);
    expect(person(r, 'a').entitled.m).toBe(75_000);
    expect(person(r, 'b').entitled.m).toBe(25_000);
    expect(r.profit).toEqual(none);
    expect(r.warnings).toContain('costs_not_covered');
  });

  it('lets helpers keep their share (at most 20 %), without a deuterium refund', () => {
    const r = settle(
      base({
        helpers: [{ id: 'h', name: 'Helper', keepPct: 30, recDeut: 5_000 }],
        recycling: [{ by: 'h', m: 100_000, k: 50_000 }],
        battles: [{ loot: { m: 0, k: 0, d: 10_000 }, fleets: [{ participant: 'a', start: { 203: 1 }, end: { 203: 1 } }] }],
      }),
    );
    const h = person(r, 'h');
    expect(h.entitled).toEqual({ m: 20_000, k: 10_000, d: 0 });
    expect(h.balance).toEqual({ m: -80_000, k: -40_000, d: 0 });
    expect(person(r, 'a').entitled).toEqual({ m: 40_000, k: 20_000, d: 5_000 });
    expect(settled(r.people, r.transfers)).toBe(true);
  });

  it('refunds the helpers\' recycler deuterium only with the option', () => {
    const input = base({
      helpers: [{ id: 'h', name: 'Helper', keepPct: 20, recDeut: 5_000 }],
      recycling: [{ by: 'h', m: 100_000, k: 50_000 }],
      battles: [{ loot: { m: 0, k: 0, d: 10_000 }, fleets: [{ participant: 'a', start: { 203: 1 }, end: { 203: 1 } }] }],
    });
    const r = settle({ ...input, settings: { ...settings, helperDeut: true } });
    // the refund from the captured deuterium, the rest of it is profit
    expect(person(r, 'h').entitled).toEqual({ m: 20_000, k: 10_000, d: 5_000 });
    expect(person(r, 'a').entitled).toEqual({ m: 40_000, k: 20_000, d: 2_500 });
    expect(settled(r.people, r.transfers)).toBe(true);
  });

  it('stays a number when participants have no costs and the helpers claim more than the pot', () => {
    const r = settle(
      base({
        helpers: [{ id: 'h', name: 'Helper', keepPct: 20, recDeut: 50_000_000 }],
        recycling: [{ by: 'h', m: 890_793, k: 364_391 }],
        settings: { ...settings, rates: { m: 3.624054575331542, k: 0.5193681150392759, d: 1 }, deficitMetalShare: 0.7952715235452417, helperDeut: true },
      }),
    );
    expect(r.coverage).toBe(1);
    expect(person(r, 'h').entitled).toEqual({ m: 890_793, k: 364_391, d: 0 });
    expect(person(r, 'a').entitled).toEqual({ m: 0, k: 0, d: 0 });
    expect(r.transfers).toEqual([]);
  });

  it('counts missiles and recycler deuterium as costs and flags too many participants', () => {
    const r = settle(
      base({
        participants: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id })),
        recycling: [{ by: 'a', m: 0, k: 0 }],
      }),
    );
    expect(r.warnings).toContain('too_many_participants');
    const m = settle(base({ participants: [{ id: 'a', name: 'A', missiles: 2, recDeut: 300 }] }));
    expect(m.people[0].costs).toEqual({ m: 25_000, k: 5_000, d: 20_300 });
  });

  it('flags rates outside 75-125 % of the reference', () => {
    const r = settle(base({ settings: { ...settings, rates: { m: 4, k: 0.8, d: 1 }, refRates: { m: 2.8, k: 0.8, d: 1 } } }));
    expect(r.rateWarnings).toEqual(['m']);
  });

  it('always settles: balances add up to zero and the suggested transfers clear them', () => {
    const r = settle(
      base({
        participants: [
          { id: 'a', name: 'A', flightDeut: 12_345 },
          { id: 'b', name: 'B', recDeut: 777 },
          { id: 'c', name: 'C' },
        ],
        helpers: [{ id: 'h', name: 'H', keepPct: 15 }],
        settings: { ...settings, mode: 'investment', deficitMetalShare: 0.4 },
        recycling: [
          { by: 'c', m: 333_333, k: 111_111 },
          { by: 'h', m: 77_777, k: 55_555 },
        ],
        battles: [
          {
            loot: { m: 123_457, k: 98_765, d: 4_321 },
            fleets: [
              { participant: 'a', start: { 207: 33, 203: 7 }, end: { 207: 30, 203: 7 } },
              { participant: 'b', start: { 215: 13 }, end: { 215: 12 } },
              { participant: 'c', start: { 202: 11 }, end: { 202: 11 } },
            ],
          },
        ],
      }),
    );
    for (const key of ['m', 'k', 'd'] as const) {
      expect(r.people.reduce((s, p) => s + p.balance[key], 0)).toBe(0);
      expect(r.people.reduce((s, p) => s + p.entitled[key], 0)).toBe(r.pot[key]);
    }
    expect(settled(r.people, r.transfers)).toBe(true);
    expect(r.people.every((p) => Object.values(p.entitled).every(Number.isInteger))).toBe(true);
  });
});

describe('transfers', () => {
  it('reports what is left after manual transfers', () => {
    const balances = [
      { id: 'a', balance: { m: 100, k: 0, d: 0 } },
      { id: 'b', balance: { m: -100, k: 0, d: 0 } },
    ];
    expect(planTransfers(balances, 202, settings.rates)).toEqual([{ from: 'b', to: 'a', res: { m: 100, k: 0, d: 0 }, ships: 1 }]);
    const left = remaining(balances, [{ from: 'b', to: 'a', res: { m: 60, k: 0, d: 0 } }]);
    expect(left.get('a')).toEqual({ m: 40, k: 0, d: 0 });
    expect(left.get('b')).toEqual({ m: -40, k: 0, d: 0 });
  });
});

describe('profit split by percent', () => {
  const battle = (m: number) => ({
    loot: { m, k: 0, d: 0 },
    fleets: [
      { participant: 'a', start: { 207: 1 }, end: { 207: 1 }, loot: { m, k: 0, d: 0 } },
      { participant: 'b', start: { 207: 1 }, end: { 207: 1 }, loot: none },
      { participant: 'c', start: { 207: 1 }, end: { 207: 1 }, loot: none },
    ],
  });
  const three = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

  it('splits equally without percents and the rest of 100 % among those without one', () => {
    expect(profitPercents(three)).toEqual([100 / 3, 100 / 3, 100 / 3]);
    expect(profitPercents([{ sharePct: 50 }, {}, {}])).toEqual([50, 25, 25]);
    expect(profitPercents([{ sharePct: 0 }, {}])).toEqual([0, 100]);
    const r = settle(base({ participants: [{ id: 'a', name: 'A', sharePct: 50 }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], battles: [battle(100_000)] }));
    expect(r.people.map((p) => p.entitled.m)).toEqual([50_000, 25_000, 25_000]);
    expect(person(r, 'b').share).toBeCloseTo(0.25);
    expect(r.warnings).toEqual([]);
  });

  it('scales percents that do not add up to 100 and warns', () => {
    const r = settle(base({ participants: [{ id: 'a', name: 'A', sharePct: 60 }, { id: 'b', name: 'B', sharePct: 60 }, { id: 'c', name: 'C', sharePct: 0 }], battles: [battle(120_000)] }));
    expect(r.people.map((p) => p.entitled.m)).toEqual([60_000, 60_000, 0]);
    expect(r.warnings).toContain('shares_not_100');
  });

  it('ignores the percents when the profit is split by investment', () => {
    const r = settle(base({ participants: [{ id: 'a', name: 'A', sharePct: 90 }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], battles: [battle(90_000)], settings: { ...settings, mode: 'investment' } }));
    expect(r.people.map((p) => p.entitled.m)).toEqual([30_000, 30_000, 30_000]);
    expect(r.warnings).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { draftOf, draftValid, transportOf } from '../src/buildOrderTransport';
import { toLocalInput } from '../src/plans';

describe('build order transport draft', () => {
  it('round-trips a transport with ships, cargo and arrival time', () => {
    const at = 1_800_000_000;
    const tr = { target: '1:2:3:planet', resources: { 901: 1000, 903: 50 }, flight: 0, ships: { 202: 3 }, speed: 70, arriveAt: at };
    const d = draftOf(tr);
    expect(d.time).toBe(toLocalInput(at).slice(0, 16));
    expect(draftValid(d)).toBe(true);
    expect(transportOf(d)).toEqual(tr);
  });

  it('keeps an imported transport without ships or target editable', () => {
    const tr = { target: null, resources: { 902: 500 }, flight: 5400 };
    const d = draftOf(tr);
    expect(d.ships).toEqual([]);
    expect(draftValid(d)).toBe(false);
    expect(draftValid(d, true)).toBe(true);
    d.res[902] = 800;
    expect(transportOf(d)).toEqual({ target: null, resources: { 902: 800 }, flight: 5400 });
  });

  it('needs cargo unless it takes everything or colonizes', () => {
    const d = { ...draftOf(), target: '1:2:3:planet' };
    expect(draftValid(d)).toBe(false);
    expect(draftValid({ ...d, all: [903] })).toBe(true);
    expect(draftValid({ ...d, mission: 'colonize' })).toBe(true);
  });

  it('loads some resources completely and keeps the amounts of the others', () => {
    const d = { ...draftOf({ target: 'x', resources: { 901: 100, 902: 200 }, flight: 0, ships: { 202: 1 } }), all: [902] };
    expect(transportOf(d)).toEqual({ target: 'x', resources: { 901: 100 }, flight: 0, ships: { 202: 1 }, all: [902] });
    expect(transportOf({ ...d, all: [903, 901, 902] }).all).toBe(true);
    expect(draftOf({ target: 'x', resources: {}, flight: 0, all: true }).all).toEqual([901, 902, 903]);
  });
});

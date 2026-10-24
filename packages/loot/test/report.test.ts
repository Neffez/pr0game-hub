import { readFileSync } from 'node:fs';
import { parseCombatReportText } from '@pr0hub/core/combat';
import { describe, expect, it } from 'vitest';
import { battleFromReport, emptyState, localEpoch, lootShares } from '../src/index.js';

const text = readFileSync(new URL('../../parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');

describe('battle report into a settlement', () => {
  it('takes the participants and sums up the fleets of each player', () => {
    const state = emptyState();
    state.participants.push({ id: 'u7', name: 'rudolf', flightDeut: 0, recDeut: 0, missiles: 0 });
    const { battle, added, skipped } = battleFromReport(state, parseCombatReportText(text, null)!, () => 1, 'g');
    expect(state.participants.map((p) => [p.id, p.name])).toEqual([['u7', 'rudolf'], ['g2', 'CVXII']]);
    expect(added).toEqual(['CVXII']);
    expect(skipped).toEqual([]);
    expect(battle.time).toBe(1);
    expect(battle.loot).toEqual({ m: 0, k: 1343846, d: 690373 });
    expect(battle.fleets).toEqual([
      { participant: 'g2', start: { 206: 347, 207: 11799, 215: 4406, 222: 3544 }, end: { 206: 323, 207: 11794, 215: 4406, 222: 3521 } },
      { participant: 'u7', start: { 207: 2178, 215: 4348, 225: 4821 }, end: { 207: 2178, 215: 4348, 225: 3901 } },
    ]);
    // loot by the cargo space of the surviving ships, adding up to the report's loot
    const shares = lootShares(battle);
    expect(shares.get('g2')!.k + shares.get('u7')!.k).toBe(1343846);
    expect(shares.get('g2')!.d + shares.get('u7')!.d).toBe(690373);
    expect(shares.get('u7')!.k).toBe(603270); // 1,343,846 * 20,181,500 / 44,956,400 cargo space
  });

  it('reads game times as local time', () => {
    expect(localEpoch('2026-10-24 13:04:03')).toBe(new Date(2026, 9, 24, 13, 4, 3).getTime() / 1000);
    expect(localEpoch(null)).toBeNull();
  });
});

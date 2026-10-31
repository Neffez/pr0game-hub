import { describe, expect, it } from 'vitest';
import { adoptKeys, applyOverrides, cleanState, marketRates, sameBattle, diffOverrides, emptyState, overriddenPaths, stateChanges, type LootState } from '../src/index.js';

const person = (id: string, name: string, flightDeut = 0) => ({ id, name, flightDeut, recDeut: 0, missiles: 0 });

const draft = (): LootState =>
  cleanState({
    ...emptyState(),
    participants: [person('u1', 'Anna', 800), person('u2', 'Ben', 300)],
    helpers: [{ id: 'u9', name: 'Hilde', keepPct: 20, recDeut: 0 }],
    battles: [
      {
        key: 'rep-1', time: 1000, loot: { m: 10, k: 5, d: 1 }, debris: { m: 500, k: 200 },
        fleets: [{ participant: 'u1', start: { 207: 5 }, end: { 207: 4 } }, { participant: 'u2', start: { 204: 9 }, end: { 204: 9 } }],
      },
    ],
    recycling: [
      { key: 'r1', by: 'u1', m: 100, k: 50, time: 2000 },
      { key: 'r2', by: 'u9', m: 30, k: 20, time: 2200 },
    ],
  });

describe('corrections on top of the hub draft', () => {
  it('stores nothing for an unchanged draft', () => {
    expect(diffOverrides(draft(), draft())).toEqual({});
    expect(applyOverrides(draft(), {})).toEqual(draft());
  });

  it('round-trips corrections and keeps them when the draft changes', () => {
    const edited = draft();
    edited.participants[0].flightDeut = 500;
    edited.participants[1].missiles = 3;
    edited.battles[0].loot.m = 99;
    edited.battles[0].fleets[1].end = { 204: 2 };
    edited.recycling.splice(1, 1);
    edited.recycling.push({ by: 'u2', m: 7, k: 7 });
    edited.settings.mode = 'investment';
    const o = diffOverrides(draft(), edited);
    expect(o).toEqual({
      settings: { mode: 'investment' },
      participants: { u1: { flightDeut: 500 }, u2: { missiles: 3 } },
      battles: { 'rep-1': { at: 1000, loot: { m: 99, k: 5, d: 1 }, fleets: { u2: { participant: 'u2', start: { 204: 9 }, end: { 204: 2 } } } } },
      recycling: { r2: { hidden: true } },
      extra: { recycling: [{ by: 'u2', m: 7, k: 7 }] },
    });
    expect(applyOverrides(draft(), o)).toEqual(edited);
    expect(overriddenPaths(o)).toEqual(new Set(['s:mode', 'p:u1:flightDeut', 'p:u2:missiles', 'b:rep-1:loot', 'b:rep-1:fleet:u2', 'r:r2']));

    // later data: new flight deuterium of Ben, a new recycling report, debris of the battle
    const fresh = draft();
    fresh.participants[1].flightDeut = 450;
    fresh.battles[0].debris = { m: 600, k: 250 };
    fresh.recycling.push({ key: 'r3', by: 'u1', m: 1, k: 1, time: 3000 });
    const live = applyOverrides(fresh, o);
    expect(live.participants.map((p) => [p.id, p.flightDeut, p.missiles])).toEqual([['u1', 500, 0], ['u2', 450, 3]]);
    expect(live.battles[0].loot.m).toBe(99);
    expect(live.battles[0].debris).toEqual({ m: 600, k: 250 });
    expect(live.recycling.map((r) => r.key ?? `${r.by}:${r.m}`)).toEqual(['r1', 'r3', 'u2:7']);
  });

  it('finds a corrected battle again when its key changed (report synced later)', () => {
    const edited = draft();
    edited.battles[0].loot.k = 77;
    const o = diffOverrides(draft(), edited);
    const fresh = draft();
    fresh.battles[0].key = 'rep-2';
    fresh.battles[0].time = 1003;
    expect(applyOverrides(fresh, o).battles[0].loot.k).toBe(77);
  });

  it('keeps people and battles added by hand and hides removed ones', () => {
    const edited = draft();
    edited.participants.push(person('g1', 'Gast'));
    edited.battles.push({ time: 5000, loot: { m: 1, k: 1, d: 1 }, fleets: [{ participant: 'g1', start: { 202: 1 }, end: { 202: 1 } }] });
    edited.helpers = [];
    const o = diffOverrides(draft(), edited);
    expect(o.helpers).toEqual({ u9: { hidden: true } });
    expect(o.extra?.participants).toEqual([person('g1', 'Gast')]);
    const live = applyOverrides(draft(), o);
    expect(live.helpers).toEqual([]);
    // the helper's recycling row goes with them
    expect(live.recycling.map((r) => r.by)).toEqual(['u1']);
    expect(live.battles[1].fleets[0].participant).toBe('g1');
  });

  it('gives a settlement saved without keys the draft keys', () => {
    const old = draft();
    for (const b of old.battles) delete b.key;
    for (const r of old.recycling) delete r.key;
    old.battles[0].time = 1002;
    const keyed = adoptKeys(draft(), old);
    expect(keyed.battles[0].key).toBe('rep-1');
    expect(keyed.recycling.map((r) => r.key)).toEqual(['r1', 'r2']);
    expect(diffOverrides(draft(), keyed)).toEqual({ battles: { 'rep-1': { at: 1000, time: 1002 } } });
    // a battle key that looks like a recycling key does not block that row
    const clash = draft();
    clash.battles[0].key = 'r1';
    const oldClash = JSON.parse(JSON.stringify(clash)) as LootState;
    delete oldClash.battles[0].key;
    for (const r of oldClash.recycling) delete r.key;
    expect(adoptKeys(clash, oldClash).recycling.map((r) => r.key)).toEqual(['r1', 'r2']);
  });

  it('counts what changed since a settlement was finalized', () => {
    const fresh = draft();
    fresh.recycling.push({ key: 'r3', by: 'u1', m: 1, k: 1, time: 3000 });
    fresh.participants[0].flightDeut = 1;
    expect(stateChanges(draft(), fresh)).toEqual({ people: 1, battles: 0, recycling: 1, settings: 0 });
    expect(stateChanges(draft(), draft())).toEqual({ people: 0, battles: 0, recycling: 0, settings: 0 });
  });

  it('rounds market rates and tells battles apart by time', () => {
    expect(marketRates({ m: 4.0551, k: 1.4328, d: 1 })).toEqual({ m: 4.06, k: 1.43, d: 1 });
    const b = (time: number | null) => ({ time, loot: { m: 0, k: 0, d: 0 }, fleets: [] });
    expect(sameBattle(b(100), b(105))).toBe(true);
    expect(sameBattle(b(100), b(106))).toBe(false);
    expect(sameBattle(b(null), b(null))).toBe(true);
  });

  it('keeps following a battle whose key changed while it was edited', () => {
    // the client edited a flight deuterium; meanwhile the battle's report was synced and its key changed
    const edited = draft();
    edited.participants[0].flightDeut = 1;
    const fresh = draft();
    fresh.battles[0].key = 'rep-9';
    fresh.battles[0].time = 1002;
    const o = diffOverrides(fresh, edited);
    expect(o.extra).toBeUndefined();
    expect(o.battles).toEqual({ 'rep-9': { at: 1002, time: 1000 } });
    // a battle and a recycling report pasted by hand that the draft has: corrections of those, not added twice
    const pasted = draft();
    pasted.battles.push({ time: 1001, loot: { m: 7, k: 0, d: 0 }, fleets: [] });
    pasted.battles.splice(0, 1);
    pasted.recycling.push({ by: 'u1', m: 100, k: 50, time: 2000 });
    pasted.recycling.splice(0, 1);
    const p = diffOverrides(draft(), pasted);
    expect(p.extra).toBeUndefined();
    expect(applyOverrides(draft(), p).battles).toHaveLength(1);
  });

  it('takes rows added by hand from the hub once the same report is synced', () => {
    const edited = draft();
    edited.battles = [];
    edited.recycling = [];
    const o = diffOverrides(emptyState(), { ...edited, battles: [{ time: 5000, loot: { m: 1, k: 1, d: 1 }, fleets: [] }], recycling: [{ by: 'u1', m: 3, k: 4, time: 6000 }] });
    expect(o.extra?.battles).toHaveLength(1);
    expect(o.extra?.recycling).toHaveLength(1);
    // later the hub has both: counted once, from the hub
    const fresh = draft();
    fresh.battles = [{ key: 'rep-5', time: 5002, loot: { m: 9, k: 9, d: 9 }, fleets: [] }];
    fresh.recycling = [{ key: 'r7', by: 'u1', m: 3, k: 4, time: 6000 }];
    const live = applyOverrides(fresh, o);
    expect(live.battles).toEqual([{ key: 'rep-5', time: 5002, loot: { m: 9, k: 9, d: 9 }, fleets: [] }]);
    expect(live.recycling.map((r) => r.key)).toEqual(['r7']);
  });

  it('finds no changes in a settlement saved before keys existed', () => {
    const old = draft();
    for (const b of old.battles) delete b.key;
    for (const r of old.recycling) delete r.key;
    expect(stateChanges(old, draft())).toEqual({ people: 0, battles: 0, recycling: 0, settings: 0 });
  });

  it('keeps a profit percent of 0 as a correction', () => {
    const edited = draft();
    edited.participants[0].sharePct = 0;
    const o = diffOverrides(draft(), edited);
    expect(o.participants).toEqual({ u1: { sharePct: 0 } });
    expect(applyOverrides(draft(), o).participants[0].sharePct).toBe(0);
  });
});

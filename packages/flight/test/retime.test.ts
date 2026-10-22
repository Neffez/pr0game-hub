import { describe, expect, it } from 'vitest';
import {
  delayedFlightTimes,
  distance,
  flightDuration,
  flightTimes,
  recallHome,
  retimeCandidates,
  shipSpeed,
  type EnemyFleet,
  type Universe,
} from '../src/index.js';

const uni: Universe = {
  galaxies: 9,
  systems: 400,
  circularGalaxies: true,
  circularSystems: true,
  galaxyDistanceFactor: 20000,
  systemDistanceFactor: 95,
  systemDistance: 2700,
  planetDistanceFactor: 5,
  planetDistance: 1000,
  fleetSpeed: 2500,
};
const drives = { combustion: 12, impulse: 10, hyperspace: 9 };
const arrival = 1_800_000_000;
// battleships and Heavy Cruisers from [1:41:1] to [3:115:8], like the sample ACS
const enemy: EnemyFleet = { from: [1, 41, 1], to: [3, 115, 8], ships: { 207: 1773, 222: 1322 }, drives, arrival };
const dur = (percent: number) => flightDuration(uni, distance(uni, enemy.from, enemy.to), shipSpeed(222, drives), percent);

describe('retime candidates', () => {
  it('lists one candidate per speed step with launch and return of a single attack', () => {
    const list = retimeCandidates(uni, enemy);
    expect(list.map((c) => c.percent)).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
    for (const c of list) {
      expect(c.duration).toBe(dur(c.percent));
      const sent = flightTimes(c.launch.to, c.duration);
      expect(c.launch.from).toBe(c.launch.to);
      expect(sent.arrival).toBe(arrival);
      expect(c.home).toBe(sent.home);
      expect(c.possible).toBe(true);
      expect(c.recallHome).toBeNull();
    }
    expect(retimeCandidates(uni, { ...enemy, ships: { 999: 1 } })).toEqual([]);
  });

  it('keeps the candidates whose launch fits the departure window', () => {
    const launch = arrival - Math.floor(dur(50));
    const single = retimeCandidates(uni, { ...enemy, departure: { from: launch - 60, to: launch + 60 } });
    expect(single.filter((c) => c.possible).map((c) => c.percent)).toEqual([50]);
    // an ACS fleet may have waited: every candidate that could have launched in the window or before stays
    const acs = retimeCandidates(uni, { ...enemy, acs: true, departure: { from: launch - 60, to: launch + 60 } });
    expect(acs.filter((c) => c.possible).map((c) => c.percent)).toEqual([100, 90, 80, 70, 60, 50]);
    expect(acs.find((c) => c.percent === 100)?.launch).toEqual({ from: launch - 60, to: launch + 60 });
    expect(acs.find((c) => c.percent === 50)?.launch).toEqual({ from: launch - 60, to: launch });
  });

  it('uses the first seen arrival for the launch and the delayed one for the return', () => {
    const c = retimeCandidates(uni, { ...enemy, arrival: arrival + 900, firstSeen: arrival })[0];
    const t = delayedFlightTimes(arrival + 900, arrival, c.duration);
    expect(c.launch.to).toBe(t.start);
    expect(c.home).toBe(t.home);
  });

  it('computes the return after a recall', () => {
    const launch = arrival - Math.floor(dur(100));
    const at = launch + 1000;
    const c = retimeCandidates(uni, { ...enemy, recall: { from: at, to: at } })[0];
    expect(c.recallHome).toEqual({ from: recallHome(at, flightTimes(launch, c.duration)).home, to: at + 1000 });
    // a window: earliest recall to latest recall
    const w = retimeCandidates(uni, { ...enemy, recall: { from: at, to: at + 300 } })[0];
    expect(w.recallHome).toEqual({ from: at + 1000, to: at + 1600 });
    // not possible when the window lies before the launch or after the arrival
    expect(retimeCandidates(uni, { ...enemy, recall: { from: arrival, to: arrival + 60 } })[0]).toMatchObject({ possible: false, recallHome: null });
    const slow = retimeCandidates(uni, { ...enemy, recall: { from: launch, to: launch + 10 } });
    expect(slow.find((c) => c.percent === 100)?.possible).toBe(true);
    expect(slow.find((c) => c.percent === 10)?.possible).toBe(true);
    expect(retimeCandidates(uni, { ...enemy, recall: { from: launch - 100, to: launch - 50 } })[0].possible).toBe(false);
  });

  it('always contains the real return of random ACS fleets in the candidate of their speed', () => {
    const percents = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    for (let n = 0; n < 2000; n++) {
      const percent = percents[Math.floor(Math.random() * 10)];
      const d = dur(percent);
      const launch = 1_800_000_000 + Math.floor(Math.random() * 1e5);
      const wait = Math.floor(Math.random() * 3000); // joined early and waited, or pushed back later
      const real = launch + Math.floor(d) + wait;
      const recall = launch + Math.floor(Math.random() * (real - launch));
      const home = recallHome(recall, delayedFlightTimes(real, launch + Math.floor(d), d)).home!;
      const fleet: EnemyFleet = {
        ...enemy, arrival: real, acs: true,
        departure: { from: launch - Math.floor(Math.random() * 600), to: launch + Math.floor(Math.random() * 600) },
        recall: { from: recall - Math.floor(Math.random() * 300), to: recall + Math.floor(Math.random() * 300) },
      };
      const c = retimeCandidates(uni, fleet).find((x) => x.percent === percent)!;
      expect(c.possible).toBe(true);
      expect(home).toBeGreaterThanOrEqual(c.recallHome!.from);
      expect(home).toBeLessThanOrEqual(c.recallHome!.to!);
    }
  });

  it('gives an open range after the recall of an ACS fleet without departure window', () => {
    const at = arrival - 600;
    const c = retimeCandidates(uni, { ...enemy, acs: true, recall: { from: at, to: at + 60 } })[0];
    const latest = arrival - Math.floor(c.duration);
    expect(c.recallHome).toEqual({ from: 2 * at - latest, to: null });
  });
});

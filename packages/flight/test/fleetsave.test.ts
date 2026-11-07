import { describe, expect, it } from 'vitest';
import { distance, fleetConsumption, fleetSaveOptions, flightDuration, SHIPS, type Universe } from '../src/index.js';

const uni: Universe = {
  galaxies: 4, systems: 400, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000, systemDistanceFactor: 95,
  systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500,
};
const drives = { combustion: 10, impulse: 8, hyperspace: 6 };
const home = { coords: [1, 100, 8] as [number, number, number], type: 'planet' as const };
const moon = { coords: [1, 100, 8] as [number, number, number], type: 'moon' as const };
const far = { coords: [1, 180, 4] as [number, number, number], type: 'planet' as const };
const fleet = { 203: 50, 204: 100 };
const base = { universe: uni, catalog: SHIPS, drives, from: home, fleet, targets: [home, moon, far] };

describe('fleet save', () => {
  it('lands at the wake-up time or later, departing as late as needed', () => {
    const now = 1_800_000_000;
    const latest = now + 1800;
    const back = now + 8 * 3600;
    const list = fleetSaveOptions({ ...base, now, latest, back });
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) {
      expect(o.rest).toBeGreaterThanOrEqual(back);
      expect(o.departure).toBeGreaterThanOrEqual(now);
      expect(o.departure).toBeLessThanOrEqual(latest);
      expect(o.late).toBe(o.rest - back);
    }
    // never to the start itself, sorted by lateness
    expect(list.some((o) => o.target === home)).toBe(false);
    expect(list.map((o) => o.late)).toEqual([...list.map((o) => o.late)].sort((a, b) => a - b));
    const best = list[0];
    const dist = distance(uni, home.coords, best.target.coords);
    // slowest ship: the large cargo (combustion 7500 × (1 + 0.1 × 10))
    expect(best.duration).toBe(flightDuration(uni, dist, 15000, best.speed));
    expect(best.fuel).toBe(fleetConsumption(uni, fleet, best.duration, dist, drives, 1, SHIPS));
  });

  it('charges a transport the full fuel and gives a deploy half back', () => {
    const now = 1_800_000_000;
    const list = fleetSaveOptions({ ...base, now, latest: now, back: now + 600, speeds: [100] });
    const deploy = list.find((o) => o.kind === 'deploy' && o.target === far)!;
    const transport = list.find((o) => o.kind === 'transport' && o.target === far)!;
    expect(transport.fuel).toBe(deploy.fuel);
    expect(deploy.cost).toBe(deploy.fuel - Math.floor(deploy.fuel / 2));
    expect(transport.cost).toBe(transport.fuel);
    // a transport rests at home: twice the floored one-way time
    expect(transport.rest - transport.departure).toBe(2 * Math.floor(transport.duration));
    expect(deploy.rest - deploy.departure).toBe(Math.floor(deploy.duration));
  });

  it('leaves out options that are back too early', () => {
    const now = 1_800_000_000;
    // a whole week: no flight between the own bodies is that long
    expect(fleetSaveOptions({ ...base, now, latest: now + 60, back: now + 7 * 86400, kinds: ['deploy', 'transport'] })).toEqual([]);
  });

  it('recalls a deploy so that it lands back home right at the wanted time', () => {
    const now = 1_800_000_000;
    const back = now + 3600;
    const list = fleetSaveOptions({ ...base, now, latest: now, back, kinds: ['recall'] });
    expect(list).toHaveLength(1);
    const r = list[0];
    expect(r.target).toBe(far);
    expect(r.departure).toBe(now);
    expect(r.recall).toBe(Math.ceil((back + now) / 2));
    expect(r.rest).toBe(2 * r.recall! - now);
    expect(r.rest).toBeGreaterThanOrEqual(back);
  });
});

import { describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { toolsLink } = await import('../src/battle.js');
const { UNIVERSE_DEFAULTS } = await import('../src/config.js');
const { decodeShare } = await import('@pr0hub/battle');
const { decodeUnitOverrides } = await import('@pr0hub/core/universe');

describe('battle simulator link', () => {
  it('carries the universe layout, the battle values used and the own units', () => {
    const req = { attackers: [{ units: { 207: 10 }, research: {}, from: [1, 1, 1], speed: 100, name: 'A' }], defenders: [], target: [1, 2, 3], resources: null, runs: 5 };
    const planet = { units: { 412: 3 }, research: {}, name: 'P' };
    const settings = { fleetDebris: 30, defenseDebris: 0, moonFactor: 1, maxMoonChance: 20, bigShields: true };
    const overrides = { 412: { name: { de: 'Bunker', en: 'Bunker' }, cost: [9000, 1000, 0] as [number, number, number] } };
    const link = toolsLink({ ...UNIVERSE_DEFAULTS, fleetSpeed: 5000, circularSystems: false }, req as never, planet as never, settings as never, overrides);
    const state = decodeShare(link.split('#')[1]);
    expect(state.uni).toMatchObject({ ut: 1, gt: 0, mg: 4, gs: 2, fd: 30, bs: 1 });
    expect(state.defenders[0].units).toEqual({ 412: 3 });
    expect(decodeUnitOverrides(state.uo)).toEqual(overrides);
    expect(toolsLink(UNIVERSE_DEFAULTS, req as never, planet as never, settings as never)).not.toContain('uo=');
  });
});

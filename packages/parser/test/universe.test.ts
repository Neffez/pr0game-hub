import { describe, expect, it } from 'vitest';
import {
  decodeUnitOverrides, encodeUnitOverrides, inactiveDaysOf, OPTIONAL_DEFAULTS, settingsError, TOOL_HASH, toolsHash, UNIVERSE_DEFAULTS, universeSettings,
} from '../src/universe.js';

describe('universe settings', () => {
  it('merges stored values over the defaults', () => {
    const u = universeSettings({ galaxies: 9, phalanxRangeFactor: 2 });
    expect(u).toMatchObject({ galaxies: 9, systems: 400, phalanxRangeFactor: 2 });
    expect(inactiveDaysOf(u)).toBe(OPTIONAL_DEFAULTS.inactiveDays);
    expect(inactiveDaysOf({ inactiveDays: 14 })).toBe(14);
  });

  it('validates what an admin sends', () => {
    expect(settingsError(undefined)).toBeNull();
    expect(settingsError({ galaxies: 5, phalanxRangeFactor: 1.5, bigShields: true, noobLimit: null })).toBeNull();
    expect(settingsError({ timezone: 'Mars/Olympus' })?.code).toBe('timezone_invalid');
    expect(settingsError({ gameUrl: 'ftp://x' })?.code).toBe('game_url_invalid');
    expect(settingsError({ pr0planUrl: 'x' })?.code).toBe('pr0plan_url_invalid');
    expect(settingsError({ galaxies: 0 })).toEqual({ code: 'setting_invalid', message: 'Invalid setting: galaxies' });
    expect(settingsError({ storageMultiplier: 1.5 })?.code).toBe('setting_invalid');
    expect(settingsError({ fleetDebrisPercent: 101 })?.code).toBe('setting_invalid');
    expect(settingsError({ phalanxRangeFactor: -1 })?.code).toBe('setting_invalid');
    expect(settingsError({ bigShields: 1 })?.code).toBe('setting_invalid');
    // a required setting cannot be reset
    expect(settingsError({ galaxies: null })?.code).toBe('setting_invalid');
  });

  it('gives the tools layout and speed, battle values only when set', () => {
    const hash = toolsHash(universeSettings({ circularSystems: false, fleetSpeed: 5000 }));
    expect(hash).toEqual({ ut: 1, gt: 0, mg: 4, ms: 400, mp: 15, gdf: 20000, sdf: 95, sd: 2700, pdf: 5, pd: 1000, gs: 2 });
    expect(toolsHash({ ...UNIVERSE_DEFAULTS, fleetDebrisPercent: 30, defenseDebrisPercent: 10, bigShields: true })).toMatchObject({ fd: 30, dd: 10, bs: 1 });
    // every hub key is a key the tools read
    const toolKeys = Object.values(TOOL_HASH) as string[];
    for (const key of Object.keys(toolsHash({ ...UNIVERSE_DEFAULTS, ...OPTIONAL_DEFAULTS }))) expect(toolKeys).toContain(key);
  });

  it('encodes unit overrides for the uo key and rejects invalid ones', () => {
    expect(encodeUnitOverrides({})).toBe('');
    const overrides = { 233: { name: { de: 'Wächter', en: 'Warden' }, cost: [1, 2, 3] as [number, number, number] } };
    const uo = encodeUnitOverrides(overrides);
    expect(uo).toMatch(/^[\w-]+$/);
    expect(decodeUnitOverrides(uo)).toEqual(overrides);
    expect(decodeUnitOverrides('not base64!')).toBeNull();
    expect(decodeUnitOverrides(encodeUnitOverrides({ 100: { hidden: true } }))).toBeNull();
  });
});

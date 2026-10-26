import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, type ShareState } from '../src/index.js';

describe('share link', () => {
  const state: ShareState = {
    attackers: [
      { units: { 207: 50, 203: 20 }, research: { 109: 14, 110: 13, 111: 15, 118: 10 }, from: [1, 234, 5], speed: 80 },
      { units: { 231: 1 }, research: { 109: 16 }, from: [2, 10, 8], speed: 100 },
    ],
    defenders: [{ units: { 401: 300, 405: 40 }, research: { 111: 12 }, from: null, speed: 100 }],
    target: [1, 240, 7],
    resources: { metal: 500000, crystal: 250000, deuterium: 100000 },
    uni: { fd: 50, dd: 10, gs: 4 },
    runs: 30,
  };

  it('keeps everything through encode and decode, readable', () => {
    const hash = encodeShare(state);
    expect(hash).toContain('a0=203:20,207:50');
    expect(hash).toContain('t=1:240:7');
    expect(decodeShare('#' + hash)).toEqual(state);
  });

  it('ignores broken values', () => {
    const s = decodeShare('a0=204:x,205:3&a0v=500&t=1:2&res=1,2');
    expect(s.attackers[0]).toEqual({ units: { 205: 3 }, research: {}, from: null, speed: 100 });
    expect(s.target).toBeNull();
    expect(s.resources).toBeNull();
  });
});

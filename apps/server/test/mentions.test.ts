import { describe, expect, it } from 'vitest';
import { mentions } from '../src/domain/mentions.js';

describe('mentions (G-8)', () => {
  it('finds @name as a whole name, ignoring case', () => {
    expect(mentions('hi @Bob!', ['bob'])).toBe(true);
    expect(mentions('hi @Bobby', ['Bob'])).toBe(false);
    expect(mentions('mail bob@bob.de', ['bob'])).toBe(false);
    expect(mentions('@Der Pirat schau mal', ['Der Pirat'])).toBe(true);
    expect(mentions('@Bob', [null, undefined, 'Bob'])).toBe(true);
  });
});

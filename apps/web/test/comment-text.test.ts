import { describe, expect, it } from 'vitest';
import { commentParts, mentionSuggestions } from '../src/commentText';

const U = { galaxies: 4, systems: 400, positions: 15 };

describe('comment text (G-8)', () => {
  it('splits mentions and coordinates from the text', () => {
    expect(commentParts('@carol schau [1:234:5] und 2:10:3', ['Carol', 'Dave'], U)).toEqual([
      { kind: 'mention', text: '@carol', name: 'Carol' },
      { kind: 'text', text: ' schau ' },
      { kind: 'coords', text: '[1:234:5]', g: 1, s: 234, p: 5 },
      { kind: 'text', text: ' und ' },
      { kind: 'coords', text: '2:10:3', g: 2, s: 10, p: 3 },
    ]);
  });

  it('keeps unknown names, partial names, mails, times and coordinates outside the universe as text', () => {
    expect(commentParts('@Carolina mail@carol 12:30:00 9:1:1', ['Carol'], U)).toEqual([{ kind: 'text', text: '@Carolina mail@carol 12:30:00 9:1:1' }]);
  });

  it('suggests member names for the @ being typed', () => {
    expect(mentionSuggestions('hey @ca', ['Carol', 'Dave', 'Cami'])).toEqual({ prefix: 'ca', names: ['Carol', 'Cami'] });
    expect(mentionSuggestions('hey @carol', ['Carol'])).toBeNull();
    expect(mentionSuggestions('mail@ca', ['Carol'])).toBeNull();
  });
});

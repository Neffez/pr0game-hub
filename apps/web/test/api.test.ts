import { beforeEach, describe, expect, it } from 'vitest';
import { selectedGroup, selectGroup, session } from '../src/api';

describe('selectedGroup', () => {
  beforeEach(() => {
    localStorage.clear();
    session.me = {
      user: { id: 1, username: 'a', isAdmin: false, lang: 'de' },
      groups: [
        { id: 3, name: 'A', role: 'member', universe: 'u8', universe_name: 'U8' },
        { id: 5, name: 'B', role: 'member', universe: 'u8', universe_name: 'U8' },
        { id: 7, name: 'C', role: 'member', universe: 'u7', universe_name: 'U7' },
      ],
    };
  });

  it('uses the stored alliance of the universe', () => {
    selectGroup('u8', 5);
    expect(selectedGroup('u8')).toBe(5);
  });

  it('falls back to the first alliance when the stored one is no longer a membership', () => {
    selectGroup('u8', 99);
    expect(selectedGroup('u8')).toBe(3);
    // an alliance of another universe doesn't count either
    selectGroup('u8', 7);
    expect(selectedGroup('u8')).toBe(3);
    expect(selectedGroup('u9')).toBeNull();
  });
});

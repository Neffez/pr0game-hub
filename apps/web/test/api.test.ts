import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, readError, safeNext, selectedGroup, selectGroup, session } from '../src/api';

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

describe('safeNext', () => {
  it('keeps an in-app path and rejects everything that could leave the hub', () => {
    expect(safeNext('/u8/overview')).toBe('/u8/overview');
    expect(safeNext('/u8/overview?tab=plans')).toBe('/u8/overview?tab=plans');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/hub://x')).toBe('/');
    expect(safeNext(['/a', '/b'])).toBe('/a');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext(1)).toBe('/');
  });
});

describe('api', () => {
  beforeEach(() => {
    session.me = { user: { id: 1, username: 'a', isAdmin: false, lang: 'de', dateFormat: 'auto', tours: { enabled: true, seen: [] } }, groups: [] };
    vi.unstubAllGlobals();
  });

  it('treats a 401 as the session ending and does not throw on a bad JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { get: () => 'application/json' },
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    );
    await expect(api('/u8/overview')).rejects.toBeInstanceOf(ApiError);
    expect(session.me?.user).toBeNull();
  });
});

describe('readError', () => {
  it('reads API errors, other errors and thrown non-errors', () => {
    expect(readError(new ApiError(409, 'Benutzername vergeben', 'username_taken'))).toBe('Benutzername vergeben');
    expect(readError(new Error('boom'))).toBe('boom');
    expect(readError('plain')).toBe('plain');
    expect(readError(undefined)).toBeTruthy();
  });

  it('turns a failed request into a network error with its own code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const e = await api('/auth/me').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 0, code: 'network' });
    expect(readError(e)).not.toContain('Failed to fetch');
    vi.unstubAllGlobals();
  });
});

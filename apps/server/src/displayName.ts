import type { DB } from './db.js';

/**
 * ASCII login form of a name: characters outside letters, digits, `. _ -` and spaces become `_`.
 * Umlauts in "Bananenfürst" become "Bananenf_rst"; the hub display name keeps the original letters.
 */
export function loginUsernameBase(name: string): string {
  let base = name.replace(/[^\w.\- ]/g, '_').replace(/\s+/g, ' ').trim();
  if (base.length < 3) base = base.padEnd(3, '_');
  if (base.length > 32) base = base.slice(0, 32);
  return base;
}

/** True when `username` is `loginUsernameBase(name)` or that base with a `-2`, `-3`, … suffix from a clash. */
export function loginUsernameMatches(username: string, name: string): boolean {
  const base = loginUsernameBase(name);
  if (username === base) return true;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const trimmed = base.length + suffix.length > 32 ? base.slice(0, 32 - suffix.length) : base;
    if (username === trimmed + suffix) return true;
  }
  return false;
}

export type ParsedDisplayName = { status: 'empty' } | { status: 'invalid' } | { status: 'ok'; name: string };

/**
 * Hub display name: NFC, letters of any language (including umlauts), combining marks, digits, spaces, `. _ -`.
 * Empty or whitespace is `empty` (the username is shown). `@` and control characters are `invalid`.
 */
export function parseDisplayName(raw: unknown): ParsedDisplayName {
  const name = String(raw ?? '').normalize('NFC').trim();
  if (!name) return { status: 'empty' };
  if (name.length > 32 || /@/.test(name) || /[\p{Cc}\p{Cs}]/u.test(name) || !/^[\p{L}\p{M}\p{N}._\- ]+$/u.test(name)) {
    return { status: 'invalid' };
  }
  return { status: 'ok', name };
}

/**
 * When a member was added from an in-game name, the login username had to be ASCII, so umlauts became `_`.
 * If they never set a display name, copy that in-game name onto the account so the online list shows "Bananenfürst"
 * instead of "Bananenf_rst". Already chosen display names are left alone.
 */
export function backfillDisplayNamesFromIngame(db: DB) {
  const users = db.prepare("SELECT id, username FROM users WHERE display_name IS NULL OR display_name = ''").all() as {
    id: number;
    username: string;
  }[];
  const ingamesOf = db.prepare(
    "SELECT ingame_name FROM group_members WHERE user_id = ? AND ingame_name IS NOT NULL AND trim(ingame_name) != ''",
  );
  const set = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
  for (const u of users) {
    const names = (ingamesOf.all(u.id) as { ingame_name: string }[]).map((r) => r.ingame_name);
    const hit = names.find((n) => loginUsernameMatches(u.username, n));
    if (!hit) continue;
    const parsed = parseDisplayName(hit);
    if (parsed.status === 'ok') set.run(parsed.name, u.id);
  }
}

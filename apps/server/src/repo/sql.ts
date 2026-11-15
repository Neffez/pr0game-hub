import type { DB } from '../db.js';

/**
 * SQL fragments shared by the data layer (`store.ts`, `repo/`) and re-exported for the routes by `routes/util.ts`.
 *
 * Identity rule: wherever a member acts in the hub (lists, comments, notifications, CSV `member` columns,
 * settlements) they are shown by their hub name, `DISPLAY` (display name, else the login username). The in-game name
 * (`group_members.ingame_name`) is used where the game is matched: parsers and match keys (`repo/moons.ts`,
 * `draftOf` in `repo/settlements.ts`), the admin's list of players without an account to assign access requests to,
 * and as a secondary hint (health subtitle, online list tooltip).
 */

/** Hub name of a member: display name, falling back to the username (not the in-game name). Alias `u` is the users table. */
export const DISPLAY = "COALESCE(NULLIF(u.display_name, ''), u.username)";
/** `DISPLAY` for a users table under another alias. */
export const displayOf = (userAlias: string) => `COALESCE(NULLIF(${userAlias}.display_name, ''), ${userAlias}.username)`;

/** The hub name of one user (`DISPLAY`), undefined when there is no such user. */
export const displayNameOf = (db: DB, userId: number) =>
  db.prepare(`SELECT ${DISPLAY} FROM users u WHERE u.id = ?`).pluck().get(userId) as string | undefined;

/** Escapes LIKE wildcards of user input (use with ESCAPE '\\'). */
export const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

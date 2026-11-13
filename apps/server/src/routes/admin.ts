import type { FastifyInstance } from 'fastify';
import { checkDisplayName, checkUsername, HttpError, randomToken, requireAdmin, requireUser, revokeAccessIfOrphaned, tokenHash } from '../auth.js';
import { loginUsernameBase } from '../displayName.js';
import { config, UNIVERSE_DEFAULTS } from '../config.js';
import { settingsError } from '@pr0hub/core/universe';
import { catalogOf, catalogOfGroup, toUniverse } from '../context.js';
import { parseUnitPage } from '@pr0hub/core';
import { DEFAULT_UNIT_DEFS, isUnitId, validateUnits, type UnitOverrides } from '@pr0hub/core/units';
import { now, type DB } from '../db.js';
import { crawlerState, resumeCrawler } from '../crawler.js';
import { events } from '../events.js';
import { listSamples, sampleContent } from '../repo/samples.js';
import { ONBOARDING_STEPS, onboardingOf } from '../repo/onboarding.js';
import { aboutRecords, backfillActivity, parseRaw, reparse, type RawIngest } from '../ingest.js';
import { systemInfo, vacuum } from '../monitor.js';
import { undoIngest } from '../repo/cleanup.js';
import { followUniverse } from '../repo/plans.js';
import { memberFleetAttacks, removeStoredAttack } from '../repo/hostile.js';
import { publishIdentity } from './auth.js';
import { DISPLAY } from './util.js';

/**
 * Global admins manage universes, groups and the technical side (syncs, player merges, activity backfill, crawler).
 * Group admins only manage their own group: name, members and invites.
 */
/** The user of the request when they are a global admin or an admin of the group. */
export function requireGroupAdminOf(db: DB, req: Parameters<typeof requireUser>[0], groupId: number) {
  const user = requireUser(req);
  const isGroupAdmin = !!db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'").get(groupId, user.id);
  if (!user.isAdmin && !isGroupAdmin) throw new HttpError(403, 'group_admin_only', 'Alliance admins only');
  return user;
}

export function adminRoutes(app: FastifyInstance, db: DB) {
  const requireGroupAdmin = (req: Parameters<typeof requireUser>[0], groupId: number) => requireGroupAdminOf(db, req, groupId);

  /** Alliance admins can't remove or demote the last admin of their alliance (that's left to the global admin). */
  const keepLastAdmin = (user: { isAdmin: boolean }, groupId: number, userId: number) => {
    if (user.isAdmin) return;
    const admins = db.prepare("SELECT user_id FROM group_members WHERE group_id = ? AND role = 'admin'").pluck().all(groupId) as number[];
    if (admins.length === 1 && admins[0] === userId) throw new HttpError(400, 'last_admin', 'The alliance needs at least one admin');
  };

  /** The first global admin (who set the hub up) can't be removed from or demoted in an alliance by anyone. */
  const owner = () => db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').pluck().get() as number | undefined;

  const isPlaceholder = (userId: number) => {
    const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(userId) as string | undefined;
    return hash === '';
  };

  /**
   * Whoever takes over a placeholder (claim link, access request) becomes a member of every alliance it belongs to:
   * alliance admins may hand it out only when they are admin of all of them (else an alliance admin could get into an
   * alliance of another universe through a shared placeholder).
   */
  const adminOfAllGroups = (user: { id: number; isAdmin: boolean }, userId: number) =>
    user.isAdmin ||
    !db
      .prepare(
        `SELECT 1 FROM group_members m WHERE m.user_id = ?
           AND NOT EXISTS (SELECT 1 FROM group_members a WHERE a.group_id = m.group_id AND a.user_id = ? AND a.role = 'admin')`,
      )
      .get(userId, user.id);

  /**
   * Open claim invite for a placeholder member of the group (replaces any previous unused one). Only its hash is
   * stored: the link is returned here once.
   */
  const createClaimInvite = (groupId: number, targetUserId: number, createdBy: number) => {
    const role =
      (db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').pluck().get(groupId, targetUserId) as string | undefined) ?? 'member';
    db.prepare('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL').run(targetUserId);
    const token = randomToken(24);
    db.prepare('INSERT INTO invites (token, group_id, role, created_by, expires_at, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      tokenHash(token),
      groupId,
      role,
      createdBy,
      now() + 30 * 86400,
      targetUserId,
    );
    return token;
  };

  const usernameFromName = (name: string) => {
    const base = loginUsernameBase(name);
    if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(base)) return checkUsername(db, base);
    for (let n = 2; n < 1000; n++) {
      const suffix = `-${n}`;
      const trimmed = base.length + suffix.length > 32 ? base.slice(0, 32 - suffix.length) : base;
      const candidate = trimmed + suffix;
      if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) return checkUsername(db, candidate);
    }
    throw new HttpError(409, 'username_taken', 'Username already taken');
  };

  /** Original name when it is a valid display name and differs from the ASCII login username (umlauts, etc.). */
  const displayNameFromMemberName = (name: string, username: string): string | null => {
    try {
      const display = checkDisplayName(name);
      return display && display !== username ? display : null;
    } catch {
      return null;
    }
  };

  // ------------------------------------------------------------- universes

  app.get('/api/universes', async (req) => {
    requireUser(req);
    return (db.prepare('SELECT * FROM universes ORDER BY slug').all() as never[]).map(toUniverse);
  });

  /**
   * Start and end of a universe from the request (undefined: unchanged, null: none) on top of the current ones; the end
   * must come after the start.
   */
  const scheduleOf = (body: { startsAt?: unknown; endedAt?: unknown }, cur: { starts_at: number | null; ended_at: number | null }) => {
    const time = (v: unknown, cur: number | null) => {
      if (v === undefined) return cur;
      if (v === null) return null;
      if (!Number.isInteger(v) || (v as number) <= 0) throw new HttpError(400, 'schedule_invalid', 'Start and end: epoch seconds or null');
      return v as number;
    };
    const startsAt = time(body.startsAt, cur.starts_at);
    const endedAt = time(body.endedAt, cur.ended_at);
    if (startsAt != null && endedAt != null && endedAt <= startsAt) throw new HttpError(400, 'schedule_invalid', 'The end must come after the start');
    return { startsAt, endedAt };
  };

  app.post<{ Body: { slug: string; name: string; settings?: object; deck?: unknown; startsAt?: number | null; endedAt?: number | null } }>('/api/admin/universes', async (req) => {
    requireAdmin(req);
    const { slug, name, settings, deck } = req.body ?? ({} as never);
    if (!/^[a-z0-9-]{1,16}$/.test(slug ?? '')) throw new HttpError(400, 'slug_invalid', 'Slug: a-z, 0-9, -');
    if (db.prepare('SELECT 1 FROM universes WHERE slug = ?').get(slug)) throw new HttpError(409, 'universe_exists', 'Universe already exists');
    validateSettings(settings);
    const schedule = scheduleOf(req.body, { starts_at: null, ended_at: null });
    db.prepare('INSERT INTO universes (slug, name, settings, deck_config, starts_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      slug,
      name || slug,
      JSON.stringify({ ...UNIVERSE_DEFAULTS, ...(settings ?? {}) }),
      deck ? JSON.stringify(validateDeck(deck)) : null,
      schedule.startsAt,
      schedule.endedAt,
    );
    return { ok: true };
  });

  app.put<{ Params: { slug: string }; Body: { name?: string; settings?: object; deck?: unknown | null; isDefault?: boolean; startsAt?: number | null; endedAt?: number | null; ended?: boolean } }>(
    '/api/admin/universes/:slug',
    async (req) => {
      requireAdmin(req);
      const { name, settings, deck, isDefault, ended } = req.body ?? {};
      const cur = db.prepare('SELECT * FROM universes WHERE slug = ?').get(req.params.slug) as
        | { id: number; settings: string; starts_at: number | null; ended_at: number | null }
        | undefined;
      if (!cur) throw new HttpError(404, 'universe_not_found', 'Universe not found');
      validateSettings(settings);
      // `ended`: end now (an ended universe keeps its end) or remove the end; else the scheduled times
      const t = now();
      const schedule =
        ended === true ? { startsAt: cur.starts_at != null && cur.starts_at > t ? null : cur.starts_at, endedAt: cur.ended_at != null && cur.ended_at <= t ? cur.ended_at : t }
        : ended === false ? { startsAt: cur.starts_at, endedAt: null }
        : scheduleOf(req.body ?? {}, cur);
      const next = { ...JSON.parse(cur.settings), ...(settings ?? {}) };
      // null removes an optional setting (back to its default)
      for (const [key, value] of Object.entries(next)) if (value === null) delete next[key];
      db.prepare('UPDATE universes SET name = COALESCE(?, name), settings = ? WHERE slug = ?').run(name ?? null, JSON.stringify(next), req.params.slug);
      // retime targets were derived with the old distances and fleet speed
      const moved = followUniverse(db, cur.id, { ...UNIVERSE_DEFAULTS, ...JSON.parse(cur.settings) }, { ...UNIVERSE_DEFAULTS, ...next }, catalogOf(toUniverse(cur as never)).drives);
      for (const groupId of moved) events.publish(groupId, { type: 'data', tables: ['attack_plans', 'target_claims'] });
      if (isDefault !== undefined) {
        // at most one default universe
        if (isDefault) db.prepare('UPDATE universes SET is_default = 0 WHERE is_default = 1').run();
        db.prepare('UPDATE universes SET is_default = ? WHERE slug = ?').run(isDefault ? 1 : 0, req.params.slug);
      }
      if (deck !== undefined) {
        db.prepare('UPDATE universes SET deck_config = ? WHERE slug = ?').run(deck ? JSON.stringify(validateDeck(deck)) : null, req.params.slug);
      }
      // the start makes it take data, the end freezes it at that time; members' pages follow
      if (schedule.startsAt !== cur.starts_at || schedule.endedAt !== cur.ended_at) {
        db.prepare('UPDATE universes SET starts_at = ?, ended_at = ? WHERE slug = ?').run(schedule.startsAt, schedule.endedAt, req.params.slug);
        const groups = db.prepare('SELECT id FROM groups WHERE universe_id = ?').pluck().all(cur.id) as number[];
        for (const groupId of groups) events.publish(groupId, { type: 'data', tables: ['universe'] });
      }
      return { ok: true };
    },
  );

  // Ships, defense and missiles of a universe: the defaults, its differences and the result.
  const unitsOf = (slug: string) => {
    const row = db.prepare('SELECT id, units FROM universes WHERE slug = ?').get(slug) as { id: number; units: string } | undefined;
    if (!row) throw new HttpError(404, 'universe_not_found', 'Universe not found');
    return { id: row.id, overrides: JSON.parse(row.units || '{}') as UnitOverrides };
  };
  const unitsView = (overrides: UnitOverrides) => ({ defaults: DEFAULT_UNIT_DEFS, overrides, units: catalogOf({ units: overrides }).units });

  app.get<{ Params: { slug: string } }>('/api/admin/universes/:slug/units', async (req) => {
    requireAdmin(req);
    return unitsView(unitsOf(req.params.slug).overrides);
  });

  app.put<{ Params: { slug: string }; Body: { units?: unknown } }>('/api/admin/universes/:slug/units', async (req) => {
    requireAdmin(req);
    const { id } = unitsOf(req.params.slug);
    const units = req.body?.units ?? {};
    const problem = validateUnits(units);
    if (problem != null) throw new HttpError(400, 'units_invalid', `Invalid units${problem ? `: ${problem}` : ''}`);
    db.prepare('UPDATE universes SET units = ? WHERE id = ?').run(JSON.stringify(units), id);
    const groups = db.prepare('SELECT id FROM groups WHERE universe_id = ?').pluck().all(id) as number[];
    for (const groupId of groups) events.publish(groupId, { type: 'data', tables: ['universe'] });
    return unitsView(units as UnitOverrides);
  });

  /** Unit values from a pasted game page source (shipyard, defense, tech tree, info page); nothing is stored. */
  app.post<{ Params: { slug: string }; Body: { html?: unknown; names?: unknown } }>('/api/admin/universes/:slug/units/parse', async (req) => {
    requireAdmin(req);
    const { overrides } = unitsOf(req.params.slug);
    const html = req.body?.html;
    if (typeof html !== 'string' || !html.trim() || html.length > 5_000_000) throw new HttpError(400, 'units_page_invalid', 'Expected a page source');
    // names of the other universes' units (ids are the same in every universe), then of this one and of pages pasted
    // before (an info page has no id); later entries win
    const names: Record<string, number> = {};
    for (const raw of db.prepare('SELECT units FROM universes WHERE slug <> ?').pluck().all(req.params.slug) as string[]) {
      for (const u of Object.values(catalogOf({ units: JSON.parse(raw || '{}') }).units)) for (const n of Object.values(u.name)) names[n] ??= u.id;
    }
    for (const u of Object.values(catalogOf({ units: overrides }).units)) for (const n of Object.values(u.name)) names[n] = u.id;
    const extra = req.body?.names;
    if (extra && typeof extra === 'object') {
      for (const [n, id] of Object.entries(extra)) if (typeof id === 'number' && isUnitId(id) && n.length <= 64) names[n] = id;
    }
    const page = parseUnitPage(html, names);
    if (!page) throw new HttpError(400, 'units_page_unknown', 'Not a shipyard, defense, tech tree or unit info page');
    return page;
  });

  // ----------------------------------------------------------------- users

  app.put<{ Params: { userId: string }; Body: { username: string } }>('/api/admin/users/:userId', async (req) => {
    requireAdmin(req);
    const userId = Number(req.params.userId);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(404, 'user_not_found', 'User not found');
    const username = checkUsername(db, req.body?.username, userId);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
    return { ok: true, username };
  });

  // ------------------------------------------------------- access requests

  /**
   * The alliances whose placeholders the user may assign requests to: all for global admins, else the ones they are
   * admin of (none: 403). Requests carry no alliance, so alliance admins see all of them but only offer their own players.
   */
  const assignableGroups = (user: { id: number; isAdmin: boolean }) => {
    if (user.isAdmin) return null;
    const groups = db.prepare("SELECT group_id FROM group_members WHERE user_id = ? AND role = 'admin'").pluck().all(user.id) as number[];
    if (!groups.length) throw new HttpError(403, 'group_admin_only', 'Alliance admins only');
    return groups;
  };

  /** Open requests plus the placeholder members (no account yet) they can be assigned to. */
  app.get('/api/admin/access-requests', async (req) => {
    const groups = assignableGroups(requireUser(req));
    const requests = db.prepare('SELECT id, username, message, created_at FROM access_requests ORDER BY id').all();
    const placeholders = db
      .prepare(
        `SELECT u.id, COALESCE(m.ingame_name, u.username) AS name, g.name AS "group", un.slug AS universe
         FROM users u JOIN group_members m ON m.user_id = u.id JOIN groups g ON g.id = m.group_id JOIN universes un ON un.id = g.universe_id
         WHERE u.password_hash = '' ${
           groups
             ? `AND g.id IN (${groups.map(() => '?').join(',')})
                AND NOT EXISTS (SELECT 1 FROM group_members o WHERE o.user_id = u.id AND o.group_id NOT IN (${groups.map(() => '?').join(',')}))`
             : ''
         } ORDER BY un.slug, g.name, name`,
      )
      .all(...(groups ?? []), ...(groups ?? []));
    return { requests, placeholders };
  });

  /** The request's username and password go to the placeholder member, who can log in with them from then on. */
  app.post<{ Params: { id: string }; Body: { userId?: number } }>('/api/admin/access-requests/:id/assign', async (req) => {
    const user = requireUser(req);
    const groups = assignableGroups(user);
    const request = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(Number(req.params.id)) as
      | { id: number; username: string; password_hash: string; lang: string }
      | undefined;
    if (!request) throw new HttpError(404, 'not_found', 'Not found');
    const userId = Number(req.body?.userId);
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND password_hash = ''").get(userId)) {
      throw new HttpError(400, 'not_placeholder', 'The player already has an account');
    }
    const username = checkUsername(db, request.username, userId);
    const memberOf = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').pluck().all(userId) as number[];
    // alliance admins only hand out players who are in their own alliances only
    if (groups && (!memberOf.some((g) => groups.includes(g)) || !adminOfAllGroups(user, userId))) {
      throw new HttpError(403, 'group_admin_only', 'Alliance admins only');
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET username = ?, password_hash = ?, lang = ? WHERE id = ?').run(username, request.password_hash, request.lang, userId);
      db.prepare('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL').run(userId);
      db.prepare('DELETE FROM access_requests WHERE id = ?').run(request.id);
    })();
    for (const groupId of memberOf) events.publish(groupId, { type: 'data', tables: ['group_members'] });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/access-requests/:id', async (req) => {
    requireAdmin(req);
    if (!db.prepare('DELETE FROM access_requests WHERE id = ?').run(Number(req.params.id)).changes) throw new HttpError(404, 'not_found', 'Not found');
    return { ok: true };
  });

  // ---------------------------------------------------------------- groups

  /** The short tag of an alliance: trimmed, at most 10 characters, empty = none (the name is shown instead). */
  const groupTag = (raw: unknown): string | null => {
    const tag = String(raw ?? '').trim();
    if (tag.length > 10) throw new HttpError(400, 'tag_too_long', 'Tag too long (at most 10 characters)');
    return tag || null;
  };

  app.get('/api/admin/groups', async (req) => {
    const user = requireUser(req);
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.tag, u.slug AS universe, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS members
         FROM groups g JOIN universes u ON u.id = g.universe_id
         WHERE ? OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ? AND role = 'admin')
         ORDER BY u.slug, g.name`,
      )
      .all(user.isAdmin ? 1 : 0, user.id);
    return groups;
  });

  app.post<{ Body: { universe: string; name: string; tag?: string | null } }>('/api/admin/groups', async (req) => {
    const user = requireAdmin(req);
    const uni = db.prepare('SELECT id FROM universes WHERE slug = ?').pluck().get(req.body?.universe) as number | undefined;
    if (!uni) throw new HttpError(404, 'universe_not_found', 'Universe not found');
    const name = String(req.body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name_missing', 'Name missing');
    if (db.prepare('SELECT 1 FROM groups WHERE universe_id = ? AND name = ?').get(uni, name)) throw new HttpError(409, 'group_exists', 'Alliance already exists');
    const id = db.prepare('INSERT INTO groups (universe_id, name, tag) VALUES (?, ?, ?)').run(uni, name, groupTag(req.body.tag)).lastInsertRowid;
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(id, user.id);
    return { id: Number(id) };
  });

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/members', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    const t = now();
    const onboarding = onboardingOf(db, groupId);
    return db
      .prepare(
        `SELECT u.id, u.username, u.display_name, m.role, m.ingame_name, m.joined_at, u.last_login_at, u.is_admin AS global_admin,
           (u.password_hash <> '') AS account,
           (SELECT COUNT(*) FROM group_members o WHERE o.user_id = u.id AND o.group_id <> m.group_id) AS other_groups,
           (SELECT MAX(expires_at) FROM invites WHERE user_id = u.id AND used_at IS NULL AND expires_at > ?) AS invite_expires_at
         FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.username`,
      )
      .all(t, groupId)
      // a member's invite for an existing account is a password recovery link: only global admins learn of it; the
      // link itself is only shown when created
      .map((m: any) => ({
        ...m,
        onboarding: ONBOARDING_STEPS.filter((k) => onboarding.get(m.id)?.[k] != null),
        account: !!m.account,
        global_admin: !!m.global_admin,
        owner: m.id === owner(),
        invite_expires_at: m.account && !user.isAdmin ? null : m.invite_expires_at,
      }));
  });

  /**
   * Existing accounts that can be added to the group (not yet a member): all for global admins, else the members of
   * the alliances the user is admin of in any universe (e.g. their alliance in the previous universe). `ingameName` is
   * the most recent in-game name from another membership.
   */
  const candidateUsers = (user: { id: number; isAdmin: boolean }, groupId: number) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, (u.password_hash <> '') AS account,
           (SELECT m.ingame_name FROM group_members m WHERE m.user_id = u.id AND m.ingame_name IS NOT NULL ORDER BY m.joined_at DESC LIMIT 1) AS ingameName,
           (SELECT json_group_array(un.slug || ' · ' || g.name) FROM group_members m JOIN groups g ON g.id = m.group_id
              JOIN universes un ON un.id = g.universe_id WHERE m.user_id = u.id) AS groups
         FROM users u
         WHERE u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
           AND (? OR u.id IN (SELECT m.user_id FROM group_members m WHERE m.group_id IN
                (SELECT group_id FROM group_members WHERE user_id = ? AND role = 'admin')))
         ORDER BY u.username COLLATE NOCASE`,
      )
      .all(groupId, user.isAdmin ? 1 : 0, user.id) as { id: number; username: string; account: number; ingameName: string | null; groups: string }[];
    return rows.map((r) => ({ ...r, account: !!r.account, groups: JSON.parse(r.groups) as string[] }));
  };

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/candidates', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    return candidateUsers(user, groupId);
  });

  app.post<{ Params: { id: string }; Body: { name?: string; userId?: number; ingameName?: string | null } }>('/api/admin/groups/:id/members', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    if (req.body?.userId !== undefined && req.body?.userId !== null) {
      // an existing account (from another universe's alliance): no new account, no invite
      const userId = Number(req.body.userId);
      if (db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)) {
        throw new HttpError(409, 'member_exists', 'Already a member of this alliance');
      }
      const candidate = candidateUsers(user, groupId).find((c) => c.id === userId);
      if (!candidate) throw new HttpError(404, 'user_not_found', 'User not found');
      const ingame = String(req.body.ingameName ?? '').trim() || candidate.ingameName || null;
      if (ingame && db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND ingame_name = ?').get(groupId, ingame)) {
        throw new HttpError(409, 'member_exists', 'A member with this in-game name already exists');
      }
      db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', ?)").run(groupId, userId, ingame);
      events.publish(groupId, { type: 'data', tables: ['group_members'] });
      return { id: userId };
    }
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name_missing', 'Name missing');
    if (db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND ingame_name = ?').get(groupId, name)) {
      throw new HttpError(409, 'member_exists', 'A member with this in-game name already exists');
    }
    const username = usernameFromName(name);
    const displayName = displayNameFromMemberName(name, username);
    const userId = Number(
      db.prepare('INSERT INTO users (username, password_hash, is_admin, display_name) VALUES (?, ?, 0, ?)').run(
        username,
        '',
        displayName,
      ).lastInsertRowid,
    );
    db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', ?)").run(groupId, userId, name);
    const token = createClaimInvite(groupId, userId, user.id);
    events.publish(groupId, { type: 'data', tables: ['group_members'] });
    return { id: userId, token };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; tag?: string | null } }>('/api/admin/groups/:id', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name_missing', 'Name missing');
    const uni = db.prepare('SELECT universe_id FROM groups WHERE id = ?').pluck().get(groupId) as number | undefined;
    if (!uni) throw new HttpError(404, 'not_found', 'Not found');
    if (db.prepare('SELECT 1 FROM groups WHERE universe_id = ? AND name = ? AND id <> ?').get(uni, name, groupId)) {
      throw new HttpError(409, 'group_exists', 'Alliance already exists');
    }
    db.prepare('UPDATE groups SET name = ?, tag = ? WHERE id = ?').run(name, groupTag(req.body?.tag), groupId);
    return { ok: true };
  });

  app.put<{ Params: { id: string; userId: string }; Body: { role?: string; ingameName?: string | null; displayName?: string | null } }>(
    '/api/admin/groups/:id/members/:userId',
    async (req) => {
      const groupId = Number(req.params.id);
      const user = requireGroupAdmin(req, groupId);
      const role = req.body?.role;
      if (role && role !== 'member' && role !== 'admin') throw new HttpError(400, 'role_invalid', 'Invalid role');
      const target = Number(req.params.userId);
      if (role === 'member') {
        if (target === owner()) throw new HttpError(400, 'owner_protected', 'The hub owner stays admin');
        keepLastAdmin(user, groupId, target);
      }
      const hasName = req.body !== undefined && req.body !== null && 'ingameName' in req.body;
      db.prepare('UPDATE group_members SET role = COALESCE(?, role), ingame_name = CASE WHEN ? THEN ? ELSE ingame_name END WHERE group_id = ? AND user_id = ?').run(
        role ?? null,
        hasName ? 1 : 0,
        String(req.body?.ingameName ?? '').trim() || null,
        groupId,
        target,
      );
      if (req.body !== undefined && req.body !== null && 'displayName' in req.body) {
        if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, target)) {
          throw new HttpError(404, 'user_not_found', 'User not found');
        }
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(checkDisplayName(req.body.displayName), target);
        publishIdentity(db, target);
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/groups/:id/members/:userId', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    const target = Number(req.params.userId);
    if (target === user.id) throw new HttpError(400, 'remove_self', 'You cannot remove yourself');
    if (target === owner()) throw new HttpError(400, 'owner_protected', 'The hub owner cannot be removed');
    keepLastAdmin(user, groupId, target);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, target)) {
      throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    const elsewhere = !!db.prepare('SELECT 1 FROM group_members WHERE user_id = ? AND group_id <> ?').get(target, groupId);
    if (isPlaceholder(target) && !elsewhere) {
      db.prepare('DELETE FROM users WHERE id = ?').run(target);
    } else if (isPlaceholder(target)) {
      // still a member of other alliances (other universes): keep the account, drop this membership and its claim link
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, target);
      db.prepare('DELETE FROM invites WHERE group_id = ? AND user_id = ? AND used_at IS NULL').run(groupId, target);
    } else {
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, target);
      revokeAccessIfOrphaned(db, target);
    }
    events.publish(groupId, { type: 'data', tables: ['group_members'] });
    return { ok: true };
  });

  app.post<{ Params: { id: string; userId: string } }>('/api/admin/groups/:id/members/:userId/invite', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    const target = Number(req.params.userId);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, target)) {
      throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    // a link for an existing account resets its password: that would let alliance admins take over any account
    if (!isPlaceholder(target)) requireAdmin(req);
    else if (!adminOfAllGroups(user, target)) throw new HttpError(403, 'group_admin_only', 'The player is also in alliances you are not admin of');
    return { token: createClaimInvite(groupId, target, user.id) };
  });

  // ------------------------------------------------- players / data hygiene

  /** Merges `from` into `into` (rename that couldn't be matched by id). */
  app.post<{ Params: { id: string }; Body: { from: number; into: number } }>('/api/admin/groups/:id/players/merge', async (req) => {
    const groupId = Number(req.params.id);
    requireAdmin(req);
    const { from, into } = req.body ?? ({} as never);
    const both = db.prepare('SELECT id, name, ingame_id, first_seen, last_seen FROM players WHERE group_id = ? AND id IN (?, ?)').all(groupId, from, into) as {
      id: number;
      name: string;
      ingame_id: number | null;
      first_seen: number;
      last_seen: number;
    }[];
    if (!Number.isInteger(from) || !Number.isInteger(into) || both.length !== 2 || from === into) throw new HttpError(400, 'players_invalid', 'Invalid players');
    const src = both.find((p) => p.id === from)!;
    db.transaction(() => {
      // Every table that references players (scores, spies, plans, comments, …). Conflicts keep the target's row.
      for (const { table, column } of playerReferences(db)) {
        db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(into, from);
      }
      db.prepare('INSERT OR REPLACE INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)').run(into, src.name, src.last_seen);
      if (src.ingame_id) db.prepare('UPDATE players SET ingame_id = NULL WHERE id = ?').run(from);
      db.prepare('UPDATE players SET ingame_id = COALESCE(ingame_id, ?), first_seen = MIN(first_seen, ?) WHERE id = ?').run(src.ingame_id, src.first_seen, into);
      db.prepare('DELETE FROM players WHERE id = ?').run(from);
    })();
    events.publish(groupId, { type: 'data', tables: ['players', 'comments'] });
    return { ok: true };
  });

  /** Running attacks in members' stored overview fleet lists (global admins: remove wrong entries). */
  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/fleet-attacks', async (req) => {
    requireAdmin(req);
    const groupId = Number(req.params.id);
    const members = db
      .prepare(
        `SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY name`,
      )
      .all(groupId) as { user_id: number; name: string }[];
    return members.flatMap((m) =>
      memberFleetAttacks(db, groupId, m.user_id).map((a) => ({ userId: m.user_id, member: m.name, ...a })),
    );
  });

  app.post<{ Params: { id: string }; Body: { userId?: number; key?: string; arrival?: number } }>('/api/admin/groups/:id/fleet-attacks/remove', async (req) => {
    requireAdmin(req);
    const groupId = Number(req.params.id);
    const userId = Number(req.body?.userId);
    const key = String(req.body?.key ?? '');
    const arrival = req.body?.arrival == null ? undefined : Number(req.body.arrival);
    if (!userId || !key || (arrival !== undefined && !Number.isFinite(arrival))) throw new HttpError(400, 'invalid_body', 'userId and key required, arrival a number');
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)) {
      throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    const snapshots = removeStoredAttack(db, groupId, userId, key, arrival);
    if (!snapshots) throw new HttpError(404, 'attack_not_found', 'No such attack in stored fleet lists');
    events.publish(groupId, { type: 'data', tables: ['fleets', 'hidden_attacks'] });
    return { snapshots };
  });

  /** Parser samples members sent for pages the hub found nothing in (all groups, hub admins). */
  app.get('/api/admin/parser-samples', async (req) => {
    requireAdmin(req);
    return listSamples(db);
  });

  app.get<{ Params: { id: string } }>('/api/admin/parser-samples/:id', async (req, reply) => {
    requireAdmin(req);
    const c = sampleContent(db, Number(req.params.id));
    if (!c) throw new HttpError(404, 'sample_not_found', 'Sample not found');
    const html = c.html != null;
    return reply
      .header('content-type', html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="sample-${Number(req.params.id)}.${html ? 'html' : 'txt'}"`)
      .send(c.html ?? c.text ?? '');
  });

  app.delete<{ Params: { id: string } }>('/api/admin/parser-samples/:id', async (req) => {
    requireAdmin(req);
    db.prepare('DELETE FROM parser_samples WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/ingests', async (req) => {
    const groupId = Number(req.params.id);
    requireAdmin(req);
    const rows = db
      .prepare(
        `SELECT r.id, r.source, r.page_type, r.url, r.summary, r.created_at, u.username, b.username AS synced_by,
           length(r.html_gz) AS html_size, length(r.text_gz) AS text_size
         FROM raw_ingests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users b ON b.id = r.synced_by WHERE r.group_id = ? ORDER BY r.id DESC LIMIT 200`,
      )
      .all(groupId) as { id: number; summary: string | null; html_size: number | null; text_size: number | null }[];
    // syncs stored before the content description: described once from their page, then kept
    const raw = db.prepare('SELECT group_id, user_id, url, html_gz, text_gz FROM raw_ingests WHERE id = ?');
    const save = db.prepare('UPDATE raw_ingests SET summary = ? WHERE id = ?');
    return rows.map((r) => {
      const summary = r.summary ? JSON.parse(r.summary) : {};
      if (!summary.about && (r.html_size || r.text_size)) {
        try {
          summary.about = aboutRecords(parseRaw(raw.get(r.id) as RawIngest, catalogOfGroup(db, groupId)).records);
        } catch {
          summary.about = [];
        }
        save.run(JSON.stringify(summary), r.id);
      }
      return { ...r, summary };
    });
  });

  // ------------------------------------------------- battle report crawler

  app.get('/api/admin/crawler', async (req) => {
    requireAdmin(req);
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN report_status = 'archived' THEN 1 ELSE 0 END) AS archived,
           SUM(CASE WHEN report_status = 'gone' THEN 1 ELSE 0 END) AS gone,
           SUM(CASE WHEN report_status = 'lost' THEN 1 ELSE 0 END) AS lost,
           SUM(CASE WHEN report_status IS NULL AND report_tries < 3 THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN report_status IS NULL AND report_tries >= 3 THEN 1 ELSE 0 END) AS failed
         FROM battle_hall`,
      )
      .get();
    const name = db.prepare('SELECT name FROM universes WHERE id = ?').pluck();
    const universes = [...crawlerState].map(([id, s]) => ({ universe: name.get(id) ?? String(id), ...s }));
    return { enabled: config.crawler.enabled, universes, ...(counts as object) };
  });

  app.post('/api/admin/crawler/retry', async (req) => {
    requireAdmin(req);
    return { reset: resumeCrawler(db) };
  });

  // ------------------------------------------------------- system monitor

  /** Database and disk size, memory, event loop and request times (see monitor.ts). */
  app.get('/api/admin/system', async (req) => {
    requireAdmin(req);
    return systemInfo(db);
  });

  /** Gives the free pages of the database file back to the disk (VACUUM); the hub waits while it runs. */
  app.post('/api/admin/system/vacuum', async (req) => {
    requireAdmin(req);
    const res = vacuum(db);
    if (!res.ok) throw new HttpError(507, 'disk_space_low', 'Not enough free disk space to rebuild the database');
    req.log.info(res, 'database vacuumed');
    return res;
  });

  app.post<{ Params: { id: string } }>('/api/admin/ingests/:id/reparse', async (req) => {
    requireAdmin(req);
    const row = db
      .prepare('SELECT r.group_id, u.settings FROM raw_ingests r JOIN groups g ON g.id = r.group_id JOIN universes u ON u.id = g.universe_id WHERE r.id = ?')
      .get(Number(req.params.id)) as { group_id: number; settings: string } | undefined;
    if (!row) throw new HttpError(404, 'not_found', 'Not found');
    const tz = JSON.parse(row.settings).timezone ?? UNIVERSE_DEFAULTS.timezone;
    return reparse(db, Number(req.params.id), tz);
  });

  /** Takes a sync back (e.g. a page of another universe); `dryRun` returns the same summary without changes. */
  app.post<{ Params: { id: string }; Body: { dryRun?: boolean } }>('/api/admin/ingests/:id/delete', async (req) => {
    requireAdmin(req);
    const groupId = db.prepare('SELECT group_id FROM raw_ingests WHERE id = ?').pluck().get(Number(req.params.id)) as number | undefined;
    if (!groupId) throw new HttpError(404, 'not_found', 'Not found');
    const dryRun = !!req.body?.dryRun;
    const res = undoIngest(db, Number(req.params.id), dryRun);
    if (!dryRun) {
      events.publish(groupId, {
        type: 'data',
        tables: ['player_scores', 'alliance_scores', 'players', 'activity_log', 'empire', 'overview', 'fleets', 'spy_reports'],
      });
    }
    return res;
  });

  /** Fills the activity log from already stored stats and spy reports. */
  app.post<{ Params: { id: string } }>('/api/admin/groups/:id/activity/backfill', async (req) => {
    const groupId = Number(req.params.id);
    requireAdmin(req);
    const row = db.prepare('SELECT u.settings FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?').get(groupId) as
      | { settings: string }
      | undefined;
    if (!row) throw new HttpError(404, 'not_found', 'Not found');
    const tz = JSON.parse(row.settings).timezone ?? UNIVERSE_DEFAULTS.timezone;
    const added = backfillActivity(db, groupId, tz);
    if (added) events.publish(groupId, { type: 'data', tables: ['activity_log', 'player_activity'] });
    return { added };
  });
}

function validateSettings(settings: object | undefined) {
  const err = settingsError(settings);
  if (err) throw new HttpError(400, err.code, err.message);
}

function playerReferences(db: DB): { table: string; column: string }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
  return tables.flatMap((t) =>
    (db.pragma(`foreign_key_list(${JSON.stringify(t)})`) as { table: string; from: string }[])
      .filter((fk) => fk.table === 'players')
      .map((fk) => ({ table: t, column: fk.from })),
  );
}

function validateDeck(deck: unknown) {
  if (!Array.isArray(deck)) throw new HttpError(400, 'deck_not_array', 'Deck must be an array');
  return deck.map((c) => {
    const { type, size, count } = c as Record<string, unknown>;
    if (typeof type !== 'string' || typeof size !== 'string' || !Number.isInteger(count) || (count as number) < 0) {
      throw new HttpError(400, 'deck_entry_invalid', 'Invalid deck entry: {type, size, count}');
    }
    return { type, size, count };
  });
}

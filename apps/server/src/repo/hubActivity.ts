import type { DB } from '../db.js';
import type { GroupContext } from '../context.js';
import { DISPLAY } from './sql.js';

/**
 * The hub's own activity: what members did in the hub, newest first. Syncs that brought the group something new (the
 * raw syncs' `news`, kept for `RAW_RETENTION_DAYS`), bundled per member and kind while they follow each other within
 * `BUNDLE_GAP`; comments; new raid plans; target claims (bundled like syncs, those made for a plan left out). Only
 * data the whole group shares: a member's own pages (empire, buildings, fleets, …), expeditions and in-game messages
 * are no part of it. A member who does not share their syncs (`share_syncs` 0) appears without name in their syncs,
 * except to themselves and global admins.
 */

/** Syncs and claims of a member of one kind no more than this apart form one entry. */
export const BUNDLE_GAP = 30 * 60;
const MAX_ENTRIES = 500;
const MAX_ITEMS = 100;
const EXCERPT = 160;

/** Count keys of a sync (Store `count`) that are shared news, and the kind of sync they make. */
const SYNC_KINDS: Record<string, string> = {
  galaxy_systems: 'galaxy',
  spy_reports: 'spy',
  player_scores: 'stats',
  alliance_scores: 'stats',
  battle_reports: 'battle',
  combat_reports: 'combat',
  hostile_spying: 'hostile',
  player_cards: 'playerCard',
  battle_hall: 'battleHall',
  market_offers: 'market',
};

export interface HubActivityEntry {
  id: string;
  kind: 'sync' | 'comment' | 'plan' | 'claim';
  /** sync: kind of data; claim: farm/attack/spy/recycle; plan: attack/hold */
  what: string | null;
  time: number;
  end: number;
  user_id: number | null;
  member: string | null;
  /** the member does not share their syncs: no name */
  hidden: boolean;
  count: number;
  items: string[];
  text: string | null;
  player_id: number | null;
  player_name: string | null;
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: string | null;
  plan_id: number | null;
  target_time: number | null;
}

interface Sync {
  user: number | null;
  time: number;
  source: string;
  summary: string | null;
}

type Summary = {
  counts?: Record<string, { new: number }>;
  news?: Record<string, { n: number; items: string[] }>;
  about?: { kind: string; who?: string; type?: number | null }[];
};

const blank = (): Omit<HubActivityEntry, 'id' | 'kind' | 'time'> => ({
  what: null, end: 0, user_id: null, member: null, hidden: false, count: 0, items: [], text: null, player_id: null,
  player_name: null, g: null, s: null, p: null, planet_type: null, plan_id: null, target_time: null,
});

/** What one raw sync brought new, per kind of sync: count and labels. */
export function syncNews(source: string, raw: string | null): Map<string, { n: number; items: string[] }> {
  const out = new Map<string, { n: number; items: string[] }>();
  if (!raw) return out;
  let s: Summary;
  try {
    s = JSON.parse(raw) as Summary;
  } catch {
    return out;
  }
  const add = (kind: string, n: number, items: string[]) => {
    if (n <= 0) return;
    const o = out.get(kind) ?? { n: 0, items: [] };
    o.n += n;
    for (const i of items) if (o.items.length < MAX_ITEMS && !o.items.includes(i)) o.items.push(i);
    out.set(kind, o);
  };
  // syncs before `news` was kept: their counts of new rows (a galaxy system counted even when unchanged)
  const news = s.news ?? Object.fromEntries(Object.entries(s.counts ?? {}).map(([k, c]) => [k, { n: c.new, items: [] }]));
  const statsItems = (s.about ?? []).filter((a) => a.kind === 'stats').map((a) => `${a.who ?? 'player'}:${a.type ?? 1}`);
  for (const [key, v] of Object.entries(news)) {
    const kind = SYNC_KINDS[key];
    if (!kind) continue;
    if (kind === 'galaxy' && source === 'json') add('universe', v.n, []);
    else add(kind, v.n, kind === 'stats' ? statsItems : v.items);
  }
  return out;
}

export function hubActivity(db: DB, ctx: GroupContext, from: number, to: number): { entries: HubActivityEntry[] } {
  const viewer = ctx.user;
  const users = new Map(
    (db.prepare(`SELECT u.id, ${DISPLAY} AS name, u.share_syncs FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ?`).all(ctx.groupId) as {
      id: number; name: string; share_syncs: number;
    }[]).map((u) => [u.id, u]),
  );
  const nameOf = (id: number | null) => (id == null ? null : (users.get(id)?.name ?? db.prepare(`SELECT ${DISPLAY} FROM users u WHERE id = ?`).pluck().get(id) as string | null) ?? null);
  const entries: HubActivityEntry[] = [];

  // ---- syncs, bundled per member and kind
  const syncs = db
    .prepare(
      `SELECT COALESCE(synced_by, user_id) AS user, created_at AS time, source, summary FROM raw_ingests
       WHERE group_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at, id`,
    )
    .all(ctx.groupId, from, to) as Sync[];
  const open = new Map<string, HubActivityEntry>();
  for (const sync of syncs) {
    for (const [what, news] of syncNews(sync.source, sync.summary)) {
      const key = `${sync.user ?? ''}|${what}`;
      let e = open.get(key);
      if (!e || sync.time - e.end > BUNDLE_GAP) {
        const hidden = sync.user != null && sync.user !== viewer.id && !viewer.isAdmin && users.get(sync.user)?.share_syncs === 0;
        e = { ...blank(), id: `sync-${sync.user ?? 0}-${what}-${sync.time}`, kind: 'sync', what, time: sync.time, end: sync.time, user_id: hidden ? null : sync.user, member: hidden ? null : nameOf(sync.user), hidden };
        open.set(key, e);
        entries.push(e);
      }
      e.end = sync.time;
      e.count += news.n;
      for (const i of news.items) if (e.items.length < MAX_ITEMS && !e.items.includes(i)) e.items.push(i);
    }
  }

  // ---- comments (on a player, a planet/moon or a raid plan's loot settlement)
  for (const c of db
    .prepare(
      `SELECT c.id, c.user_id, c.created_at, c.body, c.player_id, pl.name AS player_name, c.g, c.s, c.p, c.planet_type, c.plan_id,
         ap.g AS plan_g, ap.s AS plan_s, ap.p AS plan_p, ap.planet_type AS plan_type, ap.player_id AS plan_player_id, apl.name AS plan_player_name
       FROM comments c LEFT JOIN players pl ON pl.id = c.player_id
       LEFT JOIN attack_plans ap ON ap.id = c.plan_id AND ap.group_id = c.group_id LEFT JOIN players apl ON apl.id = ap.player_id
       WHERE c.group_id = ? AND c.deleted_at IS NULL AND c.created_at BETWEEN ? AND ?`,
    )
    .all(ctx.groupId, from, to) as any[]) {
    const body = String(c.body).replace(/\s+/g, ' ').trim();
    entries.push({
      ...blank(), id: `comment-${c.id}`, kind: 'comment', what: c.plan_id ? 'plan' : c.player_id ? 'player' : 'planet',
      time: c.created_at, end: c.created_at, user_id: c.user_id, member: nameOf(c.user_id), count: 1,
      text: body.length > EXCERPT ? `${body.slice(0, EXCERPT - 1)}…` : body,
      player_id: c.player_id ?? c.plan_player_id, player_name: c.player_name ?? c.plan_player_name,
      g: c.g ?? c.plan_g, s: c.s ?? c.plan_s, p: c.p ?? c.plan_p, planet_type: c.planet_type ?? c.plan_type, plan_id: c.plan_id,
    });
  }

  // ---- new raid plans
  for (const r of db
    .prepare(
      `SELECT ap.id, ap.user_id, ap.created_at, ap.mission, ap.target_time, ap.player_id, pl.name AS player_name, ap.g, ap.s, ap.p, ap.planet_type
       FROM attack_plans ap LEFT JOIN players pl ON pl.id = ap.player_id
       WHERE ap.group_id = ? AND ap.created_at BETWEEN ? AND ?`,
    )
    .all(ctx.groupId, from, to) as any[]) {
    entries.push({
      ...blank(), id: `plan-${r.id}`, kind: 'plan', what: r.mission, time: r.created_at, end: r.created_at, user_id: r.user_id,
      member: nameOf(r.user_id), count: 1, player_id: r.player_id, player_name: r.player_name, g: r.g, s: r.s, p: r.p,
      planet_type: r.planet_type, plan_id: r.id, target_time: r.target_time,
    });
  }

  // ---- target claims (not those a raid plan made), bundled per member and kind
  const claims = db
    .prepare(
      `SELECT c.id, c.user_id, c.created_at, c.kind, c.g, c.s, c.p, c.planet_type, pl.id AS player_id, pl.name AS player_name
       FROM target_claims c LEFT JOIN planets t ON t.group_id = c.group_id AND t.g = c.g AND t.s = c.s AND t.p = c.p
       LEFT JOIN players pl ON pl.id = t.player_id
       WHERE c.group_id = ? AND c.created_at BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM attack_plans ap WHERE ap.group_id = c.group_id AND ap.claim_id = c.id)
       ORDER BY c.created_at, c.id`,
    )
    .all(ctx.groupId, from, to) as any[];
  const openClaims = new Map<string, HubActivityEntry>();
  for (const c of claims) {
    const key = `${c.user_id}|${c.kind}`;
    const label = `${c.g}:${c.s}:${c.p}${c.planet_type === 'moon' ? ' (M)' : c.planet_type === 'debris' ? ' (TF)' : ''}`;
    let e = openClaims.get(key);
    if (!e || c.created_at - e.end > BUNDLE_GAP) {
      e = {
        ...blank(), id: `claim-${c.id}`, kind: 'claim', what: c.kind, time: c.created_at, end: c.created_at, user_id: c.user_id,
        member: nameOf(c.user_id), player_id: c.player_id, player_name: c.player_name, g: c.g, s: c.s, p: c.p, planet_type: c.planet_type,
      };
      openClaims.set(key, e);
      entries.push(e);
    } else if (e.count === 1) {
      // several targets: no single one
      Object.assign(e, { player_id: null, player_name: null, g: null, s: null, p: null, planet_type: null });
    }
    e.end = c.created_at;
    e.count++;
    if (e.items.length < MAX_ITEMS) e.items.push(label);
  }

  entries.sort((a, b) => b.end - a.end || b.time - a.time);
  return { entries: entries.slice(0, MAX_ENTRIES) };
}

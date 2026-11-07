import { debrisAmount } from '@pr0hub/core';
import { drivesFromResearch, shipSpeed } from '@pr0hub/flight';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires } from './empire.js';
import { memberPlayers } from './members.js';

const DAY = 86400;
/** Recycler */
export const RECYCLER = 209;

export interface DebrisBattle {
  time: number;
  metal: number;
  crystal: number;
}

export interface DebrisField {
  g: number;
  s: number;
  p: number;
  /** expected debris now: the last known amount plus the debris of battles since */
  metal: number;
  crystal: number;
  /** newest information about the field (galaxy, recycling or battle) */
  time: number;
  /** last known amount: from the galaxy view or a member's recycling report (exact rest) */
  base: { source: 'galaxy' | 'recycle'; time: number; metal: number; crystal: number; by: string | null } | null;
  /** battles at the position after the base (synced battle or combat reports) */
  battles: DebrisBattle[];
  /** owner of the planet at the position (galaxy), member: one of the group's members */
  owner: { id: number; name: string; ally_tag: string | null; member: boolean } | null;
}

export interface RecyclerStock {
  userId: number;
  member: string;
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
  recyclers: number;
  /** recycler speed with the member's drives (empire research) */
  speed: number;
  /** empire page time */
  time: number;
}

/**
 * Debris finder (backlog B-4): open debris fields of the group's data with the debris expected now. The last known
 * amount is the newer of the galaxy view and a member's recycling report (which tells the exact rest); battles at the
 * position after it add their debris, so a member's battle shows up at once and a recycling report clears it. Fields
 * whose newest information is older than `days` are left out. Also the recyclers of the members per planet and moon
 * (newest empire pages) with their speed, for the nearest member with recyclers (flight math in the web app).
 */
export function debrisFields(db: DB, ctx: GroupContext, days: number) {
  const g = ctx.groupId;
  const since = ctx.now - days * DAY;
  const fields = new Map<string, DebrisField>();
  const key = (r: { g: number; s: number; p: number }) => `${r.g}:${r.s}:${r.p}`;
  const field = (r: { g: number; s: number; p: number }) => {
    let f = fields.get(key(r));
    if (!f) fields.set(key(r), (f = { g: r.g, s: r.s, p: r.p, metal: 0, crystal: 0, time: 0, base: null, battles: [], owner: null }));
    return f;
  };

  // the galaxy view: the debris shown when the system was seen
  const galaxy = db
    .prepare(
      `SELECT pl.g, pl.s, pl.p, pl.debris, COALESCE(v.seen_at, pl.updated_at) AS time FROM planets pl
       LEFT JOIN galaxy_views v ON v.group_id = pl.group_id AND v.g = pl.g AND v.s = pl.s
       WHERE pl.group_id = ? AND pl.debris IS NOT NULL`,
    )
    .all(g) as { g: number; s: number; p: number; debris: string; time: number }[];
  const seen = new Map(
    (db.prepare('SELECT g, s, seen_at FROM galaxy_views WHERE group_id = ?').all(g) as { g: number; s: number; seen_at: number }[]).map((r) => [
      `${r.g}:${r.s}`,
      r.seen_at,
    ]),
  );
  for (const r of galaxy) {
    const d = JSON.parse(r.debris) as { metal: string; crystal: string };
    field(r).base = { source: 'galaxy', time: r.time, metal: debrisAmount(d.metal), crystal: debrisAmount(d.crystal), by: null };
  }

  // members' recycling reports: the exact rest at the time (newer than the galaxy view wins)
  const recycled = db
    .prepare(
      `SELECT g, s, p, time, data FROM activity_log
       WHERE group_id = ? AND kind IN ('debris_shrunk', 'debris_cleared') AND dedupe_key LIKE 'recycle:%' AND time >= ? ORDER BY time`,
    )
    .all(g, since) as { g: number; s: number; p: number; time: number; data: string }[];
  for (const r of recycled) {
    const sys = seen.get(`${r.g}:${r.s}`);
    const f = fields.get(key(r));
    if ((f?.base && f.base.time >= r.time) || (sys != null && sys >= r.time)) continue;
    const d = JSON.parse(r.data) as { metal?: number; crystal?: number; by?: string | null };
    field(r).base = { source: 'recycle', time: r.time, metal: d.metal ?? 0, crystal: d.crystal ?? 0, by: d.by ?? null };
  }

  // battles leaving debris (short battle messages and full reports, once per battle)
  const battles = db
    .prepare(
      `SELECT g, s, p, MAX(time) AS time, MAX(debris_metal) AS metal, MAX(debris_crystal) AS crystal FROM (
         SELECT g, s, p, COALESCE(time, created_at) AS time, debris_metal, debris_crystal,
           COALESCE(report_id, g || ':' || s || ':' || p || '@' || COALESCE(time, created_at)) AS battle
         FROM battle_reports WHERE group_id = ? AND debris_metal + debris_crystal > 0 AND COALESCE(time, created_at) >= ?
         UNION ALL
         SELECT g, s, p, time, debris_metal, debris_crystal, report_id FROM combat_reports
         WHERE group_id = ? AND g IS NOT NULL AND time IS NOT NULL AND debris_metal + debris_crystal > 0 AND time >= ?
       ) GROUP BY battle ORDER BY time`,
    )
    .all(g, since, g, since) as ({ g: number; s: number; p: number } & DebrisBattle)[];
  for (const b of battles) {
    const f = fields.get(key(b));
    const base = f?.base?.time ?? seen.get(`${b.g}:${b.s}`) ?? 0;
    if (b.time <= base) continue;
    field(b).battles.push({ time: b.time, metal: b.metal, crystal: b.crystal });
  }

  const members = new Set([...memberPlayers(db, ctx).values()].filter((id): id is number => id != null));
  const owners = new Map(
    (db
      .prepare(
        `SELECT pl.g, pl.s, pl.p, pr.id, pr.name, a.tag AS ally_tag FROM json_each(?) k
         JOIN planets pl ON pl.group_id = ? AND pl.g || ':' || pl.s || ':' || pl.p = k.value
         JOIN players pr ON pr.id = pl.player_id LEFT JOIN alliances a ON a.id = pr.alliance_id`,
      )
      .all(JSON.stringify([...fields.keys()]), g) as { g: number; s: number; p: number; id: number; name: string; ally_tag: string | null }[]).map((r) => [
      key(r),
      { id: r.id, name: r.name, ally_tag: r.ally_tag, member: members.has(r.id) },
    ]),
  );

  const list: DebrisField[] = [];
  for (const f of fields.values()) {
    f.metal = (f.base?.metal ?? 0) + f.battles.reduce((n, b) => n + b.metal, 0);
    f.crystal = (f.base?.crystal ?? 0) + f.battles.reduce((n, b) => n + b.crystal, 0);
    f.time = Math.max(f.base?.time ?? 0, ...f.battles.map((b) => b.time));
    if (f.metal + f.crystal <= 0 || f.time < since) continue;
    f.owner = owners.get(key(f)) ?? null;
    list.push(f);
  }
  list.sort((a, b) => b.metal + b.crystal - (a.metal + a.crystal));

  // recyclers of the members per planet and moon
  const catalog = catalogOf(ctx.universe);
  const names = new Map(
    (db
      .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
      .all(g) as { user_id: number; name: string }[]).map((r) => [r.user_id, r.name]),
  );
  const recyclers: RecyclerStock[] = [];
  for (const e of latestEmpires(db, ctx)) {
    const member = names.get(e.userId);
    if (!member) continue;
    const speed = shipSpeed(RECYCLER, drivesFromResearch(e.rec.research ?? {}), catalog.drives);
    for (const pl of e.rec.planets) {
      const n = pl.values[RECYCLER] ?? 0;
      if (n > 0) recyclers.push({ userId: e.userId, member, g: pl.coords.g, s: pl.coords.s, p: pl.coords.p, type: pl.type === 'moon' ? 'moon' : 'planet', recyclers: n, speed, time: e.time });
    }
  }
  return { fields: list, recyclers, capacity: catalog.capacity?.[RECYCLER] ?? null };
}

import { distance } from '@pr0hub/flight';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires } from './empire.js';
import { memberPlayer, memberPlayers } from './members.js';
import { latestScores } from './stats.js';

export interface ColonySystem {
  g: number;
  s: number;
  /** free positions by the galaxy view (no planet, not destroyed) */
  free: number[];
  /** when the system was seen */
  seen: number;
  /**
   * Coverage gain: by how much a planet here shortens the mean distance (game formula, system centres) from every
   * system of the universe to the viewer's nearest planet, as a share of the mean now (0 … 1; 1 without own planets)
   */
  coverage: number;
  /** distance to the viewer's nearest planet (game formula), null without own planets */
  nearest: number | null;
  /** other members' (and in-game alliance mates') planets within the range */
  members: number;
  /** planets of other players within the range, how many of them flagged inactive by the game */
  targets: number;
  inactive: number;
  /** total points of those players (each once) and of the players in the system itself */
  targetPoints: number;
  systemPoints: number;
}

/**
 * Colonization planner (backlog C-5): every system with free positions by the group's galaxy data, with what a colony
 * there adds: coverage of the universe from the viewer's planets, other members nearby (competition for targets) and
 * the players and points nearby (targets) within `range` systems. What the position itself is like (astrophysics,
 * fields, temperature, bonus) and the weighting per profile are the web app's (`@pr0hub/core/colonize`).
 */
export function colonizeSystems(db: DB, ctx: GroupContext, range: number) {
  const g = ctx.groupId;
  const u = ctx.universe.settings;
  const { galaxies: G, systems: S, positions } = u;

  // distance between system centres by galaxy and system difference (wrap-around as the universe has it)
  const table: number[][] = [];
  for (let dg = 0; dg < G; dg++) {
    table.push([]);
    for (let ds = 0; ds < S; ds++) table[dg].push(distance(u, [1, 1, 8], [1 + dg, 1 + ds, 8]));
  }
  const diff = (a: number, b: number, n: number, circular: boolean) => (circular ? (((b - a) % n) + n) % n : Math.abs(b - a));
  const dist = (ga: number, sa: number, gb: number, sb: number) => table[diff(ga, gb, G, u.circularGalaxies)][diff(sa, sb, S, u.circularSystems)];
  const sysDiff = (a: number, b: number) => (u.circularSystems ? Math.min(Math.abs(a - b), S - Math.abs(a - b)) : Math.abs(a - b));

  // the viewer's planets and the other members' (empire pages), alliance mates by the galaxy
  const me = ctx.user.id;
  const own: [number, number][] = [];
  const mates: [number, number][] = [];
  for (const e of latestEmpires(db, ctx)) {
    for (const p of e.rec.planets) if (p.type === 'planet') (e.userId === me ? own : mates).push([p.coords.g, p.coords.s]);
  }
  const memberIds = new Set([...memberPlayers(db, ctx).values()].filter((id): id is number => id != null));
  const mine = memberPlayer(db, ctx, me);
  const ownAlly = mine != null ? ((db.prepare('SELECT alliance_id FROM players WHERE id = ? AND group_id = ?').pluck().get(mine, g) as number | null) ?? null) : null;

  const planets = db
    .prepare(
      `SELECT pl.g, pl.s, pl.p, pl.player_id, pl.destroyed, pr.alliance_id, pr.status FROM planets pl
       LEFT JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ?`,
    )
    .all(g) as { g: number; s: number; p: number; player_id: number | null; destroyed: number; alliance_id: number | null; status: string | null }[];
  const ownPlayer = mine;
  const others = planets.filter((p) => p.player_id != null && p.player_id !== ownPlayer);
  const friendly = (p: { player_id: number | null; alliance_id: number | null }) => memberIds.has(p.player_id!) || (ownAlly != null && p.alliance_id === ownAlly);
  // members' planets known only from the galaxy (no empire page) count too
  const mateSet = new Set(mates.map(([a, b]) => `${a}:${b}`));
  for (const p of others) if (friendly(p) && !mateSet.has(`${p.g}:${p.s}`)) mates.push([p.g, p.s]);
  const targets = others.filter((p) => !friendly(p));
  const points = latestScores(db, g, [...new Set(targets.map((p) => p.player_id!))], [1]);

  // occupied positions per system; systems seen in the galaxy
  const occupied = new Map<string, Set<number>>();
  for (const p of planets) if (p.player_id != null || p.destroyed) (occupied.get(`${p.g}:${p.s}`) ?? occupied.set(`${p.g}:${p.s}`, new Set()).get(`${p.g}:${p.s}`)!).add(p.p);
  const seen = db.prepare('SELECT g, s, seen_at FROM galaxy_views WHERE group_id = ? AND g <= ? AND s <= ?').all(g, G, S) as { g: number; s: number; seen_at: number }[];

  // coverage: mean distance from every system to the nearest own planet, before and with a planet in the candidate
  const before = new Float64Array(G * S);
  let meanBefore = 0;
  for (let a = 1; a <= G; a++) {
    for (let b = 1; b <= S; b++) {
      let best = Infinity;
      for (const [og, os] of own) best = Math.min(best, dist(og, os, a, b));
      before[(a - 1) * S + (b - 1)] = best;
      meanBefore += best;
    }
  }
  meanBefore /= G * S;

  // planets per galaxy for the range counts
  const byGalaxy = new Map<number, typeof targets>();
  for (const p of targets) (byGalaxy.get(p.g) ?? byGalaxy.set(p.g, []).get(p.g)!).push(p);

  const systems: ColonySystem[] = [];
  for (const v of seen) {
    const taken = occupied.get(`${v.g}:${v.s}`) ?? new Set<number>();
    const free: number[] = [];
    for (let p = 1; p <= positions; p++) if (!taken.has(p)) free.push(p);
    if (!free.length) continue;
    let coverage = 1;
    let nearest: number | null = null;
    if (own.length) {
      let sum = 0;
      for (let a = 1; a <= G; a++) {
        for (let b = 1; b <= S; b++) {
          const d = dist(v.g, v.s, a, b);
          const cur = before[(a - 1) * S + (b - 1)];
          sum += d < cur ? cur - d : 0;
        }
      }
      coverage = meanBefore > 0 ? sum / (G * S) / meanBefore : 0;
      nearest = Math.min(...own.map(([og, os]) => dist(og, os, v.g, v.s)));
    }
    const near = (byGalaxy.get(v.g) ?? []).filter((p) => sysDiff(p.s, v.s) <= range);
    const players = new Set(near.map((p) => p.player_id!));
    const here = new Set(near.filter((p) => p.s === v.s).map((p) => p.player_id!));
    const sumPoints = (ids: Set<number>) => [...ids].reduce((n, id) => n + (points.get(id)?.[1]?.points ?? 0), 0);
    systems.push({
      g: v.g, s: v.s, free, seen: v.seen_at, coverage: Math.round(coverage * 1000) / 1000, nearest,
      members: mates.filter(([mg, ms]) => mg === v.g && sysDiff(ms, v.s) <= range).length,
      targets: near.length,
      inactive: near.filter((p) => /inactive/.test(p.status ?? '')).length,
      targetPoints: Math.round(sumPoints(players)),
      systemPoints: Math.round(sumPoints(here)),
    });
  }
  return { systems, own: own.length, seenSystems: seen.length, totalSystems: G * S, range };
}

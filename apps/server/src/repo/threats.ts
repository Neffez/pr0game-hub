import { distance, drivesFromResearch, flightDuration, slowestShip } from '@pr0hub/flight';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { spyEmpire } from './empire.js';
import { hostileAttacks } from './hostile.js';
import { alliance, memberPlayer } from './members.js';
import { memberPlanets } from './phalanx.js';
import { Players } from './players.js';
import { latestScores } from './stats.js';

/**
 * Who threatens me (A-5): the players outside the own alliance who spied on or attacked the viewer, ranked by how
 * often and how recently, with the trend of their fleet points, their planet nearest to one of the viewer's with the
 * flight time, and the hours of the day they usually come at. From the viewer's hostile spying, the battle reports at
 * the viewer's bodies and the attacks on their way.
 */

type Coords = { g: number; s: number; p: number };

/** Weight of one event in the ranking; it halves every `HALF_LIFE` days. */
export const THREAT_WEIGHTS = { spied: 1, attacked: 4, incoming: 6 };
const HALF_LIFE = 7;
/** The hours pattern needs this many events; the usual time is the densest window of `PEAK_HOURS` hours. */
const PATTERN_MIN = 5;
const PEAK_HOURS = 4;
/** Statistics category of the fleet points. */
const FLEET_POINTS = 2;
/** Flight time by this ship while no fleet of the player is known: the battleship. */
const REFERENCE_SHIP = 207;
/** Ships that don't fly an attack: solar satellites. */
const NOT_FLYING = new Set(['212']);

export interface Threat {
  key: string;
  player: { id: number | null; name: string; status: string[]; allyTag: string | null };
  /** ranking: events weighted by kind and age */
  score: number;
  spied: { count: number; last: number | null };
  attacked: { count: number; last: number | null };
  /** attacks on their way to the viewer now (`next`: the first arrival, `key`: that attack for the attack assistant) */
  incoming: { count: number; next: number | null; key: string | null };
  /** fleet points of the statistics now and at the start of the period (else the oldest update within it) */
  fleetPoints: { points: number; time: number; before: { points: number; time: number } | null } | null;
  /** the player's known planet nearest to one of the viewer's: one-way flight at 100 % */
  reach: { from: Coords; to: Coords; duration: number; ship: number; shipKnown: boolean; researchKnown: boolean } | null;
  /** known planets of the player (galaxy data) */
  planets: number;
  /** events per hour of the day (0–23) in the universe's time zone */
  hours: number[];
  /** the `PEAK_HOURS` hours with the most events (`from` inclusive, `to` exclusive, over midnight possible), from `PATTERN_MIN` events on */
  peak: { from: number; to: number; share: number } | null;
  /** the viewer's bodies they came for, the most often first */
  targets: (Coords & { count: number })[];
}

export interface Threats {
  days: number;
  timezone: string;
  /** the viewer's planets the hub knows (none: no reach and no battles can be found) */
  ownPlanets: number;
  threats: Threat[];
  now: number;
}

/** The densest window of `PEAK_HOURS` hours of a day's histogram. */
export function peakOf(hours: number[]): Threat['peak'] {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < PATTERN_MIN) return null;
  let best = { from: 0, sum: -1 };
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let i = 0; i < PEAK_HOURS; i++) sum += hours[(h + i) % 24];
    if (sum > best.sum) best = { from: h, sum };
  }
  return { from: best.from, to: (best.from + PEAK_HOURS) % 24, share: best.sum / total };
}

export function threatsOf(db: DB, ctx: GroupContext, days: number): Threats {
  const t = ctx.now;
  const since = t - days * 86400;
  const u = ctx.universe.settings;
  const units = catalogOf(ctx.universe);
  const players = new Players(db, ctx.groupId);
  const friends = alliance(db, ctx);
  const self = memberPlayer(db, ctx, ctx.user.id);
  const selfName = self != null ? ((db.prepare('SELECT name FROM players WHERE id = ? AND group_id = ?').pluck().get(self, ctx.groupId) as string | undefined)?.toLowerCase() ?? null) : null;
  const own = memberPlanets(db, ctx, ctx.user.id);
  const ownKeys = new Set(own.map((c) => `${c.g}:${c.s}:${c.p}`));
  const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: u.timezone, hourCycle: 'h23', hour: '2-digit' });
  const decay = (time: number) => 0.5 ** (Math.max(0, t - time) / (HALF_LIFE * 86400));

  type Cand = Pick<Threat, 'spied' | 'attacked' | 'incoming' | 'hours'> & { name: string; id: number | null; score: number; targets: Map<string, number> };
  const cands = new Map<string, Cand>();
  const cand = (name: string, id: number | null): Cand | null => {
    const lower = name.toLowerCase();
    if (friends.names.has(lower) || lower === selfName) return null;
    let c = cands.get(lower);
    if (!c) {
      c = { name, id: id ?? players.byName(name), score: 0, spied: { count: 0, last: null }, attacked: { count: 0, last: null }, incoming: { count: 0, next: null, key: null }, hours: new Array<number>(24).fill(0), targets: new Map() };
      cands.set(lower, c);
    }
    return c;
  };
  const event = (c: Cand, kind: 'spied' | 'attacked', time: number | null, target: Coords) => {
    c[kind].count++;
    if (time != null && (c[kind].last == null || time > c[kind].last!)) c[kind].last = time;
    c.score += THREAT_WEIGHTS[kind] * decay(time ?? since);
    if (time != null) c.hours[Number(hourOf.format(new Date(time * 1000))) % 24]++;
    const key = `${target.g}:${target.s}:${target.p}`;
    c.targets.set(key, (c.targets.get(key) ?? 0) + 1);
  };

  const spied = db
    .prepare('SELECT from_player AS name, time, target_g AS g, target_s AS s, target_p AS p FROM hostile_spying WHERE group_id = ? AND user_id = ? AND time >= ?')
    .all(ctx.groupId, ctx.user.id, since) as ({ name: string; time: number | null } & Coords)[];
  for (const r of spied) {
    const c = cand(r.name, null);
    if (c) event(c, 'spied', r.time, r);
  }

  if (ownKeys.size) {
    const battles = db
      .prepare('SELECT time, g, s, p, fleets FROM combat_reports WHERE group_id = ? AND time >= ? AND g IS NOT NULL')
      .all(ctx.groupId, since) as ({ time: number; fleets: string } & Coords)[];
    for (const b of battles) {
      if (!ownKeys.has(`${b.g}:${b.s}:${b.p}`)) continue;
      const names = new Set((JSON.parse(b.fleets) as [number, string, unknown][]).filter(([side, name]) => side === 0 && name).map(([, name]) => name));
      for (const name of names) {
        const c = cand(name, null);
        if (c) event(c, 'attacked', b.time, b);
      }
    }
  }

  for (const a of hostileAttacks(db, ctx)) {
    if (a.memberId !== ctx.user.id || !a.player || a.arrival <= t) continue;
    const c = cand(a.player.name, a.player.id);
    if (!c) continue;
    c.incoming.count++;
    if (c.incoming.next == null || a.arrival < c.incoming.next) Object.assign(c.incoming, { next: a.arrival, key: a.key });
    c.score += THREAT_WEIGHTS.incoming;
  }

  const list = [...cands.values()];
  const ids = list.map((c) => c.id).filter((id): id is number => id != null);
  const scores = latestScores(db, ctx.groupId, ids, [FLEET_POINTS]);
  const info = new Map(
    (db
      .prepare('SELECT p.id, p.name, p.status, a.tag FROM json_each(?) id JOIN players p ON p.id = id.value AND p.group_id = ? LEFT JOIN alliances a ON a.id = p.alliance_id')
      .all(JSON.stringify(ids), ctx.groupId) as { id: number; name: string; status: string; tag: string | null }[]).map((r) => [r.id, r]),
  );
  // the fleet points at the start of the period: the newest update up to it, else the oldest one within it
  const before = db.prepare(
    `SELECT points, stat_time AS time FROM player_scores WHERE player_id = ? AND type = ${FLEET_POINTS} AND stat_time <= ? ORDER BY stat_time DESC LIMIT 1`,
  );
  const oldest = db.prepare(`SELECT points, stat_time AS time FROM player_scores WHERE player_id = ? AND type = ${FLEET_POINTS} AND stat_time > ? ORDER BY stat_time LIMIT 1`);
  const planetsOf = db.prepare('SELECT g, s, p FROM planets WHERE group_id = ? AND player_id = ? AND destroyed = 0');

  const threats = list.map((c): Threat => {
    const now = c.id != null ? scores.get(c.id)?.[FLEET_POINTS] : undefined;
    const past = now && c.id != null ? ((before.get(c.id, since) ?? oldest.get(c.id, since)) as { points: number; time: number } | undefined) : undefined;
    const homes = c.id != null ? (planetsOf.all(ctx.groupId, c.id) as Coords[]) : [];
    const spy = homes.length && own.length ? spyEmpire(db, ctx, c.id ?? -1, c.name) : null;
    // the slowest ship of the largest fleet seen on one of their planets decides the flight time
    let ships: Record<string, number> | null = null;
    let size = 0;
    for (const pl of spy?.planets ?? []) {
      const fleet = Object.fromEntries(Object.entries(pl.values).filter(([id, n]) => Number(id) >= 200 && Number(id) < 300 && n > 0 && !NOT_FLYING.has(id)));
      const n = Object.values(fleet).reduce((a, b) => a + b, 0);
      if (n > size) [ships, size] = [fleet, n];
    }
    const drives = drivesFromResearch(spy?.research ?? {});
    const slowest = slowestShip(ships ?? { [REFERENCE_SHIP]: 1 }, drives, units.drives);
    let reach: Threat['reach'] = null;
    if (slowest && slowest.speed > 0) {
      for (const from of homes) {
        for (const to of own) {
          const duration = Math.floor(flightDuration(u, distance(u, [from.g, from.s, from.p], [to.g, to.s, to.p]), slowest.speed, 100));
          if (!reach || duration < reach.duration) {
            reach = { from, to: { g: to.g, s: to.s, p: to.p }, duration, ship: Number(slowest.id), shipKnown: !!ships, researchKnown: !!spy?.researchTime };
          }
        }
      }
    }
    const row = c.id != null ? info.get(c.id) : undefined;
    return {
      key: c.id != null ? `p${c.id}` : `n:${c.name.toLowerCase()}`,
      player: { id: c.id, name: row?.name ?? c.name, status: row ? (JSON.parse(row.status || '[]') as string[]) : [], allyTag: row?.tag ?? null },
      score: Math.round(c.score * 100) / 100,
      spied: c.spied, attacked: c.attacked, incoming: c.incoming,
      fleetPoints: now ? { points: now.points, time: now.time, before: past && past.time < now.time ? past : null } : null,
      reach,
      planets: homes.length,
      hours: c.hours,
      peak: peakOf(c.hours),
      targets: [...c.targets]
        .map(([key, count]) => {
          const [g, s, p] = key.split(':').map(Number);
          return { g, s, p, count };
        })
        .sort((a, b) => b.count - a.count),
    };
  });
  threats.sort((a, b) => b.score - a.score || (b.fleetPoints?.points ?? 0) - (a.fleetPoints?.points ?? 0));
  return { days, timezone: u.timezone, ownPlanets: own.length, threats, now: t };
}

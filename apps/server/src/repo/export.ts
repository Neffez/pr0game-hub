import { debrisAmount } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY } from '../routes/util.js';
import { finalizedSettlements } from './settlements.js';
import { latestScores } from './stats.js';

/**
 * Export of the group's own data for spreadsheets and scripts: one table per dataset (CSV download), or all of them as
 * JSON. Only data every member of the group sees in the hub (no private messages or unshared fleets).
 */

export const DATASETS = ['players', 'planets', 'spy-reports', 'battle-reports', 'expeditions', 'settlements'] as const;
export type Dataset = (typeof DATASETS)[number];

/** Reports, battles and expeditions are exported this far back by default (days). */
export const EXPORT_DAYS = 30;
export const MAX_EXPORT_DAYS = 365;

type Cell = string | number | boolean | null;
export interface Table {
  columns: string[];
  rows: Cell[][];
}

const res = (raw: string | null | undefined) => {
  const r = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return [r[901] ?? 0, r[902] ?? 0, r[903] ?? 0];
};

/**
 * Filters of the overview for the `players` and `planets` tables: name and alliance (name or tag) contain the text,
 * inactive players hidden or only them, players in vacation mode hidden, total points within a range, one galaxy
 * (planets). Planets follow their owner's filters.
 */
export interface ExportFilter {
  q?: string;
  ally?: string;
  inactive?: 'hide' | 'only';
  vacation?: boolean;
  minPoints?: number;
  maxPoints?: number;
  galaxy?: number;
}

export const hasFilter = (f: ExportFilter) => Object.values(f).some((v) => v !== undefined);

/** Whether a row of the players table passes the filter (columns by name). */
function playerPasses(columns: string[], row: unknown[], f: ExportFilter): boolean {
  const col = (name: string) => row[columns.indexOf(name)];
  const text = (name: string) => String(col(name) ?? '').toLowerCase();
  if (f.q && !text('name').includes(f.q.toLowerCase())) return false;
  if (f.ally && !`${text('alliance')} ${text('alliance_tag')}`.includes(f.ally.toLowerCase())) return false;
  const status = text('status').split(' ');
  const inactive = status.includes('inactive') || status.includes('longinactive');
  if (f.inactive === 'hide' && inactive) return false;
  if (f.inactive === 'only' && !inactive) return false;
  if (f.vacation === false && status.includes('vacation')) return false;
  const points = Number(col('points_1') ?? 0);
  if (f.minPoints != null && points < f.minPoints) return false;
  if (f.maxPoints != null && points > f.maxPoints) return false;
  return true;
}

export function exportTable(db: DB, ctx: GroupContext, dataset: Dataset, since: number, filter: ExportFilter = {}): Table {
  const table = unfiltered(db, ctx, dataset, since);
  if (!hasFilter(filter) || (dataset !== 'players' && dataset !== 'planets')) return table;
  const players = dataset === 'players' ? table : unfiltered(db, ctx, 'players', since);
  const { galaxy: _, ...ofPlayer } = filter;
  const passing = hasFilter(ofPlayer) ? players.rows.filter((r) => playerPasses(players.columns, r, filter)) : players.rows;
  if (dataset === 'players') return { columns: table.columns, rows: passing };
  // planets of the players that pass (planets without a known owner only without player filters), in the galaxy asked
  const names = hasFilter(ofPlayer) ? new Set(passing.map((r) => String(r[players.columns.indexOf('name')]).toLowerCase())) : null;
  const owner = table.columns.indexOf('player');
  const g = table.columns.indexOf('galaxy');
  return {
    columns: table.columns,
    rows: table.rows.filter((r) => (filter.galaxy == null || r[g] === filter.galaxy) && (!names || (r[owner] != null && names.has(String(r[owner]).toLowerCase())))),
  };
}

function unfiltered(db: DB, ctx: GroupContext, dataset: Dataset, since: number): Table {
  const g = ctx.groupId;
  switch (dataset) {
    case 'players': {
      const players = db
        .prepare(
          `SELECT p.id, p.ingame_id, p.name, a.tag AS ally_tag, a.name AS ally_name, p.status, p.first_seen, p.last_seen FROM players p
           LEFT JOIN alliances a ON a.id = p.alliance_id WHERE p.group_id = ? ORDER BY p.name COLLATE NOCASE`,
        )
        .all(g) as { id: number; ingame_id: number | null; name: string; ally_tag: string | null; ally_name: string | null; status: string | null; first_seen: number | null; last_seen: number | null }[];
      const scores = latestScores(db, g, players.map((p) => p.id));
      const cols = [1, 2, 3, 4, 5];
      return {
        columns: ['id', 'ingame_id', 'name', 'alliance_tag', 'alliance', 'status', ...cols.flatMap((c) => [`points_${c}`, `rank_${c}`]), 'stats_time', 'first_seen', 'last_seen'],
        rows: players.map((p) => {
          const s = scores.get(p.id) ?? {};
          return [
            p.id, p.ingame_id, p.name, p.ally_tag, p.ally_name, (JSON.parse(p.status || '[]') as string[]).join(' '),
            ...cols.flatMap((c) => [s[c]?.points ?? null, s[c]?.rank ?? null]), s[1]?.time ?? null, p.first_seen, p.last_seen,
          ];
        }),
      };
    }
    case 'planets': {
      const rows = db
        .prepare(
          `SELECT pl.g, pl.s, pl.p, pl.name, p.name AS player, a.tag AS ally_tag, pl.has_moon, pl.moon_name, pl.moon_diameter, pl.destroyed, pl.debris, pl.updated_at
           FROM planets pl LEFT JOIN players p ON p.id = pl.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
           WHERE pl.group_id = ? ORDER BY pl.g, pl.s, pl.p`,
        )
        .all(g) as { g: number; s: number; p: number; name: string | null; player: string | null; ally_tag: string | null; has_moon: number; moon_name: string | null; moon_diameter: number | null; destroyed: number; debris: string | null; updated_at: number | null }[];
      return {
        columns: ['galaxy', 'system', 'position', 'name', 'player', 'alliance_tag', 'moon', 'moon_name', 'moon_diameter', 'destroyed', 'debris_metal', 'debris_crystal', 'updated_at'],
        rows: rows.map((r) => {
          const d = r.debris ? (JSON.parse(r.debris) as { metal: string; crystal: string }) : null;
          return [r.g, r.s, r.p, r.name, r.player, r.ally_tag, !!r.has_moon, r.moon_name, r.moon_diameter, !!r.destroyed, d ? debrisAmount(d.metal) : null, d ? debrisAmount(d.crystal) : null, r.updated_at];
        }),
      };
    }
    case 'spy-reports': {
      const rows = db
        .prepare(
          `SELECT report_time, g, s, p, planet_type, planet_name, player_name, json_extract(sections, '$."900"') AS res, sections FROM spy_reports
           WHERE group_id = ? AND report_time >= ? ORDER BY report_time DESC`,
        )
        .all(g, since) as { report_time: number; g: number; s: number; p: number; planet_type: string; planet_name: string | null; player_name: string | null; res: string | null; sections: string }[];
      return {
        columns: ['time', 'galaxy', 'system', 'position', 'type', 'planet', 'player', 'metal', 'crystal', 'deuterium', 'sections'],
        rows: rows.map((r) => [r.report_time, r.g, r.s, r.p, r.planet_type, r.planet_name, r.player_name, ...res(r.res), r.sections]),
      };
    }
    case 'battle-reports': {
      const rows = db
        .prepare(
          `SELECT COALESCE(time, created_at) AS time, g, s, p, planet_type, outcome, lost_attacker, lost_defender, loot_metal, loot_crystal, loot_deuterium,
             debris_metal, debris_crystal FROM battle_reports WHERE group_id = ? AND COALESCE(time, created_at) >= ? ORDER BY 1 DESC`,
        )
        .all(g, since) as Record<string, Cell>[];
      const columns = ['time', 'g', 's', 'p', 'planet_type', 'outcome', 'lost_attacker', 'lost_defender', 'loot_metal', 'loot_crystal', 'loot_deuterium', 'debris_metal', 'debris_crystal'];
      return { columns: columns.map((c) => ({ g: 'galaxy', s: 'system', p: 'position', planet_type: 'type' })[c] ?? c), rows: rows.map((r) => columns.map((c) => r[c] ?? null)) };
    }
    case 'expeditions': {
      const rows = db
        .prepare(
          `SELECT COALESCE(e.time, e.created_at) AS time, ${DISPLAY} AS member, e.g, e.s, e.p, e.event, e.size, e.found_resources, e.found_ships
           FROM expeditions e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = e.user_id
           WHERE e.group_id = ? AND COALESCE(e.time, e.created_at) >= ? ORDER BY 1 DESC`,
        )
        .all(g, since) as { time: number; member: string | null; g: number; s: number; p: number; event: string; size: string; found_resources: string; found_ships: string }[];
      return {
        columns: ['time', 'member', 'galaxy', 'system', 'position', 'event', 'size', 'metal', 'crystal', 'deuterium', 'ships'],
        rows: rows.map((r) => [r.time, r.member, r.g, r.s, r.p, r.event, r.size, ...res(r.found_resources), r.found_ships === '{}' ? null : r.found_ships]),
      };
    }
    case 'settlements': {
      const plans = db.prepare('SELECT id, g, s, p, planet_type, mission FROM attack_plans WHERE group_id = ?').all(g) as { id: number; g: number | null; s: number | null; p: number | null; planet_type: string; mission: string }[];
      const byId = new Map(plans.map((p) => [p.id, p]));
      const rows: Cell[][] = [];
      for (const f of finalizedSettlements(db, ctx).values()) {
        const plan = byId.get(f.planId);
        const people = [...f.state.participants, ...f.state.helpers];
        const nameOf = (id: string) => people.find((x) => x.id === id)?.name ?? id;
        for (const d of f.deliveries) {
          rows.push([f.planId, plan?.g ?? null, plan?.s ?? null, plan?.p ?? null, plan?.planet_type ?? null, plan?.mission ?? null, f.finalizedAt, nameOf(d.from), nameOf(d.to), d.res.m, d.res.k, d.res.d, !!d.done]);
        }
      }
      return { columns: ['plan', 'galaxy', 'system', 'position', 'type', 'mission', 'finalized_at', 'from', 'to', 'metal', 'crystal', 'deuterium', 'done'], rows };
    }
  }
}

/** All datasets as arrays of objects (JSON export). */
export function exportAll(db: DB, ctx: GroupContext, since: number) {
  return {
    universe: ctx.universe.slug,
    group: ctx.groupName,
    exportedAt: ctx.now,
    since,
    ...Object.fromEntries(
      DATASETS.map((d) => {
        const t = exportTable(db, ctx, d, since);
        return [d, t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])))];
      }),
    ),
  };
}

/**
 * CSV (RFC 4180) with `sep` as separator; times stay Unix seconds, numbers unformatted. Texts come from other players
 * (player, planet and alliance names): one that a spreadsheet would read as a formula (starting with `=`, `+`, `-`,
 * `@`, tab or carriage return) gets a leading `'`. Numbers are untouched.
 */
export function toCsv(t: Table, sep = ','): string {
  const cell = (v: Cell) => {
    if (v == null) return '';
    let s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r;\t]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns, ...t.rows].map((r) => r.map(cell).join(sep)).join('\r\n') + '\r\n';
}

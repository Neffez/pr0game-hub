import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY } from './sql.js';

/** Data of a page whose syncing members are counted: farm finder (spy reports), galaxy views, statistics pages. */
export type ContributorScope = 'farm' | 'galaxy' | 'stats';
export const CONTRIBUTOR_SCOPES: ContributorScope[] = ['farm', 'galaxy', 'stats'];

export interface Contributors {
  scope: ContributorScope;
  /** the time window in days, null: the data the page shows now (galaxy: the newest view of each system) */
  days: number | null;
  /** members of the group who synced it (the caller included) */
  members: number;
  /** whether the caller is one of them */
  me: boolean;
  /** the other members who show their syncs (setting "show who synced"), by name */
  names: string[];
  /** the other members who keep that hidden: counted, not named */
  hidden: number;
}

/**
 * Who of the group synced the data a page calculates with ("This data comes from 6 members"): spy reports of the last
 * `days` (farm finder), the galaxy views the hub shows now, statistics pages of the last `days`. Former members and
 * deleted users are left out.
 */
export function contributors(db: DB, ctx: GroupContext, scope: ContributorScope, days: number): Contributors {
  const g = ctx.groupId;
  const since = ctx.now - days * 86400;
  const source =
    scope === 'farm' ? { sql: 'SELECT DISTINCT user_id FROM spy_reports WHERE group_id = ? AND report_time >= ?', args: [g, since] }
    : scope === 'galaxy' ? { sql: 'SELECT DISTINCT user_id FROM galaxy_views WHERE group_id = ?', args: [g] }
    : { sql: "SELECT DISTINCT user_id FROM raw_ingests WHERE group_id = ? AND page_type = 'stats' AND created_at >= ?", args: [g, since] };
  const rows = db
    .prepare(
      `SELECT u.id, ${DISPLAY} AS name, u.share_syncs FROM (${source.sql}) x
       JOIN group_members m ON m.group_id = ? AND m.user_id = x.user_id JOIN users u ON u.id = x.user_id`,
    )
    .all(...source.args, g) as { id: number; name: string; share_syncs: number }[];
  const others = rows.filter((r) => r.id !== ctx.user.id);
  return {
    scope,
    days: scope === 'galaxy' ? null : days,
    members: rows.length,
    me: others.length < rows.length,
    names: others.filter((r) => r.share_syncs).map((r) => r.name).sort((a, b) => a.localeCompare(b)),
    hidden: others.filter((r) => !r.share_syncs).length,
  };
}

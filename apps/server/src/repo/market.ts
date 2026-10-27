import type { DB } from '../db.js';

/** Metal and crystal per 1 deuterium; source 'source' (page source), 'text' (estimated from a text copy) or 'manual'. */
export interface MarketRate {
  m: number;
  k: number;
  source: 'source' | 'text' | 'manual';
  time: number;
  by: string | null;
}

const RATE_SELECT = `SELECT r.metal AS m, r.crystal AS k, r.source, r.time, COALESCE(gm.ingame_name, u.username) AS by
  FROM market_rates r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN group_members gm ON gm.group_id = r.group_id AND gm.user_id = r.user_id
  WHERE r.group_id = ? ORDER BY r.time DESC, r.id DESC`;

/** The group's current market rate: the newest synced or set one. */
export function latestMarketRate(db: DB, groupId: number): MarketRate | null {
  return (db.prepare(`${RATE_SELECT} LIMIT 1`).get(groupId) as MarketRate | undefined) ?? null;
}

export function marketRates(db: DB, groupId: number, limit = 30): MarketRate[] {
  return db.prepare(`${RATE_SELECT} LIMIT ?`).all(groupId, limit) as MarketRate[];
}

export interface MarketOfferRow {
  id: number;
  offerId: number | null;
  give: { res: string; amount: number };
  want: { res: string; amount: number };
  ratio: number | null;
  ally: boolean;
  endsAt: number;
  firstSeen: number;
}

export interface MarketTradeRow {
  time: number;
  give: { res: string; amount: number };
  want: { res: string; amount: number };
}

/** Synced trades of the market, newest first. */
export function marketTrades(db: DB, groupId: number, limit = 200): MarketTradeRow[] {
  const rows = db
    .prepare('SELECT time, give_res, give_amount, want_res, want_amount FROM market_trades WHERE group_id = ? ORDER BY time DESC, id DESC LIMIT ?')
    .all(groupId, limit) as any[];
  return rows.map((r) => ({ time: r.time, give: { res: r.give_res, amount: r.give_amount }, want: { res: r.want_res, amount: r.want_amount } }));
}

/** The latest marketplace sync with its offers that haven't ended by `at`. */
export function latestMarket(db: DB, groupId: number, at: number): { syncedAt: number; syncedBy: string | null; offers: MarketOfferRow[] } | null {
  const sync = db
    .prepare(
      `SELECT s.seen_at, COALESCE(gm.ingame_name, u.username) AS name FROM market_syncs s LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = s.user_id WHERE s.group_id = ?`,
    )
    .get(groupId) as { seen_at: number; name: string | null } | undefined;
  if (!sync) return null;
  const rows = db
    .prepare(
      `SELECT id, offer_id, give_res, give_amount, want_res, want_amount, ratio, ally, ends_at, first_seen FROM market_offers
       WHERE group_id = ? AND last_seen = ? AND ends_at > ? ORDER BY ends_at`,
    )
    .all(groupId, sync.seen_at, at) as any[];
  return {
    syncedAt: sync.seen_at,
    syncedBy: sync.name,
    offers: rows.map((r) => ({
      id: r.id,
      offerId: r.offer_id,
      give: { res: r.give_res, amount: r.give_amount },
      want: { res: r.want_res, amount: r.want_amount },
      ratio: r.ratio,
      ally: !!r.ally,
      endsAt: r.ends_at,
      firstSeen: r.first_seen,
    })),
  };
}

-- Resource market: the rate (metal and crystal per 1 deuterium) from marketplace syncs or set by hand; the newest row
-- is the group's current rate. source: 'source' (page source, exact), 'text' (estimated from a text copy), 'manual'.
CREATE TABLE market_rates (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  time INTEGER NOT NULL,
  metal REAL NOT NULL,
  crystal REAL NOT NULL,
  source TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX market_rates_time ON market_rates (group_id, time);

-- Open offers of the resource market as seen in the syncs (`give` is offered for `want`; res m, k, d).
CREATE TABLE market_offers (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- the game's offer id (page source only)
  offer_id INTEGER,
  give_res TEXT NOT NULL,
  give_amount INTEGER NOT NULL,
  want_res TEXT NOT NULL,
  want_amount INTEGER NOT NULL,
  ratio REAL,
  ally INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX market_offers_ends ON market_offers (group_id, ends_at);

-- The latest marketplace sync: which offers it showed are those with last_seen = seen_at.
CREATE TABLE market_syncs (
  group_id INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Trade history of the resource market as synced (the game lists the universe's last 40 trades; `give` was offered for
-- `want`, res m, k, d); collected over the syncs.
CREATE TABLE market_trades (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  time INTEGER NOT NULL,
  give_res TEXT NOT NULL,
  give_amount INTEGER NOT NULL,
  want_res TEXT NOT NULL,
  want_amount INTEGER NOT NULL,
  UNIQUE (group_id, time, give_res, give_amount, want_res, want_amount)
);

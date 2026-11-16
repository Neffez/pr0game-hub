import { describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { openDb } = await import('../src/db.js');
const { Players } = await import('../src/repo/players.js');
const { Store } = await import('../src/store.js');

const db = openDb(':memory:');
const universe = db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', '{}')").run().lastInsertRowid;
const groupId = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'A')").run(universe).lastInsertRowid);
const players = new Players(db, groupId);

describe('players by name', () => {
  it('does not merge a newer player who took over an abandoned name into the old one', () => {
    const old = players.player(100, 'Foo', 1000);
    // renamed: "Foo" becomes a former name, last seen at 2000
    expect(players.player(100, 'Bar', 2000)).toBe(old);
    expect(db.prepare('SELECT seen_until FROM player_aliases WHERE player_id = ?').pluck().get(old)).toBe(2000);

    // data from the time the old player still had the name: the old player
    expect(players.player(null, 'Foo', 1500)).toBe(old);
    expect(players.byName('Foo', 1500)).toBe(old);

    // data after the rename without an id: someone else, a name-only player that gets the id once known
    const newer = players.player(null, 'Foo', 3000);
    expect(newer).not.toBe(old);
    expect(players.player(200, 'Foo', 3100)).toBe(newer);
    expect(db.prepare('SELECT ingame_id FROM players WHERE id = ?').pluck().get(newer)).toBe(200);
    expect(players.byName('Foo', 3200)).toBe(newer);
  });

  it('keeps any former name for lookups without a time (search, display)', () => {
    const p = players.player(300, 'Alt', 1000);
    players.player(300, 'Neu', 2000);
    expect(players.byName('alt')).toBe(p);
    expect(players.byName('Alt', 5000)).toBeNull();
  });
});

describe('statistics without ids (plain text) and renamed players', () => {
  type Line = [ingameId: number | null, name: string, rank: number, points: number];
  let n = 0;
  /** A group of its own with a sync of player statistics (total points) and a look at its players. */
  const group = () => {
    const id = Number(db.prepare('INSERT INTO groups (universe_id, name) VALUES (?, ?)').run(universe, `Stats ${++n}`).lastInsertRowid);
    const sync = (statTime: string, lines: Line[]) =>
      new Store(db, { groupId: id, userId: 1, timezone: 'UTC' }, { pageType: 'stats', source: 'text', lang: 'de', warnings: [], counts: {}, preview: [] }).record({
        kind: 'stats', who: 'player', type: 1, statTime,
        rows: lines.map(([ingameId, name, rank, points]) => ({ rank, rankChange: null, ingameId, name, status: [], allyId: null, allyName: null, points })),
      });
    const all = () => db.prepare('SELECT id, name, ingame_id FROM players WHERE group_id = ? ORDER BY id').all(id) as { id: number; name: string; ingame_id: number | null }[];
    const scores = (playerId: number) => db.prepare('SELECT COUNT(*) FROM player_scores WHERE player_id = ?').pluck().get(playerId) as number;
    return { id, sync, all, scores };
  };
  const [T1, T2, T3] = ['2026-01-01 06:00:00', '2026-01-01 12:00:00', '2026-01-01 18:00:00'];

  it('merges the double of a renamed player once the statistics come with ids', () => {
    const g = group();
    g.sync(T1, [[1003746, 'Seelenschnitter', 89, 1000], [5, 'Other', 90, 900]]);
    // renamed in the game, the plain-text paste comes first: nobody is called "auto" yet
    g.sync(T2, [[null, 'auto', 89, 1100], [null, 'Other', 90, 950]]);
    expect(g.all().map((p) => p.name)).toEqual(['Seelenschnitter', 'Other', 'auto']);
    g.sync(T2, [[1003746, 'auto', 89, 1100], [5, 'Other', 90, 950]]);
    const [player, other, ...rest] = g.all();
    expect(rest).toEqual([]);
    expect(player).toMatchObject({ name: 'auto', ingame_id: 1003746 });
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(player.id)).toEqual(['Seelenschnitter']);
    expect(g.scores(player.id)).toBe(2);
    expect(g.scores(other.id)).toBe(2);
  });

  it('gives a plain-text line to the player with an id who has its rank and points, and takes its name as the new one', () => {
    const g = group();
    const aliases = (playerId: number) => db.prepare('SELECT name, seen_until FROM player_aliases WHERE player_id = ?').all(playerId);
    g.sync(T1, [[1003746, 'Seelenschnitter', 89, 1000]]);
    const t1 = db.prepare('SELECT stat_time FROM stat_snapshots WHERE group_id = ?').pluck().get(g.id) as number;
    // renamed after the sync with ids, then the same statistics as plain text
    g.sync(T1, [[null, 'auto', 89, 1000]]);
    const [player, ...rest] = g.all();
    expect(rest).toEqual([]);
    expect(player).toMatchObject({ name: 'auto', ingame_id: 1003746 });
    expect(aliases(player.id)).toEqual([{ name: 'Seelenschnitter', seen_until: t1 }]);
    expect(g.scores(player.id)).toBe(1);
    // a page copied before the rename and pasted now: the former name does not come back
    g.sync(T1, [[null, 'Seelenschnitter', 89, 1000]]);
    expect(g.all()).toEqual([player]);
    // the next statistics as plain text find the player by the new name
    g.sync(T2, [[null, 'auto', 88, 1100]]);
    expect(g.all()).toEqual([player]);
    expect(g.scores(player.id)).toBe(2);
    // other points on that rank are someone the snapshot does not know
    g.sync(T1, [[null, 'Fremd', 89, 999]]);
    expect(g.all()).toHaveLength(2);
  });

  it('keeps the old name as seen until the last sync with it', () => {
    const g = group();
    g.sync(T1, [[1003746, 'Seelenschnitter', 89, 1000]]);
    const id = g.all()[0].id;
    // seen under the old name after the statistics (e.g. in the galaxy)
    const later = (db.prepare('SELECT last_seen FROM players WHERE id = ?').pluck().get(id) as number) + 3600;
    new Players(db, g.id).player(1003746, 'Seelenschnitter', later);
    g.sync(T1, [[null, 'auto', 89, 1000]]);
    expect(g.all()).toEqual([{ id, name: 'auto', ingame_id: 1003746 }]);
    expect(db.prepare('SELECT seen_until FROM player_aliases WHERE player_id = ?').pluck().get(id)).toBe(later);
    expect(db.prepare('SELECT last_seen FROM players WHERE id = ?').pluck().get(id)).toBe(later);
  });

  it('merges a double with the new name when a plain-text line names the player', () => {
    const g = group();
    g.sync(T1, [[1003746, 'Seelenschnitter', 89, 1000]]);
    const snapshot = db.prepare('SELECT id FROM stat_snapshots WHERE group_id = ?').pluck().get(g.id) as number;
    const double = Number(db.prepare("INSERT INTO players (group_id, name, first_seen, last_seen) VALUES (?, 'auto', 1, 1)").run(g.id).lastInsertRowid);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 89, 1000)').run(snapshot, double);
    g.sync(T1, [[null, 'auto', 89, 1000]]);
    expect(g.all()).toEqual([{ id: expect.any(Number), name: 'auto', ingame_id: 1003746 }]);
  });

  it('merges doubles of earlier syncs with the next statistics with ids', () => {
    const g = group();
    g.sync(T1, [[1003746, 'Seelenschnitter', 89, 1000]]);
    // the double as stored before: its own row with the same rank and points in the same snapshot
    const snapshot = db.prepare('SELECT id FROM stat_snapshots WHERE group_id = ?').pluck().get(g.id) as number;
    const double = Number(db.prepare("INSERT INTO players (group_id, name, first_seen, last_seen) VALUES (?, 'auto', 1, 1)").run(g.id).lastInsertRowid);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 89, 1000)').run(snapshot, double);
    db.prepare("INSERT INTO activity_log (group_id, time, kind, player_id, dedupe_key) VALUES (?, 1, 'planet_new', ?, 'double')").run(g.id, double);
    g.sync(T2, [[1003746, 'auto', 89, 1100]]);
    const [player, ...rest] = g.all();
    expect(rest).toEqual([]);
    expect(g.scores(player.id)).toBe(2);
    expect(db.prepare("SELECT player_id FROM activity_log WHERE dedupe_key = 'double'").pluck().get()).toBe(player.id);
  });

  it('does not merge players for their name alone', () => {
    const g = group();
    // a name-only player and one with an id share a name, but never a rank with the same points in one snapshot
    g.sync(T1, [[null, 'Foo', 50, 500]]);
    const nameOnly = g.all()[0].id;
    db.prepare("INSERT INTO players (group_id, ingame_id, name, first_seen, last_seen) VALUES (?, 100, 'Foo', 1, 1)").run(g.id);
    g.sync(T2, [[100, 'Foo', 40, 700]]);
    g.sync(T3, [[100, 'Foo', 50, 500]]);
    expect(g.all()).toHaveLength(2);
    expect(g.scores(nameOnly)).toBe(1);
  });
});

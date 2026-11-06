import { describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { openDb } = await import('../src/db.js');
const { Players } = await import('../src/repo/players.js');

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

import { beforeEach, describe, expect, it } from 'vitest';
import type { GroupContext } from '../src/context.js';
import { openDb, type DB } from '../src/db.js';
import { clearEmpireCache, latestEmpire, latestEmpires } from '../src/repo/empire.js';

const ctxOf = (groupId: number, userId = 1) => ({ groupId, user: { id: userId } }) as unknown as GroupContext;
const page = (name: string) => JSON.stringify({ kind: 'empire', planets: [{ name, coords: { g: 1, s: 2, p: 3 }, type: 'planet', values: { 1: 5 } }], research: {} });

describe('latestEmpires', () => {
  let db: DB;
  const add = (groupId: number, userId: number, time: number, name: string) =>
    Number(db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(groupId, userId, time, page(name)).lastInsertRowid);

  beforeEach(() => {
    clearEmpireCache();
    db = openDb(':memory:');
    db.exec(`INSERT INTO universes (id, slug, name, settings) VALUES (1, 'u1', 'U1', '{}');
      INSERT INTO groups (id, universe_id, name) VALUES (1, 1, 'A'), (2, 1, 'B');
      INSERT INTO users (id, username, password_hash) VALUES (1, 'a', ''), (2, 'b', ''), (3, 'c', '')`);
  });

  it('returns the newest page per member of the group only', () => {
    add(1, 1, 100, 'old');
    add(1, 1, 200, 'new');
    add(1, 2, 150, 'other member');
    add(2, 3, 300, 'other group');
    const list = latestEmpires(db, ctxOf(1)).map((e) => [e.userId, e.time, e.rec.planets[0].name]);
    expect(list.sort()).toEqual([
      [1, 200, 'new'],
      [2, 150, 'other member'],
    ]);
    expect(latestEmpires(db, ctxOf(2)).map((e) => e.rec.planets[0].name)).toEqual(['other group']);
  });

  it('follows new and removed pages across requests', () => {
    add(1, 1, 100, 'first');
    expect(latestEmpire(db, ctxOf(1), 1)?.rec.planets[0].name).toBe('first');
    const second = add(1, 1, 200, 'second');
    expect(latestEmpire(db, ctxOf(1), 1)?.rec.planets[0].name).toBe('second');
    db.prepare('DELETE FROM empire_snapshots WHERE id = ?').run(second);
    expect(latestEmpire(db, ctxOf(1), 1)?.rec.planets[0].name).toBe('first');
    db.prepare('DELETE FROM empire_snapshots').run();
    expect(latestEmpire(db, ctxOf(1), 1)).toBeNull();
  });

  it('never hands out a cached page for another group', () => {
    const id = add(1, 1, 100, 'secret of A');
    expect(latestEmpires(db, ctxOf(1))).toHaveLength(1);
    // the parsed page is cached; even a row moved to another group (no code does that) is read again for it
    db.prepare('UPDATE empire_snapshots SET group_id = 2, data = ? WHERE id = ?').run(page('read for B'), id);
    expect(latestEmpires(db, ctxOf(2)).map((e) => e.rec.planets[0].name)).toEqual(['read for B']);
    expect(latestEmpires(db, ctxOf(1))).toEqual([]);
  });

  it('hands out frozen records', () => {
    add(1, 1, 100, 'p');
    const rec = latestEmpire(db, ctxOf(1), 1)!.rec;
    expect(() => {
      (rec.planets[0].values as Record<number, number>)[1] = 99;
    }).toThrow(TypeError);
  });
});

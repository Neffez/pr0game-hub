import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { AlertSchedule, groupUniverse } from '../src/notify.js';

// F-01 of the 2026-11-19 review: a removed member's planning broke the notification schedule of the whole group.
describe('member removal and the notification schedule', () => {
  function setup() {
    const db = openDb(':memory:');
    const uni = Number(db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', '{}')").run().lastInsertRowid);
    const group = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'A')").run(uni).lastInsertRowid);
    const other = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'B')").run(uni).lastInsertRowid);
    const user = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('gone', 'x')").run().lastInsertRowid);
    for (const g of [group, other]) {
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g, user);
      db.prepare('INSERT INTO building_alerts (group_id, user_id, g, s, p, planet_type, element_id, level) VALUES (?, ?, 1, 1, 1, ?, 1, 5)').run(g, user, 'planet');
      db.prepare('INSERT INTO fleet_alerts (group_id, user_id, arrival, lead, data) VALUES (?, ?, 100, 60, ?)').run(g, user, '{}');
      db.prepare('INSERT INTO storage_full (group_id, user_id, g, s, p, resource, since) VALUES (?, ?, 1, 1, 1, 901, 0)').run(g, user);
      db.prepare("INSERT INTO build_orders (group_id, user_id, data, meta) VALUES (?, ?, '{}', '{}')").run(g, user);
    }
    return { db, group, other, user };
  }
  const count = (db: ReturnType<typeof openDb>, table: string, group: number) =>
    db.prepare(`SELECT COUNT(*) FROM ${table} WHERE group_id = ?`).pluck().get(group);

  it('drops the alerts of the group the member left, keeps their build order and the other group', () => {
    const { db, group, other, user } = setup();
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group, user);
    for (const table of ['building_alerts', 'fleet_alerts', 'storage_full']) {
      expect(count(db, table, group)).toBe(0);
      expect(count(db, table, other)).toBe(1);
    }
    expect(count(db, 'build_orders', group)).toBe(1);
  });

  it('plans a group whose former member still has a build order or an orphaned alert', () => {
    const { db, group, user } = setup();
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group, user);
    // a row left from before the trigger
    db.prepare('INSERT INTO building_alerts (group_id, user_id, g, s, p, planet_type, element_id, level) VALUES (?, ?, 1, 1, 2, ?, 1, 5)').run(group, user, 'planet');
    const schedule = new AlertSchedule(db);
    expect(() => schedule.plan(group, groupUniverse(db, group)!, 1000)).not.toThrow();
    expect(schedule.due(group, 1000)).toBe(false);
  });
});

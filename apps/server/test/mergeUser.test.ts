import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { mergeUser } from '../src/repo/members.js';

// F-05 of the 2026-11-19 review: settlements refer to members by `u<id>` inside JSON, without a foreign key.
describe('mergeUser and loot settlements', () => {
  it('moves the member key of the placeholder in the settlement data, corrections and ticks', () => {
    const db = openDb(':memory:');
    const uni = Number(db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', '{}')").run().lastInsertRowid);
    const group = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'A')").run(uni).lastInsertRowid);
    const user = (name: string) => Number(db.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(name).lastInsertRowid);
    const lead = user('lead');
    const into = user('real');
    // ids so that one key is a prefix of another: only whole keys change
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(into * 10 + 1, 'other', 'x');
    const from = user('placeholder');
    const other = into * 10 + 1;
    for (const id of [lead, from]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, id);
    const plan = Number(
      db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time) VALUES (?, ?, 1, 1, 1, 'planet', 0)").run(group, lead).lastInsertRowid,
    );
    const [f, l, o, i] = [`u${from}`, `u${lead}`, `u${other}`, `u${into}`];
    const data = { participants: [{ id: f, name: 'Bob' }, { id: l, name: 'Lead' }, { id: o, name: 'Other' }], transfers: [{ from: f, to: l, res: { m: 1, k: 0, d: 0 } }] };
    const overrides = { participants: { [f]: { flightDeut: 5 }, [o]: { flightDeut: 1 } } };
    db.prepare('INSERT INTO raid_settlements (plan_id, group_id, data, overrides, done, done_before) VALUES (?, ?, ?, ?, ?, ?)').run(
      plan, group, JSON.stringify(data), JSON.stringify(overrides), JSON.stringify([`${f}>${l}`, `${o}>${l}`]), JSON.stringify([`${l}>${f}`]),
    );

    mergeUser(db, from, into);

    const row = db.prepare('SELECT data, overrides, done, done_before FROM raid_settlements WHERE plan_id = ?').get(plan) as Record<string, string>;
    expect(JSON.parse(row.data)).toEqual({
      participants: [{ id: i, name: 'Bob' }, { id: l, name: 'Lead' }, { id: o, name: 'Other' }],
      transfers: [{ from: i, to: l, res: { m: 1, k: 0, d: 0 } }],
    });
    expect(JSON.parse(row.overrides)).toEqual({ participants: { [i]: { flightDeut: 5 }, [o]: { flightDeut: 1 } } });
    expect(JSON.parse(row.done)).toEqual([`${i}>${l}`, `${o}>${l}`]);
    expect(JSON.parse(row.done_before)).toEqual([`${l}>${i}`]);
  });
});

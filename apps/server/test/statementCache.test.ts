import { describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { openDb } = await import('../src/db.js');

describe('statement cache', () => {
  it('keeps a plucked statement plucked when the same SQL is prepared again', () => {
    const db = openDb(':memory:');
    const plucked = db.prepare('SELECT 1 AS x').pluck();
    expect(db.prepare('SELECT 1 AS x').get()).toEqual({ x: 1 });
    expect(plucked.get()).toBe(1);
    expect(db.prepare('SELECT 1 AS x').pluck().get()).toBe(1);
    expect(db.prepare('SELECT 1 AS x').all()).toEqual([{ x: 1 }]);
    // the same statements come from the cache
    expect(db.prepare('SELECT 1 AS x')).toBe(db.prepare('SELECT 1 AS x'));
    expect(db.prepare('SELECT 1 AS x').pluck()).toBe(plucked);
    expect(plucked.pluck(false).get()).toEqual({ x: 1 });
    expect(plucked.get()).toBe(1);
    // writes have no pluck
    db.exec('CREATE TABLE t (a INTEGER)');
    expect(db.prepare('INSERT INTO t (a) VALUES (?)').run(5).changes).toBe(1);
  });
});

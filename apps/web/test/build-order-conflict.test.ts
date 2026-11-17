import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../src/api';
import type { StoredBuildOrder } from '../src/apiTypes';
import { addToBuildOrder } from '../src/buildOrderAdd';
import { BuildOrderChanged, changeBuildOrder } from '../src/buildOrderApi';

const HOME = '1:1:1:planet';
const stored = (revision: number, steps: { id: string; done?: boolean }[]): StoredBuildOrder => ({
  order: { base: { planets: {}, research: {} }, planets: { [HOME]: steps.map((s) => ({ ...s, kind: 'building' as const, element: 1 })) } },
  meta: {}, createdAt: 1, updatedAt: 1, revision,
});
const json = (status: number, body: unknown) => ({
  ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body,
});
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A server holding `current`: writes with a stale If-Match get 412 with the current build order. */
function server(initial: StoredBuildOrder | null) {
  let current = initial;
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, headers: init.headers, body });
    if (init.method === 'GET') return json(200, { buildOrder: current });
    const match = init.headers['if-match'];
    if ((match && match !== `"${current?.revision}"`) || (init.headers['if-none-match'] && current)) {
      return json(412, { error: 'conflict', code: 'build_order_conflict', buildOrder: current });
    }
    const revision = (current?.revision ?? 0) + 1;
    current = init.method === 'PUT'
      ? { ...stored(revision, []), order: body.order }
      : { ...current!, revision, order: { ...current!.order, planets: body.planets } };
    return json(200, { buildOrder: current });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    calls,
    /** a change made elsewhere (another tab, a script) */
    changeElsewhere(next: StoredBuildOrder) {
      current = next;
    },
    get current() {
      return current;
    },
  };
}

beforeEach(() => {
  session.me = { user: { id: 1, username: 'a', isAdmin: false, lang: 'de', dateFormat: 'auto', tours: { enabled: true, seen: [] } }, groups: [] };
  vi.unstubAllGlobals();
});

describe('build order writes', () => {
  it('send the revision they are based on', async () => {
    const srv = server(stored(4, [{ id: 'a' }]));
    const res = await changeBuildOrder('u8', stored(4, [{ id: 'a' }]), (s) => ({ method: 'PATCH', body: { planets: s!.order.planets } }));
    expect(srv.calls[0].headers['if-match']).toBe('"4"');
    expect(res.buildOrder?.revision).toBe(5);
    // none shown: only start one when there is none
    const empty = server(null);
    await changeBuildOrder('u8', null, () => ({ method: 'PUT', body: { order: stored(1, []).order } }));
    expect(empty.calls[0].headers['if-none-match']).toBe('*');
  });

  it('re-apply the change onto a build order changed elsewhere (toggle done)', async () => {
    const shown = stored(4, [{ id: 'a' }, { id: 'b' }]);
    const srv = server(shown);
    // another client added step c in between
    srv.changeElsewhere(stored(5, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    const toggle = (s: StoredBuildOrder | null) => {
      const list = s?.order.planets[HOME];
      if (!list?.some((x) => x.id === 'a')) return null;
      return { method: 'PATCH' as const, body: { planets: { [HOME]: list.map((x) => (x.id === 'a' ? { ...x, done: true } : x)) } } };
    };
    const res = await changeBuildOrder('u8', shown, toggle);
    expect(srv.calls.map((c) => [c.method, c.headers['if-match']])).toEqual([['PATCH', '"4"'], ['PATCH', '"5"']]);
    // both changes are kept
    expect(res.buildOrder?.order.planets[HOME].map((x) => [x.id, !!x.done])).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(res.buildOrder?.revision).toBe(6);
  });

  it('report a change that no longer applies, with the current build order', async () => {
    const shown = stored(4, [{ id: 'a' }]);
    const srv = server(shown);
    srv.changeElsewhere(stored(5, [{ id: 'z' }]));
    const err = await changeBuildOrder('u8', shown, (s) => (s?.revision === 4 ? { method: 'DELETE' } : null)).catch((e) => e);
    expect(err).toBeInstanceOf(BuildOrderChanged);
    expect(err.current.buildOrder.revision).toBe(5);
    expect(err.message).toBeTruthy();
    // nothing was overwritten
    expect(srv.current?.order.planets[HOME].map((x) => x.id)).toEqual(['z']);
  });

  it('add steps to the build order as it is at the time of the write', async () => {
    const srv = server(stored(2, [{ id: 'a', done: true }, { id: 'b' }]));
    // changed elsewhere between the read and the write
    const fetch = vi.mocked(globalThis.fetch);
    const real = fetch.getMockImplementation()!;
    fetch.mockImplementationOnce(async (url, init) => {
      const res = await real(url as string, init as never);
      srv.changeElsewhere(stored(3, [{ id: 'a', done: true }, { id: 'b' }, { id: 'c' }]));
      return res as never;
    });
    await addToBuildOrder('u8', HOME, [{ kind: 'building', element: 2 }], () => ({ planets: {}, research: {} }), 'advisor');
    const ids = srv.current!.order.planets[HOME].map((x) => x.id);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('a');
    expect(ids.slice(2)).toEqual(['b', 'c']);
    expect(srv.calls.filter((c) => c.method === 'PATCH').map((c) => c.headers['if-match'])).toEqual(['"2"', '"3"']);
  });
});

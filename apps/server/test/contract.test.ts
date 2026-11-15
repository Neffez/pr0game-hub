import { describe, expect, it } from 'vitest';
import { checkResponse } from './contract.js';

/** The contract check itself (contractSetup.ts runs it on every answer of the other suites). */
describe('contract check', () => {
  it('accepts an answer that matches the spec and allows extra properties', () => {
    expect(checkResponse('GET', '/api/health', 200, { ok: true })).toBeNull();
    expect(checkResponse('GET', '/api/health', 200, { ok: true, extra: 1 })).toBeNull();
  });

  it('reports wrong values, wrong types and undocumented statuses', () => {
    expect(checkResponse('GET', '/api/health', 200, { ok: false })).toMatchObject({ operation: 'GET /api/health', errors: [expect.stringContaining('/ok')] });
    expect(checkResponse('GET', '/api/{uni}/universe-json'.replace('{uni}', ':uni'), 200, {})).toMatchObject({ errors: ['/ must be array'] });
    expect(checkResponse('GET', '/api/health', 202, { ok: true })).toMatchObject({ errors: ['status 202 is not documented'] });
  });

  it('reads `type: [X, null]` and component references', () => {
    const member = { key: 'u1', username: 'a', source: null, fleets: null, fleetHistory: [] };
    expect(checkResponse('GET', '/api/:uni/alliance', 200, [member])).toBeNull();
    expect(checkResponse('GET', '/api/:uni/alliance', 200, [{ ...member, source: 'other' }])).not.toBeNull();
    expect(checkResponse('GET', '/api/:uni/alliance', 200, [{ ...member, fleets: [] }])).not.toBeNull();
  });

  it('leaves errors and paths outside the spec alone', () => {
    expect(checkResponse('GET', '/api/health', 500, { error: 'x' })).toBeNull();
    expect(checkResponse('GET', '/api/nope', 200, 1)).toBeNull();
  });
});

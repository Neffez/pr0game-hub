import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Ratchet for openapi.yaml: JSON answers whose schema says nothing (`type: object` without properties, or an array of
 * such) give the contract check nothing to verify and generate as `Record<string, never>` for the web. Their number
 * may only become fewer: when you describe some, lower `MAX_UNDESCRIBED` to the new count (CLAUDE.md, "API types").
 */
const MAX_UNDESCRIBED = 41;

type S = Record<string, unknown>;
const spec = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: S }> }> }>>;
  components: { schemas: Record<string, S> };
};

const resolve = (s: S): S => (typeof s.$ref === 'string' ? resolve(spec.components.schemas[s.$ref.split('/').pop()!]!) : s);

/** Whether a schema describes nothing a client could rely on. */
export function undescribed(raw: S | undefined): boolean {
  if (!raw) return true;
  const s = resolve(raw);
  if (s.properties || s.additionalProperties || s.allOf || s.oneOf || s.anyOf || s.const !== undefined || s.enum) return false;
  const types = ([] as unknown[]).concat(s.type ?? []);
  if (types.includes('array')) return !s.items || undescribed(s.items as S);
  return types.length === 0 || types.every((t) => t === 'object' || t === 'null');
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const list = Object.entries(spec.paths).flatMap(([path, ops]) =>
  Object.entries(ops)
    .filter(([m]) => METHODS.includes(m))
    .flatMap(([m, op]) =>
      Object.entries(op.responses ?? {})
        .filter(([code]) => code.startsWith('2'))
        .filter(([, r]) => r.content?.['application/json'] && undescribed(r.content['application/json'].schema))
        .map(([code]) => `${m.toUpperCase()} ${path} ${code}`),
    ),
);

describe('openapi.yaml answer schemas', () => {
  it('tells a described schema from an empty one', () => {
    expect(undescribed({ type: 'object' })).toBe(true);
    expect(undescribed({ type: 'array', items: { type: 'object' } })).toBe(true);
    expect(undescribed({ type: 'object', properties: { ok: { type: 'boolean' } } })).toBe(false);
    expect(undescribed({ $ref: '#/components/schemas/Raids' })).toBe(false);
    expect(undescribed({ type: 'array', items: { type: 'integer' } })).toBe(false);
  });

  it(`leaves at most ${MAX_UNDESCRIBED} JSON answers undescribed (lower the limit when you describe some)`, () => {
    expect(list.length, list.join('\n')).toBeLessThanOrEqual(MAX_UNDESCRIBED);
  });
});

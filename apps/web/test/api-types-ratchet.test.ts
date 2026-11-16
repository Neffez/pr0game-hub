import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Ratchet for the API types: answers of `api<T>` / `uniApi<T>` take `T` from the types generated out of openapi.yaml
 * (`Schema<…>`, `ApiResponse<…>` or a name exported by `src/apiTypes.ts`). Calls that still pass a hand-written type
 * may only become fewer: when you replace some, lower `MAX_HAND_WRITTEN` to the new count (CLAUDE.md, "API types").
 */
const MAX_HAND_WRITTEN = 102;

const SRC = join(import.meta.dirname, '../src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|vue)$/.test(e.name) ? [join(dir, e.name)] : []));

const generated = new Set([
  'Schema', 'ApiResponse', 'unknown', 'void',
  ...[...readFileSync(join(SRC, 'apiTypes.ts'), 'utf8').matchAll(/export type (\w+)/g)].map((m) => m[1]!),
]);

/** The type argument of each `api<…>(` / `uniApi<…>(` call, brackets balanced. */
export function typeArguments(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:api|uniApi)</g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '<' || c === '{' || c === '(' || c === '[') depth++;
      else if (c === '>' || c === '}' || c === ')' || c === ']') depth--;
      if (depth === 0) break;
    }
    if (code[i + 1] === '(') out.push(code.slice(start, i).trim());
  }
  return out;
}

/** Whether a type argument comes from the generated types: its outer name is one of them (arrays of them too). */
const isGenerated = (t: string) => generated.has(t.match(/^(\w+)/)?.[1] ?? '');

describe('API types', () => {
  const handWritten = files(SRC)
    .filter((f) => !f.endsWith('apiTypes.ts') && !f.endsWith('api.ts'))
    .flatMap((f) => typeArguments(readFileSync(f, 'utf8')).filter((t) => !isGenerated(t)).map((t) => `${relative(SRC, f)}: ${t.replace(/\s+/g, ' ')}`));

  it('finds the type arguments of API calls', () => {
    expect(typeArguments("uniApi<{ a: Record<string, number>[] }>(uni, '/x'); api<Schema<'Raids'>>('/y'); api('/z')")).toEqual([
      '{ a: Record<string, number>[] }',
      "Schema<'Raids'>",
    ]);
  });

  it(`passes at most ${MAX_HAND_WRITTEN} hand-written answer types (lower the limit when you replace some)`, () => {
    expect(handWritten.length, handWritten.join('\n')).toBeLessThanOrEqual(MAX_HAND_WRITTEN);
  });
});

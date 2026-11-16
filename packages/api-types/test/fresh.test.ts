import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS script without types
import { generate, OUT } from '../scripts/generate.mjs';

describe('generated API types', () => {
  it('match apps/server/openapi.yaml (run `pnpm --filter @pr0hub/api-types gen` after changing the spec)', async () => {
    expect(readFileSync(OUT, 'utf8') === (await generate())).toBe(true);
  });
});

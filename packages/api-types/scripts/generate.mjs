// Types of the hub API from apps/server/openapi.yaml (openapi-typescript); shared by `pnpm gen` and the freshness test.
import { readFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';

export const SPEC = new URL('../../../apps/server/openapi.yaml', import.meta.url);
export const OUT = new URL('../src/openapi.ts', import.meta.url);

const HEADER = '/* Generated from apps/server/openapi.yaml by `pnpm --filter @pr0hub/api-types gen`. Do not edit. */\n\n';

export async function generate() {
  const ast = await openapiTS(readFileSync(SPEC, 'utf8'), { alphabetize: false, exportType: true });
  return HEADER + astToString(ast);
}

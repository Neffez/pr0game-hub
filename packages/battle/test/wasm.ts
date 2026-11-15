import { existsSync, readFileSync } from 'node:fs';
import type { Fight } from '../src/index.js';

/**
 * The Battlerust engine for the tests, when it is built (`pnpm build:battle`, needs Docker). Without it the engine
 * suites are skipped (`describe.skipIf(!hasEngine)`) instead of failing to load.
 */
const file = new URL('../wasm/battlerust_bg.wasm', import.meta.url);
export const hasEngine = existsSync(file);

let fight: Fight = () => {
  throw new Error('Battlerust WASM missing: run `pnpm build:battle`');
};
if (hasEngine) {
  const wasm = await import('../wasm/battlerust.js');
  wasm.initSync({ module: readFileSync(file) });
  fight = wasm.wasm_fight_battle_rounds;
} else {
  console.warn('packages/battle/wasm is missing: engine suites skipped (build it with `pnpm build:battle`, needs Docker)');
}
export { fight };

/**
 * Types of the Battlerust WebAssembly module (`wasm/`, built by `pnpm build:battle` from the `battle-wasm` Docker
 * stage, not committed). Hand-written to match what `wasm-bindgen --target web` generates for the pinned
 * `BATTLERUST_REF`, so `pnpm typecheck` passes without the binary; update them with the engine.
 */

/** Fights one battle: engine input JSON (`engineInput`) in, result JSON with the rounds (`battleResult`) out. */
export function wasm_fight_battle_rounds(input: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
export type SyncInitInput = BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
}

/** Instantiates the module synchronously from its bytes (Node, tests). */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/** Loads and instantiates the module (browser, Web Worker). */
export default function init(
  module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<InitOutput>;

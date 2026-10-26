// Battle simulation in a worker thread (POST /api/:uni/battle/simulate): Battlerust as WebAssembly, so a large battle
// never blocks the server; the server terminates the worker after its time limit. Plain JavaScript next to src/ and
// dist/, so the same file runs under tsx, vitest and the built server.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { simulate } from '@pr0hub/battle';
import { initSync, wasm_fight_battle_rounds } from '@pr0hub/battle/wasm';

initSync({ module: readFileSync(new URL(import.meta.resolve('@pr0hub/battle/wasm/battlerust_bg.wasm'))) });
const { setup, runs, settings } = workerData;
parentPort.postMessage(simulate(wasm_fight_battle_rounds, setup, runs, settings));

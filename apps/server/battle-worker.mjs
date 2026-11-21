// Battle simulation in a worker thread (POST /api/:uni/battle/simulate, the attack assistant, the defense advisor):
// Battlerust as WebAssembly, so a large battle never blocks the server; the server terminates the worker after its
// time limit. Plain JavaScript next to src/ and dist/, so the same file runs under tsx, vitest and the built server.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { defenseAdvice, raidRisk, researchComparison, simulate } from '@pr0hub/battle';
import { unitCatalog } from '@pr0hub/core/units';
import { initSync, wasm_fight_battle_rounds } from '@pr0hub/battle/wasm';

initSync({ module: readFileSync(new URL(import.meta.resolve('@pr0hub/battle/wasm/battlerust_bg.wasm'))) });
const { job, setup, runs, search, settings, units } = workerData;
const jobs = {
  defense: () => defenseAdvice(wasm_fight_battle_rounds, search, settings, unitCatalog(units)),
  research: () => researchComparison(wasm_fight_battle_rounds, search, settings, unitCatalog(units)),
  risk: () => raidRisk(wasm_fight_battle_rounds, search, settings, unitCatalog(units)),
};
parentPort.postMessage(jobs[job]?.() ?? simulate(wasm_fight_battle_rounds, setup, runs, settings, Math.random, unitCatalog(units)));

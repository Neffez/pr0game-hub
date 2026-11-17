import type { ProdSettings } from '@pr0hub/planner';

/** the producers a production step sets: metal mine, crystal mine, deuterium synthesizer (their resources 901-903) */
export const PRODUCERS = [
  { id: 1, res: 901 },
  { id: 2, res: 902 },
  { id: 3, res: 903 },
] as const;
/** the game's choices: 100 % … 0 % in steps of 10 */
export const PROD_PERCENTS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

/**
 * Form values of a production step of the build order: percent per producer id and whether it waits for the planet's
 * build slot (the building before it is finished, e.g. the mine that makes the energy short). The other settings of
 * an imported step (research, shipyard, wait) are kept when editing.
 */
export interface ProdDraft {
  percent: Record<number, number>;
  awaitBuilding: boolean;
}

const toPercent = (f: number | undefined) => Math.round((f ?? 1) * 100);

/** a new step starts from the planet's synced factors (to the nearest 10 %), an edited one from its own */
export function prodDraftOf(prod?: ProdSettings, synced?: Record<string, number> | null): ProdDraft {
  if (prod) return { percent: Object.fromEntries(PRODUCERS.map((p) => [p.id, toPercent(prod.factors[p.id])])), awaitBuilding: prod.awaitBuilding };
  return { percent: Object.fromEntries(PRODUCERS.map((p) => [p.id, Math.round(toPercent(synced?.[p.id]) / 10) * 10])), awaitBuilding: true };
}

export const prodDraftValid = (d: ProdDraft) => PRODUCERS.every((p) => Number.isInteger(d.percent[p.id]) && d.percent[p.id] >= 0 && d.percent[p.id] <= 100);

export function prodOf(d: ProdDraft, before?: ProdSettings): ProdSettings {
  return {
    factors: Object.fromEntries(PRODUCERS.map((p) => [p.id, d.percent[p.id] / 100])),
    awaitBuilding: d.awaitBuilding,
    awaitResearch: before?.awaitResearch ?? false,
    awaitShipyard: before?.awaitShipyard ?? false,
    wait: before?.wait ?? 0,
  };
}

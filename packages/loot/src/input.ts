import { CAPACITY } from '@pr0hub/flight';
import { MAX_HELPER_KEEP, MAX_PARTICIPANTS } from './settle.js';
import type { Battle, BattleFleet, Debris, Helper, Participant, Recycling, Res, Settings, SettlementInput, Ships, Transfer } from './types.js';

/** A transfer as entered by hand (ships are computed). */
export type TransferInput = Pick<Transfer, 'from' | 'to' | 'res'>;

/** Everything the loot calculator keeps: the settlement input plus transfers changed by hand (null = suggestion). */
export interface LootState extends SettlementInput {
  transfers: TransferInput[] | null;
}

/** Market rates of the game as a default (metal and crystal per deuterium). */
export const DEFAULT_RATES: Res = { m: 2.8, k: 0.8, d: 1 };

export const DEFAULT_SETTINGS: Settings = {
  mode: 'equal',
  rates: DEFAULT_RATES,
  refRates: null,
  deficitMetalShare: 0.5,
  cargoShip: 203,
  helperDeut: false,
};

export const emptyState = (): LootState => ({
  participants: [],
  helpers: [],
  battles: [],
  recycling: [],
  settings: { ...DEFAULT_SETTINGS, rates: { ...DEFAULT_RATES } },
  transfers: null,
});

const MAX_HELPERS = 20;
const MAX_BATTLES = 20;
const MAX_ROWS = 100;
const MAX_AMOUNT = 1e15;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min = 0, max = MAX_AMOUNT): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const int = (v: unknown, min = 0, max = MAX_AMOUNT) => Math.round(num(v, min, max));
const str = (v: unknown, max = 64) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const list = <T>(v: unknown, max: number, map: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.slice(0, max).map(map).filter((x): x is T => x != null) : [];
const res = (v: unknown): Res => (isObj(v) ? { m: int(v.m), k: int(v.k), d: int(v.d) } : { m: 0, k: 0, d: 0 });
const debris = (v: Record<string, unknown>): Debris => ({ m: int(v.m), k: int(v.k) });
const ships = (v: unknown): Ships => {
  const out: Ships = {};
  if (!isObj(v)) return out;
  for (const [id, amount] of Object.entries(v)) {
    const n = int(amount);
    if (/^\d{3}$/.test(id) && n > 0) out[Number(id)] = n;
  }
  return out;
};

/**
 * Cleans an untrusted settlement (share link, stored JSON, API body): known fields only, numbers clamped, at most
 * `MAX_PARTICIPANTS` participants. References to unknown people are dropped.
 */
export function cleanState(raw: unknown): LootState {
  const base = emptyState();
  if (!isObj(raw)) return base;
  const participants = list<Participant>(raw.participants, MAX_PARTICIPANTS, (p) =>
    isObj(p) && str(p.id)
      ? {
          id: str(p.id),
          name: str(p.name),
          flightDeut: int(p.flightDeut),
          recDeut: int(p.recDeut),
          missiles: int(p.missiles, 0, 1e6),
          ...(isObj(p.extra) ? { extra: res(p.extra) } : {}),
        }
      : null,
  );
  const helpers = list<Helper>(raw.helpers, MAX_HELPERS, (h) =>
    isObj(h) && str(h.id) ? { id: str(h.id), name: str(h.name), keepPct: num(h.keepPct, 0, MAX_HELPER_KEEP), recDeut: int(h.recDeut) } : null,
  );
  const ids = new Set<string>();
  for (const p of [...participants, ...helpers]) {
    if (ids.has(p.id)) p.id = `${p.id}-${ids.size}`;
    ids.add(p.id);
  }
  const pids = new Set(participants.map((p) => p.id));
  const battles = list<Battle>(raw.battles, MAX_BATTLES, (b) =>
    isObj(b)
      ? {
          time: b.time == null ? null : int(b.time, 0, 1e11),
          loot: res(b.loot),
          fleets: list<BattleFleet>(b.fleets, MAX_ROWS, (f) =>
            isObj(f) && pids.has(str(f.participant))
              ? {
                  participant: str(f.participant),
                  start: ships(f.start),
                  end: ships(f.end),
                  ...(isObj(f.carried) ? { carried: res(f.carried) } : {}),
                  ...(isObj(f.loot) ? { loot: res(f.loot) } : {}),
                }
              : null,
          ),
          ...(isObj(b.debris) ? { debris: debris(b.debris) } : {}),
        }
      : null,
  );
  const recycling = list<Recycling>(raw.recycling, MAX_ROWS, (r) =>
    isObj(r) && ids.has(str(r.by))
      ? {
          by: str(r.by), m: int(r.m), k: int(r.k),
          ...(isObj(r.field) ? { field: debris(r.field) } : {}),
          ...(r.time != null ? { time: int(r.time, 0, 1e11) } : {}),
        }
      : null,
  );
  const s = isObj(raw.settings) ? raw.settings : {};
  const rate = (v: unknown, fallback: number) => (num(v, 0, 1000) > 0 ? num(v, 0.01, 1000) : fallback);
  const rates = (v: unknown, fallback: Res): Res => (isObj(v) ? { m: rate(v.m, fallback.m), k: rate(v.k, fallback.k), d: 1 } : fallback);
  const settings: Settings = {
    mode: s.mode === 'investment' ? 'investment' : 'equal',
    rates: rates(s.rates, { ...DEFAULT_RATES }),
    refRates: isObj(s.refRates) ? rates(s.refRates, { ...DEFAULT_RATES }) : null,
    deficitMetalShare: s.deficitMetalShare == null ? DEFAULT_SETTINGS.deficitMetalShare : num(s.deficitMetalShare, 0, 1),
    cargoShip: CAPACITY[int(s.cargoShip)] ? int(s.cargoShip) : DEFAULT_SETTINGS.cargoShip,
    helperDeut: s.helperDeut === true,
  };
  const transfers = Array.isArray(raw.transfers)
    ? list<TransferInput>(raw.transfers, MAX_ROWS, (t) =>
        isObj(t) && ids.has(str(t.from)) && ids.has(str(t.to)) ? { from: str(t.from), to: str(t.to), res: res(t.res) } : null,
      )
    : null;
  return { participants, helpers, battles, recycling, settings, transfers };
}

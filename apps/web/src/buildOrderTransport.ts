import { allOf, type TransportMission, type TransportSettings } from '@pr0hub/planner';
import { fromLocalInput, toLocalInput } from './plans';

export const SMALL_CARGO = 202;
export const COLONY_SHIP = 208;
export const MISSIONS: TransportMission[] = ['transport', 'deploy', 'colonize'];

/**
 * Form values of a transport step of the build order (adding one, or editing one). `flight` (minutes) counts when the
 * hub cannot calculate the flight (no ships, or no coordinates): a transport imported from pr0plan has a flight time
 * instead of ships.
 */
export interface TransportDraft {
  mission: TransportMission;
  target: string | null;
  ships: { id: number; count: number }[];
  speed: number;
  /** resources loaded completely (the game's "max" links), the others with their amounts */
  all: number[];
  res: Record<number, number>;
  timeMode: 'none' | 'notBefore' | 'arriveAt';
  /** value of a datetime-local input (browser time) */
  time: string;
  flight: number;
}

export function draftOf(tr?: TransportSettings): TransportDraft {
  if (!tr) {
    return { mission: 'transport', target: null, ships: [{ id: SMALL_CARGO, count: 1 }], speed: 100, all: [], res: { 901: 0, 902: 0, 903: 0 }, timeMode: 'none', time: '', flight: 0 };
  }
  const timeMode = tr.arriveAt ? 'arriveAt' : tr.notBefore ? 'notBefore' : 'none';
  const at = tr.arriveAt ?? tr.notBefore;
  return {
    mission: tr.mission ?? 'transport',
    target: tr.target,
    ships: Object.entries(tr.ships ?? {}).map(([id, count]) => ({ id: Number(id), count })),
    speed: tr.speed ?? 100,
    all: allOf(tr),
    res: { 901: tr.resources[901] ?? 0, 902: tr.resources[902] ?? 0, 903: tr.resources[903] ?? 0 },
    timeMode,
    time: at ? toLocalInput(at).slice(0, 16) : '',
    flight: Math.round(tr.flight / 60),
  };
}

const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
export const epochOf = (d: TransportDraft) => (d.timeMode === 'none' || !d.time ? null : fromLocalInput(d.time));

/** `allowNoTarget`: an edited transport that had no target may keep none (its resources just leave) */
export function draftValid(d: TransportDraft, allowNoTarget = false): boolean {
  const ships = d.ships.every((s) => Number.isInteger(s.count) && s.count >= 1) && (d.ships.length > 0 || amount(d.flight) > 0);
  const load = d.all.length > 0 || d.mission === 'colonize' || [901, 902, 903].some((r) => amount(d.res[r]) > 0);
  return (!!d.target || allowNoTarget) && ships && load && (d.timeMode === 'none' || epochOf(d) != null);
}

export function transportOf(d: TransportDraft): TransportSettings {
  const ships: Record<string, number> = {};
  for (const s of d.ships) ships[s.id] = (ships[s.id] ?? 0) + s.count;
  const resources: Record<string, number> = {};
  for (const r of [901, 902, 903]) if (!d.all.includes(r) && amount(d.res[r])) resources[r] = amount(d.res[r]);
  const tr: TransportSettings = { target: d.target, resources, flight: amount(d.flight) * 60 };
  if (d.ships.length) tr.ships = ships;
  if (d.mission !== 'transport') tr.mission = d.mission;
  if (d.speed !== 100) tr.speed = d.speed;
  const all = [901, 902, 903].filter((r) => d.all.includes(r));
  if (all.length) tr.all = all.length === 3 ? true : all;
  const at = epochOf(d);
  if (d.timeMode !== 'none' && at != null) tr[d.timeMode] = at;
  return tr;
}

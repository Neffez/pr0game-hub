import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { cleanState, type LootState } from './input.js';
import type { Res, Ships } from './types.js';

/**
 * Share links (`#s=…`): the settlement as positional arrays (people by their index, ships as id/amount pairs, no field
 * names), deflated, base64url, after the marker `z`. Older links hold the plain JSON in base64url (`eyJ…`) and still
 * open.
 */
const MARK = 'z';

type Packed = unknown[];

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const flat = (ships: Ships) => Object.entries(ships).flatMap(([id, n]) => [Number(id), n]);
const unflat = (v: unknown): Ships => {
  const out: Ships = {};
  if (!Array.isArray(v)) return out;
  for (let i = 0; i + 1 < v.length; i += 2) out[Number(v[i])] = Number(v[i + 1]);
  return out;
};
const mkd = (r: Partial<Res>) => [r.m ?? 0, r.k ?? 0, r.d ?? 0];
const res = (v: unknown) => (Array.isArray(v) ? { m: v[0], k: v[1], d: v[2] } : undefined);
const mk = (v: unknown) => (Array.isArray(v) ? { m: v[0], k: v[1] } : undefined);
/** drops trailing empty optional entries */
const trim = (a: unknown[]) => {
  while (a.length && (a[a.length - 1] === undefined || a[a.length - 1] === 0)) a.pop();
  return a;
};

function pack(s: LootState): Packed {
  const ids = [...s.participants, ...s.helpers].map((p) => p.id);
  const at = (id: string) => ids.indexOf(id);
  return [
    s.participants.map((p) => trim([p.id, p.name, p.flightDeut ?? 0, p.recDeut ?? 0, p.missiles ?? 0, p.extra ? mkd(p.extra) : 0])),
    s.helpers.map((h) => trim([h.id, h.name, h.keepPct, h.recDeut ?? 0])),
    s.battles.map((b) =>
      trim([
        b.time ?? null,
        mkd(b.loot),
        b.fleets.map((f) => trim([at(f.participant), flat(f.start), flat(f.end), f.loot ? mkd(f.loot) : 0, f.carried ? mkd(f.carried) : 0])),
        b.debris ? [b.debris.m, b.debris.k] : 0,
      ]),
    ),
    s.recycling.map((r) => trim([at(r.by), r.m, r.k, r.field ? [r.field.m, r.field.k] : 0, r.time ?? 0])),
    [
      s.settings.mode === 'investment' ? 1 : 0, s.settings.rates.m, s.settings.rates.k,
      s.settings.refRates ? [s.settings.refRates.m, s.settings.refRates.k] : 0, s.settings.deficitMetalShare, s.settings.cargoShip,
      s.settings.helperDeut ? 1 : 0,
    ],
    s.transfers ? s.transfers.map((t) => [at(t.from), at(t.to), ...mkd(t.res)]) : 0,
  ];
}

/** The packed arrays back in the shape of `LootState` (unchecked: `cleanState` checks it). */
function unpack(p: Packed): unknown {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const [parts, helps, battles, recycling, settings, transfers] = p;
  const participants = arr(parts).map((x) => {
    const [id, name, flightDeut, recDeut, missiles, extra] = arr(x);
    return { id, name, flightDeut, recDeut, missiles, ...(extra ? { extra: res(extra) } : {}) };
  });
  const helpers = arr(helps).map((x) => {
    const [id, name, keepPct, recDeut] = arr(x);
    return { id, name, keepPct, recDeut };
  });
  const ids = [...participants, ...helpers].map((x) => x.id);
  const id = (i: unknown) => ids[Number(i)];
  const [mode, rm, rk, ref, deficitMetalShare, cargoShip, helperDeut] = arr(settings);
  return {
    participants,
    helpers,
    battles: arr(battles).map((x) => {
      const [time, loot, fleets, debris] = arr(x);
      return {
        time,
        loot: res(loot),
        fleets: arr(fleets).map((f) => {
          const [who, start, end, fleetLoot, carried] = arr(f);
          return {
            participant: id(who), start: unflat(start), end: unflat(end),
            ...(fleetLoot ? { loot: res(fleetLoot) } : {}), ...(carried ? { carried: res(carried) } : {}),
          };
        }),
        ...(debris ? { debris: mk(debris) } : {}),
      };
    }),
    recycling: arr(recycling).map((x) => {
      const [by, m, k, field, time] = arr(x);
      return { by: id(by), m, k, ...(field ? { field: mk(field) } : {}), ...(time ? { time } : {}) };
    }),
    settings: {
      mode: mode === 1 ? 'investment' : 'equal', rates: { m: rm, k: rk, d: 1 }, refRates: ref ? { ...mk(ref), d: 1 } : null,
      deficitMetalShare, cargoShip, helperDeut: helperDeut === 1,
    },
    transfers: Array.isArray(transfers) ? transfers.map((t) => ({ from: id(arr(t)[0]), to: id(arr(t)[1]), res: res(arr(t).slice(2)) })) : null,
  };
}

/** Compact text of a settlement for share links (`#s=…`), readable by `decodeShare`. */
export function encodeShare(state: LootState): string {
  return MARK + toBase64Url(deflateSync(strToU8(JSON.stringify(pack(state))), { level: 9 }));
}

/** Settlement from `encodeShare` (or an older link), cleaned; null when the text is not one. */
export function decodeShare(text: string): LootState | null {
  const t = text.trim();
  try {
    if (t.startsWith(MARK)) return cleanState(unpack(JSON.parse(strFromU8(inflateSync(fromBase64Url(t.slice(MARK.length)))))));
    return cleanState(JSON.parse(new TextDecoder().decode(fromBase64Url(t))));
  } catch {
    return null;
  }
}

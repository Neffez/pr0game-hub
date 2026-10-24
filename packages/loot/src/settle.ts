import { ACS_LIMITS, fleetCapacity } from '@pr0hub/flight';
import { add, apportion, deutValue, lostShips, rate, res, roundResTo, scale, shipCosts, sub, sum, total, ZERO } from './res.js';
import { planTransfers } from './transfers.js';
import type { Battle, PersonResult, Res, ResKey, SettlementInput, SettlementResult, SettlementWarning } from './types.js';
import { RES_KEYS } from './types.js';

/** Most participants of an ACS (the game's limit). */
export const MAX_PARTICIPANTS = ACS_LIMITS.maxParticipants;
/** Game rule: loot and debris of an ACS are shared within 24 hours. */
export const SHARE_WITHIN = 24 * 3600;
/** Game rule: resources change hands at 75-125 % of the market price. */
export const RATE_RANGE: readonly [number, number] = [0.75, 1.25];
/** Game rule: a recycling helper keeps at most this share of what they recycled (%). */
export const MAX_HELPER_KEEP = 20;
/** Missile costs (interplanetary missile). */
export const MISSILE = 503;

const round = (r: Res): Res => ({ m: Math.round(r.m), k: Math.round(r.k), d: Math.round(r.d) });

/**
 * Loot per participant of one battle, as the game shares it (`calculateSteal`): by the free cargo space of the
 * surviving ships (spy probes left out, resources already carried taken off). Fleets with a known `loot` keep it, the
 * rest of the battle's loot goes to the others.
 */
export function lootShares(battle: Battle): Map<string, Res> {
  const out = new Map<string, Res>();
  const known = battle.fleets.filter((f) => f.loot);
  const open = battle.fleets.filter((f) => !f.loot);
  for (const f of known) out.set(f.participant, add(out.get(f.participant) ?? { ...ZERO }, round(res(f.loot))));
  const rest = sub(round(res(battle.loot)), sum(known.map((f) => round(res(f.loot)))));
  if (open.length) {
    const space = open.map((f) => Math.max(0, fleetCapacity(f.end, true) - total(res(f.carried))));
    const any = space.some((s) => s > 0);
    const parts = RES_KEYS.map((key) => (any ? apportion(Math.max(0, rest[key]), space) : open.map(() => 0)));
    open.forEach((f, i) => {
      const share = { m: parts[0][i], k: parts[1][i], d: parts[2][i] };
      out.set(f.participant, add(out.get(f.participant) ?? { ...ZERO }, share));
    });
  }
  return out;
}

/**
 * Covers `claims` from `supply` in kind; a resource that falls short is made up for at market rates in the
 * resources left over (a shortage of deuterium by `deficitMetalShare` in metal, the rest in crystal). The claims must
 * not be worth more than the supply.
 */
function allocate(claims: Res[], supply: Res, rates: Res, deficitMetalShare: number): Res[] {
  const need = sum(claims);
  const ratio = {} as Res;
  const free = {} as Res; // left-over value per resource, in deuterium
  const short = {} as Res;
  for (const key of RES_KEYS) {
    ratio[key] = need[key] > 0 ? Math.min(1, supply[key] / need[key]) : 1;
    free[key] = Math.max(0, supply[key] - need[key]) / rate(rates, key);
    short[key] = Math.max(0, need[key] - supply[key]);
  }
  // per unit missing of a resource: units of the other resources given instead
  const instead: Record<ResKey, Res> = { m: { ...ZERO }, k: { ...ZERO }, d: { ...ZERO } };
  const share = Math.min(1, Math.max(0, deficitMetalShare));
  for (const key of ['d', 'm', 'k'] as const) {
    if (short[key] <= 0) continue;
    let value = short[key] / rate(rates, key);
    const others = RES_KEYS.filter((o) => o !== key);
    const pref: Res = key === 'd' ? { m: share, k: 1 - share, d: 0 } : { ...ZERO };
    if (key !== 'd') {
      const avail = others.reduce((s, o) => s + free[o], 0);
      for (const o of others) pref[o] = avail > 0 ? free[o] / avail : 0;
    }
    const given = { ...ZERO };
    for (const o of others) {
      const v = Math.min(free[o], value * pref[o]);
      given[o] += v;
      free[o] -= v;
    }
    value -= given.m + given.k + given.d;
    for (const o of others) {
      if (value <= 1e-9) break;
      const v = Math.min(free[o], value);
      given[o] += v;
      free[o] -= v;
      value -= v;
    }
    for (const o of others) instead[key][o] = (given[o] * rate(rates, o)) / short[key];
  }
  return claims.map((c) => {
    const out = { ...ZERO };
    for (const key of RES_KEYS) {
      out[key] += c[key] * ratio[key];
      const missing = c[key] * (1 - ratio[key]);
      if (missing > 0) for (const o of RES_KEYS) out[o] += missing * instead[key][o];
    }
    return out;
  });
}

/**
 * Deuterium costs (flights, recyclers, the deuterium of lost ships, refunded helper deuterium) are paid back in metal
 * and crystal at market rates, `metalShare` of the value in metal: the captured deuterium is profit and shared like it.
 */
function deutInKind(c: Res, rates: Res, metalShare: number): Res {
  const share = Math.min(1, Math.max(0, metalShare));
  return { m: c.m + c.d * share * rate(rates, 'm'), k: c.k + c.d * (1 - share) * rate(rates, 'k'), d: 0 };
}

/** Settles an ACS: covers the costs of the participants and the helpers' parts, splits the profit, plans transfers. */
export function settle(input: SettlementInput): SettlementResult {
  const { participants, helpers, battles, recycling, settings } = input;
  const warnings = new Set<SettlementWarning>();
  if (participants.length > MAX_PARTICIPANTS) warnings.add('too_many_participants');
  const people = [...participants.map((p) => p.id), ...helpers.map((h) => h.id)];
  const known = new Set(people);

  const lootOf = new Map<string, Res[]>(participants.map((p) => [p.id, battles.map(() => ({ ...ZERO }))]));
  const sent = new Map<string, number>(participants.map((p) => [p.id, 0]));
  const lost = new Map<string, Res>(participants.map((p) => [p.id, { ...ZERO }]));
  battles.forEach((b, i) => {
    for (const f of b.fleets) {
      if (!known.has(f.participant) || !lootOf.has(f.participant)) {
        warnings.add('unknown_person');
        continue;
      }
      sent.set(f.participant, sent.get(f.participant)! + total(shipCosts(f.start)));
      lost.set(f.participant, add(lost.get(f.participant)!, shipCosts(lostShips(f.start, f.end))));
    }
    for (const [id, share] of lootShares(b)) if (lootOf.has(id)) lootOf.get(id)![i] = share;
  });
  const recycled = new Map<string, Res>(people.map((id) => [id, { ...ZERO }]));
  for (const r of recycling) {
    if (!recycled.has(r.by)) {
      warnings.add('unknown_person');
      continue;
    }
    recycled.set(r.by, add(recycled.get(r.by)!, round({ m: r.m, k: r.k, d: 0 })));
  }

  const holds = (id: string) => add(sum(lootOf.get(id) ?? []), recycled.get(id)!);
  const pot = sum(people.map(holds));
  const rates = settings.rates;

  // claims: participants their costs, helpers their part of the recycling (and their deuterium if refunded)
  const missileCost = shipCosts({ [MISSILE]: 1 });
  const costs = participants.map((p) =>
    round(
      add(add(lost.get(p.id)!, scale(missileCost, Math.max(0, p.missiles ?? 0))), {
        m: p.extra?.m ?? 0,
        k: p.extra?.k ?? 0,
        d: (p.flightDeut ?? 0) + (p.recDeut ?? 0) + (p.extra?.d ?? 0),
      }),
    ),
  );
  const helperParts = helpers.map((h) => {
    const r = recycled.get(h.id)!;
    const keep = Math.min(MAX_HELPER_KEEP, Math.max(0, h.keepPct)) / 100;
    return round({ m: r.m * keep, k: r.k * keep, d: settings.helperDeut ? Math.max(0, h.recDeut ?? 0) : 0 });
  });

  // helpers first (they keep their part), then the participants, scaled down alike when the pot is worth less
  const potValue = deutValue(pot, rates);
  const helperValue = deutValue(sum(helperParts), rates);
  const helperFactor = helperValue > potValue ? potValue / helperValue : 1;
  const costValue = deutValue(sum(costs), rates);
  const left = potValue - helperFactor * helperValue;
  const coverage = costValue > left ? Math.max(0, left) / costValue : 1;
  if (coverage < 1) warnings.add('costs_not_covered');
  const claims = [...costs.map((c) => scale(c, coverage)), ...helperParts.map((c) => scale(c, helperFactor))].map((c) =>
    deutInKind(c, rates, settings.deficitMetalShare),
  );
  const covered = allocate(claims, pot, rates, settings.deficitMetalShare);
  const coveredSum = sum(covered);
  const profit = { m: Math.max(0, pot.m - coveredSum.m), k: Math.max(0, pot.k - coveredSum.k), d: Math.max(0, pot.d - coveredSum.d) };

  // profit shares: equal, or by the value of the ships sent
  const invested = participants.map((p) => sent.get(p.id)!);
  const investSum = invested.reduce((s, v) => s + v, 0);
  const shares = participants.map((_, i) =>
    settings.mode === 'investment' && investSum > 0 ? invested[i] / investSum : 1 / participants.length,
  );
  const entitledRaw = [
    ...participants.map((_, i) => add(covered[i], scale(profit, shares[i]))),
    ...helpers.map((_, j) => covered[participants.length + j]),
  ];
  const entitledTotal = participants.length ? pot : round(sum(entitledRaw));
  const entitled = roundResTo(entitledTotal, entitledRaw);
  const coveredInt = roundResTo(round(coveredSum), covered).map((c, i) => ({
    m: Math.min(c.m, entitled[i].m),
    k: Math.min(c.k, entitled[i].k),
    d: Math.min(c.d, entitled[i].d),
  }));

  const result: PersonResult[] = [
    ...participants.map((p, i) => ({
      id: p.id,
      name: p.name,
      role: 'participant' as const,
      loot: lootOf.get(p.id)!,
      recycled: recycled.get(p.id)!,
      holds: holds(p.id),
      costs: costs[i],
      invested: invested[i],
      share: shares[i],
      covered: coveredInt[i],
      profit: sub(entitled[i], coveredInt[i]),
      entitled: entitled[i],
      balance: sub(entitled[i], holds(p.id)),
    })),
    ...helpers.map((h, j) => {
      const i = participants.length + j;
      return {
        id: h.id,
        name: h.name,
        role: 'helper' as const,
        loot: [],
        recycled: recycled.get(h.id)!,
        holds: holds(h.id),
        costs: helperParts[j],
        invested: 0,
        share: 0,
        covered: coveredInt[i],
        profit: sub(entitled[i], coveredInt[i]),
        entitled: entitled[i],
        balance: sub(entitled[i], holds(h.id)),
      };
    }),
  ];

  const times = battles.map((b) => b.time).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const rateWarnings = settings.refRates
    ? (['m', 'k'] as const).filter((key) => {
        const ratio = rate(settings.refRates!, key) / rate(rates, key);
        return ratio < RATE_RANGE[0] || ratio > RATE_RANGE[1];
      })
    : [];
  if (rateWarnings.length) warnings.add('rates_out_of_range');
  const allCosts = add(sum(costs), sum(helperParts));
  const profitInt = sum(result.map((p) => p.profit));
  return {
    people: result,
    loot: sum([...lootOf.values()].flat()),
    recycled: sum([...recycled.values()]),
    pot,
    costs: allCosts,
    profit: profitInt,
    coverage,
    value: { pot: potValue, costs: deutValue(allCosts, rates), profit: deutValue(profitInt, rates) },
    transfers: planTransfers(
      result.map((p) => ({ id: p.id, balance: p.balance })),
      settings.cargoShip,
      rates,
    ),
    deadline: times.length ? Math.max(...times) + SHARE_WITHIN : null,
    rateWarnings,
    warnings: [...warnings],
  };
}

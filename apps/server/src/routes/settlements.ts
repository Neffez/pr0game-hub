import type { FastifyInstance } from 'fastify';
import { localToEpoch } from '@pr0hub/core';
import { isCombatSimulation, parseCombatReportText } from '@pr0hub/core/combat';
import { applyOverrides, cleanState, diffOverrides, settle, stateChanges, type LootState } from '@pr0hub/loot';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { ingest } from '../ingest.js';
import { planFromReport } from '../repo/reportPlan.js';
import type { PlanRow } from '../repo/plans.js';
import { correctionsOf, finalizedSettlements, forgetFinalized, memberKey, settlementChecks, settlementDraft, storedSettlement } from '../repo/settlements.js';
import { clampInt, contextOf, DISPLAY, MEMBER, type Q } from './util.js';

/** Battles count for a plan from an hour before its time until an hour after (as in the draft). */
const BATTLE_SLACK = 3600;

type SettlementPlan = PlanRow & { time_precision: string; guests: string | null };

/** ACS loot settlement of a raid plan: prefilled from the hub's data, saved and shared with the group. */
export function settlementRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const isAdmin = (ctx: GroupContext) => ctx.role === 'admin' || ctx.user.isAdmin;
  const changed = (ctx: GroupContext) => {
    forgetFinalized(ctx);
    events.publish(ctx.groupId, { type: 'data', tables: ['raid_settlements'], userId: ctx.user.id });
  };

  function planOf(ctx: GroupContext, id: number) {
    const plan = db.prepare('SELECT * FROM attack_plans WHERE id = ? AND group_id = ?').get(id, ctx.groupId) as SettlementPlan | undefined;
    if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found');
    return plan;
  }
  /** Participants of the plan (for a hold also the attacked member), its creator and group admins change the settlement. */
  const canEdit = (ctx: GroupContext, plan: SettlementPlan) =>
    plan.user_id === ctx.user.id ||
    isAdmin(ctx) ||
    !!db.prepare("SELECT 1 FROM attack_plan_fleets WHERE plan_id = ? AND user_id = ? AND status <> 'withdrawn'").get(plan.id, ctx.user.id) ||
    (plan.mission === 'hold' && !!db.prepare('SELECT 1 FROM attack_plan_enemy WHERE plan_id = ? AND member_id = ?').get(plan.id, ctx.user.id));
  function editable(ctx: GroupContext, plan: SettlementPlan) {
    if (!canEdit(ctx, plan)) throw new HttpError(403, 'settlement_not_yours', 'Only participants, the creator or an admin can change the settlement');
  }

  /**
   * Attacks and holds to settle: plans of the last `days` (default 30) that were launched or done, or have a saved
   * settlement, newest first, with their members, whether a battle at the target is known and the settlement's stage:
   * open ones of the last week are checked against the hub's data (`waiting` while data is missing, else `ready`),
   * finalized ones are `delivering` until every delivery is ticked off (`settled`); with the caller's open deliveries.
   */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/settlements', async (req) => {
    const ctx = ctxOf(req);
    const t = now();
    const since = t - clampInt(req.query.days, 30, 1, 90) * 86400;
    const plans = db
      .prepare(
        `SELECT a.id, a.mission, a.g, a.s, a.p, a.planet_type, a.target_time, a.time_precision, a.status, ${DISPLAY} AS creator,
           COALESCE(a.player_id, pl.player_id) AS player_id, pr.name AS player_name, s.plan_id AS stored, s.data, s.done, s.updated_at, s.finalized_at,
           COALESCE(gb.ingame_name, ub.username) AS updated_by
         FROM attack_plans a JOIN users u ON u.id = a.user_id ${MEMBER('a')}
         LEFT JOIN planets pl ON pl.group_id = a.group_id AND pl.g = a.g AND pl.s = a.s AND pl.p = a.p
         LEFT JOIN players pr ON pr.id = COALESCE(a.player_id, pl.player_id)
         LEFT JOIN raid_settlements s ON s.plan_id = a.id
         LEFT JOIN users ub ON ub.id = s.updated_by LEFT JOIN group_members gb ON gb.group_id = a.group_id AND gb.user_id = s.updated_by
         WHERE a.group_id = ? AND a.g IS NOT NULL AND a.target_time BETWEEN ? AND ? AND (a.status IN ('launched', 'done') OR s.plan_id IS NOT NULL)
         ORDER BY a.target_time DESC`,
      )
      .all(ctx.groupId, since, t + 86400) as (PlanRow & {
      time_precision: string; creator: string; player_name: string | null; stored: number | null; data: string | null; done: string | null;
      updated_at: number | null; finalized_at: number | null; updated_by: string | null;
    })[];
    const members = db.prepare(
      `SELECT DISTINCT COALESCE(gm.ingame_name, u.username) FROM attack_plan_fleets f JOIN users u ON u.id = f.user_id
       LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = f.user_id WHERE f.plan_id = ? AND f.status <> 'withdrawn'
       UNION SELECT COALESCE(gm.ingame_name, u.username) FROM attack_plan_enemy e JOIN users u ON u.id = e.member_id
       LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = e.member_id WHERE e.plan_id = ? AND (SELECT mission FROM attack_plans WHERE id = ?) = 'hold'`,
    ).pluck();
    const battle = db.prepare(
      `SELECT EXISTS (SELECT 1 FROM battle_reports WHERE group_id = @group AND g = @g AND s = @s AND p = @p AND planet_type = @type AND time BETWEEN @from AND @to)
         OR EXISTS (SELECT 1 FROM combat_reports WHERE group_id = @group AND g = @g AND s = @s AND p = @p AND planet_type = @type AND time BETWEEN @from AND @to)`,
    ).pluck();
    const me = memberKey(ctx.user.id);
    const planRow = db.prepare('SELECT * FROM attack_plans WHERE id = ?');
    const finalized = finalizedSettlements(db, ctx, t);
    return plans.map((p) => {
      const window = p.time_precision === 'day' ? 86400 : p.time_precision === 'hour' ? 3600 : 0;
      let saved = null;
      let stage: 'open' | 'waiting' | 'ready' | 'delivering' | 'settled' = 'open';
      let missing: number | null = null;
      let deadline: number | null = null;
      /** the caller's open deliveries of a finalized settlement (`sends`: the caller sends, else receives) */
      const mine: { from: string; to: string; sends: boolean; res: { m: number; k: number; d: number } }[] = [];
      if (p.stored != null) {
        // deliveries count once the settlement is finalized (before, its numbers still follow the synced data); done:
        // ticked off by hand or delivered by the transport messages
        const f = p.finalized_at != null ? finalized.get(p.id) : undefined;
        const open = f ? f.deliveries.filter((x) => !x.done) : [];
        saved = {
          updated_at: p.updated_at, updated_by: p.updated_by, finalized_at: p.finalized_at, deliveries: f?.deliveries.length ?? 0,
          done: (f?.deliveries.length ?? 0) - open.length,
        };
        if (f) {
          stage = open.length ? 'delivering' : 'settled';
          deadline = f.deadline;
          const nameOf = (id: string) => [...f.state.participants, ...f.state.helpers].find((x) => x.id === id)?.name ?? '?';
          for (const x of open) if (x.from === me || x.to === me) mine.push({ from: nameOf(x.from), to: nameOf(x.to), sends: x.from === me, res: x.res });
        }
      }
      // open ones of the last week: what the hub's data still lacks
      if (stage === 'open' && p.target_time > t - 7 * 86400) {
        const plan = planRow.get(p.id) as SettlementPlan;
        const draft = settlementDraft(db, ctx, plan);
        missing = settlementChecks(plan.mission, draft.state, draft.sources).missing;
        stage = missing ? 'waiting' : 'ready';
        deadline = settle(draft.state).deadline;
      }
      return {
        id: p.id, mission: p.mission, g: p.g, s: p.s, p: p.p, planet_type: p.planet_type, target_time: p.target_time, status: p.status,
        creator: p.creator, player_id: p.player_id, player_name: p.player_name,
        members: members.all(ctx.groupId, p.id, ctx.groupId, p.id, p.id) as string[],
        battle: !!battle.get({
          group: ctx.groupId, g: p.g, s: p.s, p: p.p, type: p.planet_type, from: p.target_time - BATTLE_SLACK, to: p.target_time + window + BATTLE_SLACK,
        }),
        saved,
        stage,
        missing,
        deadline,
        mine,
      };
    });
  });

  /**
   * Settlement from a pasted battle report: the report is archived like a sync, then a done plan is made for it (an
   * attack of members, or a hold when members defended; `mission` decides when set), or the plan at the same target
   * around that time is taken. The client opens its settlement.
   */
  app.post<{ Params: { uni: string }; Body: { text?: unknown; mission?: unknown } }>('/api/:uni/settlements/from-report', async (req) => {
    const ctx = ctxOf(req);
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const mission = req.body?.mission === 'attack' || req.body?.mission === 'hold' ? req.body.mission : null;
    const report = parseCombatReportText(text, null);
    const time = report?.time ? localToEpoch(report.time, ctx.universe.settings.timezone) : null;
    if (!report || time == null) throw new HttpError(400, 'report_invalid', 'No battle report recognised');
    if (isCombatSimulation(report)) throw new HttpError(400, 'report_simulation', 'A battle simulation is no battle (paste it into the raid plan)');
    if (!report.target) throw new HttpError(400, 'report_no_target', 'The battle report shows no coordinates (copy it while logged in)');
    ingest(db, { groupId: ctx.groupId, userId: ctx.user.id, timezone: ctx.universe.settings.timezone }, { text, source: 'paste' });
    const res = planFromReport(db, ctx, report, time, mission);
    if (!res.ok) throw new HttpError(400, res.code, 'No member of the group fought on that side of the battle');
    if (!res.existing) events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans'], userId: ctx.user.id });
    return { id: res.id, existing: res.existing, mission: res.mission };
  });

  /**
   * The settlement as everyone sees it: the draft from the hub's data with the corrections on top (live), or the state
   * frozen when it was finalized; with what changed in the hub's data since.
   */
  function view(ctx: GroupContext, plan: SettlementPlan) {
    const stored = storedSettlement(db, ctx, plan.id);
    const draft = settlementDraft(db, ctx, plan);
    const overrides = correctionsOf(stored, draft.state);
    const live = applyOverrides(draft.state, overrides);
    const final = stored?.finalizedAt != null && stored.final ? stored.final : null;
    const state = final ?? live;
    const result = settle(state);
    // deliveries of a finalized settlement the members' transport messages show
    const deliveries = final ? (finalizedSettlements(db, ctx).get(plan.id)?.deliveries ?? []) : [];
    return {
      plan: {
        id: plan.id, mission: plan.mission, g: plan.g, s: plan.s, p: plan.p, planet_type: plan.planet_type, target_time: plan.target_time,
        status: plan.status,
      },
      can_edit: canEdit(ctx, plan),
      me: memberKey(ctx.user.id),
      draft: { state: draft.state, sources: draft.sources },
      checks: settlementChecks(plan.mission, draft.state, draft.sources),
      overrides,
      corrected: stored ? { updated_at: stored.updatedAt, updated_by: stored.updatedBy } : null,
      finalized: final ? { at: stored!.finalizedAt!, by: stored!.finalizedBy, live, changes: stateChanges(final, live) } : null,
      state,
      result,
      done: stored?.done ?? [],
      delivered: Object.fromEntries(deliveries.filter((x) => x.delivered.m + x.delivered.k + x.delivered.d > 0).map((x) => [x.key, x.delivered])),
      auto_done: deliveries.filter((x) => x.auto).map((x) => x.key),
    };
  }

  /** Cleans an edited settlement from the client into corrections of the current draft. */
  function correctionsFrom(ctx: GroupContext, plan: SettlementPlan, raw: unknown): { overrides: string; state: LootState } {
    if (raw == null || typeof raw !== 'object') throw new HttpError(400, 'settlement_invalid', 'Invalid settlement');
    const draft = settlementDraft(db, ctx, plan).state;
    const overrides = diffOverrides(draft, cleanState(raw));
    const json = JSON.stringify(overrides);
    if (json.length > 200_000) throw new HttpError(400, 'settlement_invalid', 'Settlement too large');
    return { overrides: json, state: applyOverrides(draft, overrides) };
  }
  const isFinal = (planId: number) => !!db.prepare('SELECT 1 FROM raid_settlements WHERE plan_id = ? AND finalized_at IS NOT NULL').get(planId);

  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    return view(ctx, planOf(ctx, Number(req.params.id)));
  });

  /** Saves the corrections made by hand (the client sends the edited settlement); not while it is finalized. */
  app.put<{ Params: { uni: string; id: string }; Body: { state?: unknown } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    if (isFinal(plan.id)) throw new HttpError(409, 'settlement_finalized', 'The settlement is finalized (reopen it to change it)');
    const { overrides, state } = correctionsFrom(ctx, plan, req.body?.state);
    db.prepare(
      `INSERT INTO raid_settlements (plan_id, group_id, data, overrides, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan_id) DO UPDATE SET data = excluded.data, overrides = excluded.overrides, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).run(plan.id, ctx.groupId, JSON.stringify(state), overrides, ctx.user.id, now());
    changed(ctx);
    return view(ctx, plan);
  });

  /**
   * Finalizes the settlement: its state is frozen, so the deliveries stay as they are while people send; with `state`
   * the corrections are saved first. Data synced later only shows as changes until it is reopened.
   */
  app.post<{ Params: { uni: string; id: string }; Body: { state?: unknown } | undefined }>('/api/:uni/plans/:id/settlement/finalize', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    if (isFinal(plan.id)) throw new HttpError(409, 'settlement_finalized', 'The settlement is finalized already');
    const t = now();
    const before = db.prepare('SELECT done_before FROM raid_settlements WHERE plan_id = ?').pluck().get(plan.id) as string | null | undefined;
    if (req.body?.state != null) {
      const { overrides, state } = correctionsFrom(ctx, plan, req.body.state);
      db.prepare(
        `INSERT INTO raid_settlements (plan_id, group_id, data, overrides, updated_by, updated_at, finalized_at, finalized_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (plan_id) DO UPDATE SET data = excluded.data, overrides = excluded.overrides, updated_by = excluded.updated_by,
           updated_at = excluded.updated_at, finalized_at = excluded.finalized_at, finalized_by = excluded.finalized_by`,
      ).run(plan.id, ctx.groupId, JSON.stringify(state), overrides, ctx.user.id, t, t, ctx.user.id);
    } else {
      const v = view(ctx, plan);
      db.prepare(
        `INSERT INTO raid_settlements (plan_id, group_id, data, overrides, updated_by, updated_at, finalized_at, finalized_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (plan_id) DO UPDATE SET data = excluded.data, finalized_at = excluded.finalized_at, finalized_by = excluded.finalized_by`,
      ).run(plan.id, ctx.groupId, JSON.stringify(v.state), JSON.stringify(v.overrides ?? {}), ctx.user.id, t, t, ctx.user.id);
    }
    // finalized again after reopening: deliveries done before stay done when their amounts did not change
    const frozen = cleanState(JSON.parse(db.prepare('SELECT data FROM raid_settlements WHERE plan_id = ?').pluck().get(plan.id) as string));
    const transfersNow = (frozen.transfers ?? settle(frozen).transfers).map((x) => ({ key: `${x.from}>${x.to}`, res: x.res }));
    const kept = before
      ? (JSON.parse(before) as { key: string; res: { m: number; k: number; d: number } }[])
          .filter((d) => transfersNow.some((x) => x.key === d.key && x.res.m === d.res.m && x.res.k === d.res.k && x.res.d === d.res.d))
          .map((d) => d.key)
      : [];
    db.prepare('UPDATE raid_settlements SET done = ?, done_before = NULL, migrated = 0 WHERE plan_id = ?').run(JSON.stringify(kept), plan.id);
    changed(ctx);
    return view(ctx, plan);
  });

  /** Reopens a finalized settlement: it follows the hub's data again, with its corrections. */
  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement/finalize', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    const stored = storedSettlement(db, ctx, plan.id);
    if (!stored) throw new HttpError(404, 'settlement_not_found', 'Settlement not saved');
    const overrides = correctionsOf(stored, settlementDraft(db, ctx, plan).state) ?? {};
    // what was done (by hand or by transport) with its amounts: kept when it is finalized again with the same amounts
    const doneBefore = (finalizedSettlements(db, ctx).get(plan.id)?.deliveries ?? []).filter((x) => x.done).map((x) => ({ key: x.key, res: x.res }));
    db.prepare(
      "UPDATE raid_settlements SET overrides = ?, finalized_at = NULL, finalized_by = NULL, done = '[]', done_before = ?, migrated = 0 WHERE plan_id = ?",
    ).run(JSON.stringify(overrides), JSON.stringify(doneBefore), plan.id);
    changed(ctx);
    return view(ctx, plan);
  });

  /**
   * Marks a delivery ("<from id>><to id>") of the finalized settlement as done or open: its sender or receiver, participants of the plan, its
   * creator and group admins.
   */
  app.put<{ Params: { uni: string; id: string }; Body: { key?: unknown; done?: unknown } }>('/api/:uni/plans/:id/settlement/done', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const [from, to] = key.split('>');
    if (!from || !to || key.length > 140) throw new HttpError(400, 'settlement_invalid', 'Invalid delivery');
    const me = memberKey(ctx.user.id);
    if (from !== me && to !== me) editable(ctx, plan);
    const stored = storedSettlement(db, ctx, plan.id);
    if (!stored || stored.finalizedAt == null) throw new HttpError(404, 'settlement_not_found', 'Settlement not finalized');
    const done = new Set(stored.done);
    if (req.body?.done === false) done.delete(key);
    else done.add(key);
    db.prepare('UPDATE raid_settlements SET done = ? WHERE plan_id = ?').run(JSON.stringify([...done]), plan.id);
    changed(ctx);
    return { done: [...done] };
  });

  /** Deletes the stored settlement: corrections, finalized state and deliveries marked done. */
  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    db.prepare('DELETE FROM raid_settlements WHERE plan_id = ?').run(plan.id);
    changed(ctx);
    return { ok: true };
  });
}

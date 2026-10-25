import type { FastifyInstance } from 'fastify';
import { localToEpoch } from '@pr0hub/core';
import { isCombatSimulation, parseCombatReportText } from '@pr0hub/core/combat';
import { cleanState, settle } from '@pr0hub/loot';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { ingest } from '../ingest.js';
import { planFromReport } from '../repo/reportPlan.js';
import type { PlanRow } from '../repo/plans.js';
import { memberKey, savedSettlement, settlementDraft } from '../repo/settlements.js';
import { clampInt, contextOf, DISPLAY, MEMBER, type Q } from './util.js';

/** Battles count for a plan from an hour before its time until an hour after (as in the draft). */
const BATTLE_SLACK = 3600;

type SettlementPlan = PlanRow & { time_precision: string; guests: string | null };

/** ACS loot settlement of a raid plan: prefilled from the hub's data, saved and shared with the group. */
export function settlementRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const isAdmin = (ctx: GroupContext) => ctx.role === 'admin' || ctx.user.isAdmin;
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['raid_settlements'], userId: ctx.user.id });

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
   * settlement, newest first, with their members, whether a battle at the target is known and the settlement's state.
   */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/settlements', async (req) => {
    const ctx = ctxOf(req);
    const t = now();
    const since = t - clampInt(req.query.days, 30, 1, 90) * 86400;
    const plans = db
      .prepare(
        `SELECT a.id, a.mission, a.g, a.s, a.p, a.planet_type, a.target_time, a.time_precision, a.status, ${DISPLAY} AS creator,
           COALESCE(a.player_id, pl.player_id) AS player_id, pr.name AS player_name, s.data, s.done, s.updated_at,
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
      time_precision: string; creator: string; player_name: string | null; data: string | null; done: string | null; updated_at: number | null;
      updated_by: string | null;
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
    return plans.map((p) => {
      const window = p.time_precision === 'day' ? 86400 : p.time_precision === 'hour' ? 3600 : 0;
      let saved = null;
      if (p.data != null) {
        const state = cleanState(JSON.parse(p.data));
        const deliveries = (state.transfers ?? settle(state).transfers).filter((x) => x.res.m + x.res.k + x.res.d > 0).map((x) => `${x.from}>${x.to}`);
        const done = new Set(JSON.parse(p.done ?? '[]') as string[]);
        saved = { updated_at: p.updated_at, updated_by: p.updated_by, deliveries: deliveries.length, done: deliveries.filter((k) => done.has(k)).length };
      }
      return {
        id: p.id, mission: p.mission, g: p.g, s: p.s, p: p.p, planet_type: p.planet_type, target_time: p.target_time, status: p.status,
        creator: p.creator, player_id: p.player_id, player_name: p.player_name,
        members: members.all(ctx.groupId, p.id, ctx.groupId, p.id, p.id) as string[],
        battle: !!battle.get({
          group: ctx.groupId, g: p.g, s: p.s, p: p.p, type: p.planet_type, from: p.target_time - BATTLE_SLACK, to: p.target_time + window + BATTLE_SLACK,
        }),
        saved,
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

  /** Saved settlement (null if none) and a draft from the hub's data, both with their computed result. */
  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const saved = savedSettlement(db, ctx, plan.id);
    const draft = settlementDraft(db, ctx, plan);
    return {
      plan: {
        id: plan.id, mission: plan.mission, g: plan.g, s: plan.s, p: plan.p, planet_type: plan.planet_type, target_time: plan.target_time,
        status: plan.status,
      },
      can_edit: canEdit(ctx, plan),
      saved: saved ? { ...saved, result: settle(saved.state) } : null,
      draft: { state: draft.state, sources: draft.sources, result: settle(draft.state) },
      me: memberKey(ctx.user.id),
    };
  });

  /** Saves the settlement (input of @pr0hub/loot); deliveries marked done stay. */
  app.put<{ Params: { uni: string; id: string }; Body: { state?: unknown } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    if (req.body?.state == null || typeof req.body.state !== 'object') throw new HttpError(400, 'settlement_invalid', 'Invalid settlement');
    const state = cleanState(req.body.state);
    const data = JSON.stringify(state);
    if (data.length > 200_000) throw new HttpError(400, 'settlement_invalid', 'Settlement too large');
    db.prepare(
      `INSERT INTO raid_settlements (plan_id, group_id, data, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (plan_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(plan.id, ctx.groupId, data, ctx.user.id, now());
    changed(ctx);
    const saved = savedSettlement(db, ctx, plan.id)!;
    return { ...saved, result: settle(saved.state) };
  });

  /**
   * Marks a delivery ("<from id>><to id>") as done or open: its sender or receiver, participants of the plan, its
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
    const saved = savedSettlement(db, ctx, plan.id);
    if (!saved) throw new HttpError(404, 'settlement_not_found', 'Settlement not saved');
    const done = new Set(saved.done);
    if (req.body?.done === false) done.delete(key);
    else done.add(key);
    db.prepare('UPDATE raid_settlements SET done = ? WHERE plan_id = ?').run(JSON.stringify([...done]), plan.id);
    changed(ctx);
    return { done: [...done] };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    editable(ctx, plan);
    db.prepare('DELETE FROM raid_settlements WHERE plan_id = ?').run(plan.id);
    changed(ctx);
    return { ok: true };
  });
}

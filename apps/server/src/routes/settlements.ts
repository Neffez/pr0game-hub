import type { FastifyInstance } from 'fastify';
import { cleanState, settle } from '@pr0hub/loot';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import type { PlanRow } from '../repo/plans.js';
import { memberKey, savedSettlement, settlementDraft } from '../repo/settlements.js';
import { contextOf } from './util.js';

type SettlementPlan = PlanRow & { time_precision: string; guests: string | null };

/** ACS loot settlement of a raid plan: prefilled from the hub's data, saved and shared with the group. */
export function settlementRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const isAdmin = (ctx: GroupContext) => ctx.role === 'admin' || ctx.user.isAdmin;
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['raid_settlements'], userId: ctx.user.id });

  function planOf(ctx: GroupContext, id: number) {
    const plan = db.prepare("SELECT * FROM attack_plans WHERE id = ? AND group_id = ? AND mission = 'attack'").get(id, ctx.groupId) as SettlementPlan | undefined;
    if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found');
    return plan;
  }
  /** Participants of the plan, its creator and group admins change the settlement. */
  const canEdit = (ctx: GroupContext, plan: SettlementPlan) =>
    plan.user_id === ctx.user.id ||
    isAdmin(ctx) ||
    !!db.prepare("SELECT 1 FROM attack_plan_fleets WHERE plan_id = ? AND user_id = ? AND status <> 'withdrawn'").get(plan.id, ctx.user.id);
  function editable(ctx: GroupContext, plan: SettlementPlan) {
    if (!canEdit(ctx, plan)) throw new HttpError(403, 'settlement_not_yours', 'Only participants, the creator or an admin can change the settlement');
  }

  /** Saved settlement (null if none) and a draft from the hub's data, both with their computed result. */
  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/settlement', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const saved = savedSettlement(db, ctx, plan.id);
    const draft = settlementDraft(db, ctx, plan);
    return {
      plan: { id: plan.id, g: plan.g, s: plan.s, p: plan.p, planet_type: plan.planet_type, target_time: plan.target_time, status: plan.status },
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

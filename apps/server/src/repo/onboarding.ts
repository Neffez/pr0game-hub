import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';

/**
 * Onboarding of new members (backlog D-4): the first syncs a member should do, in this order. A step is done once the
 * member synced such a page (`onboarding_steps`, written by the ingest, see `recordOnboarding`).
 */
export const ONBOARDING_STEPS = ['empire', 'stats', 'overview', 'research', 'galaxy', 'messages', 'buildings'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Page types of the ingest and the step they count for. */
const STEP_OF: Record<string, OnboardingStep> = {
  empire: 'empire',
  stats: 'stats',
  overview: 'overview',
  fleets: 'overview',
  research: 'research',
  galaxy: 'galaxy',
  messages: 'messages',
  combatReport: 'messages',
  buildings: 'buildings',
};

/** Marks the step of a synced page as done for the member who synced it (first time only). */
export function recordOnboarding(db: DB, groupId: number, userId: number, pageType: string, time: number) {
  const step = STEP_OF[pageType];
  if (!step) return;
  db.prepare('INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time) VALUES (?, ?, ?, ?)').run(groupId, userId, step, time);
}

/** Done steps of the group's members: user id -> step -> time. */
export function onboardingOf(db: DB, groupId: number, userId?: number): Map<number, Partial<Record<OnboardingStep, number>>> {
  const rows = db
    .prepare(`SELECT user_id, step, time FROM onboarding_steps WHERE group_id = ?${userId != null ? ' AND user_id = ?' : ''}`)
    .all(...(userId != null ? [groupId, userId] : [groupId])) as { user_id: number; step: OnboardingStep; time: number }[];
  const out = new Map<number, Partial<Record<OnboardingStep, number>>>();
  for (const r of rows) out.set(r.user_id, { ...out.get(r.user_id), [r.step]: r.time });
  return out;
}

/** The viewer's checklist: every step with the time it was done (null while open). */
export function myOnboarding(db: DB, ctx: GroupContext) {
  const done = onboardingOf(db, ctx.groupId, ctx.user.id).get(ctx.user.id) ?? {};
  const steps = ONBOARDING_STEPS.map((key) => ({ key, time: done[key] ?? null }));
  return { steps, done: steps.filter((s) => s.time != null).length, total: steps.length };
}

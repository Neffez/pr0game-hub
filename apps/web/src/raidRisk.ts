import { ref } from 'vue';
import type { RiskBody } from './apiTypes';

export type { RiskBody };

/**
 * The newest raid risk the member calculated (RaidRisk.vue), kept while the hub tab is open so the empire's planet
 * table can mark the bodies at risk without running the battles again. `scope`: universe and alliance it belongs to.
 */
export const lastRisk = ref<{ scope: string; bodies: RiskBody[] } | null>(null);

/** none: no known attacker, low: no attack pays off, medium: one pays off but mostly loses, high: one pays off and mostly wins. */
export const riskLevel = (b: RiskBody) => (!b.worst ? 'none' : b.worst.profit <= 0 ? 'low' : b.worst.wins >= 0.5 ? 'high' : 'medium');

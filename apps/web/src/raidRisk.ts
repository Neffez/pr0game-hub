import { ref } from 'vue';

/**
 * The newest raid risk the member calculated (RaidRisk.vue), kept while the hub tab is open so the empire's planet
 * table can mark the bodies at risk without running the battles again. `scope`: universe and alliance it belongs to.
 */
export interface RiskBody {
  key: string;
  name: string;
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon';
  threats: number;
  skipped: number;
  worst: { key: string; player: { id: number | null; name: string }; heavy: boolean; profit: number; wins: number } | null;
}

export const lastRisk = ref<{ scope: string; bodies: RiskBody[] } | null>(null);

/** none: no known attacker, low: no attack pays off, medium: one pays off but mostly loses, high: one pays off and mostly wins. */
export const riskLevel = (b: RiskBody) => (!b.worst ? 'none' : b.worst.profit <= 0 ? 'low' : b.worst.wins >= 0.5 ? 'high' : 'medium');

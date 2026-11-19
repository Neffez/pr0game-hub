/**
 * Names for the API answers the web app reads, from the types generated out of `apps/server/openapi.yaml`
 * (`@pr0hub/api-types`; the server tests check every answer against that spec). Add a name here instead of writing
 * the shape by hand; `ApiResponse<'/api/{uni}/…'>` gives the answer of any operation.
 */
import type { ApiResponse, Schema } from '@pr0hub/api-types';
import type { BuildOrder } from '@pr0hub/planner';

export type { ApiResponse, Schema } from '@pr0hub/api-types';

export type Raids = Schema<'Raids'>;
export type RaidReport = Schema<'RaidReport'>;
export type RaidsPerUser = Raids['perUser'][number];
export type RecycleReport = Schema<'RecycleReport'>;
export type MissileImpact = Schema<'MissileImpact'>;

export type Expeditions = Schema<'Expeditions'>;
export type Expedition = Schema<'Expedition'>;
export type ExpeditionsPerUser = Expeditions['perUser'][number];

export type Deck = Schema<'Deck'>;

export type PlayerDetails = Schema<'PlayerDetails'>;
export type PlayerScore = PlayerDetails['history'][number];
export type PlayerPlanet = PlayerDetails['planets'][number];

export type AllianceMember = Schema<'AllianceMember'>;

export type Threat = Schema<'Threat'>;
export type Threats = ApiResponse<'/api/{uni}/threats'>;
export type DefenseRisk = ApiResponse<'/api/{uni}/defense-risk'>;

export type Colonize = ApiResponse<'/api/{uni}/colonize'>;
export type ColonySystem = Colonize['systems'][number];
export type RiskBody = DefenseRisk['planets'][number];

/**
 * The stored build order with its revision. `order` takes the planner's type: the spec's step and base maps are looser
 * than what the planner validates and simulates.
 */
export type StoredBuildOrder = Omit<NonNullable<Schema<'StoredBuildOrder'>>, 'order'> & { order: BuildOrder };
/** The answer of the build order's GET and writes (`buildOrder` with the planner's order type). */
export type BuildOrderAnswer = Omit<Schema<'BuildOrderAnswer'>, 'buildOrder'> & { buildOrder: StoredBuildOrder | null };

export type SyncHints = ApiResponse<'/api/{uni}/sync-hints'>;
export type SyncHint = Schema<'SyncHint'>;
export type OwnSyncTimes = SyncHints['times'];
export type IngestSummary = Schema<'IngestSummary'>;
export type Contributors = ApiResponse<'/api/{uni}/contributors'>;
export type Stats = ApiResponse<'/api/{uni}/stats'>;
export type Freshness = Schema<'Freshness'>;
export type AllianceHealth = ApiResponse<'/api/{uni}/alliance-health'>;
export type HealthMember = AllianceHealth['members'][number];
export type Goals = ApiResponse<'/api/{uni}/goals'>;
export type Goal = Goals['goals'][number];
export type GoalSettings = Schema<'GoalSettings'>;
export type Onboarding = ApiResponse<'/api/{uni}/onboarding'>;
export type Achievements = ApiResponse<'/api/{uni}/achievements'>;
export type MemberAchievements = Achievements['members'][number];
export type Badge = MemberAchievements['badges'][number];
export type Ranking = ApiResponse<'/api/{uni}/ranking'>;
export type Recap = Schema<'Recap'>;
export type RecapText = ApiResponse<'/api/{uni}/recap/text'>;

export type FarmTargets = ApiResponse<'/api/{uni}/farm'>;
export type FarmTarget = Schema<'FarmTarget'>;
export type FarmSimulation = Schema<'FarmSimulation'>;

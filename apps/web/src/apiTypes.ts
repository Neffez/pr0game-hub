/**
 * Names for the API answers the web app reads, from the types generated out of `apps/server/openapi.yaml`
 * (`@pr0hub/api-types`; the server tests check every answer against that spec). Add a name here instead of writing
 * the shape by hand; `ApiResponse<'/api/{uni}/…'>` gives the answer of any operation.
 */
import type { ApiResponse, Schema } from '@pr0hub/api-types';

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

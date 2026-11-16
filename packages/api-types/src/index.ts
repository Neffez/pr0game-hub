/**
 * Types of the hub's HTTP API, generated from `apps/server/openapi.yaml` (`src/openapi.ts`). The server tests check
 * every answer against that spec (`apps/server/test/contract.ts`), so these types describe what the server sends.
 */
import type { components, paths } from './openapi.js';

export type { components, operations, paths } from './openapi.js';

/** A named schema of the spec: `Schema<'Raids'>`. */
export type Schema<N extends keyof components['schemas']> = components['schemas'][N];

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : never;
type SuccessOf<O> = O extends { responses: infer R } ? JsonOf<R[Extract<keyof R, 200 | 201>]> : never;

/** The JSON answer of an operation on success: `ApiResponse<'/api/{uni}/raids'>`, `ApiResponse<'/api/{uni}/plans', 'post'>`. */
export type ApiResponse<P extends keyof paths, M extends Method = 'get'> = SuccessOf<NonNullable<paths[P][M]>>;

/**
 * Contract check of the test suites: every JSON answer with a 2xx status that a test receives is validated against the
 * response schema of its operation in `openapi.yaml` (JSON Schema 2020-12, OpenAPI 3.1). `contractSetup.ts` hooks it
 * into every app the tests build; a violation fails the test file. Extra properties are allowed (the spec may
 * describe a subset), missing required ones, wrong types and undocumented 2xx statuses are not.
 */
import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

type Operation = { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
const spec = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as { paths: Record<string, Record<string, Operation>> };

const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
// OpenAPI 3.0's `nullable`, still used in places, is a keyword Ajv knows
ajv.addSchema(spec, 'openapi');

const pointer = (...parts: string[]) => parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
const validators = new Map<string, ValidateFunction | null>();

/** The validator of an operation's answer, null when the spec gives no JSON schema for it; undefined: undocumented status. */
function validatorOf(path: string, method: string, status: number): ValidateFunction | null | undefined {
  const op = spec.paths[path]?.[method];
  if (!op) return null; // undocumented paths are the path test's job
  const code = op.responses?.[String(status)] ? String(status) : op.responses?.[`${String(status)[0]}XX`] ? `${String(status)[0]}XX` : op.responses?.default ? 'default' : null;
  if (!code) return undefined;
  const key = `${method} ${path} ${code}`;
  if (!validators.has(key)) {
    const schema = op.responses![code]!.content?.['application/json']?.schema;
    validators.set(key, schema ? ajv.compile({ $ref: `openapi#/${pointer('paths', path, method, 'responses', code, 'content', 'application/json', 'schema')}` }) : null);
  }
  return validators.get(key)!;
}

/** Operations (`GET /api/{uni}/raids`) with a 2xx answer checked in this test file. */
export const exercised = new Set<string>();

export interface Violation {
  operation: string;
  status: number;
  errors: string[];
}

/** Checks one answer; `route` is Fastify's route url without the base path (`/api/:uni/raids`). */
export function checkResponse(method: string, route: string, status: number, body: unknown): Violation | null {
  if (status < 200 || status >= 300) return null;
  const path = route.replace(/:(\w+)/g, '{$1}');
  const m = method.toLowerCase();
  const validate = validatorOf(path, m, status);
  const operation = `${method} ${path}`;
  if (spec.paths[path]?.[m]) exercised.add(operation);
  if (validate === undefined) return { operation, status, errors: [`status ${status} is not documented`] };
  if (!validate || validate(body)) return null;
  return {
    operation,
    status,
    errors: (validate.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}`),
  };
}

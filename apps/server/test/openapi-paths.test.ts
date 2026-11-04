import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

process.env.WEB_DIR = '/nonexistent';

const { buildApp, listApiRoutes } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const YAML = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.yaml');

function yamlOps(): { method: string; path: string }[] {
  const doc = parse(readFileSync(YAML, 'utf8')) as { paths?: Record<string, Record<string, unknown>> };
  const out: { method: string; path: string }[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      if (METHODS.has(method)) out.push({ method: method.toUpperCase(), path });
    }
  }
  return out;
}

const keyOf = (o: { method: string; path: string }) => `${o.method} ${o.path}`;

describe('OpenAPI paths', () => {
  it('match the registered Fastify /api routes', async () => {
    const db = openDb(':memory:');
    const app = buildApp(db, { logger: false });
    await app.ready();
    const fastify = listApiRoutes(app);
    await app.close();

    const spec = yamlOps();
    const have = new Set(spec.map(keyOf));
    const impl = new Set(fastify.map(keyOf));
    const missingInYaml = [...impl].filter((k) => !have.has(k)).sort();
    const extraInYaml = [...have].filter((k) => !impl.has(k)).sort();
    expect({ missingInYaml, extraInYaml }, 'Fastify /api routes and openapi.yaml paths drifted').toEqual({
      missingInYaml: [],
      extraInYaml: [],
    });
  });

  it('gives every operation a unique operationId', () => {
    const doc = parse(readFileSync(YAML, 'utf8')) as { paths?: Record<string, Record<string, { operationId?: string }>> };
    const ids: string[] = [];
    for (const item of Object.values(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item ?? {})) {
        if (METHODS.has(method) && op.operationId) ids.push(op.operationId);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const OPENAPI_YAML = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'openapi.yaml');

let cachedJson: object | null = null;
let cachedYaml: string | null = null;

function yamlText() {
  if (cachedYaml == null) cachedYaml = readFileSync(OPENAPI_YAML, 'utf8');
  return cachedYaml;
}

function jsonDoc() {
  if (cachedJson == null) cachedJson = parse(yamlText()) as object;
  return cachedJson;
}

export function openapiRoutes(app: FastifyInstance) {
  app.get('/api/openapi.yaml', async (_req, reply) => reply.type('text/yaml; charset=utf-8').send(yamlText()));
  app.get('/api/openapi.json', async () => jsonDoc());
}

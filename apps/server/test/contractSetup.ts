import { afterAll, expect, vi } from 'vitest';
import { checkResponse, exercised, type Violation } from './contract.js';

/** Every app a test builds validates its JSON answers against openapi.yaml (see contract.ts). */
const violations: Violation[] = [];
const seen = new Set<string>();

vi.mock('../src/app.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/app.js')>();
  const { config } = await import('../src/config.js');
  return {
    ...mod,
    buildApp: ((...args: Parameters<typeof mod.buildApp>) => {
      const app = mod.buildApp(...args);
      app.addHook('onSend', async (req, reply, payload) => {
        const url = req.routeOptions.url;
        if (!url?.startsWith(`${config.basePath}/api/`) || typeof payload !== 'string') return payload;
        if (!String(reply.getHeader('content-type') ?? '').includes('json')) return payload;
        let body: unknown;
        try {
          body = JSON.parse(payload);
        } catch {
          return payload;
        }
        const v = checkResponse(req.method, url.slice(config.basePath.length), reply.statusCode, body);
        const key = v && `${v.operation} ${v.status} ${v.errors.join('|')}`;
        if (v && !seen.has(key!)) {
          seen.add(key!);
          violations.push(v);
        }
        return payload;
      });
      return app;
    }) as typeof mod.buildApp,
  };
});

afterAll(() => {
  if (process.env.CONTRACT_REPORT) {
    for (const v of violations) console.log(`CONTRACT ${JSON.stringify(v)}`);
    for (const op of exercised) console.log(`CONTRACT_OP ${op}`);
  }
  expect(violations, 'answers that do not match openapi.yaml').toEqual([]);
});

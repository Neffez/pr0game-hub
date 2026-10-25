import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const webDir = mkdtempSync(join(tmpdir(), 'hub-web-'));
mkdirSync(join(webDir, 'assets'));
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>hub</title>');
writeFileSync(join(webDir, 'assets', 'app-1234.js'), 'console.log(1)');
process.env.WEB_DIR = webDir;

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');

const app = buildApp(openDb(':memory:'), { logger: false });
beforeAll(() => app.ready());

describe('static web app', () => {
  it('caches hashed assets forever and revalidates the rest', async () => {
    const asset = await app.inject({ method: 'GET', url: '/hub/assets/app-1234.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const index = await app.inject({ method: 'GET', url: '/hub/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['cache-control']).toBe('no-cache');
  });

  it('serves index.html for app routes and 404 for missing files', async () => {
    const route = await app.inject({ method: 'GET', url: '/hub/u8/overview' });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('<title>hub</title>');
    expect((await app.inject({ method: 'GET', url: '/hub/assets/old-9999.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/hub' })).statusCode).toBe(302);
  });

  it('does not serve files outside the web directory', async () => {
    for (const url of ['/hub/../package.json', '/hub/%2e%2e/package.json', '/hub/assets/..%2f..%2fpackage.json']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body).not.toContain('"name"');
    }
  });
});

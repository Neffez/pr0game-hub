import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import de from '../src/locales/de';
import en from '../src/locales/en';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : files(path);
    return /\.(vue|ts)$/.test(e.name) ? [path] : [];
  });
}

/** Static keys of `t('…')`, `te('…')` and `i18n.global.t('…')` calls; keys built at runtime are not checked. */
function staticKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const call = /(?<![\w.$])(?:i18n\.global\.)?te?\(\s*'([A-Za-z][\w-]*(?:\.[\w-]+)+)'/g;
  for (const file of files(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(call)) keys.set(m[1]!, file.slice(SRC.length + 1));
  }
  return keys;
}

function has(messages: unknown, key: string): boolean {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('locale keys', () => {
  const keys = staticKeys();

  it('finds the static keys of the app', () => {
    expect(keys.size).toBeGreaterThan(1000);
    expect(keys.has('admin.samples.title')).toBe(true);
  });

  it.each([
    ['de', de],
    ['en', en],
  ])('has a text for every static t() key in %s', (_lang, messages) => {
    const missing = [...keys].filter(([key]) => !has(messages, key)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});

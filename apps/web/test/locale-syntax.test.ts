import { describe, expect, it } from 'vitest';
import { i18n } from '../src/i18n';
import de from '../src/locales/de';
import en from '../src/locales/en';

/** Every text as `[key, text]`; nested objects become dotted keys (keys with a dot of their own cannot be looked up and are skipped). */
function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => (k.includes('.') ? [] : leaves(v, prefix ? `${prefix}.${k}` : k)));
}

// A text vue-i18n cannot compile (e.g. a bare @, which starts a linked message) throws when it is rendered and takes
// the whole component down with it, so every text must compile.
describe.each([['de', de], ['en', en]] as const)('locale %s', (lang, messages) => {
  it('compiles every text', () => {
    const broken: string[] = [];
    for (const [key] of leaves(messages)) {
      try {
        i18n.global.t(key, {}, { locale: lang });
      } catch (e) {
        broken.push(`${key}: ${(e as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

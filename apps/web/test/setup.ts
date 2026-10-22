// The web app runs in the browser; the tests run in Node. The modules only touch these at import time
// (i18n: page language, stored settings), so a minimal stand-in is enough.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
// Vue's DOM runtime creates a template element at import time
globalThis.document = { documentElement: { lang: '' }, createElement: () => ({}) } as unknown as Document;

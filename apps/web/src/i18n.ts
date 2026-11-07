import { createI18n } from 'vue-i18n';
import type de from './locales/de';

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = 'hub.lang';

const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

/** Language before login: last choice in this browser, otherwise the browser language. */
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

type Messages = typeof de;

/**
 * The texts of each language are a chunk of their own, loaded when the language is used (`loadLocale` before the
 * app mounts, `setLocale` on a switch): a visitor downloads one language, not both.
 */
const LOADERS: Record<Lang, () => Promise<{ default: Messages }>> = {
  de: () => import('./locales/de'),
  en: () => import('./locales/en'),
};

export const i18n = createI18n<[Messages], Lang, false>({
  legacy: false,
  locale: initialLang(),
  // en has every key (typed against de): the fallback is never needed, so de is not loaded for it
  fallbackLocale: 'de',
  messages: {} as Record<Lang, Messages>,
});

const loaded = new Set<Lang>();
const loading = new Map<Lang, Promise<void>>();

/** Loads the texts of a language once (an import that failed is tried again on the next call). */
export function loadLocale(lang: Lang): Promise<void> {
  if (loaded.has(lang)) return Promise.resolve();
  let p = loading.get(lang);
  if (!p) {
    p = LOADERS[lang]()
      .then((m) => {
        i18n.global.setLocaleMessage(lang, m.default);
        loaded.add(lang);
      })
      .finally(() => loading.delete(lang));
    loading.set(lang, p);
  }
  return p;
}

/** Locale for Intl formatting (pr0game EN uses 1,234.56, DE 1.234,56). */
export const INTL_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

export const currentLang = (): Lang => i18n.global.locale.value;
export const intlLocale = () => INTL_LOCALE[currentLang()];
export const t = i18n.global.t;

/** The language chosen last: a slower load of an earlier choice does not switch back. */
let wanted: Lang = initialLang();

/** Switches the language; right away when its texts are loaded, else once they are. */
export function setLocale(lang: unknown): Promise<void> {
  if (!isLang(lang)) return Promise.resolve();
  wanted = lang;
  if (loaded.has(lang)) {
    apply(lang);
    return Promise.resolve();
  }
  return loadLocale(lang).then(() => {
    if (wanted === lang) apply(lang);
  });
}

function apply(lang: Lang) {
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

document.documentElement.lang = currentLang();

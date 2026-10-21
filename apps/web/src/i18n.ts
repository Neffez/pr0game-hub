import { createI18n } from 'vue-i18n';
import de from './locales/de';
import en from './locales/en';

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

export const i18n = createI18n<[typeof de], Lang, false>({
  legacy: false,
  locale: initialLang(),
  fallbackLocale: 'de',
  messages: { de, en },
});

/** Locale for Intl formatting (pr0game EN uses 1,234.56, DE 1.234,56). */
export const INTL_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

export const currentLang = (): Lang => i18n.global.locale.value;
export const intlLocale = () => INTL_LOCALE[currentLang()];
export const t = i18n.global.t;

export function setLocale(lang: unknown) {
  if (!isLang(lang)) return;
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

document.documentElement.lang = currentLang();

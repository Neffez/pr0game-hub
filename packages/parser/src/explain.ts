/**
 * Why a pasted page gave no data (backlog E-4), in a code the hub turns into plain words. The game marks every page
 * in the HTML (`<body id="{page}">`, `<html lang="…">`, see the game's `main.header.tpl`); copied text has no such
 * marks, so its page is guessed from the titles of the game's menu (the menu is on every page: a title counts only
 * when it appears more than once, as menu entry and page heading).
 */
export type ExplainCode =
  /** almost nothing pasted */
  | 'too_short'
  /** no sign of a game page */
  | 'not_game'
  /** a game page in a language the hub does not read */
  | 'language'
  /** a game page the hub does not read (`page`) */
  | 'unsupported_page'
  /** a page the hub reads, but nothing was found: a parser gap, worth a sample */
  | 'parse_failed'
  /** a game page, but which one is unknown */
  | 'unknown_game_page';

export interface Explanation {
  code: ExplainCode;
  /** the game's page id (`page=` of the URL), when known */
  page?: string;
  /** language of the page (`<html lang>`) when it is not one the hub reads */
  lang?: string;
}

/** Game pages the hub reads (`page=` ids), see `parsePage`. */
export const SUPPORTED_PAGES = new Set([
  'overview', 'empire', 'imperium', 'galaxy', 'messages', 'statistics', 'buildings', 'research', 'marketplace', 'battlehall', 'raport',
  'fleettable', 'phalanx',
]);

/** Pages the hub does not read with the titles of their menu entries (German, English) in the game's language files. */
const UNSUPPORTED: { page: string; titles: string[] }[] = [
  { page: 'shipyard', titles: ['Schiffswerft', 'Hangar'] },
  { page: 'defense', titles: ['Verteidigung', 'Defenses'] },
  { page: 'resources', titles: ['Rohstoffe', 'Resources'] },
  { page: 'techtree', titles: ['Technologie', 'Technologies'] },
  { page: 'alliance', titles: ['Allianz', 'Alliance'] },
  { page: 'buddylist', titles: ['Buddylist', 'Friends'] },
  { page: 'records', titles: ['Rekorde', 'Records'] },
  { page: 'notes', titles: ['Notizen', 'Notes'] },
  { page: 'settings', titles: ['Einstellungen', 'Options'] },
  { page: 'search', titles: ['Suche', 'Search'] },
  { page: 'fleetdealer', titles: ['Schrotthändler', 'Merchant of Fleets'] },
  { page: 'repairdock', titles: ['Reparaturdock', 'Repair dock'] },
  { page: 'battlesimulator', titles: ['Kampfsimulator', 'Simulator'] },
  { page: 'banlist', titles: ['Pranger', 'Banned'] },
  { page: 'playercard', titles: ['Spielerinformationen', 'Player Profile'] },
];
/** Menu titles of the game (German and English): two of them mark a page of the game. */
const MENU = [
  'Übersicht', 'Overview', 'Imperium', 'Empire', 'Galaxie', 'Galaxy', 'Nachrichten', 'Messages', 'Flotte', 'Fleet', 'Forschung', 'Research',
  'Gebäude', 'Buildings', 'Statistik', 'Statistics', 'Marktplatz', 'Battle Hall', ...UNSUPPORTED.flatMap((u) => u.titles),
];
const LANGS = new Set(['de', 'en']);
/** Menu titles in the game's other languages (galaxy, messages, research, buildings, from the INGAME.yaml of each language). */
const OTHER_LANGS: Record<string, string[]> = {
  es: ['Galaxia', 'Mensajes', 'Investigacion', 'Edificios'],
  fr: ['Recherche', 'Bâtiments'],
  pl: ['Galaktyka', 'Wiadomości', 'Badania', 'Budynki'],
  pt: ['Galáxia', 'Mensagens', 'Pesquisas', 'Edificios'],
  ru: ['Галактика', 'Сообщения', 'Исследования', 'Постройки'],
  tr: ['Galaksi', 'Mesajlar', 'Arastirma', 'Binalar'],
};

const count = (text: string, word: string) => text.split(word).length - 1;

/** Why `parsePage` found nothing in this page; `html` and the plain text as the parser saw them. */
export function explainNoData(input: { html?: string | null; text: string; url?: string | null }): Explanation {
  const text = input.text.trim();
  const html = input.html ?? '';
  const body = html.match(/<body[^>]*\bid\s*=\s*["']?([A-Za-z]+)/i)?.[1] ?? null;
  let urlPage: string | null = null;
  try {
    urlPage = input.url ? new URL(input.url, 'https://pr0game.com/').searchParams.get('page') : null;
  } catch {
    /* no URL */
  }
  const page = (urlPage ?? body)?.toLowerCase() ?? null;
  const lang = html.match(/<html[^>]*\blang\s*=\s*["']?([a-z]{2})/i)?.[1]?.toLowerCase() ?? null;
  if (lang && !LANGS.has(lang) && (page || body)) return { code: 'language', lang, ...(page ? { page } : {}) };
  if (page) return SUPPORTED_PAGES.has(page) ? { code: 'parse_failed', page } : { code: 'unsupported_page', page };
  if (text.length < 40) return { code: 'too_short' };
  const menu = MENU.filter((w) => text.includes(w)).length;
  const other = Object.entries(OTHER_LANGS).find(([, words]) => words.filter((w) => text.includes(w)).length >= 2)?.[0];
  const hits = (words: string[]) => words.filter((w) => text.includes(w)).length;
  // titles only German or only English use (French shares Galaxie, Messages, Empire)
  if (other && hits(['Übersicht', 'Nachrichten', 'Forschung', 'Gebäude']) < 2 && hits(['Overview', 'Research', 'Buildings', 'Statistics']) < 2) {
    return { code: 'language', lang: other };
  }
  if (menu < 2) return { code: 'not_game' };
  for (const u of UNSUPPORTED) if (u.titles.some((w) => count(text, w) >= 2)) return { code: 'unsupported_page', page: u.page };
  return { code: 'unknown_game_page' };
}

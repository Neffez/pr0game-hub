import type { PushLang } from './push.js';
import type { BadgeKey, PointKind } from './repo/achievements.js';
import type { HighlightKey, Recap, RecapCompare } from './repo/recap.js';

/**
 * The recap as a message: title and Markdown body for the Discord channel (an embed) and for copying by hand
 * (`recapMarkdown`). Names appear only for good news (highlights, badges); what is open is told as counts.
 */

const de = {
  title: 'Recap {from} – {to}',
  titleWeek: 'Recap KW {week} · {from} – {to}',
  titleStart: 'Recap seit Start · {from} – {to}',
  syncs: 'Syncs',
  active: 'aktiv',
  points: 'Punkte',
  newBadges: 'neue Abzeichen',
  newBadge: 'neues Abzeichen',
  highlights: 'Highlights',
  /** singular, plural */
  highlight: {
    top: ['Meiste Punkte: {name} ({n})', 'Meiste Punkte: {name} ({n})'],
    riser: ['Größter Sprung: {name} (+{n} Punkt)', 'Größter Sprung: {name} (+{n} Punkte)'],
    cartographer: ['Kartograph: {name} ({n} System)', 'Kartograph: {name} ({n} Systeme)'],
    scout: ['Späher: {name} ({n} Spionagebericht)', 'Späher: {name} ({n} Spionageberichte)'],
    streak: ['Längste Serie: {name} ({n} Tag)', 'Längste Serie: {name} ({n} Tage)'],
    badges: ['Abzeichen-Jäger: {name} ({n} Stufe)', 'Abzeichen-Jäger: {name} ({n} Stufen)'],
  } satisfies Record<HighlightKey, [string, string]>,
  synced: 'Am meisten eingefügt',
  badges: 'Neue Abzeichen',
  moreBadges: '… und {n} weitere',
  open: 'Da geht noch was',
  galaxy: 'Galaxie: {pct} der Systeme jünger als {days} Tage, am ältesten G{g} ({gpct})',
  idle: '{n} von {of} Mitgliedern ohne Punkte – jeder Sync zählt!',
  noEmpire: '{n} Mitglieder ohne Imperium-Sync',
  goals: 'Allianz-Ziele: {n} von {of} erreicht',
  quiet: 'Noch keine Syncs in diesem Zeitraum.',
  more: 'Alles im Hub',
  badge: {
    imperator: 'Imperator', cartographer: 'Kartograph', scout: 'Späher', fleeter: 'Fleeter', expeditioner: 'Expeditioner', trader: 'Händler', socializer: 'Socializer',
    chronicler: 'Chronist', fresh: 'Immer frisch', streak: 'Serie', raider: 'Raider', collector: 'Geldeintreiber', forist: 'Forist', miner: 'Miner', livingLegend: 'Lebende Legende',
  } satisfies Record<BadgeKey, string>,
  kind: {
    galaxy: 'Galaxie', spy: 'Spionageberichte', empire: 'Imperium', overview: 'Übersicht/Flotten', hostile: 'Fremdspionage', battle: 'Kampfberichte',
    buildings: 'Gebäudeseiten', research: 'Forschung', market: 'Marktplatz', expedition: 'Expeditionen', messages: 'Ingame-Nachrichten', stats: 'Statistik', statsFirst: 'Statistik als Erstes', universe: 'universe.json',
  } satisfies Record<PointKind, string>,
};

const en: typeof de = {
  title: 'Recap {from} – {to}',
  titleWeek: 'Recap week {week} · {from} – {to}',
  titleStart: 'Recap since the start · {from} – {to}',
  syncs: 'syncs',
  active: 'active',
  points: 'points',
  newBadges: 'new badges',
  newBadge: 'new badge',
  highlights: 'Highlights',
  highlight: {
    top: ['Most points: {name} ({n})', 'Most points: {name} ({n})'],
    riser: ['Biggest jump: {name} (+{n} point)', 'Biggest jump: {name} (+{n} points)'],
    cartographer: ['Cartographer: {name} ({n} system)', 'Cartographer: {name} ({n} systems)'],
    scout: ['Scout: {name} ({n} spy report)', 'Scout: {name} ({n} spy reports)'],
    streak: ['Longest streak: {name} ({n} day)', 'Longest streak: {name} ({n} days)'],
    badges: ['Badge hunter: {name} ({n} level)', 'Badge hunter: {name} ({n} levels)'],
  },
  synced: 'Synced the most',
  badges: 'New badges',
  moreBadges: '… and {n} more',
  open: 'Room to grow',
  galaxy: 'Galaxy: {pct} of the systems younger than {days} days, oldest G{g} ({gpct})',
  idle: '{n} of {of} members without points – every sync counts!',
  noEmpire: '{n} members without an empire sync',
  goals: 'Alliance goals: {n} of {of} reached',
  quiet: 'No syncs in this period yet.',
  more: 'Everything in the hub',
  badge: {
    imperator: 'Imperator', cartographer: 'Cartographer', scout: 'Scout', fleeter: 'Fleeter', expeditioner: 'Expeditioner', trader: 'Trader', socializer: 'Socializer',
    chronicler: 'Chronicler', fresh: 'Always fresh', streak: 'Streak', raider: 'Raider', collector: 'Debt collector', forist: 'Forist', miner: 'Miner', livingLegend: 'Living legend',
  },
  kind: {
    galaxy: 'Galaxy', spy: 'Spy reports', empire: 'Empire', overview: 'Overview/fleets', hostile: 'Foreign espionage', battle: 'Battle reports',
    buildings: 'Buildings pages', research: 'Research', market: 'Marketplace', expedition: 'Expeditions', messages: 'In-game messages', stats: 'Statistics', statsFirst: 'Statistics first', universe: 'universe.json',
  },
};

const TEXT: Record<PushLang, typeof de> = { de, en };
/** Badges listed by name; the rest are counted. */
const MAX_BADGES = 12;

const fill = (s: string, values: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** ISO week number of a day (YYYY-MM-DD). */
export function isoWeek(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

export function recapMessage(recap: Recap, lang: PushLang): { title: string; body: string } {
  const t = TEXT[lang];
  const num = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'de-DE');
  const n = (x: number) => num.format(x);
  const pct = (a: number, b: number) => {
    const p = b ? Math.round((100 * a) / b) : 0;
    return !p && a > 0 ? '< 1 %' : `${p} %`;
  };
  const date = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    return lang === 'en' ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
  };
  const change = (c: RecapCompare) => {
    if (!c.before || c.now === c.before) return '';
    const p = Math.round((100 * (c.now - c.before)) / c.before);
    return p ? ` (${p > 0 ? '▲' : '▼'} ${Math.abs(p)} %)` : '';
  };
  const title = fill(recap.period === 'days30' ? t.title : recap.period === 'start' ? t.titleStart : t.titleWeek, { week: isoWeek(recap.from), from: date(recap.from), to: date(recap.to) });

  const lines: string[] = [];
  lines.push(
    [
      `**${n(recap.syncs.now)}** ${t.syncs}${change(recap.syncs)}`,
      `**${recap.active.now}/${recap.members}** ${t.active}`,
      `**${n(recap.points.now)}** ${t.points}${change(recap.points)}`,
      `**${recap.newBadges}** ${recap.newBadges === 1 ? t.newBadge : t.newBadges}`,
    ].join(' · '),
  );
  if (!recap.points.now && !recap.syncs.now) lines.push('', t.quiet);

  if (recap.highlights.length) {
    lines.push('', `**${t.highlights}**`);
    for (const h of recap.highlights) lines.push(`• ${fill(t.highlight[h.key][h.value === 1 ? 0 : 1], { name: h.name, n: n(h.value) })}`);
  }
  const kinds = recap.kinds.filter((k) => k.units > 0).slice(0, 4);
  if (kinds.length) lines.push('', `**${t.synced}**`, kinds.map((k) => `${t.kind[k.kind]} ${n(k.units)}`).join(' · '));

  if (recap.badges.length) {
    lines.push('', `**${t.badges}**`);
    const byMember = new Map<string, string[]>();
    for (const b of recap.badges.slice(0, MAX_BADGES)) byMember.set(b.name, [...(byMember.get(b.name) ?? []), `${t.badge[b.key]} ${b.level}`]);
    for (const [name, list] of byMember) lines.push(`• ${name}: ${list.join(', ')}`);
    if (recap.badges.length > MAX_BADGES) lines.push(fill(t.moreBadges, { n: recap.badges.length - MAX_BADGES }));
  }

  const open: string[] = [];
  const g = recap.open.galaxy;
  if (g.total && g.fresh < g.total) {
    open.push(fill(t.galaxy, { pct: pct(g.fresh, g.total), days: g.days, g: g.weakest?.g ?? 1, gpct: pct(g.weakest?.fresh ?? 0, g.weakest?.total ?? 1) }));
  }
  if (recap.open.idle) open.push(fill(t.idle, { n: recap.open.idle, of: recap.members }));
  else if (recap.open.noEmpire) open.push(fill(t.noEmpire, { n: recap.open.noEmpire }));
  if (recap.open.goals.total) open.push(fill(t.goals, { n: recap.open.goals.reached, of: recap.open.goals.total }));
  if (open.length) lines.push('', `**${t.open}**`, ...open.map((x) => `• ${x}`));

  return { title, body: lines.join('\n') };
}

/** The recap as Markdown to paste into Discord or elsewhere, with a link to the hub's page. */
export function recapMarkdown(recap: Recap, lang: PushLang, link: string | null): string {
  const { title, body } = recapMessage(recap, lang);
  return `## ${title}\n${body}${link ? `\n\n${TEXT[lang].more}: ${link}` : ''}`;
}

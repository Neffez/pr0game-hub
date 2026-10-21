import type { CheerioAPI } from 'cheerio';
import type { PlayerStatus, StatsRecord, StatsRow, StatsType } from '../types.js';
import { nodeToText, normalizeText, parseGameDate, parseNumber } from '../util.js';

const STATUS_CLASSES: PlayerStatus[] = ['inactive', 'longinactive', 'vacation', 'banned', 'noob', 'strong'];

/** Short status letters (gl_short_*) DE + EN. Case matters (i vs I). */
const STATUS_LETTERS: Record<string, PlayerStatus> = {
  i: 'inactive',
  I: 'longinactive',
  u: 'vacation',
  VM: 'vacation',
  g: 'banned',
  B: 'banned',
  n: 'noob',
  N: 'noob',
  s: 'strong',
  S: 'strong',
};

const STAT_DATE_RE = /(?:Aktualisiert am|Updated)\s*:?\s*([^)\n]+)/;

/** Category names as shown in the `type` select, used for plain-text detection. */
const TYPE_NAMES: Record<string, StatsType> = {
  punkte: 1, points: 1,
  flotte: 2, fleet: 2,
  forschung: 3, research: 3,
  'gebäude': 4, building: 4, buildings: 4,
  verteidigung: 5, defense: 5,
  ehrenpunkte: 6, honorpoints: 6, 'honor points': 6,
};

export function isStatsText(text: string): boolean {
  return /(Statistiken|Statistics)\s*\((Aktualisiert am|Updated)/.test(text);
}

export function parseStatTime(text: string): string | null {
  const m = text.match(STAT_DATE_RE);
  return m ? parseGameDate(m[1]) : null;
}

export function parseStatsHtml($: CheerioAPI): StatsRecord | null {
  const headerText = normalizeText(nodeToText($.root().children().toArray()));
  const statTime = parseStatTime(headerText);

  const whoVal = $('select#who option[selected], select[name=who] option[selected]').attr('value');
  const typeVal = $('select#type option[selected], select[name=type] option[selected]').attr('value');
  const type = typeVal && /^[1-6]$/.test(typeVal) ? (Number(typeVal) as StatsType) : null;

  const rows: StatsRow[] = [];
  let who: 'player' | 'alliance' = whoVal === '2' ? 'alliance' : 'player';

  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length < 4) return;
    const playerLink = $(tr).find('a[onclick*="Dialog.Playercard"]').first();
    const rankA = tds.eq(0).find('a').first();
    const rank = parseNumber(rankA.length ? rankA.text() : tds.eq(0).text());
    if (rank == null) return;
    const rankChange = parseRankChange(rankA.attr('data-tooltip-content'));

    if (playerLink.length) {
      who = 'player';
      const idMatch = playerLink.attr('onclick')?.match(/Playercard\((\d+)/);
      const nameCell = tds.eq(1);
      const name = playerLink.text().replace(/ /g, ' ').trim();
      // honor ranking: "[Title]" in front of the player link
      const title = normalizeText(nameCell.text()).match(/^\[([^\]]+)\]/)?.[1].trim() ?? null;
      const status: PlayerStatus[] = [];
      nameCell.find('span.galaxy-short').each((_, s) => {
        const cls = ($(s).attr('class') ?? '').split(/\s+/);
        for (const c of cls) {
          const st = c.replace('galaxy-short-', '') as PlayerStatus;
          if (c.startsWith('galaxy-short-') && STATUS_CLASSES.includes(st)) status.push(st);
        }
      });
      const allyLink = tds.eq(3).find('a[href*="mode=info"]').first();
      const allyIdMatch = allyLink.attr('href')?.match(/[?&;]id=(\d+)/);
      rows.push({
        rank,
        rankChange,
        ingameId: idMatch ? Number(idMatch[1]) : null,
        name,
        status,
        allyId: allyIdMatch ? Number(allyIdMatch[1]) : null,
        allyName: allyLink.length ? allyLink.text().trim() : null,
        points: parseNumber(tds.eq(4).text()) ?? 0,
        ...(title ? { title } : {}),
      });
      return;
    }

    const allyLink = tds.eq(1).find('a[href*="mode=info"]').first();
    if (allyLink.length && tds.length >= 5) {
      who = 'alliance';
      const allyIdMatch = allyLink.attr('href')?.match(/[?&;]id=(\d+)/);
      rows.push({
        rank,
        rankChange,
        ingameId: allyIdMatch ? Number(allyIdMatch[1]) : null,
        name: allyLink.text().trim(),
        status: [],
        allyId: null,
        allyName: null,
        points: parseNumber(tds.eq(3).text()) ?? 0,
        members: parseNumber(tds.eq(2).text()),
      });
    }
  });

  if (!rows.length) return null;
  return { kind: 'stats', who, type, statTime, rows };
}

function parseRankChange(tooltip: string | undefined): number | null {
  if (!tooltip) return null;
  const text = tooltip.replace(/<[^>]*>/g, '').trim();
  if (text === '*') return 0;
  // Player table renders "-{negative}" -> "--3"; normalize any run of minus signs to one.
  const m = text.match(/^([+-]*)(\d+)$/);
  if (!m) return null;
  return m[1].includes('-') ? -Number(m[2]) : Number(m[2]);
}

/**
 * Plain text copy: one row per line, cells separated by tabs.
 * `1\tName i I\t\tAlly\t1.234.567` (player) or `1\tAlly\t12\t1.234.567\t102.880` (alliance).
 */
export function parseStatsText(text: string): StatsRecord | null {
  const statTime = parseStatTime(text);
  const rows: StatsRow[] = [];
  let who: 'player' | 'alliance' = 'player';

  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /^(Rank|Rang|Platz)\t/.test(l));
  if (headerIdx >= 0 && /(Mitglieder|Member)/.test(lines[headerIdx])) who = 'alliance';

  for (const line of lines.slice(Math.max(headerIdx + 1, 0))) {
    const cells = line.split('\t');
    if (cells.length < 3 || !/^\d+$/.test(cells[0].trim())) continue;
    const rank = Number(cells[0]);
    if (who === 'alliance') {
      if (cells.length < 4) continue;
      rows.push({
        rank, rankChange: null, ingameId: null, name: cells[1].trim(), status: [],
        allyId: null, allyName: null, points: parseNumber(cells[3]) ?? 0, members: parseNumber(cells[2]),
      });
      continue;
    }
    const points = parseNumber(cells[cells.length - 1]);
    if (points == null) continue;
    // Name cell: "Name i I" - trailing short status letters.
    const middle = cells.slice(1, -1);
    const titled = (middle[0] ?? '').trim().match(/^\[([^\]]+)\]\s*(.*)$/);
    const { name, status } = splitNameStatus(titled ? titled[2] : (middle[0] ?? ''));
    const allyRaw = middle.slice(1).map((c) => c.trim()).filter(Boolean).pop() ?? '-';
    rows.push({
      rank, rankChange: null, ingameId: null, name, status,
      allyId: null, allyName: allyRaw === '-' ? null : allyRaw, points,
      ...(titled ? { title: titled[1].trim() } : {}),
    });
  }

  if (!rows.length) return null;
  return { kind: 'stats', who, type: detectTypeFromText(text), statTime, rows };
}

export function splitNameStatus(cell: string): { name: string; status: PlayerStatus[] } {
  const parts = cell.trim().split(/[  ]+/);
  const status: PlayerStatus[] = [];
  while (parts.length > 1 && STATUS_LETTERS[parts[parts.length - 1]]) {
    status.unshift(STATUS_LETTERS[parts.pop()!]);
  }
  return { name: parts.join(' '), status };
}

/**
 * Best effort: some browsers copy the selected option of the `type` select as
 * "... von Flotte auf den Positionen ..." / "by Fleet in ranks".
 */
function detectTypeFromText(text: string): StatsType | null {
  const m = text.match(/(?:\bvon|\bby)\s*\t?\s*(Punkte|Points|Flotte|Fleet|Forschung|Research|Gebäude|Buildings?|Verteidigung|Defense|Ehrenpunkte|Honorpoints|Honor points)\b/i);
  return m ? TYPE_NAMES[m[1].toLowerCase()] ?? null : null;
}

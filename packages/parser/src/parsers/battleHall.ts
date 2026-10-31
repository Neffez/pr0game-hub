import type { CheerioAPI } from 'cheerio';
import type { BattleHallEntry, BattleHallRecord } from '../types.js';
import { parseGameDate, parseNumber } from '../util.js';

/** Battle Hall / Hall of Fame (page=battleHall): top battle reports with participants and units. */
export function isBattleHallHtml($: CheerioAPI): boolean {
  return $('body#battleHall').length > 0 || /page=battleHall/.test($('script').text());
}

const names = (text: string) =>
  text
    .split('&')
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export function parseBattleHallHtml($: CheerioAPI): BattleHallRecord {
  const entries: BattleHallEntry[] = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    const link = cells.eq(1).find('a[href*="raport="]').first();
    const reportId = link.attr('href')?.match(/raport=([a-f0-9]+)/)?.[1];
    if (cells.length !== 4 || !reportId) return;
    // "<span class=colorPositive>A & B</span> VS <span class=colorNegative>C</span>"; no spans = draw
    const [left, right = ''] = link.text().split(/\s+VS\s*/);
    const spans = link.find('span');
    const leftWon = spans.first().hasClass('colorPositive');
    const rightWon = spans.last().hasClass('colorPositive') && spans.length > 1;
    entries.push({
      reportId,
      rank: parseNumber(cells.eq(0).text()) ?? 0,
      attackers: names(left),
      defenders: names(right),
      winner: !spans.length ? 'draw' : leftWon ? 'attacker' : rightWon ? 'defender' : null,
      time: parseGameDate(cells.eq(2).text()),
      units: parseNumber(cells.eq(3).text()) ?? 0,
    });
  });
  const timeframe = $('#timeframe option[selected]').attr('value') ?? null;
  const memorial = $('#memorial option[selected]').attr('value') ?? null;
  return {
    kind: 'battleHall',
    timeframe: timeframe != null ? Number(timeframe) : null,
    memorial: memorial != null && /^[012]$/.test(memorial) ? Number(memorial) : null,
    entries,
  };
}

import type { CheerioAPI } from 'cheerio';
import type { MarketOffer, MarketRate, MarketRes, MarketplaceRecord } from '../types.js';
import { parseNumber } from '../util.js';
import { pageTime } from './empire.js';

/** Resource market (page=marketPlace): the game's reference rate and the open resource offers. */
export function isMarketplaceHtml($: CheerioAPI): boolean {
  return $('body#marketPlace').length > 0 || $('#tradeList').length > 0 || /page=marketPlace/.test($('script').text());
}

// "1.000.000  Kristall  ->  650.000  Deuterium  1,07  01h 13m 31s  03:38:42" (the flight time and the buy button follow)
const RES = 'Metall|Metal|Holz|Kristall|Crystal|Gold|Deuterium|Rum';
const OFFER_RE = new RegExp(
  `^([\\d.,]+)\\s+(${RES})\\s+->\\s+([\\d.,]+)\\s+(${RES})\\s+(\\d+[.,]\\d+)\\s+(?:(\\d+)d\\s*)?(?:(\\d+)h\\s*)?(?:(\\d+)m\\s*)?(\\d+)s\\b`,
  'i',
);

export function isMarketplaceText(text: string): boolean {
  return /^Reference ratio:/m.test(text) || text.split('\n').some((l) => OFFER_RE.test(l));
}

const RES_ID: Record<string, MarketRes> = { 1: 'm', 2: 'k', 3: 'd' };

function resOf(name: string): MarketRes {
  const n = name.toLowerCase();
  return /^(metall?|holz)$/.test(n) ? 'm' : /^(kristall|crystal|gold)$/.test(n) ? 'k' : 'd';
}

/** "1,07" or "1.07" (the decimal separator is a game setting). */
function decimal(raw: string): number | null {
  const m = raw.match(/(\d+)[.,](\d+)/);
  return m ? Number(`${m[1]}.${m[2]}`) : null;
}

export function parseMarketplaceHtml($: CheerioAPI): MarketplaceRecord {
  const base = $('#ratioBaselines');
  const m = Number(base.attr('data-metal'));
  const k = Number(base.attr('data-crystal'));
  const d = Number(base.attr('data-deuterium')) || 1;
  const offers: MarketOffer[] = [];
  $('#tradeList tbody tr').each((_, tr) => {
    const row = $(tr);
    const res = row.find('td[data-resource-id]');
    const give = RES_ID[res.eq(0).attr('data-resource-id') ?? ''];
    const want = RES_ID[res.eq(1).attr('data-resource-id') ?? ''];
    const giveAmount = parseNumber(row.find('.offered-resource-amount').text());
    const wantAmount = parseNumber(row.find('.wanted-resource-amount').text());
    const endsIn = Number(row.find('td[data-time]').attr('data-time'));
    if (!give || !want || !giveAmount || !wantAmount || !Number.isFinite(endsIn)) return;
    // the shown rate is rounded; its cell carries both sides in deuterium
    const cell = row.find('td.ratio');
    const offerDeut = Number(cell.attr('data-offer-deut'));
    const askDeut = Number(cell.attr('data-ask-deut'));
    const ratio = offerDeut > 0 && askDeut > 0 ? offerDeut / askDeut : decimal(cell.text());
    const id = Number(row.find('input[name="fleetID"]').attr('value'));
    offers.push({
      id: Number.isInteger(id) && id > 0 ? id : null,
      give: { res: give, amount: giveAmount },
      want: { res: want, amount: wantAmount },
      ratio,
      endsIn,
      ally: row.hasClass('trade-ally'),
    });
  });
  const rate: MarketRate | null = m > 0 && k > 0 ? { m: m / d, k: k / d, exact: true } : estimateMarketRate(offers);
  return { kind: 'marketplace', rate, pageTime: pageTime($), offers };
}

export function parseMarketplaceText(text: string): MarketplaceRecord {
  const offers: MarketOffer[] = [];
  for (const line of text.split('\n')) {
    const r = line.match(OFFER_RE);
    if (!r) continue;
    const [, giveAmount, give, wantAmount, want, ratio, dd, hh, mm, ss] = r;
    offers.push({
      id: null,
      give: { res: resOf(give), amount: parseNumber(giveAmount) ?? 0 },
      want: { res: resOf(want), amount: parseNumber(wantAmount) ?? 0 },
      ratio: decimal(ratio),
      endsIn: Number(dd ?? 0) * 86400 + Number(hh ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(ss),
      ally: false,
    });
  }
  return { kind: 'marketplace', rate: estimateMarketRate(offers), pageTime: null, offers };
}

/**
 * Market rate (metal and crystal per deuterium) estimated from the offers' shown exchange rates: each offer gives
 * `ratio = (give / rate[give]) / (want / rate[want])`, solved by least squares in log space. A resource no offer ties to
 * deuterium (directly or through the other one) stays null; null when nothing can be estimated.
 */
export function estimateMarketRate(offers: MarketOffer[]): MarketRate | null {
  // log rate[want] - log rate[give] = log ratio - log give + log want; unknowns x = (log m, log k), log d = 0
  let amm = 0, amk = 0, akk = 0, bm = 0, bk = 0;
  for (const o of offers) {
    if (!o.ratio || o.ratio <= 0 || o.give.res === o.want.res || o.give.amount <= 0 || o.want.amount <= 0) continue;
    const y = Math.log(o.ratio) - Math.log(o.give.amount) + Math.log(o.want.amount);
    const cm = (o.want.res === 'm' ? 1 : 0) - (o.give.res === 'm' ? 1 : 0);
    const ck = (o.want.res === 'k' ? 1 : 0) - (o.give.res === 'k' ? 1 : 0);
    amm += cm * cm;
    amk += cm * ck;
    akk += ck * ck;
    bm += cm * y;
    bk += ck * y;
  }
  const det = amm * akk - amk * amk;
  if (det > 1e-9) {
    return { m: Math.exp((bm * akk - bk * amk) / det), k: Math.exp((amm * bk - amk * bm) / det), exact: false };
  }
  // only one resource is traded against deuterium
  if (amm > 0 && amk === 0) return { m: Math.exp(bm / amm), k: null, exact: false };
  if (akk > 0 && amk === 0) return { m: null, k: Math.exp(bk / akk), exact: false };
  return null;
}

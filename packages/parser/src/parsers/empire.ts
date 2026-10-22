import type { CheerioAPI } from 'cheerio';
import { CLASS_RESEARCH, CLASS_RESOURCES, classOf, idByName, MOON_BASE } from '../tech.js';
import type { EmpirePlanet, EmpireRecord } from '../types.js';
import { COORDS_RE, parseCoords, parseNumber } from '../util.js';

export function isEmpireHtml($: CheerioAPI): boolean {
  return $('tr[data-info^="b_"], tr[data-info^="t_"], tr[data-info^="f_"]').length > 0;
}

export function isEmpireText(text: string): boolean {
  return /(Imperiumsübersicht|Empire)/.test(text) && /(Koordinaten|Coordinates)\t/.test(text);
}

export function parseEmpireHtml($: CheerioAPI): EmpireRecord | null {
  // Coordinates row: first cell label, second "-", then one cell per planet.
  let planets: EmpirePlanet[] = [];
  $('tr').each((_, tr) => {
    if (planets.length) return;
    const cells = $(tr).children('td');
    const coords = cells
      .toArray()
      .slice(2)
      .map((td) => parseCoords($(td).text()));
    if (coords.length && coords.every(Boolean)) {
      planets = coords.map((c) => ({ name: '', coords: c!, type: 'planet' as const, values: {} }));
      const rows = $(tr).prevAll('tr').toArray().filter((r) => $(r).children('td').length === cells.length);
      // Nearest previous row is the name row, the one before it holds the planet images.
      if (rows[0]) $(rows[0]).children('td').toArray().slice(2).forEach((td, i) => (planets[i].name = $(td).text().trim()));
      if (rows[1]) {
        $(rows[1]).children('td').toArray().slice(2).forEach((td, i) => {
          if (/\/mond\d*[._]/i.test($(td).find('img').attr('src') ?? '')) planets[i].type = 'moon';
        });
      }
    }
  });
  if (!planets.length) return null;

  // Planet info rows: label in the first cell, "-" in the second, one cell per planet.
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray();
    if (cells.length !== planets.length + 2) return;
    const label = $(cells[0]).text().trim();
    const values = cells.slice(2).map((td) => $(td).text().trim());
    if (/^(Temperatur|Temperature)$/.test(label)) values.forEach((v, i) => (planets[i].temp = parseNumber(v.replace(/°C/, '')) ?? undefined));
    if (/^(Felder|Fields)$/.test(label)) {
      values.forEach((v, i) => {
        const m = v.match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
        if (m) planets[i].fields = { used: parseNumber(m[1]) ?? 0, max: parseNumber(m[2]) ?? 0 };
      });
    }
  });

  const research: Record<number, number> = {};
  const flying: Record<number, number> = {};
  const flyingShips: Record<number, number> = {};
  let researchQueue: EmpireRecord['researchQueue'] = null;
  $('tr[data-info]').each((_, tr) => {
    const m = ($(tr).attr('data-info') ?? '').match(/^([rbtfd])_(\d+)$/);
    if (!m) return;
    const id = Number(m[2]);
    const cells = $(tr).children('td').toArray();
    const queued = (td: unknown) => {
      const t = $(td as never).find('span').filter((_, sp) => $(sp).text().includes('⬆')).first().text();
      return t ? parseNumber(t.replace('⬆', '')) : null;
    };
    // the total cell (Σ) of resources and ships shows the amount on fleets in flight
    const inFlight = () => {
      const t = $(cells[1]).find('span').filter((_, sp) => $(sp).text().includes('✈')).first().text();
      return t ? parseNumber(t.replace('✈', '')) ?? 0 : null;
    };
    if (m[1] === 'f') {
      const n = inFlight();
      if (n) flyingShips[id] = n;
    }
    if (m[1] === 'r') {
      const total = inFlight();
      if (total != null) flying[id] = total;
      cells.slice(2).forEach((td, i) => {
        if (!planets[i]) return;
        (planets[i].resources ??= {})[id] = parseNumber(firstSpanOrText($, td)) ?? 0;
        const perHour = $(td).find('span').filter((_, sp) => /\/h/.test($(sp).text())).first().text();
        if (perHour) (planets[i].perHour ??= {})[id] = parseNumber(perHour.replace('/h', '')) ?? 0;
      });
      return;
    }
    if (m[1] === 't') {
      research[id] = parseNumber(firstSpanOrText($, cells[1])) ?? 0;
      const level = queued(cells[1]);
      if (level != null) {
        const at = cells.slice(2).findIndex((td) => queued(td) != null);
        researchQueue = { id, level, coords: at >= 0 && planets[at] ? planets[at].coords : null };
      }
      return;
    }
    cells.slice(2).forEach((td, i) => {
      if (!planets[i]) return;
      planets[i].values[id] = parseNumber(firstSpanOrText($, td)) ?? 0;
      const q = queued(td);
      if (q == null) return;
      if (m[1] === 'b') planets[i].building = { id, level: q };
      else (planets[i].shipyard ??= {})[id] = q;
    });
  });
  markMoonsByBase(planets);
  return { kind: 'empire', planets, research, researchQueue, flying, flyingShips, pageTime: pageTime($), active: activePlanet($) };
}

/** Server time rendered into the page header: `new Date(2026, 9, 21, 13, 43, 45)` (month 0-based). */
export function pageTime($: CheerioAPI): string | null {
  const m = $('script').text().match(/serverTimeDelta\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  const p = (n: string | number) => String(n).padStart(2, '0');
  return `${m[1]}-${p(Number(m[2]) + 1)}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}

/** Selected planet of the header select ("Name (Mond) [g:s:p]") with the storage from the resource bar. */
function activePlanet($: CheerioAPI): EmpireRecord['active'] {
  const opt = $('#planetSelector option[selected]').first();
  const coords = parseCoords(opt.text());
  if (!coords) return null;
  const storage: Record<number, number> = {};
  for (const [id, key] of [[901, 'metal'], [902, 'crystal'], [903, 'deuterium']] as const) {
    const v = parseNumber($(`#max_${key}`).first().text());
    if (v != null) storage[id] = v;
  }
  return { coords, type: /\((Mond|Moon|Insel)\)/.test(opt.text()) ? 'moon' : 'planet', storage };
}

/** Fallback when no planet images are available: a moon base (41) only exists on moons. */
function markMoonsByBase(planets: EmpirePlanet[]) {
  for (const p of planets) if ((p.values[MOON_BASE] ?? 0) > 0) p.type = 'moon';
}

/** Cells contain the value plus optional "⬆ queue" / "✈ flying" spans; the value is the first span or leading text. */
function firstSpanOrText($: CheerioAPI, td: unknown): string {
  const cell = $(td as never);
  const span = cell.children('span').first();
  const own = cell.clone().children().remove().end().text().trim();
  return own || span.text();
}

/** Plain-text copy: tab separated rows, cells with line breaks are skipped. */
export function parseEmpireText(text: string): EmpireRecord | null {
  const lines = text.split('\n').map((l) => l.split('\t'));
  const coordLine = lines.find((c) => /^(Koordinaten|Coordinates)$/.test(c[0]) && c.slice(2).some((x) => COORDS_RE.test(x)));
  if (!coordLine) return null;
  const planets: EmpirePlanet[] = coordLine
    .slice(2)
    .map((c) => ({ name: '', coords: parseCoords(c)!, type: 'planet' as const, values: {} }))
    .filter((p) => p.coords);
  const nameLine = lines.find((c) => /^Name$/.test(c[0]));
  if (nameLine) nameLine.slice(2).forEach((n, i) => planets[i] && (planets[i].name = n.trim()));

  const research: Record<number, number> = {};
  for (const cells of lines) {
    const id = idByName(cells[0] ?? '');
    if (id == null || classOf(id) === CLASS_RESOURCES) continue;
    if (classOf(id) === CLASS_RESEARCH) {
      const v = parseNumber(cells[1]);
      if (v != null) research[id] = v;
      continue;
    }
    const values = cells.slice(2, 2 + planets.length);
    if (values.length !== planets.length) continue;
    values.forEach((v, i) => (planets[i].values[id] = parseNumber(v.split(/[⬆✈]/)[0]) ?? 0));
  }
  markMoonsByBase(planets);
  return { kind: 'empire', planets, research };
}

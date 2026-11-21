import type { Recap } from './apiTypes';
import { BADGE_ICONS, badgeColor } from './achievements';
import { ICONS } from './components/Icon.vue';

/**
 * The recap as an image to download or post (Discord, forum): an SVG card drawn from the recap's numbers in the hub's
 * colours, turned into a PNG by the browser. Texts come in finished (the caller translates them).
 */

export interface RecapImageTexts {
  /** "Recap", the alliance, the period */
  label: string;
  title: string;
  alliance: string;
  kpis: { value: string; label: string; change: { text: string; up: boolean } | null }[];
  highlightsTitle: string;
  highlights: { icon: string; text: string; name: string }[];
  kindsTitle: string;
  kinds: { label: string; value: string; share: number }[];
  badgesTitle: string;
  badges: { key: Recap['badges'][number]['key']; level: number; name: string; badge: string }[];
  moreBadges: string | null;
  openTitle: string;
  galaxy: { text: string; share: number } | null;
  open: string[];
  footer: string;
}

const W = 1000;
const PAD = 40;
const C = {
  bg: '#0d1117', surface: '#151b23', surface2: '#1c2430', border: '#283241', text: '#e6edf3', muted: '#8b98a9', faint: '#5d6a7b',
  accent: '#f2683c', pos: '#3fb950', neg: '#f85149',
};
const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Cuts a text to about `max` characters (the card has no text measuring). */
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function icon(name: string, x: number, y: number, size: number, color: string): string {
  const paths = ICONS[name] ?? [];
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => (d.startsWith('F:') ? `<path d="${d.slice(2)}" fill="${color}" stroke="none"/>` : `<path d="${d}"/>`))
    .join('')}</g>`;
}

const text = (x: number, y: number, s: string, size: number, color: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${esc(s)}</text>`;

/** The card as SVG markup; its height grows with the content. */
export function recapSvg(x: RecapImageTexts): { svg: string; width: number; height: number } {
  const out: string[] = [];
  let y = 0;

  // header
  out.push(`<rect x="0" y="0" width="${W}" height="120" fill="url(#head)"/>`);
  out.push(text(PAD, 46, x.label.toUpperCase(), 15, C.accent, 'font-weight="700" letter-spacing="3"'));
  out.push(text(PAD, 86, cut(x.title, 44), 32, C.text, 'font-weight="700"'));
  if (x.alliance) out.push(text(W - PAD, 86, cut(x.alliance, 30), 20, C.muted, 'text-anchor="end"'));
  y = 144;

  // key figures
  const gap = 16;
  const tw = (W - 2 * PAD - 3 * gap) / 4;
  x.kpis.slice(0, 4).forEach((k, i) => {
    const tx = PAD + i * (tw + gap);
    out.push(`<rect x="${tx}" y="${y}" width="${tw}" height="112" rx="12" fill="${C.surface}" stroke="${C.border}"/>`);
    out.push(text(tx + 20, y + 52, k.value, 34, C.text, 'font-weight="700"'));
    out.push(text(tx + 20, y + 80, cut(k.label, 22), 15, C.muted));
    if (k.change) out.push(text(tx + 20, y + 100, k.change.text, 14, k.change.up ? C.pos : C.neg, 'font-weight="600"'));
  });
  y += 112 + 28;

  // highlights | synced the most
  const colW = (W - 2 * PAD - 24) / 2;
  const rowsH = Math.max(x.highlights.length, x.kinds.length, 1) * 44 + 56;
  if (x.highlights.length || x.kinds.length) {
    out.push(`<rect x="${PAD}" y="${y}" width="${colW}" height="${rowsH}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`);
    out.push(text(PAD + 20, y + 34, x.highlightsTitle, 17, C.text, 'font-weight="700"'));
    x.highlights.forEach((h, i) => {
      const ry = y + 56 + i * 44;
      out.push(`<circle cx="${PAD + 34}" cy="${ry + 14}" r="16" fill="${C.surface2}"/>`);
      out.push(icon(h.icon, PAD + 24, ry + 4, 20, C.accent));
      out.push(text(PAD + 62, ry + 10, cut(h.text, 40), 13, C.muted));
      out.push(text(PAD + 62, ry + 29, cut(h.name, 34), 16, C.text, 'font-weight="600"'));
    });
    const kx = PAD + colW + 24;
    out.push(`<rect x="${kx}" y="${y}" width="${colW}" height="${rowsH}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`);
    out.push(text(kx + 20, y + 34, x.kindsTitle, 17, C.text, 'font-weight="700"'));
    const barW = colW - 40;
    x.kinds.forEach((k, i) => {
      const ry = y + 56 + i * 44;
      out.push(text(kx + 20, ry + 12, cut(k.label, 30), 14, C.text));
      out.push(text(kx + colW - 20, ry + 12, k.value, 14, C.muted, 'text-anchor="end"'));
      out.push(`<rect x="${kx + 20}" y="${ry + 20}" width="${barW}" height="8" rx="4" fill="${C.border}"/>`);
      out.push(`<rect x="${kx + 20}" y="${ry + 20}" width="${Math.max(4, barW * Math.min(1, k.share))}" height="8" rx="4" fill="${C.accent}"/>`);
    });
    y += rowsH + 24;
  }

  // new badges: chips, three per row
  if (x.badges.length) {
    const perRow = 3;
    const chipW = (W - 2 * PAD - 40 - (perRow - 1) * 12) / perRow;
    const lines = Math.ceil(x.badges.length / perRow);
    const h = 56 + lines * 52 + (x.moreBadges ? 28 : 0);
    out.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`);
    out.push(text(PAD + 20, y + 34, x.badgesTitle, 17, C.text, 'font-weight="700"'));
    x.badges.forEach((b, i) => {
      const cx = PAD + 20 + (i % perRow) * (chipW + 12);
      const cy = y + 52 + Math.floor(i / perRow) * 52;
      const color = badgeColor(b) ?? C.faint;
      out.push(`<rect x="${cx}" y="${cy}" width="${chipW}" height="42" rx="21" fill="${C.surface2}" stroke="${color}" stroke-opacity="0.5"/>`);
      out.push(icon(BADGE_ICONS[b.key], cx + 12, cy + 10, 22, color));
      out.push(text(cx + 44, cy + 18, cut(b.name, 24), 14, C.text, 'font-weight="600"'));
      out.push(text(cx + 44, cy + 34, cut(b.badge, 28), 12, color));
    });
    if (x.moreBadges) out.push(text(PAD + 20, y + h - 18, x.moreBadges, 13, C.muted));
    y += h + 24;
  }

  // room to grow
  if (x.galaxy || x.open.length) {
    const h = 56 + (x.galaxy ? 44 : 0) + x.open.length * 26 + 8;
    out.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`);
    out.push(text(PAD + 20, y + 34, x.openTitle, 17, C.text, 'font-weight="700"'));
    let oy = y + 58;
    if (x.galaxy) {
      const barW = W - 2 * PAD - 40;
      out.push(text(PAD + 20, oy + 4, cut(x.galaxy.text, 100), 14, C.text));
      out.push(`<rect x="${PAD + 20}" y="${oy + 14}" width="${barW}" height="10" rx="5" fill="${C.border}"/>`);
      out.push(`<rect x="${PAD + 20}" y="${oy + 14}" width="${Math.max(5, barW * Math.min(1, x.galaxy.share))}" height="10" rx="5" fill="${C.accent}"/>`);
      oy += 44;
    }
    for (const line of x.open) {
      out.push(`<circle cx="${PAD + 25}" cy="${oy}" r="3" fill="${C.accent}"/>`);
      out.push(text(PAD + 38, oy + 5, cut(line, 100), 14, C.text));
      oy += 26;
    }
    y += h + 24;
  }

  // footer
  out.push(text(PAD, y + 8, x.footer, 13, C.faint));
  out.push(text(W - PAD, y + 8, 'pr0game-hub', 13, C.faint, 'text-anchor="end" font-weight="600"'));
  const height = y + 32;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${esc(FONT)}">
<defs><linearGradient id="head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1a14"/><stop offset="0.6" stop-color="${C.surface}"/></linearGradient></defs>
<rect width="${W}" height="${height}" fill="${C.bg}"/>
${out.join('\n')}
</svg>`;
  return { svg, width: W, height };
}

/** Draws the SVG card into a PNG (twice the size for sharp text). */
export async function recapPng(card: { svg: string; width: number; height: number }, scale = 2): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('recap image'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(card.svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = card.width * scale;
  canvas.height = card.height * scale;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('recap image');
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, card.width, card.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('recap image'))), 'image/png'));
}

/** A blob as base64 (without the data URL prefix). */
export function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

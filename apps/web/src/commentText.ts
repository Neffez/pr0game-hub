/**
 * Comment text in parts (backlog G-8): `@name` of a member (longest name first, a whole name only) and coordinates
 * (`1:234:5` or `[1:234:5]`, within the universe) become their own parts; the rest stays text.
 */
export type CommentPart =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; name: string }
  | { kind: 'coords'; text: string; g: number; s: number; p: number };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function commentParts(body: string, names: string[], limits: { galaxies: number; systems: number; positions: number }): CommentPart[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const mention = sorted.length ? `@(${sorted.map(escape).join('|')})(?![\\p{L}\\p{N}_])` : null;
  const coords = String.raw`\[?(\d{1,2}):(\d{1,3}):(\d{1,2})\]?`;
  const re = new RegExp(mention ? `(?<![\\p{L}\\p{N}_])${mention}|${coords}` : coords, 'giu');
  const out: CommentPart[] = [];
  let last = 0;
  const text = (t: string) => t && out.push({ kind: 'text', text: t });
  for (const m of body.matchAll(re)) {
    const at = m.index ?? 0;
    const offset = mention ? 1 : 0;
    let part: CommentPart | null = null;
    if (mention && m[1]) {
      const name = sorted.find((n) => n.toLowerCase() === m[1].toLowerCase()) ?? m[1];
      part = { kind: 'mention', text: m[0], name };
    } else {
      const [g, s, p] = [Number(m[1 + offset]), Number(m[2 + offset]), Number(m[3 + offset])];
      if (g >= 1 && g <= limits.galaxies && s >= 1 && s <= limits.systems && p >= 1 && p <= limits.positions) part = { kind: 'coords', text: m[0], g, s, p };
    }
    if (!part) continue;
    text(body.slice(last, at));
    out.push(part);
    last = at + m[0].length;
  }
  text(body.slice(last));
  return out;
}

/** Member names that complete the `@…` the text ends with (at most `max`), for the comment box. */
export function mentionSuggestions(text: string, names: string[], max = 6): { prefix: string; names: string[] } | null {
  const m = text.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\- ]{0,20})$/u);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const hits = names.filter((n) => n.toLowerCase().startsWith(prefix) && n.toLowerCase() !== prefix).slice(0, max);
  return hits.length ? { prefix: m[1], names: hits } : null;
}

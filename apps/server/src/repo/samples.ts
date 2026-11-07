import { gunzipSync, gzipSync } from 'node:zlib';
import { config } from '../config.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { memberPlayer } from './members.js';

/** Largest sample kept (the paste's body limit is larger; a page that big is no useful sample). */
export const SAMPLE_MAX = 4 * 1024 * 1024;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Makes a pasted page fit to send to the hub's admins: scripts, styles and form values go, session tokens in links are
 * blanked, e-mail addresses and the sender's own names (hub account, in-game name, the linked player) are replaced.
 * Other players' names and coordinates stay: they are on public pages of the game anyway.
 */
export function anonymizePage(content: string, names: string[]): string {
  let out = content
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/(<input\b[^>]*?\svalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1""')
    .replace(/([?&;](?:session|sess|sid|token|key|csrf|auth|hash)[a-z_]*=)[^&"'\s<>]+/gi, '$1x')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'mail@example.com');
  for (const n of [...new Set(names.filter((x) => x && x.length >= 3))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(n)}(?=$|[^\\p{L}\\p{N}_])`, 'gu'), '$1Sender');
  }
  return out;
}

/** Stores a page the hub found nothing in, anonymized, for the hub's admins (backlog E-4). */
export function saveSample(db: DB, ctx: GroupContext, s: { html: string | null; text: string | null; code: string; page: string | null; note: string | null }) {
  const player = memberPlayer(db, ctx, ctx.user.id);
  const names = [
    ctx.user.username,
    db.prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ?').pluck().get(ctx.groupId, ctx.user.id) as string | null,
    player != null ? (db.prepare('SELECT name FROM players WHERE id = ? AND group_id = ?').pluck().get(player, ctx.groupId) as string | null) : null,
  ].filter((x): x is string => !!x);
  const html = s.html ? anonymizePage(s.html, names) : null;
  const text = s.text ? anonymizePage(s.text, names) : null;
  db.prepare('DELETE FROM parser_samples WHERE created_at < ?').run(now() - config.rawRetentionDays * 86400);
  const id = db
    .prepare('INSERT INTO parser_samples (group_id, user_id, code, page, note, html_gz, text_gz) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ctx.groupId, ctx.user.id, s.code, s.page, s.note, html ? gzipSync(html) : null, text ? gzipSync(text) : null).lastInsertRowid;
  return Number(id);
}

/** Samples of all groups for the hub's admins, newest first. */
export function listSamples(db: DB) {
  return db
    .prepare(
      `SELECT s.id, s.group_id, g.name AS group_name, un.slug AS universe, u.username, s.code, s.page, s.note, s.created_at,
         length(s.html_gz) AS html_size, length(s.text_gz) AS text_size
       FROM parser_samples s JOIN groups g ON g.id = s.group_id JOIN universes un ON un.id = g.universe_id
       LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200`,
    )
    .all();
}

/** The page of a sample (HTML when there is one, else the text). */
export function sampleContent(db: DB, id: number): { html: string | null; text: string | null } | null {
  const row = db.prepare('SELECT html_gz, text_gz FROM parser_samples WHERE id = ?').get(id) as { html_gz: Buffer | null; text_gz: Buffer | null } | undefined;
  if (!row) return null;
  return { html: row.html_gz ? gunzipSync(row.html_gz).toString('utf8') : null, text: row.text_gz ? gunzipSync(row.text_gz).toString('utf8') : null };
}

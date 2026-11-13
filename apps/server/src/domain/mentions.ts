/**
 * `@name` mentions in comments (backlog G-8): a member is mentioned when the comment holds `@` followed by their
 * display name, in-game name or hub username, not followed by a letter, digit or `_` (so `@Bob` does not mention "Bo").
 * Case is ignored; names with spaces work as written.
 */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentions(body: string, names: (string | null | undefined)[]): boolean {
  return names.some((n) => !!n && new RegExp(`(^|[^\\p{L}\\p{N}_])@${escape(n)}(?![\\p{L}\\p{N}_])`, 'iu').test(body));
}

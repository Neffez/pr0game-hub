import { fnv1a } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { alliance, memberPlayers } from '../repo/members.js';
import { Players } from '../repo/players.js';
import type { StoredMessage } from '../repo/messages.js';

export interface MessageParty {
  name: string;
  coords: string | null;
  /** player of the own alliance */
  ally: boolean;
  /** hub player, when known (links to the player page) */
  player: number | null;
}

export type ConversationMessage = Omit<StoredMessage, 'recipients' | 'owners' | 'threads' | 'partners'> & {
  from: MessageParty;
  recipients: MessageParty[];
  conversation: string;
  /** written by the viewer, or by a member in a conversation without the viewer (chat: right side) */
  out: boolean;
};

export interface Conversation {
  id: string;
  /** everyone taking part, with their newest name; `self` is the viewer, `member` a hub member */
  parties: (MessageParty & { self: boolean; member: boolean })[];
  count: number;
  last: number;
}

/** Disjoint sets of string keys. */
class Union {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/**
 * Groups player messages into conversations with the same partner(s), across the game's threads and renames.
 * A person is everything that names them: name, main planet (a renamed player keeps it), hub player (current and
 * former names), and for the members their account; the partner's in-game id of a member's copy tells which side is
 * the member. Messages with the same participants, or in the same game thread, form one conversation.
 */
export function conversations(db: DB, ctx: GroupContext, messages: StoredMessage[]): { messages: ConversationMessage[]; conversations: Conversation[] } {
  const players = new Players(db, ctx.groupId);
  const byName = new Map<string, number | null>();
  const nameToPlayer = (name: string) => {
    const k = name.toLowerCase();
    if (!byName.has(k)) byName.set(k, players.byName(name));
    return byName.get(k)!;
  };
  const planetOwner = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ?').pluck();
  const byIngame = db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = ?').pluck();
  const ally = alliance(db, ctx);

  const people = new Union();
  const keysOf = (name: string, coords: string | null) => {
    const keys = [`n:${name.toLowerCase()}`];
    if (coords) keys.push(`c:${coords}`);
    const [g, s, p] = coords?.split(':').map(Number) ?? [];
    const player = nameToPlayer(name) ?? (coords ? ((planetOwner.get(ctx.groupId, g, s, p) as number | null | undefined) ?? null) : null);
    if (player) keys.push(`p:${player}`);
    keys.forEach((k) => people.union(keys[0], k));
    return { key: keys[0], player };
  };
  const parsed = messages.map((m) => ({
    m,
    from: keysOf(m.from_name, m.from_coords),
    to: m.recipients.map((r) => keysOf(r.name, r.coords)),
  }));

  // members: their account, in-game name and hub player
  const members = db.prepare('SELECT user_id, ingame_name FROM group_members WHERE group_id = ?').all(ctx.groupId) as { user_id: number; ingame_name: string | null }[];
  const memberPlayer = memberPlayers(db, ctx);
  for (const mb of members) {
    if (mb.ingame_name) people.union(`u:${mb.user_id}`, `n:${mb.ingame_name.toLowerCase()}`);
    const p = memberPlayer.get(mb.user_id);
    if (p) people.union(`u:${mb.user_id}`, `p:${p}`);
  }
  // in a member's copy of a two-person message, the side that isn't the partner is the member
  for (const { m, from, to } of parsed) {
    if (to.length !== 1) continue;
    for (const pair of m.partners) {
      const [user, ingame] = pair.split(':').map(Number);
      const partner = byIngame.get(ctx.groupId, ingame) as number | undefined;
      if (!partner) continue;
      const pk = people.find(`p:${partner}`);
      const sides = [from.key, to[0].key];
      const member = sides.filter((k) => people.find(k) !== pk);
      if (member.length === 1) people.union(`u:${user}`, member[0]);
    }
  }

  // conversations: same participants, joined by the game's threads
  const convs = new Union();
  const participants = parsed.map(({ from, to }) => [...new Set([from, ...to].map((x) => people.find(x.key)))].sort());
  parsed.forEach(({ m }, i) => {
    const k = `k:${participants[i].join('|')}`;
    for (const t of m.threads) convs.union(k, `t:${t}`);
  });

  const viewer = people.find(`u:${ctx.user.id}`);
  const memberSet = new Set(members.map((mb) => people.find(`u:${mb.user_id}`)));
  // newest name, planet and hub player per person (messages come newest first)
  const latest = new Map<string, { name: string; coords: string | null; player: number | null }>();
  const party = (name: string, coords: string | null, key: string, player: number | null): MessageParty => {
    const root = people.find(key);
    const cur = latest.get(root);
    if (!cur) latest.set(root, { name, coords, player });
    else if (!cur.player && player) cur.player = player;
    return { name, coords, ally: ally.names.has(name.toLowerCase()) || (!!coords && ally.coords.has(coords)), player };
  };

  const byId = new Map<string, { conv: Conversation; people: Set<string> }>();
  const out: ConversationMessage[] = parsed.map(({ m, from, to }, i) => {
    const id = fnv1a(convs.find(`k:${participants[i].join('|')}`));
    let c = byId.get(id);
    if (!c) byId.set(id, (c = { conv: { id, parties: [], count: 0, last: m.time }, people: new Set() }));
    c.conv.count++;
    c.conv.last = Math.max(c.conv.last, m.time);
    participants[i].forEach((p) => c.people.add(p));
    const sender = people.find(from.key);
    const { recipients, owners: _o, threads: _t, partners: _p, ...rest } = m;
    return {
      ...rest,
      from: party(m.from_name, m.from_coords, from.key, from.player),
      recipients: recipients.map((r, j) => party(r.name, r.coords, to[j].key, to[j].player)),
      conversation: id,
      out: sender === viewer || (!participants[i].includes(viewer) && memberSet.has(sender)),
    };
  });
  // a person's newest player id also for older mentions
  for (const msg of out) {
    for (const p of [msg.from, ...msg.recipients]) p.player ??= latest.get(people.find(`n:${p.name.toLowerCase()}`))?.player ?? null;
  }

  const list = [...byId.values()].map(({ conv, people: ps }) => {
    conv.parties = [...ps].map((root) => {
      const l = latest.get(root)!;
      return {
        ...l,
        ally: ally.names.has(l.name.toLowerCase()) || (!!l.coords && ally.coords.has(l.coords)),
        self: root === viewer,
        member: memberSet.has(root),
      };
    });
    return conv;
  });
  return { messages: out, conversations: list.sort((a, b) => b.last - a.last) };
}

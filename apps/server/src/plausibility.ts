import type { Coords, EmpireRecord, HubRecord } from '@pr0hub/core';
import type { DB } from './db.js';
import { Players } from './repo/players.js';

/** Below these sizes nothing is judged: a young group, a short page. */
const MIN_KNOWN = 50;
const MIN_ROWS = 20;
const MIN_ALLIANCES = 10;
const MIN_PLANETS = 5;
const MIN_REPORTS = 2;
const MIN_NAMES = 6;
/** share of a page's names the group must know, share of compared planets with another owner */
const MIN_KNOWN_SHARE = 0.3;
const MAX_OTHER_OWNER = 0.7;

export interface PlausibilityTarget {
  groupId: number;
  userId: number;
}

/**
 * Whether parsed pages contradict what the group already knows about its universe, i.e. come from another
 * universe. Works for plain text too, unlike the markers of the HTML. Evidence per page type:
 * - a player named at coordinates (galaxy views, spy reports, hostile espionage) other than the owner the group knows
 *   there, for most compared planets;
 * - the member's own planets (overview, own fleets, target of hostile espionage, empire page) belonging to other
 *   players, or an empire page sharing no planet with the member's stored ones (the home planet can't be given up);
 * - player messages mostly without any of the member's planets among sender and recipients;
 * - names the group mostly doesn't know (statistics, battle hall of a day/week/month, combat reports, other fleets).
 * Young groups and short pages are not judged; one contradicting report alone never counts. Battle, expedition and
 * recycling reports name no players and pass on their own.
 */
export function foreignRecords(db: DB, target: PlausibilityTarget, records: HubRecord[]): boolean {
  const ctx = new Evidence(db, target);
  for (const r of records) {
    switch (r.kind) {
      case 'stats':
        if (r.who === 'player' ? ctx.unknownPlayers(r.rows.map((x) => x.name), MIN_ROWS) : ctx.unknownAlliances(r.rows.map((x) => x.name))) return true;
        break;
      case 'galaxy':
        for (const row of r.rows) if (row.playerName && !row.destroyed) ctx.named('galaxy', { g: r.g, s: r.s, p: row.position }, row.playerName);
        break;
      case 'spy':
        if (r.playerName) ctx.named('reports', r.coords, r.playerName);
        break;
      case 'hostileSpy':
        ctx.named('reports', r.fromCoords, r.fromPlayerName);
        ctx.own(r.targetCoords);
        break;
      case 'playerMessage':
        ctx.ownMessage([r.from, ...r.to].flatMap((p) => (p.coords ? [p.coords] : [])));
        break;
      case 'overview':
        if (r.current) ctx.own(r.current.coords);
        break;
      case 'fleets':
        for (const f of r.fleets) {
          if (f.owner === 'own') ctx.own(f.phase === 'return' ? (f.to?.coords ?? f.from.coords) : f.from.coords);
          else if (f.player) ctx.names.push(f.player);
        }
        break;
      case 'empire':
        if (ctx.foreignEmpire(r)) return true;
        break;
      case 'battleHall':
        // the all-time list also names players long gone from the universe (unknown to the hub)
        if (r.timeframe) for (const e of r.entries) ctx.names.push(...e.attackers, ...e.defenders);
        break;
      case 'combatReport':
        for (const f of r.fleets) ctx.names.push(f.name);
        break;
    }
  }
  return ctx.verdict();
}

/** Comparisons collected over all records of a paste. */
class Evidence {
  private players: Players;
  private owner;
  private compared = { galaxy: 0, reports: 0, own: 0, messages: 0 };
  private other = { galaxy: 0, reports: 0, own: 0, messages: 0 };
  private ownPlayers: Set<number> | null = null;
  private stored: Set<string> | null = null;
  /** names from pages without coordinates, judged together */
  names: string[] = [];

  constructor(
    private db: DB,
    private target: PlausibilityTarget,
  ) {
    this.players = new Players(db, target.groupId);
    this.owner = db
      .prepare(
        `SELECT p.id FROM planets pl JOIN players p ON p.id = pl.player_id
         WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ? AND pl.destroyed = 0`,
      )
      .pluck();
  }

  private ownerAt(c: Coords): number | undefined {
    return this.owner.get(this.target.groupId, c.g, c.s, c.p) as number | undefined;
  }

  /** a player named at coordinates: compared with the known owner */
  named(pool: 'galaxy' | 'reports', c: Coords, name: string) {
    const known = this.ownerAt(c);
    if (known == null) return;
    this.compared[pool]++;
    if (this.players.byName(name) !== known) this.other[pool]++;
  }

  /** coordinates of one of the member's own planets: on their empire pages, or owned by their player */
  own(c: Coords) {
    if (this.storedPlanets().has(key(c))) {
      this.compared.own++;
      return;
    }
    const at = this.ownerAt(c);
    const mine = this.memberPlayers();
    // a new colony without owner data, or a member without known planets: nothing to tell
    if (at == null || !mine.size) return;
    this.compared.own++;
    if (!mine.has(at)) this.other.own++;
  }

  /**
   * A player message involves the member (sender or recipient): one of its planets should be the member's. Names are
   * not compared, messages are often old and players rename.
   */
  ownMessage(coords: Coords[]) {
    const mine = this.memberPlayers();
    if (!coords.length || (!mine.size && !this.storedPlanets().size)) return;
    const owners = coords.map((c) => ({ stored: this.storedPlanets().has(key(c)), at: this.ownerAt(c) }));
    if (owners.some((o) => o.stored || (o.at != null && mine.has(o.at)))) {
      this.compared.messages++;
      return;
    }
    if (owners.some((o) => o.at != null)) {
      this.compared.messages++;
      this.other.messages++;
    }
  }

  /**
   * An empire page of another universe: its planets belong to several other players in the galaxy data (in the
   * right universe they all have one owner, the member), or it shares no planet with the member's stored pages.
   */
  foreignEmpire(r: EmpireRecord): boolean {
    const planets = r.planets.filter((p) => p.type === 'planet');
    if (!planets.length) return false;
    const owners = new Map<number, number>();
    for (const p of planets) {
      const id = this.ownerAt(p.coords);
      if (id != null) owners.set(id, (owners.get(id) ?? 0) + 1);
    }
    const known = [...owners.values()].reduce((a, b) => a + b, 0);
    if (known >= 2 && Math.max(...owners.values()) <= known / 2) return true;
    const before = this.storedPlanets();
    return before.size > 0 && !planets.some((p) => before.has(key(p.coords)));
  }

  unknownPlayers(names: string[], min: number): boolean {
    if (names.length < min || this.count('players') < MIN_KNOWN) return false;
    return names.filter((n) => this.players.byName(n) != null).length / names.length < MIN_KNOWN_SHARE;
  }

  unknownAlliances(names: string[]): boolean {
    if (names.length < MIN_ROWS || this.count('alliances') < MIN_ALLIANCES) return false;
    const byName = this.db.prepare('SELECT 1 FROM alliances WHERE group_id = ? AND name = ?');
    return names.filter((n) => byName.get(this.target.groupId, n)).length / names.length < MIN_KNOWN_SHARE;
  }

  verdict(): boolean {
    const { compared, other } = this;
    if (compared.galaxy >= MIN_PLANETS && other.galaxy / compared.galaxy > MAX_OTHER_OWNER) return true;
    if (compared.reports >= MIN_REPORTS && other.reports / compared.reports > MAX_OTHER_OWNER) return true;
    if (compared.messages >= MIN_REPORTS && other.messages / compared.messages > MAX_OTHER_OWNER) return true;
    // the member's own planets can't belong to someone else: more than half of them is enough
    if (other.own > 0 && other.own > compared.own / 2) return true;
    return this.unknownPlayers([...new Set(this.names)], MIN_NAMES);
  }

  private storedPlanets(): Set<string> {
    if (!this.stored) {
      const pages = this.db
        .prepare('SELECT data FROM empire_snapshots WHERE group_id = ? AND user_id = ?')
        .pluck()
        .all(this.target.groupId, this.target.userId) as string[];
      this.stored = new Set(pages.flatMap((d) => ((JSON.parse(d) as Partial<EmpireRecord>).planets ?? []).map((p) => key(p.coords))));
    }
    return this.stored;
  }

  /** owners (galaxy data) of the member's stored empire planets */
  private memberPlayers(): Set<number> {
    if (!this.ownPlayers) {
      const ids = [...this.storedPlanets()].map((k) => {
        const [g, s, p] = k.split(':').map(Number);
        return this.ownerAt({ g, s, p });
      });
      this.ownPlayers = new Set(ids.filter((id): id is number => id != null));
    }
    return this.ownPlayers;
  }

  private count(table: 'players' | 'alliances'): number {
    return this.db.prepare(`SELECT COUNT(*) FROM ${table} WHERE group_id = ?`).pluck().get(this.target.groupId) as number;
  }
}

const key = (c: Coords) => `${c.g}:${c.s}:${c.p}`;

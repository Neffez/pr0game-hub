import type { GalaxyRecord, GalaxyRow, PlayerStatus } from '../types.js';

/**
 * universe.json (pr0game galaxy view JSON export, scripts/game/galaxy.js `export_json`):
 * `[galaxy, players, alliances]` with galaxy = { "G:S": { "1".."15": null | slot, timepoint: ms } }.
 */
interface Slot {
  planetname?: string;
  hasmoon?: boolean;
  playerid?: number;
  name?: string;
  allianceid?: number;
  alliancename?: string;
  special?: string;
}

/** Status letters of the universe.json `special` field in the order of pr0game's userStatus() (import and export). */
export const UNIVERSE_JSON_STATUS: [PlayerStatus, string][] = [
  ['banned', 'g'],
  ['vacation', 'u'],
  ['longinactive', 'I'],
  ['inactive', 'i'],
  ['noob', 'n'],
  ['strong', 's'],
];
// "b" for banned in older exports
const SPECIAL: Record<string, PlayerStatus> = { ...Object.fromEntries(UNIVERSE_JSON_STATUS.map(([s, c]) => [c, s])), b: 'banned' };

/** Cheap check before JSON.parse of a possibly large paste. */
export function looksLikeUniverseJson(text: string): boolean {
  return /^\s*\[\s*\{\s*"\d+:\d+"\s*:/.test(text.slice(0, 200));
}

export function parseUniverseJson(text: string): GalaxyRecord[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || typeof data[0] !== 'object' || data[0] == null) return null;
  // "-" marks unknown names in the slots; the player/alliance lists may still know them.
  const known = (v: string | undefined) => (v && v !== '-' ? v : null);
  const players = (data[1] ?? {}) as Record<string, { name?: string }>;
  const alliances = (data[2] ?? {}) as Record<string, { name?: string }>;
  const records: GalaxyRecord[] = [];
  for (const [key, system] of Object.entries(data[0] as Record<string, Record<string, unknown>>)) {
    const m = key.match(/^(\d+):(\d+)$/);
    if (!m || !system || typeof system !== 'object') continue;
    const rows: GalaxyRow[] = [];
    for (const [pos, raw] of Object.entries(system)) {
      if (!/^\d+$/.test(pos) || !raw || typeof raw !== 'object') continue;
      const slot = raw as Slot;
      if (!slot.name && !slot.playerid) continue;
      const playerId = slot.playerid && slot.playerid > 0 ? slot.playerid : null;
      const allyId = slot.allianceid && slot.allianceid > 0 ? slot.allianceid : null;
      const status = [...new Set([...(slot.special ?? '')].map((c) => SPECIAL[c]).filter(Boolean))];
      rows.push({
        position: Number(pos),
        planetName: known(slot.planetname) ?? '',
        moon: !!slot.hasmoon,
        destroyed: false,
        playerId,
        playerName: known(slot.name) ?? (playerId ? known(players[playerId]?.name) : null),
        // a long inactive player is also flagged "i" in the export
        status: status.includes('longinactive') ? status.filter((s) => s !== 'inactive') : status,
        allyId,
        allyTag: null,
        allyName: known(slot.alliancename) ?? (allyId ? known(alliances[allyId]?.name) : null),
        debris: null,
      });
    }
    const timepoint = Number(system.timepoint);
    records.push({ kind: 'galaxy', g: Number(m[1]), s: Number(m[2]), rows, seenAt: timepoint > 0 ? Math.floor(timepoint / 1000) : undefined });
  }
  return records;
}

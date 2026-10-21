import type { ExpoDepletion, ExpoEventType, ExpoSize } from './types.js';

export interface DeckCard {
  type: ExpoEventType;
  size: ExpoSize;
  count: number;
}

/** ExpeditionDeckHandler::$defaultDeckConfig (pr0game, 1000 cards). */
export const DEFAULT_DECK: DeckCard[] = [
  { type: 'Res', size: 'Small', count: 329 },
  { type: 'Res', size: 'Medium', count: 37 },
  { type: 'Res', size: 'Big', count: 4 },
  { type: 'Ships', size: 'Small', count: 235 },
  { type: 'Ships', size: 'Medium', count: 26 },
  { type: 'Ships', size: 'Big', count: 3 },
  { type: 'Pirates', size: 'Small', count: 51 },
  { type: 'Pirates', size: 'Medium', count: 5 },
  { type: 'Pirates', size: 'Big', count: 1 },
  { type: 'Aliens', size: 'Small', count: 23 },
  { type: 'Aliens', size: 'Medium', count: 2 },
  { type: 'Aliens', size: 'Big', count: 1 },
  { type: 'Fast', size: 'Small', count: 17 },
  { type: 'Fast', size: 'Medium', count: 4 },
  { type: 'Fast', size: 'Big', count: 2 },
  { type: 'Slow', size: 'Small', count: 48 },
  { type: 'Slow', size: 'Medium', count: 13 },
  { type: 'Slow', size: 'Big', count: 6 },
  { type: 'BlackHole', size: 'None', count: 3 },
  { type: 'Nothing', size: 'None', count: 190 },
];

export interface DeckEvent {
  event: ExpoEventType;
  size: ExpoSize;
  depletion: ExpoDepletion;
}

export interface DeckOptions {
  /**
   * Depletion probability assumed for "Nothing" results without probe hint.
   * 0 = every Nothing counts as a drawn card.
   */
  unknownDepletionChance?: number;
  /** cards already drawn from the current deck before the first event (manual correction) */
  initialDrawn?: Partial<Record<string, number>>;
}

export interface DeckCardState extends DeckCard {
  key: string;
  /** expected remaining */
  remaining: number;
  remainingMin: number;
  remainingMax: number;
  nextProbability: number;
}

export interface DeckState {
  deckSize: number;
  cards: DeckCardState[];
  remainingTotal: number;
  drawnInDeck: number;
  resets: number;
  events: number;
  uncertainNothing: number;
}

export const cardKey = (type: string, size: string) => `${type}:${size}`;

/** random_int(0, 100) < chance  ->  chance / 101 */
const DEPLETION_CHANCE: Record<Exclude<ExpoDepletion, null>, number> = {
  none: 0,
  few: 25 / 101,
  medium: 50 / 101,
  many: 75 / 101,
};

/**
 * Tracks the per-player expedition deck (cards drawn without replacement, deck
 * regenerated when empty). "Nothing" can also come from system depletion, which
 * doesn't draw a card - such results are counted with their posterior probability.
 */
export function computeDeck(config: DeckCard[], events: DeckEvent[], opts: DeckOptions = {}): DeckState {
  const cards = config.filter((c) => c.count > 0);
  const deckSize = cards.reduce((s, c) => s + c.count, 0);
  const unknownChance = opts.unknownDepletionChance ?? 0;

  let remaining = new Map<string, number>();
  let nothingCertain = 0; // drawn Nothing cards known for sure
  let nothingPossible = 0; // drawn Nothing cards at most
  let resets = 0;
  let uncertain = 0;

  const fresh = () => {
    remaining = new Map(cards.map((c) => [cardKey(c.type, c.size), c.count]));
    nothingCertain = 0;
    nothingPossible = 0;
  };
  const total = () => [...remaining.values()].reduce((s, v) => s + v, 0);
  fresh();

  for (const [key, n] of Object.entries(opts.initialDrawn ?? {})) {
    if (remaining.has(key) && n) remaining.set(key, Math.max(0, remaining.get(key)! - n));
  }
  const nothingKey = cardKey('Nothing', 'None');
  nothingCertain = nothingPossible = opts.initialDrawn?.[nothingKey] ?? 0;

  for (const ev of events) {
    const key = cardKey(ev.event, ev.size);
    if (ev.event === 'Nothing') {
      const pd = ev.depletion == null ? unknownChance : DEPLETION_CHANCE[ev.depletion];
      const remNothing = remaining.get(nothingKey) ?? 0;
      const q = total() > 0 ? remNothing / total() : 0;
      const pCard = pd <= 0 ? (remNothing > 0 ? 1 : 0) : ((1 - pd) * q) / ((1 - pd) * q + pd);
      remaining.set(nothingKey, Math.max(0, remNothing - pCard));
      if (pCard >= 1) nothingCertain++;
      if (pCard > 0) nothingPossible++;
      if (pCard > 0 && pCard < 1) uncertain++;
    } else {
      const cur = remaining.get(key);
      if (cur == null) continue; // card type not in config
      if (cur < 0.5) {
        // Card shouldn't be left -> the deck must have been regenerated already.
        resets++;
        fresh();
      }
      remaining.set(key, remaining.get(key)! - 1);
    }
    if (total() < 0.5) {
      resets++;
      fresh();
    }
  }

  const remTotal = total();
  const fullNothing = cards.find((c) => c.type === 'Nothing')?.count ?? 0;
  const cardStates: DeckCardState[] = cards.map((c) => {
    const key = cardKey(c.type, c.size);
    const rem = remaining.get(key) ?? 0;
    const isNothing = c.type === 'Nothing';
    return {
      ...c,
      key,
      remaining: rem,
      remainingMin: isNothing ? Math.max(0, fullNothing - nothingPossible) : rem,
      remainingMax: isNothing ? Math.max(0, fullNothing - nothingCertain) : rem,
      nextProbability: remTotal > 0 ? rem / remTotal : 0,
    };
  });

  return {
    deckSize,
    cards: cardStates,
    remainingTotal: remTotal,
    drawnInDeck: deckSize - remTotal,
    resets,
    events: events.length,
    uncertainNothing: uncertain,
  };
}

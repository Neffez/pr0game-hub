/** Player messages as served by `GET /api/:uni/messages`. */
export interface MessageParty {
  name: string;
  coords: string | null;
  /** player of the own alliance */
  ally: boolean;
  /** hub player, when known */
  player: number | null;
}

export interface PlayerMessage {
  id: number;
  time: number;
  from: MessageParty;
  recipients: MessageParty[];
  subject: string;
  body: string;
  synced_by: string[];
  /** synced by the user: they choose whether the alliance sees their copy */
  own: boolean;
  own_shared: boolean;
  /** the alliance sees it (the user's copy or another member's) */
  shared: boolean;
  conversation: string;
  /** written by the user (or by a member in a conversation without the user): right side in the chat */
  out: boolean;
}

export interface Conversation {
  id: string;
  /** everyone taking part with their newest name; `self` is the user, `member` a hub member */
  parties: (MessageParty & { self: boolean; member: boolean })[];
  count: number;
  last: number;
}

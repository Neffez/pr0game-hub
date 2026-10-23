-- From the reply link (HTML only): conversation id in the syncing member's mailbox and the partner's in-game id.
ALTER TABLE player_messages ADD COLUMN thread TEXT;
ALTER TABLE player_messages ADD COLUMN partner_ingame_id INTEGER;

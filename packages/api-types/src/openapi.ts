/* Generated from apps/server/openapi.yaml by `pnpm --filter @pr0hub/api-types gen`. Do not edit. */

export type paths = {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["openApiJson"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/openapi.yaml": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["openApiYaml"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/date-format": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["setDateFormat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/tours": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change the page tour settings
         * @description Switch tours on or off, mark one tour as seen, or forget all seen tours. At least one field is required; they apply in the order `reset`, `seen`, `enabled`.
         */
        post: operations["setTours"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/fleetsave-presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Offline window presets of the fleet save planner
         * @description The signed-in user's presets, the same on every device. `null` until the user changed them; the web app shows its built-in presets ("Night", "Work") then.
         */
        get: operations["getFleetSavePresets"];
        put?: never;
        /**
         * Store the fleet save presets
         * @description Replaces all presets of the signed-in user. Names are trimmed; of two entries with the same name the later one is kept at its place. An unknown `builtin` is invalid.
         */
        post: operations["setFleetSavePresets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/share-syncs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getShareSyncs"];
        put?: never;
        post: operations["setShareSyncs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/push-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Which notifications are pushed to the caller's devices (the bell lists all of them). */
        get: operations["getPushSettings"];
        put?: never;
        post: operations["setPushSettings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/push/key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Whether web push is set up on this hub (`PUSH_CONTACT`), and the VAPID public key browsers subscribe with. */
        get: operations["getPushKey"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/push/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * @description Registers a browser for push notifications of the caller (the browser's `PushSubscription.toJSON()`). An
         *     endpoint registered by another user before moves to the caller; at most 10 browsers per user (the oldest goes).
         */
        post: operations["addPushSubscription"];
        /** @description Unregisters a browser of the caller (switched off, or before logging out). */
        delete: operations["removePushSubscription"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/push/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Sends a test notification to all browsers of the caller. */
        post: operations["sendTestPush"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/push/subscriptions/quiet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * @description Quiet hours of one of the caller's browsers: while they last, this device gets no push except the kinds in
         *     `except`; what was held back is sent when they end. `quiet: null` switches them off (held notifications go out
         *     within half a minute).
         */
        put: operations["setPushQuietHours"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/discord": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * @description The caller's own Discord webhook (only its start), their Discord user id and which notifications are posted to
         *     the webhook (the same kinds as push, set separately).
         */
        get: operations["getDiscordSettings"];
        put?: never;
        post: operations["setDiscordSettings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/discord/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Posts a test message to the caller's own Discord webhook. */
        post: operations["sendTestDiscord"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        /**
         * @description Existing accounts (with or without a password) that can be added to the alliance, e.g. members of its
         *     alliance in a previous universe; members of the alliance are left out. Global admins get every account,
         *     alliance admins the members of the alliances (in any universe) they are admin of.
         */
        get: operations["listGroupMemberCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        /** @description Members of the alliance; alliance admins. */
        get: operations["listGroupMembers"];
        put?: never;
        /**
         * @description Adds a member; alliance admins. With `name` a new placeholder account (no password) is created together with
         *     a claim invite. With `userId` an existing account (one of `listGroupMemberCandidates`) joins as member; no
         *     account and no invite are created, and the in-game name defaults to the account's most recent one.
         */
        post: operations["addGroupMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/discord": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        /** @description The alliance's Discord channel webhook (only its start) and what is posted there; alliance admins. */
        get: operations["getGroupDiscord"];
        /** @description Sets the channel webhook and what is posted there; alliance admins. */
        put: operations["setGroupDiscord"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/discord/test": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Posts a test message to the alliance's Discord channel; alliance admins. */
        post: operations["sendTestGroupDiscord"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/fleet-attacks": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        /**
         * @description Running attacks (solo and ACS) in the latest stored overview fleet list of every member, so global admins can
         *     remove wrong entries. Waves with the same route and ships share `key` and differ by `arrival`.
         */
        get: operations["listGroupFleetAttacks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/fleet-attacks/remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * @description Removes one attack (one wave with `arrival`) from every stored fleet list of the member; global admins. The
         *     alliance's hidden mark of the key is removed only when no stored fleet list of the alliance still holds an
         *     attack with this key.
         */
        post: operations["removeGroupFleetAttack"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/universes/{slug}/units": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        /** @description Ships, defense and missiles of a universe for global admins - the defaults, its differences and the result. */
        get: operations["getUniverseUnits"];
        /** @description Replaces the differences of a universe (only differences are stored, so later changes of the hub's defaults reach it). Every page of the universe's groups reloads its context. */
        put: operations["putUniverseUnits"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/universes/{slug}/units/parse": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Unit values from a pasted page source of the game (shipyard or defense page, tech tree, a unit's info page); nothing is stored. An info page has no id: its name is looked up in the units of the hub and of all universes and in `names` (e.g. of a shipyard page pasted before). */
        post: operations["parseUniverseUnits"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/system": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * @description Operating figures for global admins: database file size, free pages and WAL, size and rows per table, free disk
         *     space, memory (process and container limit), event loop delay, users online and active, syncs per day and per
         *     alliance, response times per route since the start, the slowest recent requests and the hourly samples of the
         *     last 90 days. Reads the whole database file once, so meant for on-demand use.
         */
        get: operations["getSystemInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/system/vacuum": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Rewrites the database file without its free pages (SQLite `VACUUM`); the hub does not answer while it runs. */
        post: operations["vacuumDatabase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/access-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * @description Request for access without an invite (login page). The username and password are kept (hashed) until a global
         *     admin assigns the request to a player without an account, who then logs in with them. Public; limited to 5
         *     requests per IP and hour and 100 open requests.
         */
        post: operations["requestAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/access-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * @description Open access requests and the players without an account they can be assigned to. Global admins get all players,
         *     alliance admins the players who are only in alliances they are admin of (and see all requests, which carry no
         *     alliance).
         */
        get: operations["listAccessRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/access-requests/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * @description Gives the request's username, password and language to a player without an account, who can log in with them
         *     from then on; the request is removed and open claim links of the player are revoked. Global admins, or alliance
         *     admins for players who are only in alliances they are admin of (the player stays a member of all of them).
         */
        post: operations["assignAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/access-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** @description Rejects (removes) an access request; global admins only. */
        delete: operations["deleteAccessRequest"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listApiTokens"];
        put?: never;
        post: operations["createApiToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["revokeApiToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/universes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listUniverses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/sync-hints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description What the member should paste next, most important first (an empty list: the hub is up to date). Own pages that are missing or old (empire, overview or fleet page, the galaxy systems around the own planets, buildings pages per planet, a research page, messages) and the group's shared data (statistics: categories missing in the newest synced update, or a newer update due after the interval learned from the synced ones; the market rate). `messagesDays`: how many days a messages page counts (raw pages are kept that long). */
        get: operations["getSyncHints"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Onboarding checklist of the viewer: the first syncs of a new member in order (`empire`, `stats`, `overview`, `research`, `galaxy`, `messages`, `buildings`), each with the time the member first synced such a page (null while open). Pages synced for another member count for the one who pasted them. */
        get: operations["getOnboarding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/farm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Farm finder: every spied planet or moon of players outside the own alliance (members and the in-game alliance of the viewer's player) with a spy report showing resources within `days`, with the expected resources now. The production since the report comes from the mine, power plant and storage levels of the newest report with buildings (formulas of the game's `ResourceUpdate`), the position's default temperature, the mining research of the player's newest report with research and the resource multiplier (`resourceSpeed` as a factor; `speedSource`: `settings` from the universe, `empire` derived from the members' synced production, `default` 1 when neither tells). Positions that changed owner or were destroyed since the report are left out. Sorting and flight math are up to the client. */
        get: operations["getFarmTargets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Latest synced statistics page of a category; player `rows` carry `points_stall` (see `PointsStall`). */
        get: operations["getStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/players": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["searchPlayers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Global search of the hub (Ctrl+K). For coordinates (`1:120:8`, with or without brackets) only `planet` is filled: the known planet there with its owner, or just the position when the hub knows nothing about it. Otherwise (at least 2 characters) up to 8 `players` by name or former name (`alias`: the former name that matched) and up to 5 `alliances` by name or tag, best matches first (exact, then starting with the term). */
        get: operations["globalSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/inactivity-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Alliance admins: how well the inactivity score (see `Inactivity`) fits the group's data. Players the game flagged `inactive` in the last 45 days (at most 40) were last online the universe's inactive days before the flag appeared; that login lies between the sightings without and with the flag (at most 7 days apart), or after a proof of activity before it, and is used when known within 2 days; the score is replayed 12, 24, 48, 72 and 120 hours after that (only data up to then): `detection` gives per offset the players evaluated, the share scored at least likely (≥ 50) and inactive (≥ 85) and the median score. `falseAlarms` samples the score once a day over 30 days and counts scores of at least likely that were followed by proof of activity or a relevant points gain within 3 days, with up to 15 examples. `weights` are the weights in use. Computed in steps and kept for 15 minutes; `fresh=1` computes anew. */
        get: operations["getInactivityCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/players/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description One player: scores over time, `planets` (with `has_moon`, `moon_name`, `moon_diameter` in km or null, newest spy report times), recent spy reports and further intelligence of the group; `pointsStall` (see `PointsStall`) from the whole score history; `inactivity` (see `Inactivity`). */
        get: operations["getPlayer"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/players/{id}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Evidence of when the player was online during the last 7 days, for the activity pattern (plus the stat stands for the point gain per window): espionage on members, battles (as attacker; as defender only with more than one defending fleet), messages the caller may see, galaxy activity marks, launches and recalls of hostile fleets and manual reports of members; for a member's player also their syncs (unless they hide them, `share_syncs`) and half hours with an active hub tab (unless they hide their online status), always visible to themselves and global admins. Each event has a best estimate `time` and the half width `spread` of its uncertainty. */
        get: operations["getPlayerActivity"];
        put?: never;
        /** @description Report that the player is online or offline now or was at `time` (within the last 7 days, not in the future). `kind` is `online` (default) or `offline`. The same member's report for the same minute counts once. */
        post: operations["reportPlayerActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/players/{id}/activity/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** @description Withdraw one of the caller's own manual or offline reports. */
        delete: operations["deletePlayerActivity"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/imperium": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Latest empire, overview, fleets and live points for a member (`user` query = member user id, default self), with the caller's own fleet alerts. */
        get: operations["getImperium"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/debris": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Debris finder: open debris fields of the group's data with the debris expected now, largest first. The last known amount is the newer of the galaxy view and a member's recycling report (`base`, the exact rest); battles at the position after it (synced battle and combat reports, once per battle) add their debris (`battles`). Fields whose newest information (`time`) is older than `days` are left out. `recyclers`: recyclers of the members per planet and moon from their newest empire pages with the recycler speed of their drives; `capacity`: cargo of one recycler in this universe. Distance and flight time are up to the client. */
        get: operations["getDebrisFinder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/colonize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Colonization planner: every system seen in the group's galaxy data with free positions (no planet, not destroyed) and what a colony there adds for the viewer. `coverage`: by how much a planet there shortens the mean distance (game formula between system centres) from every system of the universe to the viewer's nearest planet, as a share of the mean now (1 without own planets); `nearest`: distance to the viewer's nearest planet; within `range` systems of the same galaxy: `members` (planets of other members and in-game alliance mates), `targets` (planets of other players), `inactive` (of them flagged by the game), `targetPoints` (total points of those players, each once) and `systemPoints` (of the players in the system). The position itself (astrophysics, fields, temperature, bonus) comes from `@pr0hub/core/colonize` with the universe settings. */
        get: operations["getColonizeSystems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/debris-fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Debris fields of up to 10 galaxies that recyclers can fly to by the group's data (fleet save targets). The game allows recycling while a field holds debris or is active: a battle left debris there since its weekly cleaner (the universe's `debrisCleanup*` settings, default Saturday 02:45), which marks all fields inactive. `visible`: the galaxy shows debris there; `active`: debris was created since the last cleaner run (battle report, debris appearing or growing); `sure`: active, or the debris was seen after the run (otherwise it may have been harvested since and the empty field is gone); `time`: the newest sign; `cleanup`: the last cleaner run. */
        get: operations["getDebrisFields"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/free-positions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Free positions of up to 10 galaxies by the group's galaxy data (fleet save targets by colonization): per system seen in the galaxy the positions without a planet (destroyed planets count as taken) and when it was seen. Systems without a free position and systems never seen are left out. */
        get: operations["getFreePositions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/alliance-health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Alliance health for every member of the group: per member the total points, rank and their growth over 7 days (from the newest statistics update at or before the start, `partial` when the history is shorter), the newest sync per page type (kept pages of 14 days and the snapshot tables), the last visit in the hub, battle reports and expeditions they synced in 7 days with the loot, open deliveries of finalized loot settlements, and flags: `behind` (growth below half the alliance median), `noEmpire` (no empire page known), `staleEmpire` (the newest empire page is older than 3 days), `noStats` (no statistics), `away` (not in the hub for 3 days). The last visit (`lastSeen`, and `away`) of members who hide their online status is only shown to themselves and to admins (`onlineHidden`). */
        get: operations["getAllianceHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The group's data as one JSON file (attachment): `players` (with alliance, status, newest points and rank per category), `planets` (galaxy data with moon and debris), `spy-reports`, `battle-reports` and `expeditions` of the last `days` (default 30), and the deliveries of finalized loot settlements. Only what every member sees in the hub. Works with a read-only API token. */
        get: operations["exportGroupData"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/export/{dataset}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description One dataset of `/api/{uni}/export` as CSV (attachment, UTF-8 with BOM, header row, times as Unix seconds, numbers unformatted). Texts starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`, so a spreadsheet does not read a name as a formula. `dataset` may end in `.csv`. Works with a read-only API token. The `players` and `planets` datasets take the overview's filters (`q`, `ally`, `inactive`, `vacation`, `minPoints`, `maxPoints`, for planets also `galaxy`); planets follow their owner's filters. Other datasets ignore them. */
        get: operations["exportDatasetCsv"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/attack-assist": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Incoming attack assistant for one hostile attack on a member (from the members' fleet lists or a phalanx result, like `/api/{uni}/hostile-attacks`), found by `key` (optionally with `arrival` for waves) or by `member`, `arrival` (± 5 s) and `from`. Returns the attack, the attacked body from the member's newest empire page (units, resources projected to the impact), the attacker's ships and research (newest spy reports), the loot the attack can take, the member's bodies and research for a fleet save, the members' bodies with ships that can still land a hold 1 s before the impact (latest launch at full speed, strongest first), an open hold plan for it and the hostile phalanxes reaching the planet, and the hold fleets there at the impact (hold flights in the members' synced fleet lists that land before it and still hold after it; members' bodies holding are no helpers). `sim` is a battle simulation of 20 runs on the game's engine: the attacking ships with the attacker's research against the planet's ships and defense with the member's combat research, plus the hold fleets (null with `sim=0`, after the impact or without known ships or planet; `{ error }` when the simulator is busy or missing). */
        get: operations["getAttackAssist"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/defense-advice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Defense advisor for one of the caller's planets or moons (from the buildings page state: levels, units and resources of the newest empire, buildings or overview page). Lists the attackers the hub knows for it (at most 8): players who spied on the caller or attacked one of the caller's bodies in the last 14 days, hostile fleets on their way to the caller, and the 5 strongest players with a fleet in a spy report of the planet's galaxy; members and the own alliance are left out. Each comes with the strongest fleet known (spy report, battle report or fleet movement; spy probes and solar satellites left out), the newest fleet points of the statistics, the research of the newest spy report (else the caller's levels as an estimate) and the flight (one way at full speed from where the fleet was seen, else the owner's nearest planet) with its deuterium, and `heavy`: only the fleet's heavy ships (hull of a battleship and up), as raiders send against defense and solar satellites; each threat is searched in both variants (search key `<key>:heavy` for the heavy one). `advice` runs the search in the battle worker (counts as one simulation of the simulator's rate limit): the attacker's profit of one attack is loot + debris field (with `debris`) − ships lost − fuel in deuterium by the group's market rate (default 3 : 2 : 1); the defense types that cut the worst attacker's profit most per resource are mixed and scaled until no chosen attacker profits (status `found`), `safe` when none profits already, `limit` when no buildable defense does it for up to 20 times the profit, `budget` when the battles are too large for the engine budget. Shield domes are added once when they help; the shipyard queue counts as built. Null with `sim=0` or without threats; `{ error }` when the simulator is busy or missing. */
        get: operations["getDefenseAdvice"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/threats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Who threatens the caller: the players outside the own alliance who spied on the caller (hostile spying), fought as attackers at the caller's planets or moons (battle reports) or have an attack on its way, within `days`. Ranked by `score`: every event weighted by kind (espionage 1, battle 4, attack on its way 6) and halved per 7 days of age. With the trend of their fleet points, their known planet nearest to one of the caller's and the hours of the day they usually come at. */
        get: operations["getThreats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/defense-risk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Raid risk of all the caller's planets and moons: per body the known threats of `/api/{uni}/defense-advice` (full fleet and heavy ships only) against the body as it is, a few runs each within an engine budget; the most profitable attack is the body's risk. Runs in the battle worker (one simulation of the simulator's rate limit); the result is kept for 30 minutes while the input stays the same (`cached`). */
        get: operations["getDefenseRisk"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/fleets/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Notify the caller when one of their own fleets in flight arrives, `lead` minutes before (default 0: at the arrival). The fleet is given as listed in the caller's newest fleet list (mission, phase, start, target, arrival; the arrival may be a few seconds off). Setting it again changes the lead. */
        put: operations["putFleetAlert"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/fleets/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Share one of the caller's own fleets with the other members of the group or not, ahead of the account setting (`/api/auth/fleet-share`), for the fleets in flight and the history. The fleet is given as in the caller's newest fleet list or history (like a fleet alert); the later lines of its flight (holding, return: same mission and planets, the only one of its phase) get the same choice. In the caller's own empire view own fleets carry `shared`. */
        put: operations["putFleetShare"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/fleets/alerts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteFleetAlert"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/buildings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The caller's planets and moons for the build & research page: per planet the levels, resources (with their time), production per hour, storage, fields and build queue of the newest synced empire page or buildings page, the cost and build time of the next level as a buildings page showed them (`shown`, valid while `next` is still the next level) and the resources of fleets landing on it (`arrivals`); plus research, the catch-up bonus, the building speed (derived from a buildings page or the universe setting `buildingSpeed`, null when unknown), the storage factor, the caller's building alerts (alerts whose level is built or queued are left out; they are deleted when a page is pasted, this read writes nothing) and the buildings the caller hid (`hidden`, kept in the account). */
        get: operations["getBuildings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/storage-alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * @description The caller's planets (buildings page state, no moons) with whether a full storage there notifies by push and
         *     Discord: `muted` planets stay silent, the bell (`/api/{uni}/notifications`) lists them all the same.
         */
        get: operations["getStorageAlerts"];
        /** @description Replaces the caller's muted planets in this alliance. */
        put: operations["setStorageAlerts"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/buildings/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Notify the caller when `level` of building or research `id` on one of their synced planets is affordable and not blocked (one alert per element and planet, replaces its level; research only on planets). */
        put: operations["putBuildingAlert"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/buildings/hidden": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Replaces the buildings and research the caller hides under build & research (kept in the account, for all planets and universes). */
        put: operations["putHiddenBuildings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/buildings/alerts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteBuildingAlert"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/build-order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The caller's build order in the group (imported from pr0plan, shown under build & research), null when none. Steps the synced pages show as done are returned checked off; this read writes nothing (they are stored as done when a page is pasted). The next step of each planet notifies (`buildorder`, see `/api/{uni}/notifications`) once it can start. */
        get: operations["getBuildOrder"];
        /** @description Imports a build order, replacing the caller's one in the group (also used to start one by hand, `meta.source` `hub`). The client maps the file's planets onto hub planets and sets the base. Planets without coordinates yet (before the start, or a colony still to come) use the planned key `0:0:<n>:planet` (n: pr0plan planet id) and are later moved with `/api/{uni}/build-order/assign`. */
        put: operations["putBuildOrder"];
        post?: never;
        /** @description Deletes the caller's build order in the group. */
        delete: operations["deleteBuildOrder"];
        options?: never;
        head?: never;
        /** @description Replaces the steps (new order, done and deactivated flags, removed or added steps). The base is replaced only when `base` is sent (the client sets the start levels of elements added by hand); meta stays. */
        patch: operations["patchBuildOrder"];
        trace?: never;
    };
    "/api/{uni}/build-order/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Assigns a planned planet of the caller's build order (key `0:0:<n>:planet`) to a planet: its steps and base and the transports to it move to `to`; the import's planet mapping in `meta` follows. */
        post: operations["assignBuildOrderPlanet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/market": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The group's resource market: the current market rate (`rate`, null when none is known), the last 30 rates (`rates`, newest first), time and member of the latest marketplace sync (`syncedAt`, `syncedBy`, null before the first one), the offers it showed that haven't ended yet (`offers`, by end) and the synced trade history (`trades`). Rates come from pasted marketplace pages (`source`: exact from the page's HTML, a copied page or the page source; `text`: estimated from the exchange rates of plain text, not kept when an exact rate is within an hour) or are set by hand (`manual`); a sync with the same rate moves the newest row on in time instead of adding one. */
        get: operations["getMarket"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/market/rate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Sets the group's market rate by hand (metal `m` and crystal `k` per 1 deuterium); it becomes the current rate. */
        put: operations["setMarketRate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/alliance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Combined empire/spy data and shared fleets for all members (respects fleet sharing). */
        get: operations["getAlliance"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/galaxy-views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getGalaxyViews"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/browse/{g}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Navigation strip of one galaxy, keyed by system: `planets` (occupied positions), `points` (sum of the newest total points of the players with a planet in the system, each player once), `seen` (time of the newest synced galaxy view) and `own` (systems with a planet of an alliance member). */
        get: operations["browseGalaxy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/browse/{g}/{s}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description One system of the group's galaxy data: `rows` per position with planet, moon (`has_moon`, `moon_name`, `moon_diameter` in km from the moon tooltip of a synced galaxy view, null when unknown), owner, debris and the newest battle; plus who synced the system when. */
        get: operations["browseSystem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/battle/simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Simulate a battle on the game's battle engine
         * @description Fights the battle `runs` times on Battlerust, pr0game's own battle engine (stun of ion cannons, rapidfire, explosions, defense rebuild), and summarizes the runs: win chances, losses per unit, debris, loot, moon chance and flight times. Allowed with a read-only API token (it writes nothing). Without a planet in `defenders[0]` the group's newest spy report of `target` is the planet (ships, defense, combat research, resources). Universe settings of the hub (debris percentages, shield domes, layout, fleet speed) apply unless overridden. Limits: 5,000,000 pieces (ships and defense, not resource units) per battle, 50,000,000 pieces × runs, 20 simulations per minute and user, 20 seconds.
         */
        post: operations["simulateBattle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/spy/{g}/{s}/{p}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSpyAtCoords"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/spy-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The group's spy reports, newest first (report time, then id). */
        get: operations["listSpyReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/hostile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHostileSpy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/hostile-attacks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Hostile attacks on members (overview pastes) and from phalanx results, ACS fleets as one attack. Listed until their latest possible return, also after the impact (taken from the member's older fleet lists then). `planId` and `holdPlanId` name the retime and hold plan answering an attack; `hidden` (`by`: member name, `at`: epoch seconds) is set when a member hid it for the group, else null. */
        get: operations["getHostileAttacks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/hostile-attacks/hide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Hides a hostile attack in the raid planner for the whole group, until the attack's latest possible return (`until`). A later attack with the same key (same route and lead ships) arriving after that is listed again. */
        post: operations["hideHostileAttack"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/hostile-attacks/unhide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Shows a hidden hostile attack again for the whole group (no error when it is not hidden). */
        post: operations["unhideHostileAttack"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/own-attacks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Own attacks in flight (attack, ACS attack, destroy) from the members' newest overview pastes that no open plan on the target covers yet (target time within an hour of the arrival). Only listed for their participants: the member whose own fleet it is, in an ACS also members whose planet a joined fleet starts from (galaxy data). ACS fleets as one attack, the lead first; fleets of non-members have `memberId` null. */
        get: operations["getOwnAttacks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/battle-hall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Paginated battle hall archive. Each entry includes `moon_destruction` (0 or 1) when the report is locally archived and was a moon-destruction battle; otherwise 0, and `memorial`: 1 for a farewell battle (a player crashing on purpose when quitting, flagged by the game; learned from a hall synced with the farewell filter "only"), 0 when seen with the filter "hide", null when not known. Farewell battles are left out by default. The response carries `memorials`, the number of farewell battles of the group regardless of filters. */
        get: operations["getBattleHall"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/combat-reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Archived battle report: outcome, losses, debris, `loot_metal`, `loot_crystal`, `loot_deuterium` (captured by all attackers together, 0 for reports archived before the loot was read), the attacked planet or moon `g`, `s`, `p`, `planet_type` (null when the page hid the coordinates) and the fleets before and after. Reports pasted as text have the id of the battle message at the same target and time, else the id of the same battle archived from its public page (same time and losses, coordinates hidden), else a local id `text-<epoch>-<g>-<s>-<p>`. Archiving a report again fills in what the stored one lacked (target, loot); a report archived later with its game id (link, battle hall) takes over the local copy of the same battle, whose local id then no longer exists. */
        get: operations["getCombatReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/raids": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Raid statistics of the members in the time range: battle reports (`perUser`, `reports` with the game's `report_id`, `archived` 1 when the full report is archived under `/combat-reports/{id}` and `target_player_name`, the owner of the target from the galaxy), recycling (`recyclePerUser`, `recycling`) and interplanetary missile impacts (`missilePerUser`: per member their attacks, missiles fired, intercepted of those with a known result (`known`) and destroyed units by id; `missiles`: the impacts with `result` hit/intercepted/noDefense or null, `intercepted`, `losses` {unit id: count}, `created_at` (when the copy was synced, for impacts without a time) and `defense` true when the member's planet was the target). */
        get: operations["getRaids"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/expeditions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getExpeditions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/deck": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getDeck"];
        /** @description Saves the expedition deck of a member. */
        put: operations["putDeck"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Raid planner plans including fleets, enemy retime data and phalanx snapshots. `spy` holds the values for the combat simulators: the target's newest spy report, for hold plans the defended planet (attacked member's empire page, else its newest spy report). Hold plans also return `enemy.research` and `enemy.research_time`, the attacking player's research from the newest spy report showing it (null when unknown). `enemy.planet_ships` holds the ships on the attacked planet changed by hand (null: those of `spy`). A fleet in flight carries `seen` (`arrival`, `time` of the overview, `ships` flying), from its member's overview or, in an ACS, from another participant's overview showing it from a planet of that member. `guests` lists ACS fleets of non-members taken over from an overview (`planOwnAttack`) for the simulators, with their player's research from the newest spy report showing it (`research`, `research_time`, null when unknown). This read does not write. Plans made from an own attack (`planOwnAttack`) follow the running attack when an overview is pasted or `syncPlans` runs: fleets joining the ACS later are added as launched fleets (existing fleets stay as they are), `guests` are renewed and the target time and claim move with a changed arrival. Recalls are applied the same way: a plan fleet whose member's newest overview, pasted before the fleet would have landed, shows it flying back from the target to its start after an older overview showed it going there is withdrawn with `recalled_at` (page time of that overview; once per fleet). When no fleet of the plan is left, the plan is cancelled and its claim released. Attack plans with a taken-over battle simulation (`updatePlanFromSim`) carry `sim` (`time`, `by`: member name, `defender`: whether it holds the target), else null; `spy.source` is `sim` when the simulation's ships, defense and combat research replace those of an older (or missing) spy report, else `spy`. Guests whose combat research comes from the simulation have `research_source: sim`. */
        get: operations["getPlans"];
        put?: never;
        /** @description Creates a raid plan and claims the target. */
        post: operations["createPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Applies stored overview pastes to the group's raid plans: fleets that joined a running ACS, a moved arrival, recalled fleets withdrawn, hold and retime times following the impact, and fleets seen in flight marked launched. GET /plans is a pure read; the raid planner calls this when it opens so the list is current without a new paste. Session cookie only (API tokens are read-only). */
        post: operations["syncPlans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/own": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Plan for an own attack in flight (`key` from `getOwnAttacks`), by one of its participants: target and exact target time from the overview, status launched, one launched fleet per member with the ships flying (speed 100 %), fleets of non-members as `guests` of the plan. Claims the target like a new plan. The plan keeps the attack's key and follows it when an overview is pasted or `syncPlans` runs (see `getPlans`). */
        post: operations["planOwnAttack"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/sim": {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Takes a pasted battle simulation (or battle report) over into an attack plan; creator, admins and participants. Coordinates in the text are ignored (simulations show placeholders). The first defender becomes the target's ships, defense and combat research (109-111 from the percentages) for the simulators. Attacker fleets only change the plan when recognised: by the name of a member or guest, else by the slot (plan fleets that are not withdrawn, then guests) with the same ship types, else as the only remaining fleet with those ship types. Recognised member fleets take the ships and their combat research (returned as the fleet's `sim_research` in `getPlans`, only the levels the member's own research lacks), guests their combat research and, unless the plan follows a running attack, the ships. Replaces an earlier simulation of the plan. */
        post: operations["updatePlanFromSim"];
        /** @description Drops the taken-over simulation; the target's spy report and the guests' spy research count again. */
        delete: operations["removePlanSim"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/settlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Attack and hold plans to settle: plans of the last `days` (default 30, at most 90) that were launched or done, or have a saved settlement, newest first. `members` are the plan's members (for a hold also the attacked member), `battle` whether a battle message or report at the target around the plan's time is known, `saved` the stored settlement (null if none): when its corrections were last saved, when it was finalized (null while it follows the synced data) and, once finalized, the number of deliveries and how many are marked done. `stage`: open settlements of the last week are checked against the hub's data (`waiting` with `missing` items, else `ready`; older ones `open`), finalized ones are `delivering` until every delivery is ticked off (`settled`). `deadline` is 24 hours after the last battle, `mine` the caller's open deliveries of a finalized settlement; deliveries the transport messages show delivered in full count as done. */
        get: operations["listSettlements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/settlements/from-report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Plan to settle a battle after the fact, from a pasted battle report (copied while logged in, with coordinates). The report is archived like a sync. When members attacked it is an attack, when members defended a hold; `mission` decides when set. A plan at the same target around the report's time with that mission is returned instead of a new one (`existing`). A new plan is done: members' fleets launched from their start planets with the ships before the battle (speed 100 %), non-members as guests; a hold keeps the first defender as the attacked member and the attackers as the enemy. Open its settlement with GET /plans/{id}/settlement. */
        post: operations["settlementFromReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/settlement": {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        /** @description ACS loot settlement of an attack or hold plan. `draft` is prefilled from the hub's data: participants from the plan's fleets (members as `u<user id>`, then guest fleets), battles at the target around the plan's time (fleets and losses from the archived battle report, else the planned ships; `key` the report id, else `t<time>`), loot by cargo space unless a member's fleet return messages (one per fleet in the report, the first after the battle) or else their flights home in the overview (first per fleet with its surviving ships) tell what each fleet brought home (`sources.returnLoot`, `sources.returnSource`; together at most the battle's loot), recycling reports at the target within 24 hours (`key` `r<id>`, members outside the plan as helpers keeping 20 %), the deuterium of the attack flights (with the flight time of their return flight in the overview when seen, else the planned speed: `sources.flightDeutFrom`), the deuterium of the recycler flights estimated from the recyclers' return messages (`sources.recDeut`) and the interplanetary missiles of the members' missile impact messages on the target (`sources.missiles`). `sources` tells where the draft's values come from. `overrides` are the corrections made by hand on top of the draft (`Overrides` of `@pr0hub/loot`, null if none), `corrected` when they were last saved. `state` is the settlement everyone sees: the draft with the corrections (so data synced later flows in), or, once `finalized`, the state frozen then; `finalized.live` is what it would be now and `finalized.changes` counts the differences per kind. `result` is computed from `state` by `@pr0hub/loot`, `done` lists the deliveries marked done, `delivered` what the members' transport messages show delivered per delivery of a finalized settlement and `auto_done` the deliveries delivered in full by them (a transport counts from the finalizing on for three days and for one settlement only, the one finalized first), `me` is the caller's id in a settlement. A hold is settled like an ACS: participants are the hold fleets and the attacked member, the battle report's defenders (ships only) and no loot, so the debris covers their losses. */
        get: operations["getSettlement"];
        /** @description Saves the corrections of the settlement for the group (participants of the plan, for a hold also the attacked member, its creator or a group admin): `state` is the edited settlement, cleaned like a share link (known fields only, numbers clamped, at most 5 participants); only what differs from the current draft is stored. Not while the settlement is finalized. */
        put: operations["saveSettlement"];
        post?: never;
        /** @description Deletes the stored settlement: corrections, finalized state and deliveries marked done (participants of the plan, its creator or a group admin). It then follows the hub's data again without corrections. */
        delete: operations["deleteSettlement"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/settlement/finalize": {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Finalizes the settlement (participants, creator or admin): its current state is frozen, so the deliveries stay as they are while people send; data synced later only shows in `finalized.changes`. With `state`, the corrections are saved first (as PUT). */
        post: operations["finalizeSettlement"];
        /** @description Reopens a finalized settlement (participants, creator or admin): it follows the hub's data again with its corrections (a settlement saved before corrections existed is turned into corrections of its whole state). The deliveries done (by hand or transport report) are remembered with their amounts: finalizing it again keeps those whose amounts did not change. */
        delete: operations["reopenSettlement"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/settlement/done": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Marks a delivery of the finalized settlement as done (`done` true or missing) or open again (`done: false`): its sender or receiver, participants of the plan, its creator or a group admin. */
        put: operations["markSettlementDelivery"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/claims": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getClaims"];
        put?: never;
        /** @description Claims a target for the alliance. Body: `g`, `s`, `p`, `type` (`planet`, `moon` or `debris` for the debris field at the position), `kind` (`farm`, `attack`, `spy`; always `recycle` for a debris field), `minutes` (1–1440, default 120), `note`, `force` (group admins take over). A claim of the debris field and one of the planet at the same position don't block each other. */
        post: operations["createClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getComments"];
        put?: never;
        /** @description Adds a comment on a player, loot settlement or planet. */
        post: operations["createComment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/comments/counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Number of comments per `players` (player id), `plans` (raid plan id, loot settlement) and `planets` ("g:s:p:type"). */
        get: operations["getCommentCounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Synced in-game messages (respects per-user and per-message sharing). */
        get: operations["getMessages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/moon-chances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Moon chances: battles of the group's combat reports within `days` (1–365, default 30) that had a moon chance or created a moon, newest first, with the chance in percent (plus the cascading `extra`, capped at 100), the sides, the side a member fought on (by in-game names) and the moon at the position now (galaxy); per member the battles, the expected moons (sum of the chances) and the moons created; `newMoons`: moons that appeared at members' planets in the galaxy within the period. Reports stored before the moon chance was read are missing. */
        get: operations["getMoonChances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * @description Current notifications, earliest first (none before the start or after the end of the universe; a read that
         *     writes nothing, the push and Discord senders keep since when a storage is full): `attack` (hostile fleets heading for a member, from the members' shared
         *     fleet lists; `fleet`, `fleets`, `attackerFleetPoints`: the newest fleet points of the origin's owner in the
         *     statistics, null when unknown), `invite` (the caller's open invitations to a raid planner plan in planning;
         *     `plan`, `member` is who invited, `time` its target time, valid until the end of its day or hour by
         *     `plan.time_precision`), `comment` (comments of others of the last 48 hours in a thread the caller wrote in, after
         *     the caller's last comment there, or anywhere when they mention the caller as `@` with their in-game name or
         *     username, one entry per thread; `thread`, `excerpt`, `count`, `mention` (true when one of them mentions the
         *     caller), `member`/`userId` the newest author, `time` the newest comment), `launch` (a fleet of the caller in a plan with an exact target time,
         *     invited or ready, that launches within the next hour; `plan`, `from`, `time` the launch) and `building` (the
         *     resources for the level of a building or research alert are there, listed 24 hours; `alert`, `planet`, `element`, `level`,
         *     `time` since when) and `fleet` (an own fleet with a fleet alert, due `lead` minutes before its arrival, listed
         *     from an hour before that until 10 minutes after the arrival; `alert`, `fleet`, `lead`, `time` the arrival) and
         *     `settlement` (a loot settlement the caller takes part in, finalized within 48 hours, while deliveries of the
         *     caller are open, neither ticked off nor delivered by transport messages, not for the member who finalized it
         *     nor for settlements saved before finalizing existed; `plan`, `sends`, `gets`, `member` who finalized it, `time`
         *     when) and `buildorder` (the next open step of the caller's build order on a planet can start by its timeline:
         *     slot free, requirements met, resources there; `planet`, `step` with `id`, `kind`, `element`, `count` and
         *     `target` level or count, `time` now; one per planet) and `phalanx` (a sensor phalanx of a moon outside the own
         *     alliance reaches planets of the caller, by a spy report of the moon that reached the hub within 24 hours; one per
         *     moon; `moon`, `level`, `range`, `since` the game time of that report, `player` the moon's owner, `planets` the
         *     caller's planets in reach, `time` when the report reached the hub). Push notifications send
         *     the same entries (see `/api/push/subscriptions`).
         */
        get: operations["getNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/presence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Online members of the group and where they are; per member the tab in use (see `reportPresence`). */
        get: operations["getPresence"];
        put?: never;
        /** @description A hub tab of the current user reports where it is. Each tab (`tab`) is kept on its own; the presence shows the tab in use: an active one before inactive ones, a focused one before one only visible, then the latest report. Tabs that have not reported for 15 minutes are dropped, so open tabs report at least every 5 minutes. `closed: true` removes the tab. An active report also notes the 5-minute slot for the activity pattern of the user's player (`getPlayerActivity`, kept 30 days). */
        post: operations["reportPresence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Server-Sent Events stream (use `group` query; EventSource cannot send headers). */
        get: operations["subscribeEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Browser login; sets the session cookie. Failed attempts are limited per IP and username (10) and per IP (30) within 15 minutes; an attempt counts from its start (also while others are still being checked) and a successful one is taken back. */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Clears the session cookie. */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/lang": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Stores the hub UI language on the account. */
        post: operations["setLang"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/username": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Changes the hub username; needs the current password. Wrong current passwords are limited to 10 per account within 15 minutes. */
        post: operations["changeUsername"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/display-name": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The hub display name of the signed-in user (what others see in the online list and comments). Null when unset; the username is shown then. */
        get: operations["getDisplayName"];
        put?: never;
        /** @description Sets the hub display name (1–32 letters of any language including umlauts, digits, spaces, `. _ -`, no `@`; stored NFC). Empty or whitespace clears it (the username is shown). Not unique. No password. */
        post: operations["setDisplayName"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Changes the password and revokes API tokens; needs the old password. Wrong current passwords are limited to 10 per account within 15 minutes. */
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/fleet-share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description How the member shares their own fleets with the alliance. */
        get: operations["getFleetShare"];
        put?: never;
        /** @description Stores fleet sharing. */
        post: operations["setFleetShare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/message-share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Whether the member shares in-game messages with the alliance. */
        get: operations["getMessageShare"];
        put?: never;
        /** @description Stores message sharing. */
        post: operations["setMessageShare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/show-online": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Whether the member appears in the online list. */
        get: operations["getShowOnline"];
        put?: never;
        /** @description Stores online visibility. */
        post: operations["setShowOnline"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/share-activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Whether the member shares activity with the alliance. */
        get: operations["getShareActivity"];
        put?: never;
        /** @description Stores activity sharing. */
        post: operations["setShareActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/invites/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Claim or recovery invite (the token in the link). */
        get: operations["getInvite"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/invites/{token}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Accepts a claim or recovery invite. */
        post: operations["acceptInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/universes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Creates a universe; hub admins. */
        post: operations["createUniverse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/universes/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Updates a universe's name, settings, deck or schedule; hub admins. */
        put: operations["updateUniverse"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Renames a hub account; hub admins. */
        put: operations["renameUser"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Alliances of every universe; hub and alliance admins see what they may manage. */
        get: operations["listGroups"];
        put?: never;
        /** @description Creates an alliance; hub admins. */
        post: operations["createGroup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Updates the alliance name or tag; alliance admins. */
        put: operations["updateGroup"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Changes a member's role, in-game name or hub display name (`displayName`, global on the account); alliance admins. Empty `displayName` clears it. */
        put: operations["updateGroupMember"];
        post?: never;
        /** @description Removes a member; alliance admins. */
        delete: operations["removeGroupMember"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/members/{userId}/invite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Creates a claim invite for a placeholder member (alliance admins) or a password recovery link for a member with an account (global admins); an unused earlier link of the member stops working. A placeholder that is also in other alliances needs an admin of all of them (whoever claims it becomes a member of each). The token is returned only here, the hub stores its hash. */
        post: operations["createMemberInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/players/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Merges two player rows of the alliance; remaps every `players` foreign key. */
        post: operations["mergePlayers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/parser-samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Parser samples sent by members of all alliances (newest 200); hub admins. */
        get: operations["listParserSamples"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/parser-samples/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The anonymized page of a sample as a download (HTML when there is one, else text); hub admins. */
        get: operations["downloadParserSample"];
        put?: never;
        post?: never;
        /** @description Deletes a sample; hub admins. */
        delete: operations["deleteParserSample"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/ingests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Recent pastes of the alliance; alliance admins. */
        get: operations["listGroupIngests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/groups/{id}/activity/backfill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Rebuilds the activity log from stored pages; hub admins. */
        post: operations["backfillGroupActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/crawler": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Battle-hall crawler status; hub admins. */
        get: operations["getCrawler"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/crawler/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Resumes a crawler that gave up; hub admins. */
        post: operations["retryCrawler"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/ingests/{id}/reparse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Parses a stored paste again; hub admins. */
        post: operations["reparseIngest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/ingests/{id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Deletes a stored paste (and optionally the data it created); hub admins. */
        post: operations["deleteIngest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/ingest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Stores a pasted game page. `forUser` may point to another member only for messages and combat reports, not for empire, overview or fleets. Player profiles (`page=playerCard`, the in-game popup) store the home planet. `dryRun` returns the preview without storing. When nothing was recognized (`pageType` `unknown`), `explain` says why: `code` one of `too_short`, `not_game`, `language` (with `lang`), `unsupported_page` (with the game's `page` id), `parse_failed` (a page the hub reads, nothing found) or `unknown_game_page`. */
        post: operations["ingestPage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/ingest/sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Sends a page the hub found nothing in to the hub's admins as a parser sample. Body: `html` and/or `text` (at most 4 MB together), `note` (up to 500 characters). Stored anonymized (scripts, styles, form values, session tokens in links, e-mail addresses and the sender's own names removed) for the retention of raw syncs; the explanation is worked out again on the server. Counts against the paste rate limit. */
        post: operations["sendParserSample"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/universe-json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description universe.json built from the alliance's galaxy data. */
        get: operations["downloadUniverseJson"];
        put?: never;
        /** @description Uploads a universe.json (whole universe). */
        post: operations["uploadUniverseJson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/phalanx": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Stores a phalanx scan for a retime plan. */
        post: operations["ingestPhalanx"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/retime": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Retime plan for a hostile attack (`key` from `getHostileAttacks`). */
        post: operations["planRetime"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/hold": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Hold plan for a hostile attack (`key` from `getHostileAttacks`). */
        post: operations["planHold"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Updates a raid plan (creator, or coordinates by a participant). */
        put: operations["updatePlan"];
        post?: never;
        /** @description Deletes a raid plan; the creator. */
        delete: operations["deletePlan"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/phalanx": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** @description Drops the phalanx return stored on a retime plan. */
        delete: operations["clearPlanPhalanx"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/enemy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Updates the enemy fleet of a retime or hold plan. */
        put: operations["updatePlanEnemy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/fleets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Adds a fleet to a raid plan. */
        post: operations["addPlanFleet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/plans/{id}/fleets/{fleet}": {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
                /** @description Plan fleet id */
                fleet: number;
            };
            cookie?: never;
        };
        get?: never;
        /** @description Updates a plan fleet (owner, or the plan creator for some fields). */
        put: operations["updatePlanFleet"];
        post?: never;
        /** @description Removes a plan fleet. */
        delete: operations["deletePlanFleet"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/claims/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Updates a target claim. */
        put: operations["updateClaim"];
        post?: never;
        /** @description Releases a target claim. */
        delete: operations["deleteClaim"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/comments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Edits a comment. */
        put: operations["updateComment"];
        post?: never;
        /** @description Deletes a comment. */
        delete: operations["deleteComment"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/deck/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Adds a drawn card or depletion event to the expedition deck. */
        post: operations["addDeckEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/deck/events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** @description Removes a deck event. */
        delete: operations["deleteDeckEvent"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/players/{id}/note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Saves the alliance note on a player. */
        put: operations["putPlayerNote"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/{uni}/messages/{id}/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Shares or hides one in-game message for the alliance. */
        post: operations["shareMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        FalseAlarmSummary: {
            /** @description Days sampled */
            days?: number;
            /** @description Scores of at least likely (player-days) */
            positives?: number;
            players?: number;
            horizons?: {
                /** @enum {integer} */
                hours?: 12 | 24 | 72;
                contradicted?: number;
                players?: number;
                rate?: number | null;
            }[];
            bands?: {
                /** @enum {string} */
                band?: "50-69" | "70-84" | "85+";
                positives?: number;
                /** @description Disproved within that many hours */
                within?: {
                    [key: string]: number;
                };
            }[];
        };
        SyncHint: {
            /** @enum {string} */
            key: "empire" | "stats" | "overview" | "galaxy" | "buildings" | "research" | "messages" | "market";
            /**
             * @description high: features are missing or wrong without it; medium: noticeably outdated; low: better with it
             * @enum {string}
             */
            level: "high" | "medium" | "low";
            /**
             * @description The member's own pages or the group's shared data
             * @enum {string}
             */
            scope: "me" | "group";
            /** @description Epoch seconds of the newest sync of this page (galaxy: the oldest system), null when there is none */
            time: number | null;
            /** @description buildings: planets without a buildings page; galaxy: outdated systems around the own planets */
            count?: number;
            /** @description Of how many planets or systems */
            total?: number;
            /** @description stats: epoch seconds of the missing update: the newest synced one (categories lacking it) or, with `estimated`, the one expected after `interval` */
            update?: number;
            /** @description stats: `update` is expected from the interval learned from the synced updates (never fixed hours), no member synced it yet */
            estimated?: boolean;
            /** @description stats: interval of the statistics updates in seconds, learned from the synced updates (the shortest gap seen at least twice) */
            interval?: number;
            /** @description stats: categories without that update (1 total, 2 fleet, 3 research, 4 buildings, 5 defense); empty: just outdated (older than a day, interval unknown) */
            types?: number[];
        };
        /** @description The player gained no total points since the synced stat update at `time` (Unix seconds), the update of the last gain; each update is compared to the one before. `atLeast`: no gain seen, `time` is the first update looked at (the gain lies before it). Null while the newest update still has a gain or fewer than two are known. Lists look back twice the universe's `inactiveDays` from the newest update, the player page the whole history. */
        PointsStall: {
            time: number;
            atLeast: boolean;
        } | null;
        /** @description How sure the hub is that the player is inactive, before or with the game's flag (`inactive` 95, `longinactive` 100). Without the flag the score grows with the time since the latest sign of activity (`since`): proven activity (attacks in combat reports or the battle hall, espionage on members, messages a member synced and may share, fleet launches and recalls seen, reports by hand, a fleet sent away between two spy reports) or a relevant gain in total points (gains below a small share of what the active players around the same rank gained are builds finishing from a queue and don't count). Spy reports whose resources match the projection of the report before and fleet or defense points lost and not rebuilt raise it; galaxy activity marks lower it (others' attacks and espionage set them too). At most 94 without the game's flag. `reasons` lists what the score is made of. Null for players the hub doesn't know. */
        Inactivity: {
            score: number;
            /**
             * @description inactive ≥ 85, likely ≥ 50, possible ≥ 20; unknown without current statistics
             * @enum {string}
             */
            level: "inactive" | "likely" | "possible" | "active" | "unknown";
            /** @description Probably inactive since (Unix seconds) */
            since: number | null;
            /** @description `since` is the start of the window looked at (twice the inactive days); the player may have stopped earlier */
            atLeast: boolean;
            /** @enum {string|null} */
            status: "inactive" | "longinactive" | null;
            /** @description Statistics update of the last relevant points gain */
            stall: number | null;
            /** @description Newest proven activity */
            lastActive: number | null;
            /** @description What the score is made of */
            reasons: ({
                /** @constant */
                code: "flag";
                /** @enum {string} */
                status: "inactive" | "longinactive";
                time: number | null;
            } | {
                /** @constant */
                code: "proven";
                /** @enum {string} */
                source: "attack" | "spy" | "message" | "fleet" | "recall" | "manual" | "fleetGone";
                time: number;
            } | {
                /** @constant */
                code: "gain";
                time: number;
                size?: number;
                ratio?: number | null;
            } | {
                /** @constant */
                code: "noGain";
                since: number;
                atLeast: boolean;
            } | {
                /** @constant */
                code: "weakGains";
                n: number;
            } | {
                /** @constant */
                code: "galaxy";
                n: number;
                time: number;
            } | {
                /** @constant */
                code: "idleSpy";
                n: number;
            } | {
                /** @constant */
                code: "losses";
            })[];
        } | null;
        FarmTarget: {
            g?: number;
            s?: number;
            p?: number;
            /** @enum {string} */
            type?: "planet" | "moon";
            name?: string | null;
            player?: {
                id?: number;
                name?: string;
                status?: string[];
                ally_tag?: string | null;
                points?: number | null;
            };
            /** @description Newest spy report with resources (901 metal, 902 crystal, 903 deuterium) and the number of reports */
            report?: {
                time?: number;
                resources?: {
                    [key: string]: number;
                };
                count?: number;
            };
            /** @description Building levels of the newest report with buildings (plus solar satellites, 212); null for moons and when no report showed them */
            levels?: {
                time?: number;
                values?: {
                    [key: string]: number;
                };
            } | null;
            /** @description Expected resources now (production since the report */
            projected?: {
                [key: string]: number;
            };
            perHour?: {
                [key: string]: number;
            };
            /** @description Storage full per resource */
            full?: {
                [key: string]: boolean;
            };
            /** @description Loot of a won attack: half of each projected resource */
            loot?: {
                [key: string]: number;
            };
            fleet?: components["schemas"]["FarmSection"];
            defense?: components["schemas"]["FarmSection"];
            lastBattle?: number | null;
            inactivity?: components["schemas"]["Inactivity"];
            /** @description Points gained per statistics category since the report (keys 1 total, 2 fleet, 5 defense): newest score minus the score of the last update before the report; null when no update after the report or none before it is synced. Used by the spy priority list. */
            changes?: {
                [key: string]: number | null;
            };
            /** @description Espionage level of the player from the newest report with research */
            espionage?: number | null;
            /** @description Moons only: the diameter from the galaxy view (moon destruction calculator) */
            moonDiameter?: number | null;
        };
        /** @description Why a pasted page gave no data (`explainNoData` of `@pr0hub/core`) */
        Explanation: {
            /** @enum {string} */
            code?: "too_short" | "not_game" | "language" | "unsupported_page" | "parse_failed" | "unknown_game_page";
            /** @description The game's page id (`page=` of its URL) when known */
            page?: string;
            /** @description Language of the page when the hub does not read it */
            lang?: string;
        };
        /** @description Newest spy report section (null when no report showed it) */
        FarmSection: {
            time?: number;
            points?: number | null;
            /** @description Units that fight (solar satellites */
            units?: number;
        } | null;
        /** @description Market rate as metal (`m`) and crystal (`k`) per 1 deuterium */
        MarketRate: {
            m?: number;
            k?: number;
            /**
             * @description Exact from the page's HTML (copied page or page source), estimated from plain text, or set by hand
             * @enum {string}
             */
            source?: "source" | "text" | "manual";
            /** @description Epoch seconds (game time of the page */
            time?: number;
            /** @description Member who synced or set it */
            by?: string | null;
        };
        /** @description A loot settlement of a raid plan (GET /plans/{id}/settlement) */
        Settlement: {
            /** @description The plan's target and time */
            plan?: {
                id?: number;
                /** @enum {string} */
                mission?: "attack" | "hold";
                g?: number | null;
                s?: number | null;
                p?: number | null;
                /** @enum {string} */
                planet_type?: "planet" | "moon";
                target_time?: number;
                status?: string;
            };
            /** @description The caller may correct, finalize and reopen it (participant, creator or admin) */
            can_edit?: boolean;
            me?: string;
            draft?: {
                state?: components["schemas"]["LootState"];
                sources?: Record<string, never>;
            };
            /** @description What the hub's data covers, so members see what is still to sync: `battle` (archived report with fleets, only the battle message, none), `returns` per member fleet of an attack with one battle (loot from the fleet return message, the overview, or missing), `recycling` (`gap`: an emptied debris field the recycling rows do not cover), `missing` the count of missing items. */
            checks?: {
                /** @enum {string} */
                battle?: "report" | "plan" | "missing";
                returns?: {
                    [key: string]: "message" | "overview" | "missing";
                };
                /** @enum {string} */
                recycling?: "ok" | "none" | "gap" | "n/a";
                missing?: number;
            };
            /** @description Corrections made by hand on top of the draft (`Overrides` of @pr0hub/loot) */
            overrides?: Record<string, never> | null;
            corrected?: null | {
                updated_at?: number;
                updated_by?: string | null;
            };
            finalized?: null | {
                at?: number;
                by?: string | null;
                live?: components["schemas"]["LootState"];
                /** @description Differences between the frozen state and `live`, per kind */
                changes?: {
                    people?: number;
                    battles?: number;
                    recycling?: number;
                    settings?: number;
                };
            };
            state?: components["schemas"]["LootState"];
            /** @description Settlement of `state` computed by @pr0hub/loot */
            result?: Record<string, never>;
            /** @description Deliveries marked done ("<from id>><to id>") */
            done?: string[];
            /** @description Finalized: resources the transport messages show delivered per delivery ("<from id>><to id>") */
            delivered?: {
                [key: string]: {
                    m?: number;
                    k?: number;
                    d?: number;
                };
            };
            /** @description Deliveries the transport messages show delivered in full */
            auto_done?: string[];
        };
        /** @description Input of an ACS loot settlement (`@pr0hub/loot`, the same as the loot calculator's share links). Resources are `{ m, k, d }` (metal, crystal, deuterium), ships element id -> amount. `transfers` null: the suggested deliveries. */
        LootState: {
            participants?: {
                id?: string;
                name?: string;
                flightDeut?: number;
                recDeut?: number;
                missiles?: number;
                extra?: Record<string, never>;
                /** @description Share of the profit in percent with `settings.mode` equal; participants without one split what the others leave equally */
                sharePct?: number;
            }[];
            helpers?: {
                id?: string;
                name?: string;
                /** @description Share of what they recycled the helper keeps (game rule at most 20 %) */
                keepPct?: number;
                /** @description Recycler deuterium */
                recDeut?: number;
            }[];
            battles?: {
                time?: number | null;
                loot?: Record<string, never>;
                fleets?: {
                    participant?: string;
                    start?: Record<string, never>;
                    end?: Record<string, never>;
                    carried?: Record<string, never>;
                    /** @description Loot this fleet brought home (wins over the share by cargo space) */
                    loot?: Record<string, never>;
                }[];
                /** @description Debris field at the target after the battle (`{ m, k }`, battle report), when known */
                debris?: Record<string, never>;
            }[];
            recycling?: {
                by?: string;
                m?: number;
                k?: number;
                /** @description Debris field before this collection (`{ m, k }`, recycling report), when known */
                field?: Record<string, never>;
                /** @description Time of the recycling report */
                time?: number | null;
            }[];
            settings?: {
                /**
                 * @description equal: by percent (`sharePct`, equal shares by default); investment: by the value of the ships sent
                 * @enum {string}
                 */
                mode?: "equal" | "investment";
                /** @description Metal and crystal per deuterium */
                rates?: Record<string, never>;
                refRates?: Record<string, never> | null;
                deficitMetalShare?: number;
                cargoShip?: number;
                /** @description Refund the helpers' recycler deuterium on top of their share (default false) */
                helperDeut?: boolean;
            };
            transfers?: Record<string, never>[] | null;
        };
        PushSettings: {
            /** @description Hostile fleets heading for the caller (default on) */
            attackSelf?: boolean;
            /** @description Hostile fleets heading for other members (default off) */
            attackOthers?: boolean;
            /** @description Invitations to raid planner plans (default on) */
            invites?: boolean;
            /** @description New comments in threads the caller wrote in (default on) */
            comments?: boolean;
            /** @description Launch reminders of the caller's plan fleets (default on) */
            launch?: boolean;
            /** @description The next level of a building the caller waits for is affordable (default on) */
            buildings?: boolean;
            /** @description Access requests from the login page; only global admins get them (default on) */
            accessRequests?: boolean;
            /** @description A member sent a page the hub could not read as a parser sample (`/api/{uni}/ingest/sample`); only global admins get them (default on) */
            parserSamples?: boolean;
            /** @description An own fleet the caller set an alert for arrives (or is about to */
            fleets?: boolean;
            /** @description A storage (metal, crystal, deuterium) on one of the caller's planets is full (default on) */
            storage?: boolean;
            /** @description A loot settlement the caller takes part in was finalized and they have deliveries open (default on) */
            settlements?: boolean;
            /** @description The next step of the caller's build order on a planet can start (default on) */
            buildOrder?: boolean;
            /** @description A sensor phalanx outside the own alliance is newly known to reach one of the caller's planets (default on) */
            phalanx?: boolean;
            /**
             * @description Launch reminder this many minutes ahead (default 5)
             * @enum {integer}
             */
            leadMinutes?: 1 | 2 | 5 | 10 | 15 | 30;
            /** @description Hostile espionage (mission 6) counts for `attackSelf` and `attackOthers` (default on); off: only fleets that are not spying */
            spying?: boolean;
            /** @description `comments` only when a comment mentions the caller (default off) */
            mentionsOnly?: boolean;
            /** @description Quiet hours of the caller's Discord webhook (`/api/auth/discord`); always null in the push settings, where each device has its own (`/api/push/subscriptions/quiet`) */
            quiet?: components["schemas"]["QuietHours"] | null;
        };
        /** @description Quiet hours of a push device or a Discord webhook: between `from` and `to` nothing is sent. What they hold back is sent when they end (or are switched off), as long as it still matters: an attack that landed meanwhile is dropped, the rest is kept a day; at most the newest 20 per device. */
        QuietHours: {
            /** @description Start, time of day `HH:MM` in `tz` */
            from: string;
            /** @description End (earlier than `from`: over midnight; must differ from `from`) */
            to: string;
            /** @description IANA time zone of the device, e.g. `Europe/Berlin` */
            tz: string;
            /** @description Kinds that come through at once: attacks on the caller, their launch reminders, their fleet alerts (default: all three) */
            except?: ("attackSelf" | "launch" | "fleets")[];
        };
        /** @description One step of a build order: +1 level of a building or research, `count` units of a ship or defense, a production setting (`prod`) or a transport; its target level follows from the base and the steps before it. */
        BuildOrderStep: {
            /** @description Stable id (letters, digits, _ and -), unique in the build order */
            id: string;
            /** @enum {string} */
            kind: "building" | "research" | "ship" | "defense" | "prod" | "transport";
            /** @description Game element id (building */
            element?: number;
            /** @description Units (ship */
            count?: number;
            /** @description `factors` producer id (1, 2, 3) -> 0 … 1; wait for the build slot, research or shipyard first; `wait` seconds afterwards */
            prod?: {
                factors?: Record<string, never>;
                awaitBuilding?: boolean;
                awaitResearch?: boolean;
                awaitShipyard?: boolean;
                wait?: number;
            };
            /** @description Resources (901-903) leaving the planet, landing on `target` (hub planet key, null: none) after `flight` seconds */
            transport?: {
                target?: string | null;
                resources?: Record<string, never>;
                flight?: number;
            };
            deactivated?: boolean;
            /** @description Checked off by hand */
            done?: boolean;
        };
        BuildOrder: {
            /** @description Start levels: `planets` (hub planet key `g:s:p:type` -> element id -> level or count) and `research` (id -> level) */
            base: {
                planets?: Record<string, never>;
                research?: Record<string, never>;
            };
            /** @description Hub planet key -> steps in order */
            planets: {
                [key: string]: components["schemas"]["BuildOrderStep"][];
            };
        };
        StoredBuildOrder: {
            order: components["schemas"]["BuildOrder"];
            /** @description Where it came from, as the import sent it (e.g. the pr0plan settings and planet mapping) */
            meta: Record<string, never>;
            /** @description Unix seconds of the import */
            createdAt: number;
            /** @description Unix seconds of the last change */
            updatedAt: number;
        } | null;
        DiscordSettings: {
            /** @description Start of the caller's webhook URL (the URL itself is never returned), null when none is set */
            webhook: string | null;
            /** @description Caller's Discord user id */
            userId: string | null;
            prefs: components["schemas"]["PushSettings"];
        };
        DiscordChannelSettings: {
            /** @description Start of the channel's webhook URL (the URL itself is never returned), null when none is set */
            webhook: string | null;
            /** @description All settings, the defaults filled in */
            prefs: WithRequired<components["schemas"]["DiscordChannelPrefs"], "attacks" | "plans" | "launch" | "leadMinutes" | "lang" | "spying">;
        };
        DiscordChannelPrefs: {
            /** @description Hostile fleets heading for members (default on) */
            attacks?: boolean;
            /** @description New raid planner plans (default on) */
            plans?: boolean;
            /** @description Launch reminders of the members' plan fleets (default on) */
            launch?: boolean;
            /**
             * @description Launch reminder this many minutes ahead (default 5)
             * @enum {integer}
             */
            leadMinutes?: 1 | 2 | 5 | 10 | 15 | 30;
            /**
             * @description Language of the channel's messages (default de)
             * @enum {string}
             */
            lang?: "de" | "en";
            /** @description Hostile espionage (mission 6) counts for `attacks` (default on) */
            spying?: boolean;
        };
        Threat: {
            key: string;
            player: {
                /** @description Null when the hub only knows the name */
                id: number | null;
                name: string;
                status: string[];
                allyTag: string | null;
            };
            score: number;
            spied: {
                count?: number;
                last?: number | null;
            };
            /** @description Battle reports at the caller's bodies with the player among the attackers */
            attacked: {
                count?: number;
                last?: number | null;
            };
            /** @description Attacks on their way to the caller now */
            incoming: {
                count?: number;
                /** @description The first arrival */
                next?: number | null;
                /** @description Key of that attack for `/api/{uni}/attack-assist` */
                key?: string | null;
            };
            /** @description Fleet points of the newest statistics; `before` at the start of the period (else the oldest update within it), null without an older update */
            fleetPoints: {
                points?: number;
                time?: number;
                before?: {
                    points?: number;
                    time?: number;
                } | null;
            } | null;
            /** @description The player's known planet nearest to one of the caller's planets with the one-way flight time at 100 %: by the slowest ship of the largest fleet seen in spy reports (`shipKnown`), else a battleship; drives from the newest spy report with research (`researchKnown`), else none */
            reach: {
                from?: {
                    g?: number;
                    s?: number;
                    p?: number;
                };
                to?: {
                    g?: number;
                    s?: number;
                    p?: number;
                };
                /** @description Seconds */
                duration?: number;
                ship?: number;
                shipKnown?: boolean;
                researchKnown?: boolean;
            } | null;
            /** @description Known planets of the player */
            planets: number;
            /** @description Espionage and battles per hour of the day (0 to 23) in the universe's time zone */
            hours: number[];
            /** @description The 4 hours with the most events (from 5 events on); `to` is exclusive and may lie past midnight */
            peak: {
                from?: number;
                to?: number;
                /** @description Share of the events in these hours (0 to 1) */
                share?: number;
            } | null;
            /** @description The caller's bodies the player came for, the most often first */
            targets: {
                g?: number;
                s?: number;
                p?: number;
                count?: number;
            }[];
        };
        StorageAlerts: {
            planets: {
                g: number;
                s: number;
                p: number;
                name: string;
                /** @description A full storage on this planet sends no push and no Discord message */
                muted: boolean;
            }[];
        };
        BuildingAlert: {
            id: number;
            g: number;
            s: number;
            p: number;
            /** @enum {string} */
            planet_type: "planet" | "moon";
            element_id: number;
            level: number;
            created_at: number;
        };
        FleetAlert: {
            id: number;
            /** @description Unix seconds */
            arrival: number;
            /** @description Minutes before the arrival to notify (0 at the arrival) */
            lead: number;
            /** @description The fleet movement as last seen in the caller's fleet list */
            fleet: Record<string, never>;
            created_at: number;
        };
        Buildings: {
            planets: {
                /** @description `g:s:p:type` */
                key: string;
                name: string;
                coords: {
                    g?: number;
                    s?: number;
                    p?: number;
                };
                /** @enum {string} */
                type: "planet" | "moon";
                /**
                 * @description Page the levels and resources come from
                 * @enum {string}
                 */
                source: "empire" | "buildings" | "research";
                /** @description levels (`values`, with the counts of ships, defense and missiles from the empire page), `shipyard` (units in the shipyard queue, element id -> count), `resources` at `time` (Unix seconds), `perHour`, `storage` (when shown), `fields`, `queue` (target levels, `end` when known) and `busy`: research (account wide, locks research lab and TechnoDome), the planet's shipyard (locks nanite factory and shipyard) and `lab` (a research lab or TechnoDome in any build queue, locks research) in use, each `{ until }` (Unix seconds, null when unknown) or null when free */
                planet: Record<string, never>;
                /** @description building id -> `{ next, cost, time }` as the buildings page showed them */
                shown: Record<string, never> | null;
                /** @description research id -> `{ next, cost, time }` as the research page of this planet showed them */
                shownResearch?: Record<string, never> | null;
                /** @description Max temperature of the planet (empire page) */
                temp: number | null;
                arrivals: {
                    /** @description Unix seconds */
                    at?: number;
                    /** @description 901-903 */
                    resources?: Record<string, never>;
                    mission?: number | null;
                    missionName?: string;
                    /** @description Return flight */
                    back?: boolean;
                    from?: Record<string, never>;
                }[];
            }[];
            /** @description Research levels of the account (research id -> level), finished queue entries included */
            research: Record<string, never>;
            /** @description Account wide research queue, first in progress (from the newest research page, overview or empire page) */
            researchQueue: {
                id?: number;
                level?: number;
                end?: number | null;
            }[];
            /** @description Derived from a research page, else the universe setting `researchSpeed`; null when unknown */
            researchSpeed: number | null;
            /** @description Universe setting `universityFactor` (research time −% per TechnoDome level) */
            universityFactor: number;
            /** @description Catch-up bonus in percent, not rounded: the exact value behind the costs of a buildings page, the rounded one of the overview, or calculated like the game from newer synced statistics; null when the universe has none */
            catchUp: number | null;
            catchUpFrom: {
                /**
                 * @description page: a buildings page, research: a research page
                 * @enum {string}
                 */
                source?: "page" | "research" | "overview" | "stats";
                /** @description Unix seconds of that page or statistics update */
                time?: number;
            } | null;
            buildingSpeed: number | null;
            /** @description Universe setting `shipyardSpeed` (2500 = 1x), else the building speed; null when unknown */
            shipyardSpeed: number | null;
            /** @description Universe setting `resourceMultiplier` (2500 = 1x); null when unknown */
            resourceSpeed: number | null;
            storageFactor: number;
            empireTime: number | null;
            fleetsTime: number | null;
            alerts: components["schemas"]["BuildingAlert"][];
            /** @description Building ids the caller hid on the buildings page */
            hidden: number[];
        };
        PlanBody: {
            g?: number;
            s?: number;
            p?: number;
            /** @enum {string} */
            type?: "planet" | "moon";
        };
        OwnAttack: {
            /** @description Stable while the attack lasts: route and the lead fleet's ships */
            key?: string;
            /** @description Page time of the newest overview showing it */
            seen?: number;
            arrival?: number;
            to?: components["schemas"]["PlanBody"];
            /** @description Owner of the target (galaxy data): id, name */
            player?: Record<string, never> | null;
            /** @description The lead first */
            fleets?: {
                /** @description null for a non-member's ACS fleet */
                memberId?: number | null;
                member?: string | null;
                /** @description Owner of the start (galaxy data): id, name */
                player?: Record<string, never> | null;
                from?: components["schemas"]["PlanBody"];
                mission?: number | null;
                ships?: {
                    [key: string]: number;
                };
            }[];
        };
        SystemInfo: {
            /** @description Unix time of the figures */
            time?: number;
            /** @description Unix time the server started */
            startedAt?: number;
            /** @description Node.js version */
            node?: string;
            database?: {
                file?: string;
                /** @description Size of the database file */
                bytes?: number;
                /** @description Free pages inside the file (reused by new data */
                freeBytes?: number;
                /** @description Size of the write-ahead log */
                walBytes?: number;
                pageSize?: number;
                /** @description Days pasted pages are kept for reparsing */
                rawRetentionDays?: number;
                /** @description Backups in the data directory (`dist/backup.js`), null when there is none */
                backups?: {
                    count?: number;
                    bytes?: number;
                    newest?: string | null;
                } | null;
                /** @description Largest first */
                tables?: {
                    name?: string;
                    rows?: number;
                    bytes?: number;
                    indexBytes?: number;
                }[];
            };
            /** @description File system of the data directory */
            disk?: {
                total?: number;
                free?: number;
            } | null;
            memory?: {
                rss?: number;
                heapUsed?: number;
                heapTotal?: number;
                external?: number;
                arrayBuffers?: number;
                /** @description Maximum size of the JS heap */
                heapLimit?: number;
                /** @description cgroup memory limit and use (incl. file cache); null outside a container or without limit */
                container?: {
                    limit?: number | null;
                    current?: number | null;
                };
            };
            /** @description Event loop delay in ms since the last hourly sample; null when not measured */
            eventLoop?: {
                p50?: number;
                p99?: number;
                max?: number;
                mean?: number;
            } | null;
            usage?: {
                /** @description Accounts with a password */
                users?: number;
                /** @description Users with an open hub tab */
                online?: number;
                /** @description Open live event streams */
                connections?: number;
                activeDay?: number;
                activeWeek?: number;
                /** @description Syncs per day within the retention of pasted pages, newest first */
                days?: {
                    /** Format: date */
                    day?: string;
                    syncs?: number;
                    users?: number;
                    /** @description Stored (compressed) pages */
                    bytes?: number;
                }[];
                groups?: {
                    id?: number;
                    name?: string;
                    universe?: string;
                    members?: number;
                    syncs?: number;
                    raw_bytes?: number;
                    stat_snapshots?: number;
                    players?: number;
                    spy_reports?: number;
                    combat_reports?: number;
                }[];
            };
            /** @description Per route (`METHOD /api/path/:param`, without the base path) since the start; percentiles of the last 200 requests */
            requests?: {
                route?: string;
                count?: number;
                /** @description Responses with status 5xx */
                errors?: number;
                avg?: number;
                p50?: number;
                p95?: number;
                max?: number;
            }[];
            /** @description The latest requests that took 1 s or more */
            slow?: {
                time?: number;
                route?: string;
                ms?: number;
                status?: number;
            }[];
            /** @description Hourly samples of the last 90 days */
            samples?: {
                time?: number;
                db_bytes?: number;
                free_bytes?: number;
                wal_bytes?: number;
                rss?: number;
                heap_used?: number;
                loop_p99?: number | null;
                loop_max?: number | null;
                requests?: number;
                slow?: number;
            }[];
        };
        /** @description One fleet (slot) of a battle side. Units are element ids -> pieces (ships 202-232; on the defending planet also defense 401-408); research by id: 109 weapons, 110 shields, 111 armour, 115/117/118 combustion, impulse and hyperspace drive, 134 fuel efficiency (the drives only matter for flight times). */
        BattleSlot: {
            /**
             * @example {
             *       "203": 50,
             *       "207": 200
             *     }
             */
            units?: {
                [key: string]: number;
            };
            /**
             * @example {
             *       "109": 12,
             *       "110": 12,
             *       "111": 12
             *     }
             */
            research?: {
                [key: string]: number;
            };
            /** @description Attackers and holding fleets (not the planet), for flight time and deuterium. "g:s:p" or [g, s, p] */
            from?: string | number[];
            /**
             * @description Attackers and holding fleets
             * @default 100
             * @enum {integer}
             */
            speed: 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;
            /**
             * @description Attackers only
             * @default 0
             */
            carried: number;
            /** @description Player or fleet name */
            name?: string;
        };
        BattleRequest: {
            /** @description Attacking fleets (ACS) */
            attackers: components["schemas"]["BattleSlot"][];
            /** @description The defending planet first (`null` or omitted: taken from the group's newest spy report of `target`), then fleets holding there. */
            defenders?: (components["schemas"]["BattleSlot"] | null)[];
            /** @description Target coordinates, "g:s:p" or [g, s, p]; needed without a planet in `defenders[0]` */
            target?: string | number[];
            /**
             * @description Which spy report of `target` is used
             * @default planet
             * @enum {string}
             */
            planetType: "planet" | "moon";
            /** @description Resources on the planet for the loot (default from the spy report, else none) */
            resources?: {
                metal?: number;
                crystal?: number;
                deuterium?: number;
            };
            /**
             * @description How often the battle is fought (it is random)
             * @default 20
             */
            runs: number;
            /** @description Overrides of the universe settings of the hub */
            settings?: {
                /** @description Share of destroyed ships in the debris field */
                fleetDebrisPercent?: number;
                /** @description Share of the destroyed */
                defenseDebrisPercent?: number;
                /** @description Moon chance: 1 % per 100,000 debris times this factor */
                moonFactor?: number;
                maxMoonChance?: number;
                /** @description Shield domes must fall before other units can be hit */
                bigShields?: boolean;
            };
            /**
             * @description Include the engine's rounds of the typical battle (`typical.engine`)
             * @default false
             */
            report: boolean;
        };
        /** @description Average, minimum and maximum over the runs */
        BattleRange: {
            avg?: number;
            min?: number;
            max?: number;
        };
        /** @description Per element id of one fleet (same order as in the request) */
        BattleFleetSummary: {
            /** @description Pieces lost in the battle */
            lost?: {
                [key: string]: components["schemas"]["BattleRange"];
            };
            /** @description Defense rebuilt after the battle (the planet only) */
            repaired?: {
                [key: string]: components["schemas"]["BattleRange"];
            };
            /** @description Pieces after the battle (the average shows the risk */
            remaining?: {
                [key: string]: components["schemas"]["BattleRange"];
            };
            /** @description Share of the runs (0-1) in which at least one piece of the type is lost for good */
            lossChance?: {
                [key: string]: number;
            };
        };
        BattleSimulation: {
            runs?: number;
            /** @description Share of the runs (0-1) */
            wins?: {
                attacker?: number;
                defender?: number;
                draw?: number;
            };
            rounds?: components["schemas"]["BattleRange"];
            /** @description Share of the runs (0-1) per number of rounds fought */
            roundShares?: {
                [key: string]: number;
            };
            attackers?: components["schemas"]["BattleFleetSummary"][];
            defenders?: components["schemas"]["BattleFleetSummary"][];
            debris?: {
                metal?: components["schemas"]["BattleRange"];
                crystal?: components["schemas"]["BattleRange"];
            };
            /** @description Average loot over all runs (lost battles bring none) */
            loot?: {
                metal?: number;
                crystal?: number;
                deuterium?: number;
            };
            moonChance?: components["schemas"]["BattleRange"];
            /** @description Value of the lost pieces (metal + crystal) per side */
            lostValue?: {
                attacker?: components["schemas"]["BattleRange"];
                defender?: components["schemas"]["BattleRange"];
            };
            /** @description Average costs (metal, crystal, deuterium) of what each side lost for good, rebuilt defense not counted; with `loot` and `debris` the balance of both sides */
            lostResources?: {
                attacker?: {
                    metal?: number;
                    crystal?: number;
                    deuterium?: number;
                };
                defender?: {
                    metal?: number;
                    crystal?: number;
                    deuterium?: number;
                };
            };
            /** @description Settings used (universe settings of the hub with the request's overrides) */
            settings?: {
                fleetDebris?: number;
                defenseDebris?: number;
                moonFactor?: number;
                maxMoonChance?: number;
                bigShields?: boolean;
            };
            /** @description The spy report used as the planet */
            spyReport?: {
                id?: number;
                time?: number;
                reporter?: string | null;
                /** @description Spied player */
                player?: string | null;
            } | null;
            /** @description Attackers and holding fleets with a start */
            flights?: {
                /** @enum {string} */
                side?: "attacker" | "defender";
                /** @description Index in `attackers` or `defenders` */
                slot?: number;
                distance?: number;
                /** @description One way */
                duration?: number;
                deuterium?: number;
            }[];
            /** @description The run closest to the average losses */
            typical?: {
                /** @enum {string} */
                winner?: "attacker" | "defender" | "draw";
                rounds?: number;
                /** @description The engine's output (with `report`) */
                engine?: Record<string, never>;
            };
            /** @description The same battle in the battle simulator page (pr0game-tools) */
            link?: string;
        };
        StoredFleetBody: {
            g?: number;
            s?: number;
            p?: number;
            /** @enum {string} */
            type?: "planet" | "moon";
        };
        StoredFleetAttack: {
            userId?: number;
            /** @description Hub display name */
            member?: string;
            key?: string;
            /**
             * @description Fleet owner as seen by the member
             * @enum {string}
             */
            owner?: "own" | "hostile" | "foreign";
            /** @description Epoch seconds */
            arrival?: number;
            from?: components["schemas"]["StoredFleetBody"];
            to?: components["schemas"]["StoredFleetBody"];
            mission?: number | null;
            /** @description Fleets in the attack (ACS > 1) */
            fleets?: number;
        };
        Error: {
            /** @description English message */
            error: string;
            /** @description Stable key for clients */
            code: string;
        };
        Enabled: {
            enabled: boolean;
        };
        ActivityEvent: {
            /** @description Best estimate (Unix seconds) */
            time: number;
            /** @description Half width of the uncertainty in seconds (0 = exact) */
            spread: number;
            /** @enum {string} */
            source: "spy" | "attack" | "defense" | "message" | "galaxy" | "fleet" | "recall" | "manual" | "offline" | "sync" | "hub";
            /** @description Contribution to the activity curve (galaxy marks scaled by planets per hour) */
            weight?: number;
            /** @description Galaxy mark only – galaxy coordinate */
            g?: number;
            /** @description Galaxy mark only – system coordinate */
            s?: number;
            /** @description Galaxy mark only – position */
            p?: number;
            /** @description Galaxy mark only – when the galaxy view was seen (server time of the page, else the time of the sync; Unix seconds) */
            syncedAt?: number;
            /** @description Manual and offline reports only */
            id?: number;
            /** @description Reporting member (manual and offline reports only) */
            reporter?: string | null;
            /** @description Reported by the caller (manual and offline reports only) */
            mine?: boolean;
        };
        User: {
            id?: number;
            username?: string;
            isAdmin?: boolean;
            /** @enum {string} */
            lang?: "de" | "en";
            /**
             * @description Date format of the hub; `auto` follows `lang` (de DD.MM.YYYY, en DD/MM/YYYY)
             * @enum {string}
             */
            dateFormat?: "auto" | "dmy." | "dmy/" | "ymd";
            tours?: components["schemas"]["Tours"];
        };
        /** @description Page tours of the hub (guided explanations shown on the first visit of a page) */
        Tours: {
            /** @description Whether tours start automatically on the first visit of a page */
            enabled?: boolean;
            /** @description Ids of the tours already seen or skipped */
            seen?: string[];
        };
        /** @description An offline window of the fleet save planner */
        FleetSavePreset: {
            name: string;
            /** @description Offline from (time of day) */
            from: string;
            /** @description Back at (time of day) */
            to: string;
            /**
             * @description Marks one of the web app's built-in presets: it is shown under its name in the viewer's language, `name` is the fallback
             * @enum {string}
             */
            builtin?: "night" | "work";
        };
        GroupMembership: {
            id?: number;
            name?: string;
            /** @description Short alliance tag (at most 10 characters) for narrow places; null = none, the name is shown instead */
            tag?: string | null;
            /** @enum {string} */
            role?: "member" | "admin";
            universe?: string;
            universe_name?: string;
            /** @description Scheduled start of the universe (epoch seconds), null = active since its creation */
            universe_starts_at?: number | null;
            /** @description End of the universe (epoch seconds, may lie ahead), null = no end */
            universe_ended_at?: number | null;
        };
        Me: {
            user?: components["schemas"]["User"] | null;
            groups?: components["schemas"]["GroupMembership"][];
            /** @description Slug of the universe the start page forwards to (set by a hub admin); null when none is set */
            defaultUniverse?: string | null;
        };
        ApiTokenMeta: {
            id?: number;
            name?: string;
            prefix?: string;
            /** @description Unix seconds */
            createdAt?: number;
            lastUsedAt?: number | null;
        };
        ApiTokenCreated: components["schemas"]["ApiTokenMeta"] & {
            /** @description Shown once; store securely */
            token: string;
        };
        Catalog: {
            /** @description Language → element id → name */
            names?: {
                [key: string]: {
                    [key: string]: string;
                };
            };
            /** @description Element id → [metal, crystal, deuterium, factor] */
            costs?: {
                [key: string]: number[];
            };
            classes?: {
                buildings?: number;
                research?: number;
                fleet?: number;
                defense?: number;
                resources?: number;
            };
        };
        /** @description A ship (200-299), defense unit or missile (400-599) as the hub calculates with it; the hull is (metal + crystal) / 10. */
        UnitDef: {
            id: number;
            name: {
                de?: string;
                en?: string;
            };
            /** @description Short column label */
            short: {
                de?: string;
                en?: string;
            };
            /** @description Metal, crystal, deuterium of one unit */
            cost: number[];
            /** @description Requirements, building or research id -> level */
            req: {
                [key: string]: number;
            };
            /** @description Once per planet (shield domes) */
            one: boolean;
            attack: number;
            shield: number;
            /** @description Target id -> shots */
            rapidfire: {
                [key: string]: number;
            };
            /** @description Cargo capacity */
            capacity: number;
            /** @description Per drive (combustion, impulse, hyperspace): base speed, research level from which it is used (0 none, 1 always) and deuterium consumption; null: does not fly */
            drives: {
                speed?: number[];
                tech?: number[];
                consumption?: number[];
            } | null;
        };
        /** @description Differences of a universe from the defaults by unit id: changed fields of `UnitDef` (without `id`), `hidden: true` for a unit the universe does not have; a new id needs `name` and `cost`. At most 100 units. */
        UnitOverrides: {
            [key: string]: Record<string, never>;
        };
        UnitsAdmin: {
            /** @description The hub's units by id */
            defaults: {
                [key: string]: components["schemas"]["UnitDef"];
            };
            overrides: components["schemas"]["UnitOverrides"];
            /** @description The universe's visible units by id */
            units: {
                [key: string]: components["schemas"]["UnitDef"];
            };
        };
        /** @description Settings of a universe (one contract with `@pr0hub/core/universe`): stored values over the defaults. Optional settings without a value stand for their default (battle values: the tool's own value). */
        UniverseSettings: {
            /** @default 4 */
            galaxies: number;
            /** @default 400 */
            systems: number;
            /** @default 15 */
            positions: number;
            /**
             * @description Galaxy distance wraps around (game config uni_type 1)
             * @default true
             */
            circularGalaxies: boolean;
            /**
             * @description System distance wraps around (game config galaxy_type 1)
             * @default true
             */
            circularSystems: boolean;
            /** @default 20000 */
            galaxyDistanceFactor: number;
            /** @default 95 */
            systemDistanceFactor: number;
            /** @default 2700 */
            systemDistance: number;
            /** @default 5 */
            planetDistanceFactor: number;
            /** @default 1000 */
            planetDistance: number;
            /**
             * @description Game config fleet_speed (2500 = 1×)
             * @default 2500
             */
            fleetSpeed: number;
            /**
             * @description Game config building_speed (2500 = 1×)
             * @default 0
             */
            buildingSpeed: number;
            /**
             * @description Game config research_speed (2500 = 1×)
             * @default 0
             */
            researchSpeed: number;
            /**
             * @description Game config shipyard_speed (2500 = 1×)
             * @default 0
             */
            shipyardSpeed: number;
            /**
             * @description Game config resource_multiplier (2500 = 1×)
             * @default 0
             */
            resourceMultiplier: number;
            /**
             * @description Game config storage_multiplier
             * @default 1
             */
            storageMultiplier: number;
            /**
             * @description Game config factor_university (research time −% per TechnoDome level)
             * @default 8
             */
            universityFactor: number;
            /**
             * @description IANA time zone of the game clock (`timezone_invalid` otherwise)
             * @default Europe/Berlin
             */
            timezone: string;
            /**
             * @description Game base URL incl. universe path (`game_url_invalid` when not http(s))
             * @default
             */
            gameUrl: string;
            /**
             * @description pr0plan linked from the build order tab (`pr0plan_url_invalid` when not http(s))
             * @default https://pr0sync.pages.dev/
             */
            pr0planUrl: string;
            /** @description Days without login until the game flags a player inactive (default 7) */
            inactiveDays?: number | null;
            /** @description Game config phalanx_range_factor (default 1; phalanx coverage) */
            phalanxRangeFactor?: number | null;
            /** @description Weekday of the game's weekly debris cleaner (CleanerCronjob), 0 Sunday … 6 Saturday (default 6) */
            debrisCleanupDay?: number | null;
            /** @description Hour of the debris cleaner in the universe's time zone (default 2) */
            debrisCleanupHour?: number | null;
            /** @description Minute of the debris cleaner (default 45) */
            debrisCleanupMinute?: number | null;
            /** @description Game config missile_range_factor (default 1; passed on to the IPM calculator) */
            missileRangeFactor?: number | null;
            /** @description Game config noob_protection_time (default 0 = unknown) */
            noobLimit?: number | null;
            /** @description Game config noob_protection_multi (default 5) */
            noobFactor?: number | null;
            /** @description Game config noob_inactives (default false) */
            noobInactives?: boolean | null;
            /** @description Game config metal_start (default 5000): metal of a new planet; build orders planned before the start or for planets without coordinates begin with it */
            metalStart?: number | null;
            /** @description Game config crystal_start (default 1500) */
            crystalStart?: number | null;
            /** @description Game config deuterium_start (default 0) */
            deuteriumStart?: number | null;
            /** @description Game config planet_size_factor (default 1; fields of new colonies in the colonization planner) */
            planetSizeFactor?: number | null;
            /** @description Game config max_initial_planets. With `maxAdditionalPlanets` and `planetsPerTech` the planet limit of a player (`ceil(initial + min(additional, astrophysics × perTech))`, 0 initial planets lifts the cap); not assumed when unset: the fleet save planner then warns of every colony save */
            maxInitialPlanets?: number | null;
            /** @description Game config max_additional_planets (planets astrophysics can add at most) */
            maxAdditionalPlanets?: number | null;
            /** @description Game config planets_per_tech (planets per astrophysics level) */
            planetsPerTech?: number | null;
            /** @description Production bonus of new colonies per position in percent (the game's `planet_data` bonus columns, active with `planet_ressource_bonus`): position → [metal, crystal, deuterium], each −100 to 1000. Colonization planner. */
            positionBonus?: {
                [key: string]: number[];
            } | null;
            /** @description Game config fleet_debris_percentage (default 40) */
            fleetDebrisPercent?: number | null;
            /** @description Game config def_debris_percentage (default 0) */
            defenseDebrisPercent?: number | null;
            /** @description Shield domes must fall before other units can be hit (default false) */
            bigShields?: boolean | null;
            /** @description Legacy: flight calculator of the tools, their base is taken from it (prefer the server setting `TOOLS_URL`) */
            flightCalculatorUrl?: string;
        } & {
            [key: string]: unknown;
        };
        /** @description Universe and alliance context for the selected group */
        Context: {
            /** @description Universe with its `settings` (layout, speeds, distance factors, time zone, game URL, `pr0planUrl` linked from the build order tab, as set by a hub admin; `pr0plan_url_invalid` when not http(s)). Speed settings use the game's internal values (2500 = 1×): `buildingSpeed`, `researchSpeed`, `shipyardSpeed`, `resourceMultiplier` and `fleetSpeed`; `storageMultiplier` is the game config `storage_multiplier` (default 1). Optional settings: `phalanxRangeFactor` and `missileRangeFactor` (game config `phalanx_range_factor` and `missile_range_factor`, number ≥ 0, default 1; the missile factor is passed on to the IPM calculator), `noobLimit`, `noobFactor` and `noobInactives` (game config `noob_protection_time`, `noob_protection_multi` and `noob_inactives`, default 0 = unknown, 5 and false; weak/strong are derived from them and `player.points`), `inactiveDays` (days without login until the game flags a player inactive, number ≥ 0, default 7; the player page adds them to the last stat update with a points gain), `fleetDebrisPercent` and `defenseDebrisPercent` (game config `fleet_debris_percentage` and `def_debris_percentage`, 0-100, default 40 and 0) and `bigShields` (boolean, default false: shield domes must fall before other units can be hit); passed on to the battle simulator. `startsAt`: scheduled start (epoch seconds; read-only before it), null = active since its creation. `endedAt`: end of the universe (epoch seconds, may lie ahead; frozen and read-only from then on), null = no end. `units`: the universe's differences from the hub's ships, defense and missiles (`UnitOverrides`, set by a hub admin). */
            universe?: {
                settings?: components["schemas"]["UniverseSettings"];
            };
            group?: {
                id?: number;
                name?: string;
                /** @description Short alliance tag (at most 10 characters) for narrow places; null = none, the name is shown instead */
                tag?: string | null;
                role?: string;
            };
            /** @description Base URL of the pr0game tools with trailing slash (server setting `TOOLS_URL`, default the root of the hub's origin); the hub links the tool pages (flight calculator, battle simulator, …) below it. */
            toolsUrl?: string;
            /** @description The group's current market rate (newest from a marketplace sync or set by hand, see `getMarket`); null when none is known. The hub uses it for the loot settlement and links to the battle simulator. */
            marketRate?: components["schemas"]["MarketRate"] | null;
            /** @description Alliance members. `name` is the hub display name, falling back to the username. */
            members?: {
                id: number;
                username: string;
                /** @description Display name */
                name: string;
                /** @description Stored display name; null when unset */
                display_name?: string | null;
                role: string;
                global_admin?: number;
                ingame_name?: string | null;
                last_seen_at?: number | null;
            }[];
            me?: components["schemas"]["User"];
            /** @description Hub player of the requesting member (`id`) with the newest synced total `points` (null if unknown); the pages derive weak/strong (noob protection) from them */
            player?: {
                id?: number;
                points?: number | null;
            } | null;
            /** @description Own data from the newest own empire page: `time`, `research` (element id → level) and `planets` with `name`, `coords`, `type` (planet/moon), `silo` (missile silo level) and `ipm` (interplanetary missiles). */
            own?: Record<string, never> | null;
        };
        Overview: {
            players: {
                points_stall?: components["schemas"]["PointsStall"];
                inactivity?: components["schemas"]["Inactivity"];
            }[];
            /** @description Planets and moons of other players the alliance spied on, and the members' own */
            planets: {
                g: number;
                s: number;
                p: number;
                /** @enum {string} */
                type: "planet" | "moon";
                name: string | null;
                player_id: number | null;
                /** @description Newest spy report: `count` reports in all; resources, building, fleet and defense points of the newest report showing them */
                spy: {
                    time: number;
                    count: number;
                    res?: {
                        [key: string]: number;
                    };
                    resTime?: number;
                    building?: number;
                    buildingTime?: number;
                    fleet?: number;
                    fleetTime?: number;
                    defense?: number;
                    defenseTime?: number;
                } | null;
                /** @description A member's own planet: points of buildings, fleet and defense from the newest empire page */
                own: {
                    time: number;
                    building: number | null;
                    fleet: number | null;
                    defense: number | null;
                } | null;
                /** @description Unix seconds of the newest battle report at the position */
                last_battle: number | null;
                /** @description Attack, ACS attack or destroy of members still flying to this planet/moon (from their newest fleet list, as far as they share it): next `arrival` (Unix seconds) and the `members` flying */
                next_attack: {
                    arrival: number;
                    members: string[];
                } | null;
                /** @description Spying of members still flying to this planet/moon, like `next_attack` */
                next_spy: {
                    arrival: number;
                    members: string[];
                } | null;
            }[];
            /** @description The synced player statistics of the last two days per category and update (which ranks they cover) */
            coverage: {
                type: number;
                stat_time: number;
                rows: number;
                min_rank: number | null;
                max_rank: number | null;
            }[];
            /** @description The Δ column sections of the total points (synced updates on the statistics grid), null for a section without one */
            slots: ({
                from: number;
                to: number;
            } | null)[];
        };
        Imperium: {
            userId?: number;
            empire?: Record<string, never> | null;
            /** @description Without an empire page, the empire put together from the spy reports of the member's player (planets with buildings, fleet and defense per newest report; research with `researchTime`). */
            spy?: Record<string, never> | null;
            overview?: Record<string, never> | null;
            fleets?: components["schemas"]["SharedFleets"];
            fleetHistory?: Record<string, never>[];
            /** @description The caller's fleet alerts, only when the member is the caller (null otherwise). Alerts whose fleet is missing from a newer fleet list before its arrival (recalled) and alerts arrived more than 10 minutes ago are removed. */
            fleetAlerts?: components["schemas"]["FleetAlert"][] | null;
            player?: Record<string, never> | null;
            fleetBase?: Record<string, never> | null;
            leader?: Record<string, never> | null;
            /** @description The member's planets (newest empire page, else the galaxy's planets of their player) that a known sensor phalanx of a moon outside the own alliance reaches, with the moons nearest first. Levels from the newest moon spy report showing the buildings; moons the galaxy shows destroyed since are left out. */
            phalanx?: components["schemas"]["PhalanxExposure"][];
        };
        MemberPlanet: {
            g?: number;
            s?: number;
            p?: number;
            name?: string | null;
        };
        /** @description Owner of the moon now (galaxy data, else the spy report) */
        PhalanxOwner: {
            id?: number | null;
            name?: string;
            /** @description Alliance tag (or name) */
            ally?: string | null;
            /** @description In vacation mode (cannot use the phalanx) */
            vacation?: boolean;
        } | null;
        PhalanxExposure: {
            planet?: components["schemas"]["MemberPlanet"];
            threats?: {
                /** @description `g`, `s`, `p` of the moon */
                moon?: Record<string, never>;
                level?: number;
                /** @description Range in systems (`(level² − 1) × phalanxRangeFactor` */
                range?: number;
                /** @description Systems between moon and planet (circular galaxies wrap around) */
                distance?: number;
                /** @description Report time of the newest level */
                time?: number;
                /** @description Game time since when the phalanx is known to reach the planet (oldest report of the newest run reaching it) */
                since?: number;
                /** @description When that report reached the hub */
                known?: number;
                player?: components["schemas"]["PhalanxOwner"];
            }[];
        };
        /** @description A row synced by a member; `user_id` and `username` (hub name) are null when the account is gone. */
        MemberRow: {
            user_id: number | null;
            username: string | null;
        };
        /** @description A battle report of a member (`battle_reports` row). */
        RaidReport: {
            id: number;
            /** @description The game's report id */
            report_id?: string | null;
            time: number | null;
            created_at: number;
            g: number;
            s: number;
            p: number;
            /** @enum {string} */
            planet_type: "planet" | "moon";
            outcome?: string | null;
            lost_attacker: number;
            lost_defender: number;
            loot_metal: number;
            loot_crystal: number;
            loot_deuterium: number;
            debris_metal: number;
            debris_crystal: number;
            /**
             * @description 1 when the full report is archived under `/combat-reports/{id}`
             * @enum {integer}
             */
            archived: 0 | 1;
            /** @description Owner of the target from the galaxy */
            target_player_name?: string | null;
            /** @description At one of the member's own planets (a defense */
            defense: boolean;
        } & components["schemas"]["MemberRow"];
        /** @description A recycling report of a member (`recycle_reports` row). */
        RecycleReport: {
            id: number;
            time: number | null;
            created_at: number;
            g: number;
            s: number;
            p: number;
            metal: number;
            crystal: number;
            /** @description What the field held before */
            total_metal: number;
            total_crystal: number;
        } & components["schemas"]["MemberRow"];
        /** @description An interplanetary missile impact a member synced. */
        MissileImpact: {
            id: number;
            time: number | null;
            /** @description When the copy was synced (for impacts without a time) */
            created_at: number;
            count: number;
            from_g: number;
            from_s: number;
            from_p: number;
            g: number;
            s: number;
            p: number;
            /** @enum {string|null} */
            result: "hit" | "intercepted" | "noDefense" | null;
            intercepted: number | null;
            /** @description Destroyed units by id */
            losses: {
                [key: string]: number;
            } | null;
            target_player_name?: string | null;
            /** @description The member's planet was the target */
            defense: boolean;
        } & components["schemas"]["MemberRow"];
        Raids: {
            from: number;
            to: number;
            perUser: {
                userId: number | null;
                username: string | null;
                raids: number;
                metal: number;
                crystal: number;
                deuterium: number;
                lost: number;
                debris: number;
            }[];
            reports: components["schemas"]["RaidReport"][];
            recyclePerUser: {
                userId: number | null;
                username: string | null;
                runs: number;
                metal: number;
                crystal: number;
                /** @description What the fields still held */
                left: number;
            }[];
            recycling: components["schemas"]["RecycleReport"][];
            missilePerUser: {
                userId: number | null;
                username: string | null;
                attacks: number;
                fired: number;
                intercepted: number;
                /** @description Missiles of attacks with a known result */
                known: number;
                losses: {
                    [key: string]: number;
                };
            }[];
            missiles: components["schemas"]["MissileImpact"][];
        };
        /** @description An expedition result (`expeditions` row, found resources and ships parsed). */
        Expedition: {
            id: number;
            user_id: number;
            username: string;
            /** @description `manual:…` for an event counted by hand on the deck tab */
            dedupe_key: string;
            time: number | null;
            created_at: number;
            g?: number | null;
            s?: number | null;
            p?: number | null;
            event: string;
            size: string;
            factor?: number | null;
            depletion?: string | null;
            found_resources: {
                [key: string]: number;
            };
            found_ships: {
                [key: string]: number;
            };
        };
        Expeditions: {
            from: number;
            to: number;
            perUser: {
                userId: number;
                username: string;
                total: number;
                /** @description Count per event key (`Res:Small`, `Nothing`) */
                events: {
                    [key: string]: number;
                };
                resources: {
                    [key: string]: number;
                };
                ships: {
                    [key: string]: number;
                };
            }[];
            deckSize: number;
            /** @description Cards per event key in the universe's deck */
            expected: {
                [key: string]: number;
            };
            list: components["schemas"]["Expedition"][];
        };
        Deck: {
            userId: number;
            settings: {
                startTime: number | null;
                initialDrawn: {
                    [key: string]: number;
                };
                unknownDepletion: number;
            };
            lastEvents: {
                id: number;
                event: string;
                size: string;
                depletion?: string | null;
                time: number;
                /** @enum {integer} */
                manual: 0 | 1;
            }[];
            state: {
                deckSize: number;
                cards: {
                    type: string;
                    size: string;
                    count: number;
                    key: string;
                    /** @description Expected remaining */
                    remaining: number;
                    remainingMin: number;
                    remainingMax: number;
                    nextProbability: number;
                }[];
                remainingTotal: number;
                drawnInDeck: number;
                resets: number;
                events: number;
                uncertainNothing: number;
            };
        };
        Known: {
            time: number;
            /**
             * @description From a spy report or the member's empire page
             * @enum {string}
             */
            source: "spy" | "empire";
        };
        PlayerDetails: {
            player: {
                id: number;
                ingame_id?: number | null;
                name: string;
                alliance_id?: number | null;
                status: string[];
                first_seen: number;
                last_seen: number;
                note?: string | null;
                ally_name?: string | null;
                ally_tag?: string | null;
                ally_ingame_id?: number | null;
            };
            history: {
                /** @description Stat category (1 total … 7 units) */
                type: number;
                time: number;
                points: number;
                rank?: number | null;
            }[];
            /** @description The caller's own total and fleet points, for comparison (empty on the own page) */
            ownHistory: {
                type: number;
                time: number;
                points: number;
            }[];
            planets: {
                g: number;
                s: number;
                p: number;
                name?: string | null;
                /** @enum {integer} */
                has_moon: 0 | 1;
                moon_name?: string | null;
                moon_diameter?: number | null;
                updated_at?: number | null;
                last_spy: number | null;
                last_spy_moon: number | null;
            }[];
            spyReports: {
                id: number;
                g: number;
                s: number;
                p: number;
                /** @enum {string} */
                planet_type: "planet" | "moon";
                planet_name?: string | null;
                report_time: number;
                /** @description Values per element class (900 resources, 0 buildings, 100 research, 200 fleet, 400 defense) */
                sections: Record<string, never>;
            }[];
            statusLog: {
                status: string;
                seen_at: number;
            }[];
            aliases: {
                name: string;
                seen_until: number;
            }[];
            research: null | ({
                values: {
                    [key: string]: number;
                };
            } & components["schemas"]["Known"]);
            /** @description Phalanx level per moon `g:s:p` */
            phalanx: {
                [key: string]: {
                    level: number;
                } & components["schemas"]["Known"];
            };
            pointsStall: components["schemas"]["PointsStall"];
            inactivity: components["schemas"]["Inactivity"];
        };
        Universe: {
            id: number;
            slug: string;
            name: string;
            settings: components["schemas"]["UniverseSettings"];
            /** @description The expedition deck (cards per event and size) */
            deck: {
                type: string;
                size: string;
                count: number;
            }[];
            /** @description Own values of ships and defense: differences from the default catalog per unit id */
            units: Record<string, never>;
            isDefault: boolean;
            startsAt: number | null;
            endedAt: number | null;
        };
        GalaxyView: {
            g: number;
            s: number;
            seen_at: number;
            /** @description Hub name of the member who synced the system last */
            username: string | null;
        };
        SpyReportRow: {
            id: number;
            g: number;
            s: number;
            p: number;
            /** @enum {string} */
            planet_type: "planet" | "moon";
            planet_name?: string | null;
            player_name: string | null;
            player_id: number | null;
            report_time: number;
            /** @description Values per element class (900 resources, 0 buildings, 100 research, 200 fleet, 400 defense) */
            sections: Record<string, never>;
            /** @description Hub name of the member who synced it */
            reporter: string | null;
        };
        Comment: {
            id: number;
            user_id: number | null;
            /** @description Hub name of the author */
            member: string | null;
            body: string;
            created_at: number;
            edited_at: number | null;
        };
        CommentCounts: {
            /** @description Comments per player id */
            players: {
                [key: string]: number;
            };
            /** @description Comments per plan id */
            plans: {
                [key: string]: number;
            };
            /** @description Comments per planet `g:s:p:type` */
            planets: {
                [key: string]: number;
            };
        };
        FleetShare: {
            /** @description Fleets are shared with the alliance by default */
            enabled: boolean;
            /** @description Missions never shared */
            hidden: number[];
            /** @description The own fleets also show in the history of past movements */
            history: boolean;
        };
        Coords: {
            g: number;
            s: number;
            p: number;
            /** @enum {string} */
            type: "planet" | "moon";
        };
        /** @description A hostile attack (single fleet or ACS) from the members' overview pastes or a phalanx result. */
        HostileAttack: {
            /** @description Stable while the attack lasts: route and the lead fleet's ships */
            key: string;
            /** @description Member it heads for (overview); null when only seen in a phalanx */
            memberId: number | null;
            /** @description That member */
            member: string | null;
            /** @enum {string} */
            source: "overview" | "phalanx";
            /** @description Member who pasted the phalanx */
            reporter: string | null;
            /** @description Landing back home when a phalanx of the attacker's planet shows the return */
            home: number | null;
            /** @description Page time of the overview it was seen on */
            seen: number;
            arrival: number;
            from: components["schemas"]["Coords"];
            to: components["schemas"]["Coords"];
            /** @description The lead first */
            fleets: {
                mission: number | null;
                ships: {
                    [key: string]: number;
                };
            }[];
            /** @description Owner of the origin according to the galaxy data */
            player: {
                id: number;
                name: string;
            } | null;
            /** @description Owner's drive research from the newest spy report showing research */
            drives: {
                research: {
                    [key: string]: number;
                };
                time: number | null;
            } | null;
            /** @description Latest possible return: slowest speed without any drive research */
            until: number;
            /** @description Retime plan against it */
            planId: number | null;
            /** @description Hold plan against it */
            holdPlanId: number | null;
            /** @description Hidden in the raid planner by a member, until its latest return */
            hidden: {
                by: string | null;
                at: number;
            } | null;
        };
        BattleHallEntry: {
            id: number;
            group_id?: number;
            report_id: string;
            time: number | null;
            attackers: string[];
            defenders: string[];
            winner: string | null;
            units: number;
            created_at: number;
            /** @description State of the crawler fetching the full report */
            report_status: string | null;
            report_tries: number;
            /** @description 1 for a farewell battle */
            memorial: number | null;
            /** @enum {integer} */
            archived: 0 | 1;
            /** @enum {integer} */
            moon_destruction: 0 | 1;
        };
        BattleHall: {
            total: number;
            page: number;
            pages: number;
            memorials: number;
            entries: components["schemas"]["BattleHallEntry"][];
        };
        /** @description An archived battle report, fleets expanded to element id with the amount before and after. */
        CombatReport: {
            group_id?: number;
            report_id: string;
            time: number | null;
            winner: string;
            rounds: number;
            lost_attacker: number;
            lost_defender: number;
            debris_metal: number;
            debris_crystal: number;
            loot_metal: number;
            loot_crystal: number;
            loot_deuterium: number;
            g: number | null;
            s: number | null;
            p: number | null;
            /** @enum {string|null} */
            planet_type: "planet" | "moon" | null;
            /** @enum {integer} */
            moon_destruction: 0 | 1;
            /** @description Moon chance in percent */
            moon_chance: number | null;
            moon_extra: number;
            /** @enum {integer} */
            moon_created: 0 | 1;
            /** @description Units of the battle hall entry */
            units: number | null;
            fleets: {
                /** @enum {string} */
                side: "attacker" | "defender";
                name: string;
                ships: {
                    id: number;
                    before: number;
                    after: number;
                }[];
            }[];
        };
        Claim: {
            id: number;
            user_id: number;
            member: string;
            g: number;
            s: number;
            p: number;
            /** @enum {string} */
            planet_type: "planet" | "moon" | "debris";
            /** @enum {string} */
            kind: "farm" | "attack" | "spy" | "recycle";
            note: string | null;
            created_at: number;
            expires_at: number;
            /** @description Target's owner by the galaxy data */
            player_id: number | null;
            player_name: string | null;
            planet_name: string | null;
        };
        MessageParty: {
            name: string;
            coords: string | null;
            /** @description Player of the own alliance */
            ally: boolean;
            /** @description Hub player */
            player: number | null;
        };
        Messages: {
            /** @description The caller's account setting: own messages are shared with the alliance */
            share: boolean;
            messages: {
                id: number;
                time: number;
                from_name: string;
                from_coords: string | null;
                subject: string;
                body: string;
                /** @description Members who synced it (visible to the caller) */
                synced_by: string[];
                /** @description The caller synced it */
                own: boolean;
                /** @description The caller's copy is shared */
                own_shared: boolean;
                /** @description The alliance sees it */
                shared: boolean;
                from: components["schemas"]["MessageParty"];
                recipients: components["schemas"]["MessageParty"][];
                conversation: string;
                /** @description Written by the caller, or by a member in a conversation without the caller */
                out: boolean;
            }[];
            conversations: {
                id: string;
                parties: ({
                    self: boolean;
                    member: boolean;
                } & components["schemas"]["MessageParty"])[];
                count: number;
                last: number;
            }[];
        };
        PlanFleet: {
            id: number;
            user_id: number;
            member: string;
            /** @description Start planet; null while not chosen (an invited member) */
            g: number | null;
            s: number | null;
            p: number | null;
            /** @enum {string|null} */
            planet_type: "planet" | "moon" | null;
            ships: {
                [key: string]: number;
            };
            /** @description Speed in percent */
            speed: number;
            /** @enum {string} */
            status: "invited" | "ready" | "launched" | "withdrawn";
            recalled_at: number | null;
            updated_at: number;
            /** @description Drive research of the member (synced or entered by hand) */
            drives: Record<string, never> | null;
            /** @description Combat research from a taken-over simulation where the member's is unknown */
            sim_research: Record<string, never> | null;
            /** @description The launch as seen in the member's newest fleet list */
            seen: Record<string, never> | null;
        };
        Plan: {
            id: number;
            user_id: number;
            creator: string;
            g: number | null;
            s: number | null;
            p: number | null;
            /** @enum {string|null} */
            planet_type: "planet" | "moon" | null;
            target_time: number;
            /** @enum {string} */
            time_precision: "day" | "hour" | "exact";
            note: string | null;
            /** @enum {string} */
            status: "planning" | "launched" | "done" | "cancelled";
            /** @enum {string} */
            mission: "attack" | "hold";
            /** @description Fleets of players outside the hub taking part (simulator) */
            guests: Record<string, never>[];
            created_at: number;
            updated_at: number;
            /** @description Member holding the active claim of the target */
            claim_user_id: number | null;
            player_id: number | null;
            player_name: string | null;
            planet_name: string | null;
            /** @description When and by whom a simulation was taken over into the plan */
            sim: {
                time: number;
                by: string | null;
                defender: boolean;
            } | null;
            fleets: components["schemas"]["PlanFleet"][];
            /** @description The hostile fleet a retime or hold plan is about */
            enemy: Record<string, never> | null;
            /** @description Newest spy values of the target (or the attacker for a hold) for the simulators */
            spy: {
                time: number;
                values: {
                    [key: string]: number;
                };
            } | null;
        };
        Stats: {
            /** @enum {string} */
            who: "player" | "alliance";
            type: number;
            /** @description Per category the newest stand and which pages of 100 ranks it holds (sync overview) */
            categories: {
                /** @enum {string} */
                who: "player" | "alliance";
                type: number;
                stat_time: number;
                pages: number[];
            }[];
            /** @description The caller's player, its alliance and newest points per category */
            me: {
                id: number;
                allyId: number | null;
                points: {
                    [key: string]: number;
                };
            } | null;
            statTime: number | null;
            prevTime: number | null;
            /** @description Players (`who=player`) or alliances (`who=alliance`) of the newest stand, by rank */
            rows: {
                rank: number;
                rank_change?: number | null;
                points: number;
                id: number;
                name: string;
                own: boolean;
                prev_rank: number | null;
                /** @description Points since the stand before */
                delta: number | null;
                title?: string | null;
                status?: string[];
                ally_id?: number | null;
                ally_name?: string | null;
                ally_tag?: string | null;
                planet_count?: number;
                first_planet?: string | null;
                /** @enum {integer} */
                member?: 0 | 1;
                ownAlly?: boolean;
                scores?: {
                    [key: string]: number;
                };
                points_stall?: components["schemas"]["PointsStall"];
                /** @description Alliances only */
                members?: number | null;
                /** @description Alliances only */
                tag?: string | null;
            }[];
        };
        GalaxySystem: {
            /** @description The newest galaxy view of the system */
            view: {
                seen_at: number;
                username: string | null;
            } | null;
            /** @description Moons whose sensor phalanx reaches the system, newest knowledge first */
            phalanx: {
                g: number;
                s: number;
                p: number;
                level: number;
                range: number;
                from: number;
                to: number;
                distance: number;
                time: number;
                /** @enum {string} */
                source: "spy" | "empire";
                own: boolean;
                player?: Record<string, never> | null;
            }[];
            rows: {
                p: number;
                name?: string | null;
                /** @enum {integer} */
                has_moon: 0 | 1;
                moon_name?: string | null;
                moon_diameter?: number | null;
                /** @enum {integer} */
                destroyed: 0 | 1;
                /** @description Debris field (metal */
                debris?: Record<string, never> | null;
                updated_at: number | null;
                player_id: number | null;
                ingame_id?: number | null;
                player_name?: string | null;
                status: string[];
                note?: string | null;
                ally_id?: number | null;
                ally_name?: string | null;
                ally_tag?: string | null;
                last_battle?: number | null;
                points: number | null;
                rank: number | null;
                /** @description Planet of an alliance member */
                own: boolean;
                spy_planet: components["schemas"]["SpyMark"];
                spy_moon: components["schemas"]["SpyMark"];
            }[];
        };
        /** @description The newest spy report of the position and the resources the newest report showing them had */
        SpyMark: {
            time: number;
            res: {
                [key: string]: number;
            } | null;
            resTime: number | null;
        } | null;
        PlayerMatch: {
            id: number;
            ingame_id: number | null;
            name: string;
            ally_name: string | null;
        };
        /** @description What a sync stored (or would store with `dryRun`), per record kind */
        IngestSummary: {
            pageType: string;
            source: string | null;
            lang: string | null;
            /** @description Stable codes */
            warnings: string[];
            counts: {
                [key: string]: {
                    new: number;
                    duplicate: number;
                };
            };
            /** @description Short description per record for the preview */
            preview: Record<string, never>[];
            /** @description Loot settlements (raid plans) the messages count for */
            settlements?: Record<string, never>[];
            explain?: components["schemas"]["Explanation"];
        };
        Created: {
            id: number;
        };
        CrawlerStatus: {
            enabled: boolean;
            /** @description Universes whose game is failing (paused or stopped) */
            universes: {
                universe: string;
                failures: number;
                failingSince: number;
                nextAttempt: number;
                stopped: boolean;
                lastError: string;
            }[];
            archived?: number | null;
            gone?: number | null;
            lost?: number | null;
            pending?: number | null;
            failed?: number | null;
        };
        /** @description The member's newest synced fleet movements as far as they share them with the caller; null without a synced fleet list. */
        SharedFleets: {
            /** @description Unix seconds of the synced page */
            time: number;
            /** @description Fleets (own */
            data: Record<string, never>[];
            /** @description The member shares no fleets by default (`fleetShare` off); single fleets may still be shared */
            private: boolean;
        } | null;
        AllianceMember: {
            key?: string;
            user_id?: number | null;
            username?: string;
            /** @description Hub display name; null when unset or for spy-only players */
            display_name?: string | null;
            ingame_name?: string | null;
            player_id?: number | null;
            /** @enum {string|null} */
            source?: "empire" | "spy" | null;
            created_at?: number | null;
            data?: Record<string, never> | null;
            fleets?: components["schemas"]["SharedFleets"];
            fleetHistory?: Record<string, never>[];
        };
    };
    responses: never;
    parameters: {
        /** @description Universe slug (e.g. `u8`) */
        Uni: string;
        /** @description Alliance group id (see `GET /api/auth/me`) */
        HubGroupHeader: number;
        /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
        HubGroupQuery: number;
        /** @description Attack plan id */
        PlanId: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok?: true;
                    };
                };
            };
        };
    };
    openApiJson: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description This specification as JSON */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    openApiYaml: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description This specification as YAML */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/yaml": string;
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current user and group memberships */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
        };
    };
    setDateFormat: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    dateFormat: "auto" | "dmy." | "dmy/" | "ymd";
                };
            };
        };
        responses: {
            /** @description Stored on the account */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                        dateFormat?: string;
                    };
                };
            };
            /** @description Unknown date format (`date_format_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setTours: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    enabled?: boolean;
                    /** @description Tour id to mark as seen */
                    seen?: string;
                    /**
                     * @description Forget all seen tours
                     * @enum {boolean}
                     */
                    reset?: true;
                };
            };
        };
        responses: {
            /** @description The new tour settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tours"];
                };
            };
            /** @description No or invalid field (`tours_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFleetSavePresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stored presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        presets: components["schemas"]["FleetSavePreset"][] | null;
                    };
                };
            };
        };
    };
    setFleetSavePresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    presets: components["schemas"]["FleetSavePreset"][];
                };
            };
        };
        responses: {
            /** @description The stored presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        presets: components["schemas"]["FleetSavePreset"][];
                    };
                };
            };
            /** @description No list, more than 20 entries or an invalid entry (`presets_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getShareSyncs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether the live events of the user's syncs name the user (other members get a hint "X synced …"). Off: the events go out without `userId`, views still reload. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    setShareSyncs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Enabled"];
            };
        };
        responses: {
            /** @description Stored on the account */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    getPushSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSettings"];
                };
            };
        };
    };
    setPushSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PushSettings"];
            };
        };
        responses: {
            /** @description Stored settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSettings"];
                };
            };
            /** @description Lead time not one of the allowed values (`push_settings_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPushKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description VAPID key and status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        enabled: boolean;
                        /** @description Base64url (uncompressed P-256 point) */
                        publicKey: string | null;
                    };
                };
            };
        };
    };
    addPushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description HTTPS URL of FCM
                     */
                    endpoint: string;
                    keys: {
                        p256dh: string;
                        auth: string;
                    };
                };
            };
        };
        responses: {
            /** @description Registered */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                        /** @description Quiet hours of this browser (kept when it registers again, dropped when it moves to another user) */
                        quiet?: components["schemas"]["QuietHours"] | null;
                    };
                };
            };
            /** @description Invalid endpoint or keys (`push_endpoint_invalid`, `push_keys_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Push is not set up on this hub (`push_disabled`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removePushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uri */
                    endpoint: string;
                };
            };
        };
        responses: {
            /** @description Unregistered (or not registered) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                        /** @description 0 when the browser was not registered for the caller */
                        removed?: number;
                    };
                };
            };
        };
    };
    sendTestPush: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sent */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Browsers the push services accepted it for */
                        devices?: number;
                    };
                };
            };
            /** @description Push is not set up on this hub (`push_disabled`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setPushQuietHours: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description Endpoint of the registered browser
                     */
                    endpoint: string;
                    quiet: components["schemas"]["QuietHours"] | null;
                };
            };
        };
        responses: {
            /** @description Stored quiet hours */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        quiet: components["schemas"]["QuietHours"] | null;
                    };
                };
            };
            /** @description Invalid endpoint or quiet hours (`push_endpoint_invalid`, `quiet_hours_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The browser is not registered for the caller (`push_subscription_unknown`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDiscordSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordSettings"];
                };
            };
        };
    };
    setDiscordSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Discord webhook URL (`https://discord.com/api/webhooks/…`); null or empty removes it */
                    webhook?: string | null;
                    /** @description Discord user id (17 to 20 digits); null or empty removes it */
                    userId?: string | null;
                    prefs?: components["schemas"]["PushSettings"];
                };
            };
        };
        responses: {
            /** @description Stored settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordSettings"];
                };
            };
            /** @description Invalid webhook, user id or settings (`discord_webhook_invalid`, `discord_user_id_invalid`, `discord_settings_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    sendTestDiscord: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Discord took the message */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description No webhook set (`discord_not_configured`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Discord refused the message (`discord_send_failed`); a webhook Discord no longer knows is removed */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGroupMemberCandidates: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accounts by username */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description User id */
                        id: number;
                        username: string;
                        /** @description false for a placeholder without password */
                        account: boolean;
                        /** @description Most recent in-game name of the account in another alliance */
                        ingameName: string | null;
                        /** @description Alliances of the account as "<universe slug> · <alliance name>" */
                        groups: string[];
                    }[];
                };
            };
            /** @description Not an admin of the alliance (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGroupMembers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        username?: string;
                        role?: string;
                        ingame_name?: string | null;
                        /** @description The member has a password (false = placeholder) */
                        account?: boolean;
                        /** @description Onboarding steps the member has done (first sync of each kind of page) */
                        onboarding?: ("empire" | "stats" | "overview" | "research" | "galaxy" | "messages" | "buildings")[];
                        /** @description Expiry of the member's open claim or recovery link, null without one (recovery links only for global admins). Links are stored as their hash: the link itself is only returned when created (`addGroupMember`, `createMemberInvite`). */
                        invite_expires_at?: number | null;
                    }[];
                };
            };
        };
    };
    addGroupMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description In-game name of a new placeholder member */
                    name?: string;
                    /** @description Existing account to add instead of a new one */
                    userId?: number;
                    /** @description With `userId`: in-game name in this alliance */
                    ingameName?: string | null;
                };
            };
        };
        responses: {
            /** @description Added */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description User id of the member */
                        id: number;
                        /** @description Claim invite token (only for a new placeholder); returned only here, the hub keeps its hash */
                        token?: string;
                    };
                };
            };
            /** @description Neither `name` nor `userId` (`name_missing`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not an admin of the alliance (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The account is not one the caller may add (`user_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Already a member, or the in-game name is taken in the alliance (`member_exists`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getGroupDiscord: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordChannelSettings"];
                };
            };
            /** @description Not an admin of the alliance (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setGroupDiscord: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Discord webhook URL; null or empty removes it */
                    webhook?: string | null;
                    prefs?: components["schemas"]["DiscordChannelPrefs"];
                };
            };
        };
        responses: {
            /** @description Stored settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordChannelSettings"];
                };
            };
            /** @description Invalid webhook or settings (`discord_webhook_invalid`, `discord_settings_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not an admin of the alliance (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    sendTestGroupDiscord: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Discord took the message */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description Not an admin of the alliance (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description No webhook set (`discord_not_configured`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Discord refused the message (`discord_send_failed`) */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGroupFleetAttacks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Attacks per member */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoredFleetAttack"][];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeGroupFleetAttack: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Alliance group id */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Member whose fleet lists hold the attack */
                    userId: number;
                    /** @description Attack key from the list */
                    key: string;
                    /** @description Arrival (epoch seconds) of the wave to remove; without it every wave with this key goes */
                    arrival?: number;
                };
            };
        };
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Fleet lists changed */
                        snapshots?: number;
                    };
                };
            };
            /** @description Missing `userId` or `key`, or `arrival` not a number (`invalid_body`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not a member of the alliance (`member_not_found`) or no such attack (`attack_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getUniverseUnits: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Units of the universe */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnitsAdmin"];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description No such universe (`universe_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putUniverseUnits: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    units?: components["schemas"]["UnitOverrides"];
                };
            };
        };
        responses: {
            /** @description Stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnitsAdmin"];
                };
            };
            /** @description Invalid differences (`units_invalid`, the message names the first field) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    parseUniverseUnits: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Page source */
                    html: string;
                    /** @description Further unit names -> id */
                    names?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description Values found per unit */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        kind: "shipyard" | "techtree" | "info";
                        /** @enum {string} */
                        lang: "de" | "en";
                        units: Record<string, never>[];
                        /** @description Names without a known id */
                        unknown: string[];
                    };
                };
            };
            /** @description No page source (`units_page_invalid`) or not one of these pages (`units_page_unknown`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSystemInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current figures */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemInfo"];
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    vacuumDatabase: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Database compacted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        /** @description File size before (bytes) */
                        before: number;
                        /** @description File size after (bytes) */
                        after: number;
                        /** @description Duration */
                        ms: number;
                    };
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Less free disk space than the database needs to be rewritten (`disk_space_low`) */
            507: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    requestAccess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 3–32 characters (letters */
                    username: string;
                    password: string;
                    /** @description Shown to the admin */
                    message: string;
                    /** @enum {string} */
                    lang?: "de" | "en";
                };
            };
        };
        responses: {
            /** @description Request stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description Invalid username, password length or message too long (`username_invalid`, `password_too_short`, `password_too_long`, `message_missing`, `message_too_long`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Username taken by an account with a password or an open request (`username_taken`; placeholder members without a password do not block the name) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too many requests from this IP or too many open requests (`too_many_attempts`, `too_many_requests`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAccessRequests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Requests and placeholder players */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        requests?: {
                            id?: number;
                            username?: string;
                            message?: string;
                            created_at?: number;
                            /**
                             * @description The player without an account whose login name the request carries; the request can only be
                             *     assigned to them (`username_of_placeholder` otherwise)
                             */
                            placeholder?: number | null;
                        }[];
                        placeholders?: {
                            /** @description User id to assign to */
                            id?: number;
                            name?: string;
                            group?: string;
                            universe?: string;
                        }[];
                    };
                };
            };
            /** @description Neither a global nor an alliance admin (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    assignAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    userId: number;
                };
            };
        };
        responses: {
            /** @description Assigned */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description The player already has an account (`not_placeholder`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not an admin, or an alliance admin and the player is also in an alliance they are not admin of (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Request not found (`not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description The username has been taken meanwhile (`username_taken`), or it is the login name of another player
             *     without an account, who is the one to assign the request to (`username_of_placeholder`)
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description Not a global admin (`admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Request not found (`not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listApiTokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Personal API tokens (no secrets) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiTokenMeta"][];
                };
            };
            /** @description Not logged in */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createApiToken: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                };
            };
        };
        responses: {
            /** @description Token created (secret shown once) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiTokenCreated"];
                };
            };
        };
    };
    revokeApiToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
        };
    };
    getCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Element names and costs (not player data) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listUniverses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Universes the user can access; each carries `isDefault` (the universe the start page forwards to) and `startsAt`/`endedAt` (scheduled start and end, epoch seconds or null) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Universe"][];
                };
            };
        };
    };
    getContext: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Context"];
                };
            };
        };
    };
    getSyncHints: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        hints: components["schemas"]["SyncHint"][];
                        messagesDays: number;
                    };
                };
            };
        };
    };
    getOnboarding: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        steps?: {
                            /** @enum {string} */
                            key?: "empire" | "stats" | "overview" | "research" | "galaxy" | "messages" | "buildings";
                            time?: number | null;
                        }[];
                        done?: number;
                        total?: number;
                    };
                };
            };
        };
    };
    getFarmTargets: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Age of the newest report with resources in days (1–30, default 7) */
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        targets?: components["schemas"]["FarmTarget"][];
                        resourceSpeed?: number;
                        /** @enum {string} */
                        speedSource?: "settings" | "empire" | "default";
                        storageFactor?: number;
                        days?: number;
                        /** @description Time of the universe the projection is for (Unix seconds) */
                        now?: number;
                    };
                };
            };
        };
    };
    getOverview: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Overview"];
                };
            };
        };
    };
    getStats: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                who?: "player" | "alliance";
                type?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Stats"];
                };
            };
        };
    };
    searchPlayers: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                q?: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlayerMatch"][];
                };
            };
        };
    };
    globalSearch: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                q?: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        players: {
                            id?: number;
                            name?: string;
                            status?: string[];
                            ally_tag?: string | null;
                            ally_name?: string | null;
                            /** @description Former name that matched (null when the current name matched) */
                            alias?: string | null;
                        }[];
                        alliances: {
                            id?: number;
                            name?: string;
                            tag?: string | null;
                            /** @description Known players of the alliance */
                            players?: number;
                        }[];
                        /** @description Only for coordinates; owner fields are missing when the position is unknown */
                        planet: {
                            g?: number;
                            s?: number;
                            p?: number;
                            name?: string | null;
                            has_moon?: boolean;
                            moon_name?: string | null;
                            destroyed?: boolean;
                            player_id?: number | null;
                            player_name?: string | null;
                            ally_tag?: string | null;
                        } | null;
                    };
                };
            };
        };
    };
    getInactivityCheck: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                fresh?: "1";
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        generatedAt?: number;
                        weights?: {
                            [key: string]: number;
                        };
                        events?: number;
                        skipped?: number;
                        /** @description Used events whose last login a proof of activity narrowed down */
                        narrowed?: number;
                        detection?: {
                            hours?: number;
                            n?: number;
                            likely?: number;
                            inactive?: number;
                            median?: number | null;
                        }[];
                        falseAlarms?: components["schemas"]["FalseAlarmSummary"] & {
                            /** @description Share of high scores disproved within 24 hours (the false alarm rate) */
                            rate?: number | null;
                            /** @description Disproved within 72 hours, by what came first: gain or the proof source */
                            causes?: {
                                [key: string]: number;
                            };
                            examples?: {
                                playerId?: number;
                                name?: string;
                                time?: number;
                                score?: number;
                                /** @description Earliest horizon within which activity showed */
                                hours?: number;
                                /** @description Time of the cause */
                                activeAt?: number;
                                /** @description gain or the proof source (attack, spy, message, fleet, recall, manual, fleetGone) */
                                cause?: string;
                                gain?: {
                                    /** @description Points of the gain */
                                    size?: number | null;
                                    /** @description Share of the median gain of the active players around the rank */
                                    ratio?: number | null;
                                    /** @description Categories that grew in that update (2 fleet, 3 research, 4 buildings, 5 defense) and by how much */
                                    categories?: {
                                        [key: string]: number;
                                    };
                                } | null;
                            }[];
                        };
                        /** @description Ended universe: samples whose 72 hours of follow-up reach into the last 7 days before the end, counted apart (players come back before a universe closes); null for a running universe */
                        endPhase?: (components["schemas"]["FalseAlarmSummary"] & {
                            ended?: number;
                        }) | null;
                    };
                };
            };
            /** @description Not an alliance admin */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getPlayer: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlayerDetails"];
                };
            };
        };
    };
    getPlayerActivity: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Start of the period (Unix seconds) */
                        from: number;
                        events: components["schemas"]["ActivityEvent"][];
                        /** @description Total points per stat time since 12 hours before `from`, oldest first: the gain per stat window compared with the player's other windows tells how active they were then (coarse, 6-hour blocks). */
                        scores?: {
                            /** @description Stat time (Unix seconds) */
                            time?: number;
                            points?: number;
                        }[];
                    };
                };
            };
            /** @description Not a player of the group (`player_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    reportPlayerActivity: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Unix seconds (default now) */
                    time?: number | null;
                    /**
                     * @description Online or offline report (default online)
                     * @enum {string}
                     */
                    kind?: "online" | "offline";
                };
            };
        };
        responses: {
            /** @description Stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Time in the future or older than 7 days (`activity_time_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not a player of the group (`player_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deletePlayerActivity: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
                eventId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not a player of the group (`player_not_found`) or no own manual report (`activity_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getImperium: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                user?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Imperium"];
                };
            };
        };
    };
    getDebrisFinder: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Age of the newest information about a field in days (1–30, default 7) */
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fields?: {
                            g?: number;
                            s?: number;
                            p?: number;
                            metal?: number;
                            crystal?: number;
                            time?: number;
                            base?: {
                                /** @enum {string} */
                                source?: "galaxy" | "recycle";
                                time?: number;
                                metal?: number;
                                crystal?: number;
                                /** @description Member whose recyclers left the rest */
                                by?: string | null;
                            } | null;
                            battles?: {
                                time?: number;
                                metal?: number;
                                crystal?: number;
                            }[];
                            /** @description Owner of the planet at the position; `member` when it is one of the group's members */
                            owner?: {
                                id?: number;
                                name?: string;
                                ally_tag?: string | null;
                                member?: boolean;
                            } | null;
                        }[];
                        recyclers?: {
                            userId?: number;
                            member?: string;
                            g?: number;
                            s?: number;
                            p?: number;
                            /** @enum {string} */
                            type?: "planet" | "moon";
                            recyclers?: number;
                            speed?: number;
                            time?: number;
                        }[];
                        capacity?: number | null;
                        days?: number;
                        now?: number;
                    };
                };
            };
        };
    };
    getColonizeSystems: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Range in systems (1–200 */
                range?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        systems?: {
                            g?: number;
                            s?: number;
                            free?: number[];
                            seen?: number;
                            coverage?: number;
                            nearest?: number | null;
                            members?: number;
                            targets?: number;
                            inactive?: number;
                            targetPoints?: number;
                            systemPoints?: number;
                        }[];
                        /** @description The viewer's planets (newest empire page) */
                        own?: number;
                        seenSystems?: number;
                        totalSystems?: number;
                        range?: number;
                    };
                };
            };
        };
    };
    getDebrisFields: {
        parameters: {
            query: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Galaxies, comma separated (`1,3`) */
                g: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fields?: {
                            [key: string]: {
                                s?: number;
                                p?: number;
                                visible?: boolean;
                                active?: boolean;
                                sure?: boolean;
                                /** @description Newest sign of the field (Unix seconds) */
                                time?: number;
                            }[];
                        };
                        /** @description The last run of the weekly debris cleaner (Unix seconds) */
                        cleanup?: number;
                    };
                };
            };
        };
    };
    getFreePositions: {
        parameters: {
            query: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Galaxies, comma separated (`1,3`) */
                g: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Per galaxy the systems with free positions */
                        systems?: {
                            [key: string]: {
                                s?: number;
                                free?: number[];
                                /** @description When the galaxy showed the system (Unix seconds) */
                                seen?: number;
                            }[];
                        };
                    };
                };
            };
        };
    };
    getAllianceHealth: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        medianGrowth?: number | null;
                        /** @description Seconds the growth and activity cover */
                        window?: number;
                        members?: {
                            userId?: number;
                            /** @description Hub display name */
                            name?: string;
                            /** @description In-game name when it differs from `name` */
                            ingameName?: string | null;
                            role?: string;
                            lastSeen?: number | null;
                            /** @description The member hides their online status from the caller */
                            onlineHidden?: boolean;
                            player?: Record<string, never> | null;
                            points?: number | null;
                            rank?: number | null;
                            growth?: number | null;
                            partial?: boolean;
                            /** @description Page type (empire, overview, fleets, buildings, research, galaxy, stats, messages, …) → Unix seconds */
                            syncs?: Record<string, never>;
                            battles?: number;
                            loot?: number;
                            expeditions?: number;
                            openDeliveries?: number;
                            flags?: ("behind" | "noEmpire" | "staleEmpire" | "noStats" | "away")[];
                        }[];
                    };
                };
            };
        };
    };
    exportGroupData: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Reports, battles and expeditions this many days back (default 30) */
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        universe?: string;
                        group?: string;
                        exportedAt?: number;
                        since?: number;
                        players?: Record<string, never>[];
                        planets?: Record<string, never>[];
                        "spy-reports"?: Record<string, never>[];
                        "battle-reports"?: Record<string, never>[];
                        expeditions?: Record<string, never>[];
                        settlements?: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid `days` (`export_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    exportDatasetCsv: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Like `/api/{uni}/export` */
                days?: number;
                /** @description Separator (default comma; semicolon for spreadsheets with a decimal comma) */
                sep?: "comma" | "semicolon" | "tab";
                /** @description Player name contains this text (case ignored) */
                q?: string;
                /** @description Alliance name or tag contains this text (case ignored) */
                ally?: string;
                /** @description Players the game flags inactive: left out, or only them */
                inactive?: "hide" | "only";
                /** @description `0`: players in vacation mode are left out */
                vacation?: "0";
                /** @description Total points at least */
                minPoints?: number;
                /** @description Total points at most */
                maxPoints?: number;
                /** @description Planets of this galaxy (`planets` only) */
                galaxy?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                dataset: "players" | "planets" | "spy-reports" | "battle-reports" | "expeditions" | "settlements";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            /** @description Invalid `days` or filter (`export_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown dataset (`export_unknown`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAttackAssist: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Key of the attack (route and lead ships) */
                key?: string;
                /** @description Attacked member's user id */
                member?: number;
                /** @description Impact (Unix seconds) */
                arrival?: number;
                /** @description Origin `g:s:p` */
                from?: string;
                /** @description `0` skips the simulation */
                sim?: "0" | "1";
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description The hostile attack (`key`, `arrival`, `from`, `to`, `fleets`, `player`, `drives`, …) */
                        attack?: Record<string, never>;
                        member?: {
                            id?: number;
                            name?: string;
                        } | null;
                        /** @description The attacked body: `g`, `s`, `p`, `type`, `name`, `values` (levels and units of the empire page), `present` (`values` without the ships of `away`: what defends in the simulation and can still be saved), `resources` at the impact (`metal`, `crystal`, `deuterium`), `empireTime`, `deuterium` and `perHour` of the empire page */
                        target?: Record<string, never> | null;
                        /** @description The member's planets and moons (`g`, `s`, `p`, `type`, `name`) */
                        bodies?: Record<string, never>[];
                        /** @description The member's research levels */
                        research?: Record<string, never>;
                        attacker?: {
                            player?: Record<string, never> | null;
                            /** @description `values` and `time` of the newest spy report showing research */
                            research?: Record<string, never> | null;
                            /** @description Ships of all fleets of the attack */
                            ships?: Record<string, never>;
                            /** @description When the movement shows no ships: `time` of the spy report of the origin whose flying ships are used instead */
                            estimated?: Record<string, never> | null;
                        };
                        /** @description Resources the surviving attackers could take (`metal`, `crystal`, `deuterium`) */
                        loot?: Record<string, never> | null;
                        helpers?: {
                            userId?: number;
                            member?: string;
                            from?: Record<string, never>;
                            ships?: Record<string, never>;
                            points?: number;
                            /** @description One-way seconds at full speed */
                            duration?: number;
                            /** @description Latest launch (Unix seconds) */
                            launch?: number;
                        }[];
                        /** @description Id of an open hold plan for the attack */
                        holdPlan?: number | null;
                        /** @description Ships of the member that left the attacked body after their newest empire page (newer fleet list, not in a fleet list from up to the empire page) and are not back by the impact; taken off the planet in the simulation. `unknown` when no fleet list from before the empire page exists. */
                        away?: {
                            ships?: Record<string, never>;
                            fleets?: number;
                            unknown?: boolean;
                        } | null;
                        /** @description Hold fleets at the planet at the impact (they defend in the simulation) */
                        holds?: {
                            /** @description Member it belongs to (by fleet list or start planet) */
                            member?: string | null;
                            player?: string | null;
                            from?: Record<string, never>;
                            ships?: Record<string, never>;
                            /** @description The member's research (empty for others) */
                            research?: Record<string, never>;
                            /** @description Landing at the planet; null when holding there already */
                            arrival?: number | null;
                        }[];
                        /** @description Hostile phalanxes reaching the planet (like `PhalanxExposure.threats`) */
                        phalanx?: Record<string, never>[];
                        /** @description Ships and planet are known (a simulation is possible) */
                        simulated?: boolean;
                        /** @description Simulation summary (`wins`, `rounds`, `attackers`, `defenders`, `loot`, `debris`, `lostResources`, …) or `{ error }` */
                        sim?: Record<string, never> | null;
                        now?: number;
                    };
                };
            };
            /** @description No such hostile attack (`attack_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getDefenseAdvice: {
        parameters: {
            query: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description The caller's body `g:s:p:planet` or `g:s:p:moon` */
                planet: string;
                /** @description `0`: the planet's ships are away (only defense and solar satellites defend); default `1` */
                ships?: "0" | "1";
                /** @description `0`: the debris field does not count as profit; default `1` */
                debris?: "0" | "1";
                /** @description Resources at the attack: projected to now (default) or full storages */
                loot?: "now" | "full";
                /** @description Comma-separated `key`s of the threats to simulate (default: all listed) */
                threats?: string;
                /** @description `0` lists the threats without the search */
                sim?: "0" | "1";
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description `key`, `name`, `coords`, `type`, `time` of the state, `units` defending (ships with `ships`, defense incl. the shipyard queue, solar satellites), combat `research`, `resources` at the attack, `defenseValue` (defense in deuterium by the rate) */
                        planet?: Record<string, never>;
                        /** @description `m` and `k` (metal and crystal per deuterium) and `source` (`market` or `default`) */
                        rate?: Record<string, never>;
                        /** @description Defense units the planet can build (requirements met; shield domes not built yet) */
                        candidates?: number[];
                        threats?: {
                            /** @description Id for `threats` */
                            key?: string;
                            /** @description `id` (null when unknown), `name`, `status`, `allyTag` */
                            player?: Record<string, never>;
                            reasons?: {
                                /** @enum {string} */
                                kind?: "spied" | "attacked" | "incoming" | "nearby";
                                count?: number;
                                last?: number | null;
                            }[];
                            /** @description `units`, `points`, `source` (`spy`, `combat`, `incoming`), `time`, `from` (null when unknown) */
                            fleet?: Record<string, never>;
                            /** @description `points` and `time` of the newest fleet statistics */
                            fleetPoints?: Record<string, never> | null;
                            /** @description `values`, `known` (from a spy report), `time` */
                            research?: Record<string, never>;
                            /** @description `from`, `distance`, `duration` (seconds), `fuel` (deuterium) */
                            flight?: Record<string, never> | null;
                            /** @description Heavy ships only: `units`, `points`, `flight`; null without heavy ships or when the fleet has nothing else */
                            heavy?: Record<string, never> | null;
                        }[];
                        /** @description Search keys of the threat variants given to the search (`<key>` and `<key>:heavy`) */
                        simulated?: string[];
                        /** @description `status` (`safe`, `found`, `limit`, `budget`), `before` and `after` (per threat `key`, `profit` in deuterium, average `loot`, `debris`, `lost` and `defenderLost` resources, `fuel`, `wins` share of the attacker), `add` (defense units to build), `cost`, `costValue`, `battles` and `runs` per battle; or `{ error }` */
                        advice?: Record<string, never> | null;
                        now?: number;
                    };
                };
            };
            /** @description Invalid `planet` (`planet_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not one of the caller's synced planets (`planet_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getThreats: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description Period in days (clamped to 1-3650; missing, empty or not a number: 30) */
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The threats, the highest score first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        days: number;
                        /** @description Time zone of the universe (`hours` and `peak` are in it) */
                        timezone: string;
                        /** @description Planets of the caller the hub knows (0: battles and flight times cannot be found) */
                        ownPlanets: number;
                        now: number;
                        threats: components["schemas"]["Threat"][];
                    };
                };
            };
        };
    };
    getDefenseRisk: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                /** @description `0`: the ships are away; default `1` */
                ships?: "0" | "1";
                /** @description `0`: the debris field does not count as profit; default `1` */
                debris?: "0" | "1";
                /** @description Resources: projected to now (default) or full storages */
                loot?: "now" | "full";
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        planets?: {
                            key?: string;
                            name?: string;
                            coords?: Record<string, never>;
                            /** @enum {string} */
                            type?: "planet" | "moon";
                            /** @description Known threats of the body */
                            threats?: number;
                            /** @description Attacks left out for the engine budget */
                            skipped?: number;
                            /** @description The most profitable attack: threat `key`, `player`, `heavy` (heavy ships only), `profit` in deuterium, `wins` share, average `loot`, `debris`, `lost`, `fuel` */
                            worst?: Record<string, never> | null;
                        }[];
                        /** @description Runs per attack */
                        runs?: number | null;
                        battles?: number | null;
                        cached?: boolean;
                        /** @description Simulator busy or missing (`battle_busy`, `battle_rate_limit`, …) */
                        error?: string | null;
                        /** @description `m`, `k`: metal and crystal per deuterium */
                        rate?: Record<string, never>;
                        now?: number;
                    };
                };
            };
        };
    };
    putFleetAlert: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Game mission id */
                    mission?: number | null;
                    /** @enum {string} */
                    phase: "out" | "return" | "hold";
                    /** @description Start: `{ coords: { g, s, p }, type }` */
                    from: Record<string, never>;
                    /** @description Target: `{ coords: { g, s, p }, type }` */
                    to?: Record<string, never> | null;
                    /** @description Unix seconds */
                    arrival: number;
                    /** @description Minutes before the arrival (default 0) */
                    lead?: number;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        alerts?: components["schemas"]["FleetAlert"][];
                    };
                };
            };
            /** @description Invalid body (`alert_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such own fleet in flight in the caller's newest fleet list (`fleet_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    putFleetShare: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Game mission id */
                    mission?: number | null;
                    /** @enum {string} */
                    phase: "out" | "return" | "hold";
                    /** @description Start: `{ coords: { g, s, p }, type }` */
                    from: Record<string, never>;
                    /** @description Target: `{ coords: { g, s, p }, type }` */
                    to?: Record<string, never> | null;
                    /** @description Unix seconds */
                    arrival: number;
                    shared: boolean;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        shared?: boolean;
                        /** @description Fleet lines the choice was stored for */
                        lines?: number;
                    };
                };
            };
            /** @description Invalid body (`fleet_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such own fleet in the caller's fleet lists (`fleet_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteFleetAlert: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        alerts?: components["schemas"]["FleetAlert"][];
                    };
                };
            };
            /** @description Not an alert of the caller (`alert_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getBuildings: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Buildings"];
                };
            };
        };
    };
    getStorageAlerts: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Planets and their mute state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorageAlerts"];
                };
            };
        };
    };
    setStorageAlerts: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Planet coordinates `g:s:p`; only the caller's synced planets are kept, others are left out */
                    muted: string[];
                };
            };
        };
        responses: {
            /** @description Planets and their mute state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorageAlerts"];
                };
            };
            /** @description Invalid list (`storage_alerts_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putBuildingAlert: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    g: number;
                    s: number;
                    p: number;
                    /** @enum {string} */
                    type: "planet" | "moon";
                    /** @description Building or research id */
                    id: number;
                    level: number;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        alerts?: components["schemas"]["BuildingAlert"][];
                    };
                };
            };
            /** @description Invalid body or no such building on that planet type (`alert_invalid`, `building_unknown`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not one of the caller's synced planets (`planet_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    putHiddenBuildings: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Building and research ids */
                    ids: number[];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        hidden?: number[];
                    };
                };
            };
            /** @description Not a list of building or research ids (`hidden_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteBuildingAlert: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        alerts?: components["schemas"]["BuildingAlert"][];
                    };
                };
            };
            /** @description Not an alert of the caller (`alert_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getBuildOrder: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        buildOrder?: components["schemas"]["StoredBuildOrder"];
                    };
                };
            };
        };
    };
    putBuildOrder: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    order: components["schemas"]["BuildOrder"];
                    /** @description Kept as sent (at most 64 KiB) */
                    meta?: Record<string, never>;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        buildOrder?: components["schemas"]["StoredBuildOrder"];
                    };
                };
            };
            /** @description Not a valid build order: unknown elements, duplicate step ids, bad planet keys, too many steps (`build_order_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteBuildOrder: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        buildOrder?: components["schemas"]["StoredBuildOrder"];
                    };
                };
            };
        };
    };
    patchBuildOrder: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Hub planet key -> steps in order */
                    planets: {
                        [key: string]: components["schemas"]["BuildOrderStep"][];
                    };
                    /** @description Optional new start levels, as `BuildOrder.base` (`planets`, `research`); omitted keeps the stored base */
                    base?: {
                        planets?: Record<string, never>;
                        research?: Record<string, never>;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        buildOrder?: components["schemas"]["StoredBuildOrder"];
                    };
                };
            };
            /** @description Not valid steps (`build_order_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The caller has no build order in the group (`build_order_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    assignBuildOrderPlanet: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Planned planet key, `0:0:<n>:planet`
                     * @example 0:0:1:planet
                     */
                    from: string;
                    /**
                     * @description Hub planet key `g:s:p:type`
                     * @example 1:100:8:planet
                     */
                    to: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        buildOrder?: components["schemas"]["StoredBuildOrder"];
                    };
                };
            };
            /** @description No planned planet as `from` (`build_order_invalid`), or `to` is not one of the caller's synced planets (moons and planned planets included, `build_order_target_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The caller has no build order in the group (`build_order_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `from` is not in the build order or `to` already has steps (`build_order_planet_taken`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getMarket: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rate?: components["schemas"]["MarketRate"] | null;
                        rates?: components["schemas"]["MarketRate"][];
                        /** @description Epoch seconds (game time of the page) */
                        syncedAt?: number | null;
                        syncedBy?: string | null;
                        offers?: {
                            id?: number;
                            /** @description The game's offer id (page source only) */
                            offerId?: number | null;
                            /** @description Offered resource (`m`, `k`, `d`) and amount */
                            give?: {
                                /** @enum {string} */
                                res?: "m" | "k" | "d";
                                amount?: number;
                            };
                            /** @description Asked resource and amount */
                            want?: {
                                /** @enum {string} */
                                res?: "m" | "k" | "d";
                                amount?: number;
                            };
                            /** @description Exchange rate the game showed (offered / asked value in deuterium) */
                            ratio?: number | null;
                            /** @description Offered by the own alliance or by one with an accepted main, wing, alliance or trade alliance pact (the game's `trade-ally` row) */
                            ally?: boolean;
                            endsAt?: number;
                            firstSeen?: number;
                        }[];
                        /** @description Synced trade history (accepted offers of the universe as the marketplace lists them), newest first, at most 200 */
                        trades?: {
                            /** @description Epoch seconds of the trade */
                            time?: number;
                            give?: {
                                /** @enum {string} */
                                res?: "m" | "k" | "d";
                                amount?: number;
                            };
                            want?: {
                                /** @enum {string} */
                                res?: "m" | "k" | "d";
                                amount?: number;
                            };
                        }[];
                    };
                };
            };
        };
    };
    setMarketRate: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    m: number;
                    k: number;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarketRate"];
                };
            };
            /** @description m or k missing, not above 0 or above 100 (`rate_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAlliance: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AllianceMember"][];
                };
            };
        };
    };
    getGalaxyViews: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GalaxyView"][];
                };
            };
        };
    };
    browseGalaxy: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                g: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        planets?: {
                            [key: string]: number;
                        };
                        points?: {
                            [key: string]: number;
                        };
                        seen?: {
                            [key: string]: number;
                        };
                        own?: number[];
                    };
                };
            };
        };
    };
    browseSystem: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                g: number;
                s: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GalaxySystem"];
                };
            };
        };
    };
    simulateBattle: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "attackers": [
                 *         {
                 *           "units": {
                 *             "203": 50,
                 *             "207": 200
                 *           },
                 *           "research": {
                 *             "109": 12,
                 *             "110": 12,
                 *             "111": 12,
                 *             "118": 8
                 *           },
                 *           "from": "1:100:5"
                 *         }
                 *       ],
                 *       "target": "1:110:8",
                 *       "runs": 20
                 *     }
                 */
                "application/json": components["schemas"]["BattleRequest"];
            };
        };
        responses: {
            /** @description Summary of the runs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BattleSimulation"];
                };
            };
            /** @description Invalid request (`battle_invalid`, the message names the field) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description No spy report of `target` in the group (`spy_report_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Battle above the limits (`battle_too_large`) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description More than 20 simulations per minute (`battle_rate_limit`) or the simulator is busy (`battle_busy`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The simulation took longer than 20 seconds (`battle_timeout`) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSpyAtCoords: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                type?: "planet" | "moon";
                limit?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                g: number;
                s: number;
                p: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        reports?: Record<string, never>[];
                        total?: number;
                    };
                };
            };
        };
    };
    listSpyReports: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                limit?: number;
                /**
                 * @description Keyset paging: `<report_time>:<id>` of the last report of the previous page; only older reports follow.
                 *     Stable while new reports come in. Takes precedence over `offset`.
                 */
                before?: string;
                /** @description Rows to skip (ignored with `before`) */
                offset?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpyReportRow"][];
                };
            };
        };
    };
    getActivity: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                from?: number;
                to?: number;
                /** @description Comma-separated kinds: `phalanx_new`, `phalanx_up`, `planet_new`, `planet_destroyed`, `moon_new`, `moon_destroyed`, `debris_new`, `debris_grown`, `debris_shrunk`, `debris_cleared`, `points_loss`, `fleet_loss`, `no_growth`, `market_offer` (a new offer of a synced marketplace; `data` has `give`, `want`, `ratio`, `endsAt`, `ally`) */
                kinds?: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Entries per kind in the period */
                        counts?: Record<string, never>;
                        /** @description Newest 1000 entries with the player (`player_id`, `player_name`, `status`, alliance) and the player's newest synced total `points` (null if unknown) */
                        entries?: Record<string, never>[];
                    };
                };
            };
        };
    };
    getHostileSpy: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                from?: number;
                to?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        from?: number;
                        to?: number;
                        /** @description Newest hostile espionage events (up to 1000) */
                        list?: {
                            from_player?: string;
                            /** @description Hub player id of the spy when known */
                            from_player_id?: number | null;
                        }[];
                        /** @description Aggregated by spy name */
                        bySpy?: {
                            from_player?: string;
                            from_player_id?: number | null;
                            count?: number;
                            victims?: number;
                            last?: number | null;
                        }[];
                    };
                };
            };
        };
    };
    getHostileAttacks: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HostileAttack"][];
                };
            };
        };
    };
    hideHostileAttack: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description `key` of the attack from GET /hostile-attacks */
                    key: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description No such hostile attack listed (`attack_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    unhideHostileAttack: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
        };
    };
    getOwnAttacks: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnAttack"][];
                };
            };
        };
    };
    getBattleHall: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                page?: number;
                sort?: string;
                /** @description Participant filter (substring). Matches names in the hall entry and, via player aliases, any current or former name of players whose name or alias matches. */
                q?: string;
                /** @description Farewell battles: omitted leaves them out, `all` includes them, `only` returns only them. */
                memorial?: "all" | "only";
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BattleHall"];
                };
            };
        };
    };
    getCombatReport: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CombatReport"];
                };
            };
        };
    };
    getRaids: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                from?: number;
                to?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Raids"];
                };
            };
        };
    };
    getExpeditions: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                from?: number;
                to?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Expeditions"];
                };
            };
        };
    };
    getDeck: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                user?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Deck"];
                };
            };
        };
    };
    putDeck: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    getPlans: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Plan"][];
                };
            };
        };
    };
    createPlan: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    syncPlans: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
        };
    };
    planOwnAttack: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                };
            };
        };
        responses: {
            /** @description Plan created; `claimedBy` names the member holding the target claim instead, if any */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        claimedBy?: string | null;
                    };
                };
            };
            /** @description Attack arrived, already planned, not pasted or not the caller's (`attack_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updatePlanFromSim: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Text of the simulation result */
                    text: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description The simulation had a defender (taken over as the target) */
                        defender?: boolean;
                        /** @description Attacker fleets in the simulation */
                        attackers?: number;
                        /** @description Attacker fleets recognised as a plan fleet or guest */
                        identified?: number;
                        /** @description Recognised fleets the simulation changed */
                        updated?: number;
                    };
                };
            };
            /** @description No battle simulation in the text (`plan_sim_invalid`) or a hold plan (`plan_sim_hold`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not the creator, an admin or a participant (`plan_not_yours`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removePlanSim: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
        };
    };
    listSettlements: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        /** @enum {string} */
                        mission?: "attack" | "hold";
                        g?: number;
                        s?: number;
                        p?: number;
                        /** @enum {string} */
                        planet_type?: "planet" | "moon";
                        target_time?: number;
                        status?: string;
                        creator?: string;
                        player_id?: number | null;
                        player_name?: string | null;
                        members?: string[];
                        battle?: boolean;
                        saved?: null | {
                            updated_at?: number;
                            updated_by?: string | null;
                            finalized_at?: number | null;
                            /** @description Deliveries of the finalized settlement (0 while open) */
                            deliveries?: number;
                            done?: number;
                        };
                        /** @enum {string} */
                        stage?: "open" | "waiting" | "ready" | "delivering" | "settled";
                        /** @description Items the hub data still lacks (checked open settlements only) */
                        missing?: number | null;
                        deadline?: number | null;
                        mine?: {
                            from?: string;
                            to?: string;
                            /** @description The caller sends (else receives) */
                            sends?: boolean;
                            res?: {
                                m?: number;
                                k?: number;
                                d?: number;
                            };
                        }[];
                    }[];
                };
            };
        };
    };
    settlementFromReport: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Text of the battle report */
                    text: string;
                    /**
                     * @description Omit to detect it from the members in the report
                     * @enum {string}
                     */
                    mission?: "attack" | "hold";
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        existing?: boolean;
                        /** @enum {string} */
                        mission?: "attack" | "hold";
                    };
                };
            };
            /** @description No battle report (`report_invalid`), a battle simulation (`report_simulation`: every fleet only numbered), no coordinates in it (`report_no_target`) or no member on the chosen side (`report_no_member`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSettlement: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settlement"];
                };
            };
            /** @description No attack plan with this id in the group (`plan_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    saveSettlement: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    state: components["schemas"]["LootState"];
                };
            };
        };
        responses: {
            /** @description The settlement as GET returns it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settlement"];
                };
            };
            /** @description No or too large state (`settlement_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not a participant, the creator or an admin (`settlement_not_yours`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The settlement is finalized (`settlement_finalized`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteSettlement: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
            /** @description Not a participant, the creator or an admin (`settlement_not_yours`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    finalizeSettlement: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    state?: components["schemas"]["LootState"];
                };
            };
        };
        responses: {
            /** @description The settlement as GET returns it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settlement"];
                };
            };
            /** @description Not a participant, the creator or an admin (`settlement_not_yours`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Finalized already (`settlement_finalized`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    reopenSettlement: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The settlement as GET returns it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Settlement"];
                };
            };
            /** @description No stored settlement (`settlement_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    markSettlementDelivery: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description "<from id>><to id>", e.g. "u3>u7" */
                    key: string;
                    done?: boolean;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        done?: string[];
                    };
                };
            };
            /** @description No finalized settlement (`settlement_not_found`) or plan (`plan_not_found`) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getClaims: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Claim"][];
                };
            };
        };
    };
    createClaim: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    getComments: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                player?: number;
                /** @description Thread of the loot settlement of a raid plan (instead of `player` or `c`). */
                plan?: number;
                c?: string;
                type?: string;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Comment"][];
                };
            };
        };
    };
    createComment: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    getCommentCounts: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommentCounts"];
                };
            };
        };
    };
    getMessages: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                limit?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Messages"];
                };
            };
        };
    };
    getMoonChances: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
                days?: number;
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        battles?: {
                            reportId?: string;
                            time?: number;
                            g?: number | null;
                            s?: number | null;
                            p?: number | null;
                            chance?: number;
                            extra?: number;
                            created?: boolean;
                            attackers?: string[];
                            defenders?: string[];
                            /** @enum {string|null} */
                            memberSide?: "attacker" | "defender" | null;
                            moon?: {
                                diameter?: number | null;
                            } | null;
                        }[];
                        members?: {
                            name?: string;
                            battles?: number;
                            expected?: number;
                            created?: number;
                        }[];
                        newMoons?: {
                            time?: number;
                            g?: number;
                            s?: number;
                            p?: number;
                            player?: string;
                            diameter?: number | null;
                        }[];
                        days?: number;
                    };
                };
            };
        };
    };
    getNotifications: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable while the event lasts */
                        id: string;
                        /** @enum {string} */
                        kind: "attack" | "invite" | "comment" | "launch" | "building" | "fleet" | "storage" | "settlement" | "buildorder" | "phalanx";
                        /** @description attack: the attacked member; invite: who invited; comment: the newest author; launch, building, fleet, storage, buildorder and phalanx: the caller; settlement: who finalized it */
                        userId: number;
                        member: string;
                        /** @description Unix seconds (arrival */
                        time: number;
                        /** @description building and fleet: id of the building or fleet alert */
                        alert?: number;
                        /** @description fleet only: minutes before the arrival the alert reminds */
                        lead?: number;
                        /** @description building: the planet or moon; storage: the planet (no type, moons have no production) */
                        planet?: {
                            g?: number;
                            s?: number;
                            p?: number;
                            /** @enum {string} */
                            type?: "planet" | "moon";
                            name?: string;
                        };
                        /** @description building only: building id */
                        element?: number;
                        /** @description building: the affordable level; phalanx: the sensor phalanx level */
                        level?: number;
                        /** @description phalanx only: the moon with the phalanx (`g`, `s`, `p`) */
                        moon?: Record<string, never>;
                        /** @description phalanx only: range in systems */
                        range?: number;
                        /** @description phalanx only: game time of the oldest spy report of the newest run that shows the phalanx reaching the planets */
                        since?: number;
                        player?: components["schemas"]["PhalanxOwner"];
                        /** @description phalanx only: the caller's planets in reach */
                        planets?: components["schemas"]["MemberPlanet"][];
                        /**
                         * @description storage only: the full storage's resource (metal, crystal, deuterium)
                         * @enum {integer}
                         */
                        resource?: 901 | 902 | 903;
                        /** @description attack: the fleet (for an ACS the lead fleet with all ships); fleet: the own fleet of the alert */
                        fleet?: Record<string, never>;
                        /** @description attack only: number of fleets of an ACS */
                        fleets?: number;
                        /** @description invite, launch and settlement (launch: `time_precision` is always exact and missing; `target_time` instead; settlement: target and mission only) */
                        plan?: {
                            id?: number;
                            g?: number | null;
                            s?: number | null;
                            p?: number | null;
                            /** @enum {string} */
                            planet_type?: "planet" | "moon";
                            /** @enum {string} */
                            mission?: "attack" | "hold";
                            /** @enum {string} */
                            time_precision?: "day" | "hour" | "exact";
                            target_time?: number;
                        };
                        /** @description settlement only: the caller's open deliveries to send (by name) */
                        sends?: {
                            to?: string;
                            res?: Record<string, never>;
                        }[];
                        /** @description settlement only: the caller's open deliveries to get (by name) */
                        gets?: {
                            from?: string;
                            res?: Record<string, never>;
                        }[];
                        /** @description comment only: a player, the loot settlement of a raid plan (with the plan target), or a planet/moon with its owner */
                        thread?: {
                            player: number;
                            name: string;
                        } | {
                            plan: number;
                            g: number;
                            s: number;
                            p: number;
                            /** @enum {string} */
                            type: "planet" | "moon";
                        } | {
                            g: number;
                            s: number;
                            p: number;
                            /** @enum {string} */
                            type: "planet" | "moon";
                            owner?: string | null;
                        };
                        /** @description comment only: the newest comment, shortened */
                        excerpt?: string;
                        /** @description comment only: one of the comments mentions the caller (`@name`) */
                        mention?: boolean;
                        /** @description comment only: new comments in the thread */
                        count?: number;
                        /** @description launch only: start planet or moon of the fleet */
                        from?: {
                            g?: number;
                            s?: number;
                            p?: number;
                            /** @enum {string} */
                            type?: "planet" | "moon";
                        };
                    }[];
                };
            };
        };
    };
    getPresence: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Online members */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        userId: number;
                        /** @description Page below the universe, e.g. `browse`; null until reported or when the member does not share their activity */
                        page: string | null;
                        g?: number;
                        s?: number;
                        /** @description Player shown in the player page or dialog */
                        player?: number;
                        /** @description false while the tab is in the background or its user idle */
                        active: boolean;
                    }[];
                };
            };
        };
    };
    reportPresence: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Id of the tab */
                    tab?: string;
                    page?: string;
                    g?: number;
                    s?: number;
                    player?: number;
                    /**
                     * @description false while the tab is in the background or its user idle
                     * @default true
                     */
                    active?: boolean;
                    /**
                     * @description The tab's window has the focus
                     * @default false
                     */
                    focused?: boolean;
                    /** @description The tab goes away; other fields are ignored */
                    closed?: boolean;
                };
            };
        };
        responses: {
            /** @description Stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok?: boolean;
                    };
                };
            };
        };
    };
    subscribeEvents: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: never;
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description text/event-stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Wrong username or password (`login_failed`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too many failed or pending attempts (`too_many_attempts`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    setLang: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    changeUsername: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Wrong password or invalid username (`password_wrong`, `username_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Username taken (`username_taken`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too many wrong passwords for this account (`too_many_attempts`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDisplayName: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        displayName: string | null;
                    };
                };
            };
        };
    };
    setDisplayName: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    displayName?: string | null;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        displayName: string | null;
                    };
                };
            };
            /** @description Invalid display name (`display_name_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Old password wrong or new one invalid (`old_password_wrong`, `password_too_short`, `password_too_long`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too many wrong passwords for this account (`too_many_attempts`) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFleetShare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FleetShare"];
                };
            };
        };
    };
    setFleetShare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FleetShare"];
                };
            };
        };
    };
    getMessageShare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    setMessageShare: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    getShowOnline: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    setShowOnline: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    getShareActivity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    setShareActivity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enabled"];
                };
            };
        };
    };
    getInvite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    acceptInvite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    createUniverse: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Changed settings; `null` resets an optional one. `setting_invalid` names the first invalid key, `setting_unknown` the first key that is no setting. */
                    settings?: components["schemas"]["UniverseSettings"];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updateUniverse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Changed settings; `null` resets an optional one. `setting_invalid` names the first invalid key, `setting_unknown` the first key that is no setting. */
                    settings?: components["schemas"]["UniverseSettings"];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    renameUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    listGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>[];
                };
            };
        };
    };
    createGroup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Created"];
                };
            };
        };
    };
    updateGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updateGroupMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    role?: "member" | "admin";
                    ingameName?: string | null;
                    /** @description Hub display name of the account (all universes) */
                    displayName?: string | null;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid display name (`display_name_invalid`) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeGroupMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    createMemberInvite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        token?: string;
                    };
                };
            };
            /** @description Not an admin of the alliance, a member with an account and no global admin, or a placeholder also in an alliance the caller is not admin of (`group_admin_only`) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    mergePlayers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    listParserSamples: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        group_id?: number;
                        group_name?: string;
                        universe?: string;
                        username?: string | null;
                        code?: string;
                        page?: string | null;
                        note?: string | null;
                        created_at?: number;
                        /** @description Compressed size */
                        html_size?: number | null;
                        /** @description Compressed size */
                        text_size?: number | null;
                    }[];
                };
            };
        };
    };
    downloadParserSample: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                    "text/plain": string;
                };
            };
        };
    };
    deleteParserSample: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    listGroupIngests: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>[];
                };
            };
        };
    };
    backfillGroupActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Activity entries added */
                        added: number;
                    };
                };
            };
        };
    };
    getCrawler: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CrawlerStatus"];
                };
            };
        };
    };
    retryCrawler: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Reports given new tries */
                        reset: number;
                    };
                };
            };
        };
    };
    reparseIngest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IngestSummary"];
                };
            };
        };
    };
    deleteIngest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    ingestPage: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IngestSummary"];
                };
            };
        };
    };
    sendParserSample: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id?: number;
                        explain?: components["schemas"]["Explanation"];
                    };
                };
            };
        };
    };
    downloadUniverseJson: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown[];
                };
            };
        };
    };
    uploadUniverseJson: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    ingestPhalanx: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    planRetime: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    planHold: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updatePlan: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    deletePlan: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    clearPlanPhalanx: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updatePlanEnemy: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    addPlanFleet: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updatePlanFleet: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
                /** @description Plan fleet id */
                fleet: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    deletePlanFleet: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                /** @description Attack plan id */
                id: components["parameters"]["PlanId"];
                /** @description Plan fleet id */
                fleet: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updateClaim: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    deleteClaim: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    updateComment: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    deleteComment: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    addDeckEvent: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Created"];
                };
            };
        };
    };
    deleteDeckEvent: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    putPlayerNote: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    shareMessage: {
        parameters: {
            query?: {
                /** @description Alliance group id (alternative to `X-Hub-Group`, required for SSE) */
                group?: components["parameters"]["HubGroupQuery"];
            };
            header?: {
                /** @description Alliance group id (see `GET /api/auth/me`) */
                "X-Hub-Group"?: components["parameters"]["HubGroupHeader"];
            };
            path: {
                /** @description Universe slug (e.g. `u8`) */
                uni: components["parameters"]["Uni"];
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
}
type WithRequired<T, K extends keyof T> = T & {
    [P in K]-?: T[P];
};

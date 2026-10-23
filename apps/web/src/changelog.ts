/**
 * Changelog for users ("What's new" under Account): new features and fixes in plain words, newest day first.
 * Written together with CHANGELOG.md; developer-only changes (refactors, tests, docs, CI) are left out.
 */
export interface ChangelogItem {
  kind: 'new' | 'fix';
  de: string;
  en: string;
}

export interface ChangelogDay {
  /** YYYY-MM-DD */
  date: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogDay[] = [
  {
    date: '2026-10-23',
    items: [
      {
        kind: 'new',
        de: 'Admin: Die Liste der Synchronisationen zeigt wieder, was jeweils synchronisiert wurde, etwa die Top-Spieler einer Statistik oder die Planeten eines Imperiums.',
        en: 'Admin: the list of syncs shows again what each one contained, e.g. the top players of a statistics page or the planets of an empire page.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Schiffe für die eigene Flotte kommen vom Startplanet oder aus allen eigenen Schiffen (auch solche, die du erst noch dorthin verlegst) und werden gleich mit der Höchstzahl eingetragen; die Zahl lässt sich ändern.',
        en: 'Raid planner: ships for your fleet come from the start planet or from all your ships (also those you still have to move there) and are added with the maximum right away; the amount can be changed.',
      },
      {
        kind: 'fix',
        de: 'Auch Spionageberichte, Spionage-Warnungen, Nachrichten, Flottenbewegungen, Übersicht, Ruhmeshalle und Kampfberichte aus einem anderen Universum werden erkannt und abgelehnt. Admins sehen jede Synchronisation in einer Liste und können sie nach einer Vorschau neu einlesen oder samt ihrer Daten löschen.',
        en: 'Spy reports, espionage warnings, messages, fleet movements, overview, battle hall and combat reports from another universe are recognised and rejected too. Admins see every sync in one list and can read it again or delete it with its data after a preview.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Ein Plan kann mit einem Spieler und einem ungefähren Termin beginnen (nur Tag oder ca. Uhrzeit); Koordinaten (aus den bekannten Planeten des Spielers) und die genaue Einschlagszeit trägst du nach, sobald sie feststehen. Beim Hinzufügen der eigenen Flotte zeigt die Auswahl nur Schiffe, die auf dem Startplanet stehen, und „max“ übernimmt alle eines Typs.',
        en: 'Raid planner: a plan can start with a player and a rough date (just the day or around a time); add the coordinates (from the player\'s known planets) and the exact impact once they are known. When adding your fleet, the list only shows ships on the start planet, and "max" takes all of a type.',
      },
      {
        kind: 'fix',
        de: 'Auch Imperium-Seiten aus einem anderen Universum werden jetzt erkannt und abgelehnt. Admins können falsch synchronisierte Imperium-Seiten wieder entfernen.',
        en: 'Empire pages from another universe are now recognised and rejected too. Admins can remove wrongly synced empire pages again.',
      },
      {
        kind: 'new',
        de: 'Admin: Statistik-Stände, die im falschen Universum gelandet sind, lassen sich nach einer Vorschau samt der dadurch angelegten Spieler wieder entfernen.',
        en: 'Admin: statistics that ended up in the wrong universe can be removed again after a preview, together with the players they brought in.',
      },
      {
        kind: 'fix',
        de: 'Seiten aus einem anderen Universum werden beim Synchronisieren abgelehnt, statt im falschen Universum zu landen – auch als reiner Text: Der Hub vergleicht Statistik und Galaxie mit den bekannten Spielern und Planeten. Beim Wechsel des Universums kann nichts mehr im vorherigen gespeichert werden.',
        en: 'Pages from another universe are rejected when syncing instead of ending up in the wrong universe, plain text included: the hub compares statistics and galaxy views with the known players and planets. Switching universes can no longer save anything into the previous one.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Eigene Angriffe solo oder als Verband planen, die auf die Sekunde landen. Jedes Mitglied trägt seine Flotte ein (Startplanet und Schiffe aus der eigenen Imperium-Seite), der Hub zeigt Startzeiten mit Countdown, den Anführer, Verzögerungen und die Verbandsgrenzen; alle sehen Änderungen sofort. Im Aktionen-Menü eines Ziels: „Angriff planen“. „Raids“ heißt jetzt „Raid-Statistiken“.',
        en: 'Raid planner: plan own attacks, solo or as ACS, that land at the second. Every member adds their fleet (start planet and ships from their empire page); the hub shows launch times with countdown, the lead, delays and the ACS limits, and everyone sees changes at once. In the action menu of a target: "Plan attack". "Raids" is now called "Raid statistics".',
      },
      {
        kind: 'new',
        de: 'Neuigkeiten: Diese Seite unter Konto zeigt, was es Neues im Hub gibt und was behoben wurde.',
        en: "What's new: this page under Account shows the hub's new features and fixes.",
      },
      {
        kind: 'new',
        de: 'Ingame-Nachrichten: Spielernachrichten lassen sich wie Berichte synchronisieren und stehen auf der neuen Seite „Ingame-Nachrichten“. Ob die Allianz deine Nachrichten sieht, stellst du im Konto ein (standardmäßig aus); einzelne Nachrichten kannst du gezielt teilen oder zurückhalten.',
        en: 'In-game messages: player messages can be synced like reports and are listed on the new page "In-game messages". Whether the alliance sees your messages is set in your account (off by default); single messages can be shared or kept private.',
      },
      {
        kind: 'new',
        de: 'Ingame-Nachrichten als Unterhaltungen: alle Nachrichten mit einem Spieler in einer Chat-Ansicht, auch nach Umbenennungen. Spieler der eigenen Allianz blau, andere orange; ein Profil-Symbol öffnet den Spieler, und in den Spielerdetails führt ein Link zu den Nachrichten mit ihm.',
        en: 'In-game messages as conversations: all messages with a player in one chat view, also across renames. Players of your own alliance in blue, others in orange; a profile icon opens the player, and the player details link to the messages with them.',
      },
      {
        kind: 'new',
        de: 'Benachrichtigungen: Die Glocke neben dem Hub-Namen meldet feindliche Flotten, die auf ein Mitglied zufliegen, mit Ankunft und Countdown. Solange Angriffe laufen, wird sie rot und der Menüpunkt „Flotten“ zeigt „⚔ n“.',
        en: 'Notifications: the bell next to the hub name reports hostile fleets heading for a member, with arrival and countdown. While attacks are on their way it turns red and the "Fleet" menu entry shows "⚔ n".',
      },
      {
        kind: 'new',
        de: 'Flottenbewegungen: Die Ereignisse der Spielübersicht lassen sich synchronisieren. „Mein Imperium“ zeigt deine Flotten im Flug, die Allianz-Flottenseite die aller Mitglieder (eigener Tab, als Tabelle, filterbar nach Mitglied).',
        en: 'Fleet movements: the events of the game overview can be synced. "My empire" shows your fleets in flight, the alliance fleet page those of all members (own tab, as a table, filterable by member).',
      },
      {
        kind: 'new',
        de: 'Flotten-Freigabe im Konto: Du entscheidest, ob und welche deiner Flottenbewegungen (Angriff, Transport, Expedition …) die anderen sehen.',
        en: 'Fleet sharing in your account: you decide whether and which of your fleet movements (attack, transport, expedition …) the others see.',
      },
      {
        kind: 'new',
        de: 'Allianzseiten (Planeten, Flotten, Forschung) zeigen auch Mitglieder ohne Imperium-Sync und Spieler der Ingame-Allianz, ergänzt aus den Spionageberichten.',
        en: "Alliance pages (planets, fleet, research) also show members who don't sync their empire and players of the in-game alliance, filled in from spy reports.",
      },
      {
        kind: 'new',
        de: 'Kontoeinstellungen übersichtlicher: Karten über die ganze Breite, Erklärungen als Info-Symbol.',
        en: 'Clearer account settings: cards over the full width, explanations as info icons.',
      },
      {
        kind: 'fix',
        de: 'Feindliche Angriffe und Verbandsangriffe auf Mitglieder wurden teils als fremde Flotte erkannt, und weitere Flotten eines Verbands fehlten.',
        en: 'Hostile attacks and ACS attacks on members were partly taken for foreign fleets, and further fleets of an ACS were missing.',
      },
      {
        kind: 'fix',
        de: 'Kein Alarm mehr bei „Angriffen“ von Spielern der eigenen Allianz (z. B. Mondversuche oder Saven).',
        en: 'No more alarm for "attacks" by players of your own alliance (e.g. moon attempts or saving).',
      },
      {
        kind: 'fix',
        de: 'Fremde Flotten auf ein Mitglied sind immer sichtbar, auch wenn es seine eigenen Flotten nicht teilt.',
        en: "Foreign fleets heading for a member are always visible, also when the member doesn't share their own fleets.",
      },
      {
        kind: 'fix',
        de: 'Übersicht: Ein Statistik-Update außerhalb der 6-Stunden-Zeiten ging in den Δ-Spalten verloren.',
        en: 'Overview: a statistics update off the 6-hour times was lost in the Δ columns.',
      },
      {
        kind: 'fix',
        de: 'In Spielernachrichten zitierte Berichte zählen nicht mehr als echte Berichte.',
        en: 'Reports quoted in player messages no longer count as real reports.',
      },
      {
        kind: 'fix',
        de: 'Die Benachrichtigungsliste wurde von den ⓘ-Symbolen der Seite überdeckt.',
        en: "The notification list was covered by the page's ⓘ icons.",
      },
    ],
  },
  {
    date: '2026-10-22',
    items: [
      {
        kind: 'new',
        de: 'Live-Updates: Was ein Mitglied synchronisiert, erscheint ohne F5 in allen offenen Hub-Tabs der Allianz, mit einem Hinweis, wer was synchronisiert hat (im Konto abschaltbar).',
        en: 'Live updates: what a member syncs appears in all open hub tabs of the alliance without F5, with a hint who synced what (can be turned off in your account).',
      },
      {
        kind: 'new',
        de: 'Anwesenheit: Die Seitenleiste zeigt, wer aus der Allianz gerade im Hub ist und welche Seite, welches System oder welchen Spieler er ansieht.',
        en: 'Presence: the sidebar shows who of the alliance is in the hub right now and which page, system or player they are looking at.',
      },
      {
        kind: 'new',
        de: 'Ziele reservieren: Planeten und Monde lassen sich für 30 Minuten bis 24 Stunden zum Farmen, Angreifen oder Spionieren reservieren, damit niemand doppelt fliegt. Neue Seite „Ziele“ mit allen Reservierungen.',
        en: 'Target claims: planets and moons can be claimed for 30 minutes up to 24 hours for farming, attacking or spying, so nobody flies twice. New page "Targets" with all claims.',
      },
      {
        kind: 'new',
        de: 'Kommentare: Die Allianz kann über Spieler, Planeten und Monde diskutieren; neue Kommentare erscheinen live.',
        en: 'Comments: the alliance can discuss players, planets and moons; new comments appear live.',
      },
      {
        kind: 'new',
        de: 'Mein Imperium: Live-Punkte inklusive Flotten im Flug und der Aufholbonus (aus der Spielübersicht und live berechnet).',
        en: 'My empire: live points including fleets in flight and the catch-up bonus (from the game overview and calculated live).',
      },
      {
        kind: 'new',
        de: 'Handy-Ansicht: Tab-Leiste unten, Menü als Ausklapp-Leiste, Schnell-Sync aus der Zwischenablage, Galaxie zum Wischen und Karten statt breiter Tabellen auf allen Seiten.',
        en: 'Phone layout: tab bar at the bottom, menu as a drawer, quick sync from the clipboard, swipeable galaxy and cards instead of wide tables on all pages.',
      },
      {
        kind: 'new',
        de: 'Sync: Galaxieansicht und Spielübersicht gehen auch als kopierter Text (ohne HTML, z. B. am Handy); die Vorschau erscheint automatisch, der Schnell-Sync hat einen Serienmodus für die nächste Seite.',
        en: 'Sync: galaxy view and game overview also work as copied text (no HTML needed, e.g. on a phone); the preview appears by itself, quick sync has a series mode for the next page.',
      },
      {
        kind: 'new',
        de: 'Übersicht: Alle bekannten Spieler werden immer gelistet, die Δ-Spalten folgen dem 6-Stunden-Raster der Statistik wie im FF-Hub, und große Listen laden deutlich schneller.',
        en: 'Overview: all known players are always listed, the Δ columns follow the 6-hour statistics grid like in the FF-Hub, and large lists load much faster.',
      },
      {
        kind: 'new',
        de: 'Hub auf Deutsch und Englisch, die Sprache stellst du im Konto ein.',
        en: 'Hub in German and English, the language is set in your account.',
      },
      {
        kind: 'new',
        de: 'Admin- und Benutzereinstellungen öffnen innerhalb des Universums, das Menü bleibt sichtbar.',
        en: 'Admin and user settings open inside the universe, the menu stays visible.',
      },
      {
        kind: 'new',
        de: 'Flugrechner mit dem Schweren Kreuzer.',
        en: 'Flight calculator with the Schwerer Kreuzer.',
      },
      {
        kind: 'fix',
        de: 'Neuere Schiffe (Schwerer Kreuzer, Sturmtransporter, Optimierter Recycler, Behemoth, Void Titan) zählten 0 Punkte; der Schwere Jäger hat die Kosten aus dem Spiel.',
        en: 'Newer ships (Schwerer Kreuzer, Sturmtransporter, Optimierter Recycler, Behemoth, Void Titan) counted 0 points; the Schwerer Jäger has the costs from the game.',
      },
      {
        kind: 'fix',
        de: 'Live-Punkte im Imperium: Schiffe fehlten nach einem Statistik-Sync oder wenn die Flotte unterwegs war, und der Aufholbonus wurde in manchen Universen nur halb so groß angezeigt.',
        en: 'Live points in the empire: ships were missing after a statistics sync or when the fleet was in flight, and the catch-up bonus showed only half its size in some universes.',
      },
      {
        kind: 'fix',
        de: 'Doppelt synchronisierte Berichte (einmal HTML, einmal Text) zählen nur noch einmal, z. B. im Expo-Deck und bei den Raids.',
        en: 'Reports synced twice (once as HTML, once as text) count only once, e.g. in the expedition deck and the raids.',
      },
      {
        kind: 'fix',
        de: 'Ein später synchronisierter älterer Spionagebericht ändert Besitzer und Name eines Planeten nicht mehr.',
        en: "An older spy report synced later no longer changes a planet's owner and name.",
      },
      {
        kind: 'fix',
        de: 'Spieler, die nur als „Spieler #123“ bekannt waren, bekommen mit dem nächsten Sync ihren echten Namen.',
        en: 'Players only known as "Player #123" get their real name with the next sync.',
      },
      {
        kind: 'fix',
        de: 'Beim schnellen Blättern (Galaxie, Imperium, Spieler …) überschrieb keine ältere Antwort mehr die aktuelle Anzeige; Ladefehler werden angezeigt.',
        en: 'When paging quickly (galaxy, empire, players …) an older answer no longer overwrites the current view; loading errors are shown.',
      },
      {
        kind: 'fix',
        de: 'Übersicht: Geleerte Punkte-Filter blendeten weiterhin Spieler aus.',
        en: 'Overview: cleared points filters kept hiding players.',
      },
      {
        kind: 'fix',
        de: 'Battle Hall: Kämpfe, in denen der Angreifer in der ersten Runde abgeschossen wurde, halten das Archiv nicht mehr an; ein nicht erreichbares Universum bremst die anderen nicht mehr.',
        en: 'Battle hall: fights where the attacker was shot down in the first round no longer stop the archive; an unreachable universe no longer holds up the others.',
      },
      {
        kind: 'fix',
        de: 'Spionageberichte werden auch bei abweichender Groß-/Kleinschreibung des Namens gefunden.',
        en: 'Spy reports are also found when the name differs in upper/lower case.',
      },
      {
        kind: 'fix',
        de: 'Raids und Expeditionen werden pro Mitglied gezählt, nicht pro Anzeigename.',
        en: 'Raids and expeditions are counted per member, not per display name.',
      },
      {
        kind: 'fix',
        de: 'Eine gespeicherte Allianz, in der man nicht mehr ist, sperrt das Universum nicht mehr; der letzte Admin einer Allianz kann nicht entfernt werden.',
        en: 'A stored alliance you are no longer a member of no longer locks the universe; the last admin of an alliance cannot be removed.',
      },
    ],
  },
  {
    date: '2026-10-21',
    items: [
      {
        kind: 'new',
        de: 'Start des pr0game Hub: Statistiken, Nachrichten, Galaxie, Imperium, Spielübersicht und Battle Hall synchronisieren; Übersicht, Mein Imperium, Galaxie, Aktivität, Allianz, Spionageberichte, Raids, Expeditionen, Expo-Deck und Battle Hall.',
        en: 'Launch of the pr0game Hub: sync statistics, messages, galaxy, empire, game overview and battle hall; overview, my empire, galaxy, activity, alliance, spy reports, raids, expeditions, expedition deck and battle hall.',
      },
      {
        kind: 'new',
        de: 'Neues Menü mit Symbolen, „Einfügen“ heißt jetzt „Synchronisieren“; Statistik-Seite, universe.json-Download und Benutzername ändern.',
        en: 'New menu with icons, "Paste" is now "Sync"; statistics page, universe.json download and changing your username.',
      },
    ],
  },
];

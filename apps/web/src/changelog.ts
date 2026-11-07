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
    date: '2026-11-07',
    items: [
      {
        kind: 'new',
        de: 'Spionage-Priorität, TF-Finder und Kolonisieren haben jetzt eine eigene Tour, die beim ersten Öffnen des Tabs startet (oder über das „?“).',
        en: 'Spy priority, debris finder and colonize now have their own tour, started the first time you open the tab (or from the "?").',
      },
      {
        kind: 'new',
        de: 'Neuer Kolonisierungsplaner als Tab bei Planeten (Allianz): freie Positionen aus der Galaxie, bewertet als Fleeter (gute Abdeckung des Universums, viele Punkte von Zielen in der Nähe) oder Miner (Felder, Temperatur, Positionsbonus) – Positionen mit vielen Mitgliedern in der Nähe rutschen nach hinten. Er zeigt auch, ab welcher Astrophysik-Stufe eine Position besiedelbar ist.',
        en: 'New colonization planner as a tab of the planets page (alliance): free positions from the galaxy, rated as a fleeter (good coverage of the universe, many points of targets nearby) or a miner (fields, temperature, position bonus) – positions with many members nearby move down. It also shows from which astrophysics level a position can be colonized.',
      },
      {
        kind: 'new',
        de: 'Mondchancen: Der Hub merkt sich die Mondchance jedes Kampfberichts und ob ein Mond entstanden ist. In der Battle Hall siehst du je Mitglied, wie viele Monde zu erwarten waren und wie viele entstanden sind, dazu neue Monde an Planeten von Mitgliedern und den Mondzerstörungsrechner mit dem Durchmesser des Mondes.',
        en: 'Moon chances: the hub keeps the moon chance of every battle report and whether a moon was created. In the battle hall you see per member how many moons were to be expected and how many were created, new moons at members\' planets, and the moon destruction calculator with the moon\'s diameter.',
      },
      {
        kind: 'new',
        de: 'Kommentare: Mit @Name erwähnst du ein Mitglied – es bekommt eine Benachrichtigung (Glocke, Push, Discord), auch wenn es in dem Thread noch nichts geschrieben hat. Beim Tippen von @ schlägt der Hub Namen vor, Koordinaten im Text führen direkt in die Galaxie.',
        en: 'Comments: @name mentions a member – they get a notification (bell, push, Discord), even if they never wrote in that thread. Typing @ suggests names, coordinates in the text lead straight to the galaxy.',
      },
      {
        kind: 'new',
        de: 'Neue Mitglieder sehen eine Checkliste „Erste Schritte“: welche Seiten sie zuerst einfügen sollten, wo sie sie im Spiel finden und einen Haken, sobald eine Seite angekommen ist. Allianz-Admins sehen in der Mitgliederliste, wer schon fertig ist.',
        en: 'New members see a "First steps" checklist: which pages to paste first, where to find them in the game and a tick as soon as a page arrived. Alliance admins see in the member list who is done.',
      },
      {
        kind: 'new',
        de: 'Erkennt der Hub eine eingefügte Seite nicht, sagt er jetzt warum – etwa „das ist die Schiffswerft, die liest der Hub noch nicht“ oder „die Seite ist auf Französisch“. Solche Seiten kannst du den Admins anonymisiert als Probe schicken, damit sie den Hub verbessern.',
        en: 'When the hub does not recognize a pasted page, it now says why – e.g. "this is the shipyard, which the hub does not read yet" or "the page is in French". You can send such pages to the admins, anonymized, as a sample so they can improve the hub.',
      },
      {
        kind: 'new',
        de: 'Synchronisieren: mehrere gespeicherte Seiten auf einmal hochladen oder hineinziehen (auch einen ganzen Ordner), oder Seiten nacheinander einfügen und sammeln. Jede Seite bekommt ihre eigene Vorschau, gespeichert wird alles mit einem Klick.',
        en: 'Sync: upload or drop several saved pages at once (a whole folder too), or paste pages one after the other and collect them. Each page gets its own preview, one click saves them all.',
      },
      {
        kind: 'new',
        de: 'Neuer TF-Finder als Tab im Farm-Finder: alle offenen Trümmerfelder mit der Menge jetzt (auch direkt nach einem Kampf eines Mitglieds), nötigen Recyclern, deiner Flugzeit und dem nächsten Mitglied mit genug Recyclern. Trümmerfelder lassen sich zum Abbauen reservieren, unabhängig vom Planeten dort.',
        en: 'New debris finder as a tab of the farm finder: every open debris field with its amount now (also right after a member\'s battle), the recyclers needed, your flight time and the nearest member with enough recyclers. Debris fields can be claimed for recycling, apart from the planet there.',
      },
      {
        kind: 'new',
        de: 'Farm-Finder: neuer Tab „Spionage-Priorität“. Er zeigt, welche Ziele jetzt eine Sonde wert sind – weil ihr Bericht alt ist, seitdem Flotte oder Verteidigung gebaut wurde oder dort gekämpft wurde – und wie viele Sonden du für einen Bericht mit Gebäuden brauchst.',
        en: 'Farm finder: new tab "Spy priority". It shows which targets are worth a probe now – because their report is old, fleet or defense was built since or there was a battle – and how many probes you need for a report with buildings.',
      },
      {
        kind: 'new',
        de: 'Raid-Risiko: Für jeden deiner Planeten und Monde siehst du, wie viel ein Angreifer dort jetzt holen könnte – im Verteidigungsberater und in deinem Imperium. Der Verteidigungsberater rechnet außerdem jeden Angreifer auch mit nur schweren Schiffen, wie Raider es oft machen.',
        en: 'Raid risk: for each of your planets and moons you see how much an attacker could get there right now – in the defense advisor and in your empire. The defense advisor also calculates every attacker with heavy ships only, as raiders often do.',
      },
      {
        kind: 'new',
        de: 'Verteidigungsberater unter Bauen & Forschen: zeigt, wer deinen Planeten angreifen könnte (Spionage, Angriffe, Flotten im Anflug, starke Flotten in der Nähe), was ihm ein Angriff einbringt und welche Verteidigung den Angriff zum Verlustgeschäft macht. Die Einheiten kommen mit einem Klick in die Bauliste.',
        en: 'Defense advisor under Build & research: shows who could attack your planet (spying, attacks, fleets on their way, strong fleets nearby), what an attack would bring them and which defense turns it into a loss. The units go into the build order in one click.',
      },
      {
        kind: 'fix',
        de: 'Fleetsave mit Recyclern kennt jetzt das wöchentliche Löschen der Trümmerfelder (Standard Samstag 02:45, im Admin-Panel einstellbar): Abgebaute Felder zählen nur, wenn seitdem dort gekämpft wurde.',
        en: 'Fleet save with recyclers now knows the weekly cleanup of debris fields (Saturday 02:45 by default, set in the admin panel): harvested fields only count when there was a battle since.',
      },
      {
        kind: 'new',
        de: 'Die Allianz-Gesundheit sieht jetzt jedes Mitglied. Wer seinen Online-Status ausgeblendet hat, dessen letzten Besuch sehen weiterhin nur Admins.',
        en: 'Every member can now see the alliance health. The last visit of members who hide their online status stays visible to admins only.',
      },
      {
        kind: 'new',
        de: 'Export: CSV-Knopf an Übersicht, Statistik, Spionageberichten, Expeditionen und Raids, und alle Daten deiner Allianz als JSON unter Konto. Mit einem API-Token holt sich auch eine Tabellenkalkulation die Daten.',
        en: 'Export: a CSV button on overview, statistics, spy reports, expeditions and raids, and all your alliance\'s data as JSON under Account. With an API token a spreadsheet can fetch the data too.',
      },
      {
        kind: 'new',
        de: 'Allianz-Gesundheit für Allianz-Admins: je Mitglied Wachstum der Woche gegen den Median, letzter Besuch, wann welche Seite eingefügt wurde, Kämpfe, Expeditionen und offene Lieferungen. Wer zurückfällt, kein Imperium mehr einfügt oder nicht mehr vorbeischaut, ist markiert.',
        en: 'Alliance health for alliance admins: per member the growth of the week against the median, last visit, when which page was pasted, battles, expeditions and open deliveries. Members who fall behind, stop pasting their empire page or stay away are flagged.',
      },
      {
        kind: 'new',
        de: 'Upgrade-Berater unter Bauen & Forschen: Minen, Energie und Produktionsforschung sortiert danach, wie schnell sie sich amortisieren (zum Marktkurs der Allianz) – mit einem Klick in die Bauliste. Im Gebäude-Reiter steht der beste nächste Schritt.',
        en: 'Upgrade advisor under Build & research: mines, energy and production research ranked by how fast they pay back (at the alliance\'s market rate) – into the build order in one click. The buildings tab shows the best next step.',
      },
      {
        kind: 'new',
        de: 'Fleetsave mit Recyclern: Flotten mit Recycler bekommen zusätzlich „Abbauen“ zu einem Trümmerfeld und zurück – mit viel feiner abgestuften Flugzeiten.',
        en: 'Fleet save with recyclers: fleets with a recycler also get "Recycle" to a debris field and back – with much finer flight times.',
      },
      {
        kind: 'new',
        de: 'Angriffs-Assistent: Schiffe, die du nach dem letzten Imperium weggeschickt hast, zählen im Kampfergebnis nicht mehr mit. Zeigt die Flottenbewegung keine Schiffe, schätzt der Hub die Angriffsflotte aus dem letzten Spionagebericht des Angreifers.',
        en: 'Attack assistant: ships you sent away after your latest empire page no longer count in the battle result. When the fleet movement shows no ships, the hub estimates the attacking fleet from the attacker\'s latest spy report.',
      },
      {
        kind: 'new',
        de: 'Angriffs-Assistent: „Voraussichtliches Kampfergebnis“ kompakt in zwei Zeilen, und Halteflotten von Mitgliedern, die zum Einschlag auf dem Planeten stehen, kämpfen in der Simulation mit. Weniger Text, besser lesbar auf dem Handy.',
        en: 'Attack assistant: "Expected battle result" in two compact lines, and members\' hold fleets that are on the planet at the impact join the simulation. Less text, easier to read on phones.',
      },
      {
        kind: 'new',
        de: 'Angriffs-Assistent: Ein Klick auf einen Angriff in der Glocke öffnet eine Seite mit Countdown, Simulation „Hält die Verteidigung?“, den Rohstoffen in Gefahr, Fleetsave-Möglichkeiten vor dem Einschlag und den Mitgliedern, die noch rechtzeitig halten können – einladen mit einem Klick.',
        en: 'Attack assistant: a click on an attack in the bell opens a page with a countdown, a "Will it hold?" simulation, the resources at risk, fleet save options before the impact and the members who can still hold in time – invite them in one click.',
      },
      {
        kind: 'new',
        de: 'Fleetsave-Planer: Sag, wann du offline bist, und der Hub schlägt je Planet und Mond einen Flug vor, der genau zu deiner Rückkehr landet – mit Abflugzeit, Tempo und Deuterium. Vorlagen wie „Nacht“ oder „Arbeit“ mit einem Klick.',
        en: 'Fleet save planner: say when you are offline and the hub suggests a flight per planet and moon that lands right when you are back – with departure, speed and deuterium. Presets like "Night" or "Work" in one click.',
      },
      {
        kind: 'new',
        de: 'Feindliche Phalanx: Im Imperium siehst du je Planet, welche Monde anderer Allianzen ihn mit der Sensorphalanx sehen können und seit wann das bekannt ist; Planeten in Reichweite tragen ein Auge. Wird eine neue Phalanx in Reichweite bekannt, meldet sich die Glocke (auch per Push und Discord).',
        en: 'Hostile phalanx: My empire shows per planet which moons of other alliances can watch it with their sensor phalanx and since when that is known; planets in range carry an eye. When a new phalanx in range becomes known, the bell tells you (also by push and Discord).',
      },
      {
        kind: 'fix',
        de: 'Sicherheit: Beim Ändern von Passwort oder Benutzernamen sind nur noch 10 falsche Eingaben des aktuellen Passworts in 15 Minuten möglich, danach wird gesperrt.',
        en: 'Security: when changing the password or username, only 10 wrong entries of the current password are allowed within 15 minutes, then it locks.',
      },
      {
        kind: 'fix',
        de: 'Sicherheit: Die Sperre nach zu vielen falschen Passwörtern lässt sich nicht mehr umgehen, indem viele Anmeldeversuche gleichzeitig geschickt werden.',
        en: 'Security: the lock after too many wrong passwords can no longer be bypassed by sending many login attempts at once.',
      },
      {
        kind: 'new',
        de: 'Der Hub ist schneller: Seiten und Daten werden komprimiert übertragen, beim Start wird nur deine Sprache geladen, und Übersicht, Allianz und Planung laden die Imperien der Mitglieder deutlich schneller.',
        en: 'The hub is faster: pages and data are sent compressed, only your language is loaded at the start, and overview, alliance and planning load the members\' empires much faster.',
      },
      {
        kind: 'fix',
        de: 'Sicherheit: Spieler ohne Konto, die in mehreren Allianzen eingetragen sind, kann nur noch ein Admin aller dieser Allianzen per Einladungslink oder Zugangsanfrage vergeben. So kommt niemand über einen solchen Spieler an die Daten einer fremden Allianz.',
        en: 'Security: players without an account who are in several alliances can only be handed out by invite link or access request by an admin of all those alliances. Nobody gets at another alliance\'s data through such a player.',
      },
    ],
  },
  {
    date: '2026-11-06',
    items: [
      {
        kind: 'new',
        de: 'Admin-Panel: Die Prüfung des Inaktivitäts-Scores zeigt Fehlalarme nach Zeitabstand (12, 24, 72 Stunden) und Score-Höhe, bei Punktezuwächsen deren Größe und Kategorie, und zählt die letzten Tage vor dem Ende eines Universums getrennt.',
        en: 'Admin panel: the inactivity score check shows false alarms by how soon (12, 24, 72 hours) and by score, for points gains their size and category, and counts the last days before a universe ends apart.',
      },
      {
        kind: 'fix',
        de: '„Was soll ich als Nächstes einfügen?“ rechnet nicht mehr mit festen Statistik-Zeiten, sondern lernt aus den eingefügten Updates, wann dein Server aktualisiert. Fehlt einer Kategorie das neueste Update, steht das genau so da.',
        en: '"What should I paste next?" no longer assumes fixed statistics times but learns from the pasted updates when your server updates. When a category lacks the newest update, it says exactly that.',
      },
      {
        kind: 'fix',
        de: '„Was soll ich als Nächstes einfügen?“ kennt die Uhrzeiten der Statistik-Updates deines Servers und verlangt nach der Zeitumstellung kein Update mehr, das es nicht gibt.',
        en: '"What should I paste next?" knows the hours of your server\'s statistics updates and no longer asks for an update that does not exist after the clock change.',
      },
      {
        kind: 'new',
        de: 'Inaktivität genauer: Angriffe, Spionage, Nachrichten und verschickte Flotten zählen als Beweis für Aktivität, kleine Punktezuwächse aus Bauschleifen nicht mehr. Galaxie-Aktivität durch Angriffe anderer macht Farmziele nicht mehr „aktiv“. Der Tooltip zeigt die Gründe. Allianz-Admins können den Score im Admin-Panel an den eigenen Daten prüfen.',
        en: 'More precise inactivity: attacks, espionage, messages and fleets sent away count as proof of activity, small points gains from build queues no longer do. Galaxy activity caused by others attacking no longer makes farm targets "active". The tooltip shows the reasons. Alliance admins can check the score on their own data in the admin panel.',
      },
      {
        kind: 'new',
        de: '„Was soll ich als Nächstes einfügen?“ lässt sich in der Übersicht einklappen und startet auf dem Handy eingeklappt – nur eine Zeile mit einer roten (wichtig) oder gelben (veraltet) Warnung und der Anzahl der Hinweise.',
        en: '"What should I paste next?" folds away in the overview and starts folded on phones – just one line with a red (important) or yellow (outdated) warning and the number of hints.',
      },
      {
        kind: 'new',
        de: 'Farm-Finder (unter Kämpfe & Expos): Welche Ziele lohnen sich jetzt? Der Hub rechnet die Rohstoffe der Spionageberichte bis heute hoch und sortiert nach Beute pro Flugstunde, mit Schiffen, Treibstoff, Flugzeit und Risiko.',
        en: 'Farm finder (under Combat & expeditions): which targets pay off now? The hub projects the resources of the spy reports to today and ranks them by loot per flight hour, with ships, fuel, flight time and risk.',
      },
      {
        kind: 'new',
        de: 'Inaktivität: Übersicht, Spielerdetails und Farm-Finder zeigen, wie sicher ein Spieler inaktiv ist – oft Tage bevor das Spiel ihn markiert.',
        en: 'Inactivity: the overview, player details and the farm finder show how likely a player is inactive – often days before the game flags them.',
      },
      {
        kind: 'new',
        de: 'Suche: Mit Strg+K (Mac: ⌘K), „/“ oder dem Suchfeld im Menü findest du von jeder Seite aus Spieler (auch frühere Namen), Allianzen, Koordinaten und Seiten des Hubs.',
        en: 'Search: with Ctrl+K (Mac: ⌘K), "/" or the search field in the menu you find players (also former names), alliances, coordinates and pages of the hub from every page.',
      },
      {
        kind: 'new',
        de: '„Was soll ich als Nächstes einfügen?“: Die Sync-Seite zeigt, welche deiner Seiten fehlen oder alt sind (Imperium, Statistik, Übersicht, Galaxie, Gebäude, Forschung, Nachrichten, Marktkurs), was damit besser wird und wo du sie im Spiel findest. Das Wichtigste steht kurz auch in der Übersicht.',
        en: '"What should I paste next?": the sync page shows which of your pages are missing or old (empire, statistics, overview, galaxy, buildings, research, messages, market rate), what they improve and where to find them in the game. The most important ones also show in short on the overview.',
      },
      {
        kind: 'new',
        de: 'AKS-Beuterechner (Tools): Kampfbericht, Nachrichten, Imperium und Marktplatz einfach einfügen – Flug- und Recycler-Deut, Raketen, die Beute jeder Flotte und die Recycler werden ausgefüllt. Mehrere Abrechnungen nebeneinander in Tabs.',
        en: 'ACS loot calculator (tools): just paste the battle report, messages, empire and marketplace – flight and recycler deuterium, missiles, the loot of each fleet and the recyclers are filled in. Several settlements side by side in tabs.',
      },
      {
        kind: 'fix',
        de: 'Admin und Beuteabrechnung zeigen beim schnellen Wechseln oder bei Live-Updates immer den neuesten Stand.',
        en: 'Admin and loot settlement always show the latest data when switching quickly or on live updates.',
      },
      {
        kind: 'fix',
        de: 'Bauplan: Braucht ein Schritt eine Forschung, die ein anderer Planet über mehrere Stufen erforscht, wartet er darauf, statt als nicht möglich zu gelten.',
        en: 'Build order: a step that needs research another planet brings up over several levels waits for it instead of counting as impossible.',
      },
      {
        kind: 'fix',
        de: 'Tastatur: In Dialogen und im Benachrichtigungsfenster bleibt Tab im Fenster, Esc schließt auch die Benachrichtigungen, danach steht der Fokus wieder dort, wo er vorher war.',
        en: 'Keyboard: in dialogs and the notification panel Tab stays inside, Esc also closes the notifications, and the focus returns to where it was.',
      },
      {
        kind: 'fix',
        de: 'Admin: Claim- und Passwort-Links werden nur noch beim Erzeugen angezeigt und sicher gespeichert. Für einen offenen Link steht „offen bis …“, ein neuer Link lässt sich jederzeit erzeugen.',
        en: 'Admin: claim and password links are only shown when created and stored securely. An open link shows "open until …"; a new link can be created at any time.',
      },
      {
        kind: 'fix',
        de: 'Übernimmt ein neuer Spieler den alten Namen eines anderen, landen seine Berichte und Punkte nicht mehr beim früheren Namensträger.',
        en: 'When a new player takes over another player\'s old name, their reports and points no longer end up with the former owner of the name.',
      },
      {
        kind: 'new',
        de: 'Links in den Kampfsimulator, Flug- und IRak-Rechner nehmen die eigenen Schiffe und Verteidigung des Universums mit, auch neue Einheiten wie den Bunker.',
        en: 'Links into the battle simulator, flight and IPM calculator take the universe\'s own ships and defense along, including new units such as the Bunker.',
      },
      {
        kind: 'new',
        de: 'Admin: der Phalanx-Reichweitenfaktor des Universums lässt sich einstellen.',
        en: 'Admin: the phalanx range factor of the universe can be set.',
      },
      {
        kind: 'fix',
        de: 'Eigene Schiffe und Verteidigung eines Universums werden in eingefügten Seiten und Kampfberichten richtig erkannt, auch wenn ein anderes Universum denselben Namen für eine andere Einheit verwendet.',
        en: 'Own ships and defense of a universe are recognised correctly in pasted pages and battle reports, even when another universe uses the same name for a different unit.',
      },
    ],
  },
  {
    date: '2026-11-05',
    items: [
      {
        kind: 'fix',
        de: 'Ein sehr langer Bauplan zeigt bei nicht mehr berechneten Schritten „Plan zu lang“ statt „auf diesem Planeten nicht möglich“.',
        en: 'A very long build order shows "plan too long" for steps it no longer calculates instead of "not possible on this planet".',
      },
      {
        kind: 'fix',
        de: 'Übersicht und Allianz zeigen bei schnell aufeinanderfolgenden Aktualisierungen immer den neuesten Stand.',
        en: 'Overview and alliance always show the latest data when updates come in quickly.',
      },
      {
        kind: 'fix',
        de: 'Flugrechner: ein Link nur mit eigenen Einheiten öffnet keinen neuen Tab mehr.',
        en: 'Flight calculator: a link with own units only no longer opens a new tab.',
      },
      {
        kind: 'fix',
        de: 'Ein Zugang lässt sich nicht mehr zweimal mit demselben Namen in anderer Groß-/Kleinschreibung beantragen.',
        en: 'Access can no longer be requested twice with the same name in different upper/lower case.',
      },
    ],
  },
  {
    date: '2026-11-04',
    items: [
      {
        kind: 'fix',
        de: 'Wenn deine Sitzung abläuft, kommst du zur Anmeldung. Eine Spielernotiz, die nicht gespeichert werden konnte, bleibt als Fehler sichtbar.',
        en: 'When your session expires you are sent to login. A player note that could not be saved stays visible as an error.',
      },
      {
        kind: 'fix',
        de: 'Für ein anderes Mitglied kannst du nur noch Nachrichten und Berichte einfügen, nicht dessen Übersicht, Imperium oder Flottenliste.',
        en: 'For another member you can now only paste messages and reports, not their overview, empire or fleet list.',
      },
      {
        kind: 'fix',
        de: 'Raidpläne ändern sich nicht mehr allein durchs Öffnen der Liste. Neue Flotten, Rückrufe und eine verschobene Ankunft werden übernommen, wenn du eine Übersicht einfügst oder den Raidplaner öffnest.',
        en: 'Raid plans no longer change just by opening the list. New fleets, recalls and a moved arrival are applied when you paste an overview or open the raid planner.',
      },
      {
        kind: 'fix',
        de: 'Die Flottenliste aus dem Seitenquelltext wird auch gespeichert, wenn auf der Übersicht kein Planet ausgewählt ist. Unbekannte Schiffe oder Verteidigung in einem Bericht werden als Warnung angezeigt. Zusammenführen von Spielern behält Raidpläne. Der Optimierte Recycler braucht standardmäßig Werft/Schilde/Impuls 6.',
        en: 'The fleet list from page source is stored even when the overview has no selected planet. Unknown ships or defense in a report show a warning. Merging players keeps raid plans. The Optimized Recycler defaults to shipyard/shields/impulse 6.',
      },
      {
        kind: 'fix',
        de: 'Wenn der Kampfsimulator einmal hängen bleibt, blockiert er die nächsten Simulationen nicht mehr. Sehr viele Syncs hintereinander werden kurz abgewiesen.',
        en: 'If the battle simulator hangs once, it no longer blocks the next simulations. Very many syncs in a short time are refused for a moment.',
      },
      {
        kind: 'fix',
        de: 'Wenn du dein Passwort änderst, gelten deine API-Tokens nicht mehr. Ein Passwort darf höchstens 256 Zeichen haben.',
        en: 'Changing your password now also revokes your API tokens. A password may be at most 256 characters.',
      },
      {
        kind: 'new',
        de: 'Tutorials für Tabs: Wechselst du nach der ersten Tour in einen anderen Tab (Bauen & Forschen, Raidplaner, Expeditionen, Flotten), erklärt eine kurze Tour, was dort neu ist, etwa Abrechnungen und Raid-Statistiken.',
        en: 'Tutorials for tabs: when you switch to another tab after the first tour (build & research, raid planner, expeditions, fleets), a short tour explains what is new there, such as settlements and raid statistics.',
      },
      {
        kind: 'new',
        de: 'Auch das Admin-Panel hat jetzt ein Tutorial: Es erklärt Allianzen, Mitglieder mit Claim- und Passwort-Links, Zugangsanfragen und den Discord-Kanal, für Hub-Admins auch Universen und die Wartung.',
        en: 'The admin panel now has a tutorial too: it explains alliances, members with claim and password links, access requests and the Discord channel, for hub admins also universes and maintenance.',
      },
      {
        kind: 'new',
        de: 'Tutorials gibt es jetzt für alle Menüpunkte: Statistik, Mein Imperium, Marktplatz, Galaxie, Spionageberichte, Fremdspionage, Aktivität, Ingame-Nachrichten, Planeten, Flotten, Forschung, Battle Hall, Expeditionen und Konto. Mit dem „?“ neben dem Titel startest du sie jederzeit wieder.',
        en: 'Tutorials now exist for every menu page: statistics, my empire, market, galaxy, espionage reports, hostile espionage, activity, in-game messages, planets, fleets, research, battle hall, expeditions and account. The "?" next to the title starts them again at any time.',
      },
      {
        kind: 'fix',
        de: 'Beute abrechnen: In der Teilnehmertabelle stehen die Eingabefelder wieder genau unter ihren Spaltennamen.',
        en: 'Settle loot: in the participants table the input fields sit right under their column headers again.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen hat jetzt ein Tutorial: Beim ersten Besuch erklärt es, dass der Hub alles aus synchronisierten Berichten ausfüllt und du jeden Wert noch von Hand anpassen kannst, und geht alle Bereiche der Seite durch.',
        en: 'Settle loot now has a tutorial: on the first visit it explains that the hub fills in everything from synced reports and that you can still adjust every value by hand, and walks through every part of the page.',
      },
      {
        kind: 'new',
        de: 'Die Tutorials erklären jetzt jeden Tab und die wichtigsten Bedienelemente, im Raidplaner zum Beispiel, wie Abrechnungen aus synchronisierten Kampf-, Flottenrückkehr- und Recyclerberichten von selbst entstehen. Eine Tour, die du durch einen Seitenwechsel abbrichst, kommt beim nächsten Besuch wieder.',
        en: 'The tutorials now explain every tab and the main controls, in the raid planner for example how settlements fill themselves in from synced combat, fleet return and recycler reports. A tour you leave by switching pages comes back on the next visit.',
      },
      {
        kind: 'new',
        de: 'Raid-Statistiken: Alle Tabellen lassen sich nach Spalten sortieren (am Handy per Auswahl) und ein- und ausklappen.',
        en: 'Raid statistics: all tables can be sorted by column (on phones via a selection) and collapsed.',
      },
      {
        kind: 'new',
        de: 'Allianzen können ein Kürzel bekommen (Admin-Bereich, neben dem Allianznamen). Es steht in der Online-Anzeige im Menü, wenn der volle Name dort nicht in die Zeile passt; der volle Name erscheint beim Darüberfahren.',
        en: 'Alliances can have a short tag (admin panel, next to the alliance name). It is shown in the online list in the menu when the full name does not fit on the line; the full name appears on hover.',
      },
      {
        kind: 'new',
        de: 'Tutorials: Beim ersten Öffnen von Übersicht, Seite einfügen, Bauen & Forschen und Raidplaner zeigt der Hub eine kurze Tour mit den wichtigsten Bereichen. Du kannst sie überspringen oder „Nicht mehr anzeigen“ wählen, mit dem „?“ neben der Überschrift neu starten und sie unter Konto ein- oder ausschalten.',
        en: 'Tutorials: the first time you open Overview, Paste a page, Build & research and Raid planner, the hub shows a short tour of the main areas. You can skip it or choose "Don\'t show again", restart it with the "?" next to the title and switch tutorials on or off under Account.',
      },
      {
        kind: 'new',
        de: 'Das Menü oben ist aufgeräumter: Der Universumsname ist jetzt eine Überschrift (der Link ins Spiel zeigt sich beim Darüberfahren), und die Allianz steht bei der Online-Anzeige unten („3 online · Allianzname“).',
        en: 'The menu header is tidier: the universe name is now a heading (the link into the game shows on hover), and the alliance appears in the online list below ("3 online · alliance name").',
      },
      {
        kind: 'new',
        de: 'Der Name des Universums oben im Menü führt jetzt direkt ins Spiel zu diesem Universum.',
        en: 'The universe name at the top of the menu now leads straight to that universe in the game.',
      },
      {
        kind: 'new',
        de: 'Bald inaktiv: Bekommt ein Spieler keine Punkte mehr, zeigt sein Profil, seit welchem Statistik-Update er keine Punkte mehr hatte und ab wann er inaktiv ist. In Übersicht und Statistik steht dann ein „Zz“ neben dem Namen, der Tooltip nennt dasselbe. Die Tage bis inaktiv stellt der Admin im Universum ein (Standard 7).',
        en: 'Inactive soon: when a player stops gaining points, the profile shows since which stat update there were no points and when the player turns inactive. Overview and statistics show a "Zz" next to the name with the same in its tooltip. The admin sets the days until inactive in the universe (default 7).',
      },
      {
        kind: 'new',
        de: 'Expeditionen: Auswertung und Expo-Deck sind jetzt ein Menüpunkt „Expeditionen“ mit zwei Tabs. Alle Tabellen lassen sich per Klick auf die Spalte sortieren (am Handy über eine Auswahl), die Bereiche lassen sich einklappen.',
        en: 'Expeditions: statistics and expedition deck are now one menu entry "Expeditions" with two tabs. All tables sort with a click on a column (on mobile with a selection), the sections can be collapsed.',
      },
    ],
  },
  {
    date: '2026-11-03',
    items: [
      {
        kind: 'new',
        de: 'Raids: Die reservierten Ziele sind kein eigener Menüpunkt mehr, sondern stehen im Tab Planung zwischen den aktuellen und den vergangenen Plänen. „Aktuelle Pläne“ und „Ziele“ lassen sich einklappen.',
        en: 'Raids: the claimed targets are no longer a menu entry of their own but sit in the planning tab between the current and the past plans. "Current plans" and "Targets" can be collapsed.',
      },
      {
        kind: 'new',
        de: 'Raids: wieder mit Fadenkreuz-Symbol; die Knöpfe der Planung stehen wie bei den Abrechnungen über dem Inhalt. In den Raid-Statistiken steht bei jedem Kampfbericht der Spieler des Ziels.',
        en: 'Raids: back to the crosshair icon; the planning buttons sit above the content like in the settlements. The raid statistics show the target player next to each battle report.',
      },
      {
        kind: 'new',
        de: 'Raid-Statistiken: Zu jedem Kampfbericht gibt es Links zum Bericht im Spiel und – wenn er synchronisiert ist – zum lokal gespeicherten Bericht, wie in der Battle Hall.',
        en: 'Raid statistics: every battle report links the report in the game and, once synced, the locally stored report, like the battle hall.',
      },
      {
        kind: 'new',
        de: 'Raids: Raid-Planer und Raid-Statistiken sind jetzt ein Menüpunkt „Raids“ mit den Tabs Planung, Abrechnungen und Statistiken.',
        en: 'Raids: raid planner and raid statistics are now one menu entry "Raids" with the tabs planning, settlements and statistics.',
      },
      {
        kind: 'new',
        de: 'Raid-Statistiken: Raketenangriffe aus den eingefügten „Raketeneinschlag“-Nachrichten – je Mitglied Raketen, abgefangene Raketen, zerstörte Verteidigung und ihr Wert, dazu die Liste der Einschläge.',
        en: 'Raid statistics: missile attacks from the pasted "Missile impact" messages – per member missiles, intercepted missiles, destroyed defense and its value, plus the list of impacts.',
      },
      {
        kind: 'fix',
        de: 'Englische Raketeneinschlag-Nachrichten werden jetzt erkannt (auch für die Beute-Abrechnung).',
        en: 'English missile impact messages are recognized now (also for the loot settlement).',
      },
      {
        kind: 'new',
        de: 'Schiffe & Verteidigung (Admin-Panel und pr0game-Tools): Bunker, Titan Laser und Decoy vom Testserver sind mit Kosten und Voraussetzungen hinterlegt. Wer sie anlegt oder ihre Seite einfügt, bekommt die Werte vorausgefüllt.',
        en: 'Ships & defense (admin panel and pr0game tools): Bunker, Titan Laser and Decoy of the test server are stored with costs and requirements. Adding them or pasting their page fills in the values.',
      },
    ],
  },
  {
    date: '2026-11-02',
    items: [
      {
        kind: 'new',
        de: 'pr0game-Tools: Eigene Werte für Schiffe und Verteidigung in Flugrechner, Kampfsimulator, Beute- und IPM-Rechner, auch neue Einheiten. Die Werte lassen sich aus Quelltexten von Werft, Verteidigung, Technologiebaum und Infoseiten einfügen und bleiben in deinem Browser. Geteilte Links nehmen sie mit. Die bisherigen eigenen Schiffe des Flugrechners werden übernommen.',
        en: 'pr0game tools: own values for ships and defense in the flight calculator, battle simulator, loot and IPM calculator, new units too. The values can be pasted from the page sources of the shipyard, defense, tech tree and info pages and stay in your browser. Shared links carry them. The flight calculator’s custom ships are taken over.',
      },
      {
        kind: 'new',
        de: 'Admin-Panel, Schiffe & Verteidigung: Eingefügte Werft- und Verteidigungsseiten zeigen alle Einheiten des Universums. Fehlende schlägt der Hub zum Ausblenden vor, ausgeblendete, die dort stehen, zum Einblenden.',
        en: 'Admin panel, ships & defense: pasted shipyard and defense pages list every unit of the universe. The hub offers to hide the missing ones and to show hidden ones listed there.',
      },
      {
        kind: 'new',
        de: 'Admin-Panel: Schiffe und Verteidigung pro Universum einstellbar – Kosten, Voraussetzungen, Ladung, Antriebe, Angriff, Schild und Rapidfire, auch neue Einheiten. Die Werte lassen sich aus Quelltexten von Werft, Verteidigung, Technologiebaum und Infoseiten einfügen. Bauen & Forschen, Flugzeiten, Raid-Planer, Kampfsimulator und Beuteabrechnung rechnen dann mit den Werten des Universums.',
        en: 'Admin panel: ships and defense can be set per universe – costs, requirements, cargo, drives, attack, shield and rapidfire, new units too. The values can be pasted from the page sources of the shipyard, defense, tech tree and info pages. Build & research, flight times, raid planner, battle simulator and loot settlement then use the universe’s values.',
      },
      {
        kind: 'new',
        de: 'Admin-Panel: Bestehende Konten lassen sich einer Allianz in einem weiteren Universum zuweisen, statt dort neue Mitglieder anzulegen. Der Ingame-Name wird übernommen und kann geändert werden.',
        en: 'Admin panel: existing accounts can be assigned to an alliance in another universe instead of creating new members there. The in-game name is taken over and can be changed.',
      },
      {
        kind: 'fix',
        de: 'Ein Mitglied ohne Konto, das aus einer Allianz entfernt wird, bleibt in seinen Allianzen anderer Universen erhalten.',
        en: 'A member without an account who is removed from one alliance stays in their alliances of other universes.',
      },
      {
        kind: 'fix',
        de: 'Info-Hinweise werden in Dialogen nicht mehr abgeschnitten. Die Universumseinstellungen erklären jetzt auch Entfernungsfaktoren, runde Galaxien/Systeme und den Noobschutz-Faktor.',
        en: 'Info tooltips are no longer cut off in dialogs. The universe settings now also explain the distance factors, circular galaxies/systems and the noob protection factor.',
      },
      {
        kind: 'fix',
        de: 'Schiffe & Verteidigung: Schwerer Kreuzer, Optimierter Recycler, Behemoth und Void Titan zeigen jetzt ihre Voraussetzungen.',
        en: 'Ships & defense: heavy cruiser, optimized recycler, Behemoth and Void Titan now show their requirements.',
      },
      {
        kind: 'new',
        de: 'Bauliste: Produktionswechsel und Transporte werden nach einem Sync (Imperium als Seitenquelltext, Flottenbewegungen) von selbst abgehakt. Ist ein Speicher zu klein, zeigt der Schritt, wie viel per Transport kommen muss, statt „nicht möglich“. Dazu ein Link zu pr0plan (im Admin-Panel einstellbar).',
        en: 'Build order: production changes and transports are checked off by themselves after a sync (empire page source, fleet movements). If a storage is too small, the step shows how much has to come by transport instead of “not possible”. Plus a link to pr0plan (configurable in the admin panel).',
      },
      {
        kind: 'new',
        de: 'Bauliste unter Bauen & Forschen: Importiere eine Build Order aus pr0plan, ordne ihre Planeten deinen zu und sieh für jeden Schritt, wann er möglich ist – gerechnet ab deinem echten Stand mit Produktion, Speicher und ankommenden Transporten. Schritte lassen sich umsortieren, abhaken und überspringen. Ist der nächste Schritt möglich, kommt eine Benachrichtigung. Weichen die Einstellungen der Datei vom Universum ab, siehst du eine Warnung; gerechnet wird mit den Werten des Hubs.',
        en: 'Build order under build & research: import a build order from pr0plan, map its planets onto yours and see for each step when it is possible – planned from your real state with production, storage and incoming transports. Steps can be reordered, checked off and skipped. You get a notification when the next step is possible. If the file’s settings differ from the universe, you see a warning; the hub’s values are used.',
      },
      {
        kind: 'new',
        de: 'Bauen & Forschen hat einen Tab „Schiffe & Verteidigung“: Anzahl, Kosten und Bauzeit je Einheit, wie viele du dir gerade leisten kannst, wann die nächste bezahlbar ist, und Gesamtkosten und -zeit für eine Menge. Schilde (einmal je Planet), Silo-Platz und eine blockierte Werft sind berücksichtigt.',
        en: 'Build & research has a “Ships & defense” tab: count, cost and build time per unit, how many you can afford right now, when the next one is affordable, and the total cost and time for an amount. Shields (once per planet), silo space and a blocked shipyard are taken into account.',
      },
      {
        kind: 'new',
        de: 'Admin: Die Universum-Einstellungen öffnen sich in einem eigenen Fenster, übersichtlich in aufklappbare Abschnitte gegliedert (auch auf dem Handy). „Universum anlegen“ ist ein Button unter der Liste.',
        en: 'Admin: universe settings open in their own window, organized into collapsible sections (also on phones). “Create universe” is a button below the list.',
      },
    ],
  },
  {
    date: '2026-11-01',
    items: [
      {
        kind: 'new',
        de: 'Universen planen: Admins können für ein Universum einen Starttermin und optional ein Ende festlegen. Bis zum Start zeigt das Universum einen Countdown, danach geht es von selbst los; zum Ende wird es automatisch eingefroren.',
        en: 'Scheduled universes: admins can set a start and optionally an end for a universe. Until the start it shows a countdown, then it opens by itself; at the end it is frozen automatically.',
      },
      {
        kind: 'new',
        de: 'Beendete Universen: Admins können ein Universum beenden, wenn es vorbei ist. Es wird eingefroren: Alle Daten bleiben lesbar, Ressourcen und Countdowns stehen still, synchronisieren und ändern geht nicht mehr, Benachrichtigungen ruhen. Bei Bedarf lässt es sich wieder öffnen.',
        en: 'Ended universes: admins can end a universe once it is over. It is frozen: all data stays readable, resources and countdowns stand still, syncing and changes are no longer possible, notifications rest. It can be reopened if needed.',
      },
      {
        kind: 'new',
        de: 'Battle Hall: Der Hub liest die öffentliche Battle Hall alle paar Stunden selbst ein. Neue Einträge und ihre Kampfberichte kommen so auch dann an, wenn niemand die Battle Hall im Spiel synchronisiert.',
        en: 'Battle hall: the hub reads the public battle hall by itself every few hours. New entries and their battle reports arrive even when nobody syncs the battle hall in the game.',
      },
    ],
  },
  {
    date: '2026-10-31',
    items: [
      {
        kind: 'new',
        de: 'Beute abrechnen und Beuterechner: Statt „gleichmäßig“ lässt sich der Gewinn jetzt nach Prozent aufteilen, mit einem eigenen Anteil pro Teilnehmer. Ohne Angabe bekommen alle gleich viel.',
        en: 'Loot settlement and loot calculator: instead of "equally" the profit can now be split by percent, with a share per participant. Without any, everyone gets the same.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen: Ein Diagramm zeigt, wie Beute und Trümmerfeld über Kostenausgleich, Gewinn und Helferanteil bei jedem Teilnehmer ankommen, nach Menge oder nach Wert in Deut.',
        en: 'Loot settlement: a diagram shows how loot and debris field go through costs covered, profit and the helpers\' part to each participant, by amount or by value in deuterium.',
      },
      {
        kind: 'new',
        de: 'Battle Hall: Abschiede (Spieler, die aufhören und ihre Flotte absichtlich zerstören lassen) werden erkannt und sind wie im Spiel ausgeblendet. Dafür die Battle Hall im Spiel einmal mit „Abschiede: anzeigen“ einfügen.',
        en: 'Battle hall: farewell battles (players quitting who have their fleet destroyed on purpose) are recognised and hidden like in the game. To get them, paste the battle hall once with "Memorials: only".',
      },
      {
        kind: 'fix',
        de: 'Beute abrechnen: Von Hand eingefügte Berichte zählen nicht mehr doppelt, wenn sie später synchronisiert werden. Ein Transport hakt nur noch eine Lieferung ab, und erst nach dem Festschreiben. Nach erneutem Festschreiben bleiben nur Lieferungen mit unveränderten Beträgen abgehakt.',
        en: 'Loot settlement: reports pasted by hand no longer count twice once they are synced. A transport ticks off only one delivery, and only after finalizing. After finalizing again only deliveries with unchanged amounts stay ticked off.',
      },
      {
        kind: 'new',
        de: 'Beim Synchronisieren siehst du, in welche Beuteabrechnung deine Berichte einfließen. Wird eine Abrechnung festgeschrieben, sagt dir eine Benachrichtigung (Glocke, Push, Discord), was du schickst und bekommst.',
        en: 'When syncing you see which loot settlement your reports count for. When a settlement is finalized, a notification (bell, push, Discord) tells you what you send and get.',
      },
      {
        kind: 'new',
        de: 'Synchronisieren liest jetzt auch Transportberichte, Raketeneinschläge und Recycler-Rückkehr. Beute abrechnen übernimmt daraus die IRaks, schätzt das Recycler-Deut, rechnet das Flug-Deut mit der echten Flugzeit und hakt Lieferungen ab, sobald der Transportbericht synchronisiert ist.',
        en: 'Sync now also reads transport reports, missile impacts and recyclers coming home. The loot settlement takes the missiles from them, estimates the recycler deuterium, computes the flight deuterium with the real flight time and ticks off deliveries once the transport report is synced.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen: Ein Datenstand zeigt, welche Berichte noch fehlen und wer sie synchronisieren muss. Die Liste der Abrechnungen zeigt den Stand, die verbleibende Zeit zum Verteilen und deine offenen Lieferungen.',
        en: 'Loot settlement: a data status shows which reports are still missing and who has to sync them. The list of settlements shows the stage, the time left to share and your open deliveries.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen: Die Abrechnung übernimmt später synchronisierte Kampf-, Flottenrückkehr- und Recyclerberichte von selbst, deine Korrekturen bleiben markiert stehen. Mit „Festschreiben“ werden die Zahlen für die Lieferungen eingefroren, „Wieder öffnen“ holt neue Daten.',
        en: 'Loot settlement: reports synced later (battle, fleet return, recycling) flow in by themselves, your corrections stay and are marked. "Finalize" freezes the numbers for the deliveries, "Reopen" takes in new data.',
      },
      {
        kind: 'fix',
        de: 'Koordinatenfelder öffnen auf dem Handy wieder die normale Tastatur, damit man den Doppelpunkt tippen kann.',
        en: 'Coordinate fields open the normal keyboard on phones again, so you can type the colon.',
      },
      {
        kind: 'fix',
        de: 'Angriffe: Entfernt ein Admin eine falsch erkannte Welle, bleibt eine gleiche, ausgeblendete Welle weiter ausgeblendet.',
        en: 'Attacks: when an admin removes a wrongly detected wave, an identical wave that was hidden stays hidden.',
      },
      {
        kind: 'fix',
        de: 'Kampfhalle und Kampfberichte behalten die Namen vom ersten Sync, auch wenn sich ein Spieler umbenennt oder löscht. Die Suche findet Kämpfe mit früheren und aktuellen Namen.',
        en: 'Battle hall and combat reports keep the names of the first sync, even when a player renames or deletes their account. Search finds battles by former and current names.',
      },
      {
        kind: 'fix',
        de: 'Aktivitätsmuster: Galaxie-Sterne nutzen die Serverzeit der kopierten Seite. Spionage oder Kampf kurz vor dem Kopieren erklärt einen Stern damit zuverlässig, auch wenn die Galaxie erst später eingefügt wird.',
        en: 'Activity pattern: galaxy marks use the server time of the copied page. Espionage or a battle shortly before copying now reliably explains a mark, even when the galaxy is pasted later.',
      },
      {
        kind: 'fix',
        de: 'Aktivitätsmuster: Eigene Flotten der Allianz, die kurz vor dem Galaxie-Sync am Planeten ankamen (Spionage, Transport, Angriff …), erklären einen Galaxie-Stern auch ohne gesyncten Bericht.',
        en: 'Activity pattern: own alliance fleets that arrived at the planet shortly before the galaxy sync (espionage, transport, attack …) explain a galaxy mark even without a synced report.',
      },
      {
        kind: 'fix',
        de: 'Aktivitätsmuster: Eine Offline-Meldung streicht nur Galaxie-Sterne im Abstand von 15 Minuten. Nur Galaxie-Sterne heben die Kurve nicht mehr auf volle Höhe, ihre Striche sind blasser.',
        en: 'Activity pattern: an offline report only removes galaxy marks within 15 minutes of it. Galaxy marks alone no longer raise the curve to full height, and their ticks are paler.',
      },
    ],
  },
  {
    date: '2026-10-30',
    items: [
      {
        kind: 'fix',
        de: 'Galaxie: Wird nur ein Teil eines Systems als Text kopiert, gelten die Planeten danach nicht mehr als zerstört.',
        en: 'Galaxy: copying only part of a system as text no longer marks the planets after it as destroyed.',
      },
      {
        kind: 'fix',
        de: 'Spionage-Historie: Beim Weiterscrollen fehlen keine Berichte mehr und es tauchen keine doppelt auf, auch wenn gerade neue Berichte dazukommen.',
        en: 'Spy history: scrolling on no longer skips or repeats reports, even while new reports come in.',
      },
      {
        kind: 'fix',
        de: 'Feindliche Spionage: Der Spieler-Link zeigt nicht mehr auf einen neuen Besitzer des Startplaneten.',
        en: 'Enemy spying: the player link no longer points to a new owner of the start planet.',
      },
      {
        kind: 'fix',
        de: 'Beuteabrechnung: „Aktualisieren“ ohne neue Daten markiert eine gespeicherte Abrechnung nicht mehr als geändert, Transfers lassen sich danach weiter abhaken.',
        en: 'Loot settlement: “Update” without new data no longer marks a saved settlement as changed; transfers can still be ticked afterwards.',
      },
      {
        kind: 'fix',
        de: 'Planet-Aktionen: Art und Dauer eines Claims lassen sich wieder mit den Pfeiltasten wählen, und die Bildschirmtastatur auf Tablets schließt das Menü nicht mehr.',
        en: 'Planet actions: the type and duration of a claim can be picked with the arrow keys again, and the on-screen keyboard on tablets no longer closes the menu.',
      },
      {
        kind: 'fix',
        de: 'Aktionsmenüs auf dem Handy (Planet und Mond, auch im Galaxie-Browser) öffnen sich von unten, damit alle Einträge sichtbar und tippbar bleiben.',
        en: 'Action menus on phones (planet and moon, including the galaxy browser) open from the bottom so every item stays on screen and tappable.',
      },
      {
        kind: 'fix',
        de: 'Aktivitätsmuster: Ein Galaxie-Stern fällt nur weg, wenn Spionage oder ein Kampf an dem Planeten vor dem Galaxie-Sync war; danach bleibt er als uneindeutige Aktivität. Doppelte Sterne aus älteren Syncs werden über die Sync-Zeit gefiltert.',
        en: 'Activity pattern: a galaxy mark is removed only if espionage or a battle at that planet happened before the galaxy was synced; after that it stays as unclear activity. Duplicate marks from older syncs are filtered using sync time.',
      },
      {
        kind: 'new',
        de: 'Aktivitätsmuster: Galaxie-Sterne zählen pro Planet nur einmal pro Stunde – ein Planet wenig, mehrere Planeten in derselben Stunde stärker (bis zum bisherigen Maximum). Eigener Spio oder Kampf auf dem Planeten streicht nur diesen Stern; Offline-Meldungen streichen die Sterne in der Stunde.',
        en: 'Activity pattern: galaxy marks count once per planet per hour – one planet counts little, several planets in the same hour count more (up to the former maximum). Own espionage or a battle on that planet drops only that mark; offline reports drop the marks in that hour.',
      },
      {
        kind: 'new',
        de: 'Aktivitätsmuster: Neben „Onlinezeit melden“ kannst du Offlinezeit melden – der Spieler gilt dann zu dem Zeitpunkt als offline (sichtbar im Muster, ohne die Kurve zu erhöhen).',
        en: 'Activity pattern: besides “Report online time” you can report offline time – the player is then treated as offline at that time (shown in the pattern without raising the curve).',
      },
    ],
  },
  {
    date: '2026-10-29',
    items: [
      {
        kind: 'fix',
        de: 'Spionage-Verlauf: „Neueste Berichte“ lädt beim Scrollen zuverlässig weitere Berichte nach (Fix für abgebrochenes Nachladen).',
        en: 'Spy history: “Latest reports” reliably loads more reports while scrolling (fix for broken pagination).',
      },
      {
        kind: 'new',
        de: 'Spionage-Verlauf: „Neueste Berichte“ zeigt beim Scrollen mehr Einträge (wie in der Übersicht), nicht nur die ersten 50.',
        en: 'Spy history: “Latest reports” loads more entries as you scroll (like the overview), not just the first 50.',
      },
      {
        kind: 'fix',
        de: 'Fremdspionage: Spionennamen sind klickbar und öffnen das Spielerprofil, wenn der Spieler im Hub bekannt ist – wie bei Spionageberichten.',
        en: 'Hostile espionage: spy names are clickable and open the player profile when that player is known in the hub, like on spy reports.',
      },
      {
        kind: 'new',
        de: 'Aktivität: Verschwindet ein bekannter Planet oder Mond in der Galaxie, erscheinen „Planet zerstört“ bzw. „Mond zerstört“ (neben „Neuer Planet“ / „Neuer Mond“).',
        en: 'Activity: when a known planet or moon disappears from the galaxy view, “Planet destroyed” or “Moon destroyed” entries appear (alongside new planet/moon).',
      },
      {
        kind: 'fix',
        de: 'Admin-Panel: Den Abschnitt „Flottenbewegungen“ (falsch gespeicherte Angriffe entfernen) sehen und nutzen nur noch Hub-Administratoren, nicht Allianz-Admins.',
        en: 'Admin panel: only hub administrators can see and use the “Fleet movements” section to remove wrongly stored attacks; alliance admins cannot.',
      },
    ],
  },
  {
    date: '2026-10-28',
    items: [
      {
        kind: 'fix',
        de: 'Admin-Panel: Im Abschnitt „Flottenbewegungen“ heißt der Entfernen-Button wieder „Entfernen“ (statt Platzhaltertext).',
        en: 'Admin panel: the “Fleet movements” section shows “Remove” on its button again instead of a missing translation placeholder.',
      },
      {
        kind: 'fix',
        de: 'Admin-Panel: Hub-Administratoren können falsch gespeicherte Angriffe aus den Flottenlisten eines Mitglieds entfernen (Abschnitt „Flottenbewegungen“).',
        en: 'Admin panel: hub administrators can remove wrongly stored attacks from a member’s saved fleet lists (“Fleet movements” section).',
      },
      {
        kind: 'fix',
        de: 'Sync: Eingehende Angriffe ohne Schiffsliste in der Zeile („Eine Flotten vom …“) gelten wieder als feindlich, nicht als fremde Flotte.',
        en: 'Sync: incoming attacks without a ship list in the line (“A fleet from …”) are marked hostile again on the attacked member’s overview, not foreign.',
      },
      {
        kind: 'fix',
        de: 'Sync: Flotten aus kopierter Übersicht oder Phalanx mit Ankunftsuhr über einem Tag (z. B. „3T 17:13:37“) werden wieder erkannt – für alle Missionen.',
        en: 'Sync: fleet events from a copied overview or phalanx whose arrival clock is more than a day away (e.g. “3T 17:13:37”) are recognised again for every mission.',
      },
      {
        kind: 'fix',
        de: 'Battle Hall: Das Todesstern-Symbol bei Mondzerstörungen ist neutral grau hinterlegt statt in der Gewinner-/Verlierer-Farbe des Namens.',
        en: 'Battle Hall: the death star icon for moon destruction uses a neutral grey badge instead of the attacker name’s win/loss colour.',
      },
      {
        kind: 'fix',
        de: 'Battle Hall und lokal archivierte Kampfberichte: Ein erneuter Sync, nachdem Spieler im Spiel gelöscht wurden, überschreibt gespeicherte Namen nicht mehr durch „–“ oder leere Einträge.',
        en: 'Battle Hall and locally archived battle reports: syncing again after players were deleted in the game no longer overwrites stored names with “–” or blanks.',
      },
      {
        kind: 'fix',
        de: 'Battle Hall: Die Spielersuche findet Kämpfe auch über frühere Namen (wie in der Übersicht).',
        en: 'Battle Hall: player search finds battles by former names too (like on the overview).',
      },
      {
        kind: 'new',
        de: 'Battle Hall: Lokal archivierte Mondzerstörungen sind am Todesstern-Symbol hinter den Angreifer-Namen erkennbar.',
        en: 'Battle Hall: locally archived moon-destruction battles show a death star icon after the attackers’ names.',
      },
      {
        kind: 'fix',
        de: 'Kampfberichte zur Mondzerstörung werden wieder erkannt – beim Archiv aus der Battle Hall und beim Einfügen als Text.',
        en: 'Moon-destruction battle reports are recognised again when archived from the battle hall and when pasted as text.',
      },
    ],
  },
  {
    date: '2026-10-27',
    items: [
      {
        kind: 'fix',
        de: 'Marktplatz: Die Kursquelle heißt jetzt „genau“, „geschätzt“ oder „von Hand“ – auch die normal kopierte Seite liefert den genauen Kurs. Ein unveränderter Kurs erzeugt keine doppelten Einträge im Verlauf mehr.',
        en: 'Marketplace: the rate source now reads "exact", "estimated" or "by hand" – a normally copied page gives the exact rate too. An unchanged rate no longer adds duplicate rows to the history.',
      },
      {
        kind: 'fix',
        de: 'Beute abrechnen: Der Marktkurs aus dem Marktplatz wird jetzt beim Erstellen aus Hub-Daten als Kurs übernommen, und „Aktualisieren aus Hub-Daten“ übernimmt einen neuen Marktkurs, solange du die Kurse nicht von Hand geändert hast.',
        en: 'Loot settlement: the market rate from the marketplace is now used as the rates when creating from hub data, and "Update from hub data" takes over a new market rate as long as you have not changed the rates by hand.',
      },
      {
        kind: 'new',
        de: 'Marktplatz: Der Handelsverlauf der Marktplatz-Seite wird bei jedem Sync mitgesammelt und auf der Seite „Marktplatz“ einklappbar angezeigt. „Allianz“ bei einem Angebot heißt: eigene Allianz oder eine Allianz mit Vertrag (im Spiel grün markiert).',
        en: 'Marketplace: the trade history of the marketplace page is collected with every sync and shown, collapsible, on the "Marketplace" page. "Alliance" on an offer means the own alliance or an alliance with a pact (marked green in the game).',
      },
      {
        kind: 'new',
        de: 'Marktplatz: Kopiere die Marktplatz-Seite aus dem Spiel und füge sie unter Synchronisieren ein. Der Hub merkt sich den Marktkurs (genau aus dem Seitenquelltext, sonst geschätzt) und zeigt ihn mit den offenen Angeboten auf der neuen Seite „Marktplatz“, wo du ihn auch von Hand setzen kannst. Neue Angebote erscheinen im Aktivitätslog, und in der Beute-Abrechnung übernimmst du den Marktkurs mit einem Klick auf „Marktkurs“.',
        en: 'Marketplace: copy the marketplace page in the game and paste it under Sync. The hub keeps the market rate (exact from the page source, otherwise estimated) and shows it with the open offers on the new "Marketplace" page, where you can also set it by hand. New offers show up in the activity log, and in the loot settlement the “Market rate” button takes it over with one click.',
      },
      {
        kind: 'new',
        de: 'Standard-Universum: Admins können ein Universum festlegen, in dem man direkt landet, wenn man den Hub öffnet. Die Universenliste erreichst du weiterhin über das Menü „Universen“.',
        en: 'Default universe: admins can pick a universe you land in directly when opening the hub. The universe list is still available from the “Universes” menu.',
      },
      {
        kind: 'new',
        de: 'Schnellzugriff auf die Tools: Ein Klick auf „pr0game Hub“ im Menü (am Handy oben in der Leiste) führt zu den Tools.',
        en: 'Quick access to the tools: clicking “pr0game Hub” in the menu (in the top bar on mobile) takes you to the tools.',
      },
      {
        kind: 'new',
        de: 'Mondzerstörungsrechner bei den Tools: Chance, einen Mond mit Todessternen zu zerstören und dabei die Flotte zu verlieren, auch über mehrere Wellen, und eine Empfehlung, wie viele Todessterne und Wellen ein Mond für die gewünschte Chance braucht. Im Hub öffnet das Aktionsmenü eines Mondes den Rechner mit dem Durchmesser aus der Galaxie (dafür die Galaxie als Seitenquelltext einfügen).',
        en: 'Moon destruction calculator in the tools: the chance to destroy a moon with Death Stars and to lose the fleet doing so, also over several waves, and a recommendation of how many Death Stars and waves a moon needs for the wanted chance. In the hub, the action menu of a moon opens the calculator with the diameter from the galaxy (paste the galaxy as page source for that).',
      },
      {
        kind: 'new',
        de: 'Zugang anfragen: Auf der Anmeldeseite können Leute ohne Account Nutzername, Passwort und eine Nachricht (Pflicht) hinterlegen. Ein Admin weist die Anfrage einem Spieler ohne Account zu, danach kann sich der Spieler mit diesen Daten anmelden. Admins werden über neue Anfragen benachrichtigt (Glocke, Push und Discord, wenn eingerichtet). Allianz-Admins sehen die Anfragen auf der Glocke und können sie Spielern ihrer eigenen Allianz zuweisen.',
        en: 'Request access: on the login page, people without an account can leave a username, password and a message (required). An admin assigns the request to a player without an account, after which that player can log in with these details. Admins are notified of new requests (bell, push and Discord if set up). Alliance admins see requests on the bell and can assign them to players of their own alliance.',
      },
      {
        kind: 'new',
        de: 'Aktivitätsmuster: Bei Spielern der eigenen Allianz zählen jetzt auch ihre Synchronisierungen und die Zeiten, in denen sie den Hub offen hatten (nur wenn sie Online-Status bzw. Synchronisierungen teilen). Der Punktezuwachs erscheint als graue Stufenfläche je Statistik-Zeitraum (6 h) im Vergleich zu den anderen Zeiträumen des Spielers: keine Punkte heißt keine Aktivität, viele Punkte viel Aktivität.',
        en: 'Activity pattern: for players of your own alliance, their syncs and the times they had the hub open now count too (only if they share their online status or syncs). Point gains now show as a grey stepped area per statistics window (6 h) compared with the player’s other windows: no points means no activity, many points much activity.',
      },
      {
        kind: 'new',
        de: 'Aktivitätsmuster auf der Spielerseite: zeigt, wann ein Spieler über den Tag meist online ist – aus Spionagen, Kämpfen, Nachrichten, Flottenbewegungen, Punktezuwachs und Galaxie-Aktivität, wahlweise für die letzten 24 Stunden oder 7 Tage. Mit „Onlinezeit melden“ trägst du selbst ein, dass ein Spieler gerade (oder zu einer bestimmten Zeit) online war.',
        en: 'Activity pattern on the player page: shows when a player is usually online over the day – from espionage, battles, messages, fleet movements, point gains and galaxy activity, for the last 24 hours or 7 days. With “Report online time” you note yourself that a player is (or was at a certain time) online.',
      },
      {
        kind: 'fix',
        de: 'Flottenbewegungen teilen: Marktplatz- und Transferflüge lassen sich jetzt in den Kontoeinstellungen ausblenden.',
        en: 'Sharing fleet movements: marketplace and transfer flights can now be hidden in the account settings.',
      },
    ],
  },
  {
    date: '2026-10-26',
    items: [
      {
        kind: 'fix',
        de: 'Kampfsimulator aus dem Spionageverlauf: Deine Forschungen und dein nächster Planet als Start werden jetzt für den Angreifer übernommen.',
        en: 'Battle simulator from the spy history: your research and your nearest planet as start are now filled in for the attacker.',
      },
      {
        kind: 'new',
        de: '„n“ und „s“ werden jetzt auch in Galaxie, Statistik, Spielerinfo und Aktivität aus deinen Punkten berechnet, wenn der Noobschutz des Universums eingetragen ist.',
        en: '"N" and "S" are now also calculated from your points in the galaxy, statistics, player info and activity once the universe’s noob protection is entered.',
      },
      {
        kind: 'new',
        de: 'Übersicht: „n“ und „s“ werden aus deinen Punkten berechnet, sobald der Admin den Noobschutz des Universums (Limit, Faktor) eingetragen hat. Vorher galt die Sicht dessen, der zuletzt synchronisiert hat.',
        en: 'Overview: "N" and "S" are calculated from your points once the admin has entered the universe’s noob protection (limit, factor). Before, they showed the view of whoever synced last.',
      },
      {
        kind: 'new',
        de: 'Übersicht: Neue Filter „Schwache (n) aus“ und „Starke (s) aus“ blenden Spieler mit diesem Status aus, „Planeten aus“ zeigt nur noch Monde.',
        en: 'Overview: new filters "hide weak (N)" and "hide strong (S)" hide players with that status, "hide planets" shows only moons.',
      },
      {
        kind: 'new',
        de: 'Imperium: Mit dem Auge an einer eigenen Flotte teilst du sie mit der Allianz oder nicht, wie bei Ingame-Nachrichten, auch wenn du Flottenbewegungen im Konto sonst nicht teilst. Der Rückflug derselben Flotte folgt automatisch.',
        en: 'Empire: the eye on one of your fleets shares it with the alliance or not, like in-game messages, even if you otherwise do not share fleet movements under Account. The return of the same fleet follows automatically.',
      },
      {
        kind: 'new',
        de: 'Konto: Neue Option „Anderen zeigen, wenn ich etwas synchronisiere“. Ausgeschaltet bekommen andere Mitglieder keinen Hinweis mehr mit deinem Namen, wenn du etwas einfügst; die Daten sehen sie weiterhin.',
        en: 'Account: new option "Show others when I sync something". When it is off, other members no longer get a hint with your name when you paste something; they still see the data.',
      },
      {
        kind: 'new',
        de: 'Monde sind in Tabellen jetzt nur noch mit dem Mond-Symbol markiert statt mit Symbol und Wort, die Spalten werden dadurch schmaler.',
        en: 'Moons in tables are now marked with just the moon symbol instead of symbol and word, so the columns get narrower.',
      },
      {
        kind: 'new',
        de: 'Übersicht: In den Spalten Angriff und Spio läuft ein Countdown, solange ein Angriff oder eine Spionage eines Mitglieds auf den Planeten unterwegs ist (wie im FF-Hub). Der Tooltip zeigt, wer fliegt und wann die Flotte ankommt.',
        en: 'Overview: the Attack and Spy columns show a countdown while an attack or spying of a member is on its way to the planet (like FF-Hub). The tooltip shows who is flying and when the fleet arrives.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Nach einer Simulation öffnet „Nächste Welle“ einen neuen Tab mit den übrigen Schiffen und der Verteidigung beider Seiten und den Ressourcen nach der Beute, so lassen sich mehrere Wellen nacheinander simulieren.',
        en: 'Battle simulator: after a simulation, "Next wave" opens a new tab with the ships and defense left on both sides and the resources after the loot, so several waves can be simulated one after another.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulator: Flotten lassen sich per Doppelklick auf ihren Tab wieder umbenennen, und ein einzelner Tab hat rechts wieder Abstand.',
        en: 'Battle simulator: fleets can be renamed by double-clicking their tab again, and a single tab has its right padding back.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulator und AKS-Beuterechner nutzen auf breiten Bildschirmen mehr Breite, die Tabellen müssen weniger scrollen.',
        en: 'Battle simulator and ACS loot calculator use more width on wide screens, so the tables need less scrolling.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulator: Auch der Planet zeigt die Antriebsforschung, die Spalte Wiederaufgebaut steht ganz hinten, und die Verlusttabellen passen in ihre halbe Breite. Mehr Abstand im Ergebnis.',
        en: 'Battle simulator: the planet shows its drive research too, the rebuilt column is last, and the loss tables fit their half width. More space in the result.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Haltende Flotten beim Verteidiger haben jetzt Start, Geschwindigkeit und Antriebsforschung. Ihre Flugzeit wird angezeigt und ihr Deuterium geht in die Bilanz des Verteidigers ein. Forschung und Schiffe stehen auf beiden Seiten auf gleicher Höhe.',
        en: 'Battle simulator: fleets holding at the defender now have a start, speed and drive research. Their flight time is shown and their deuterium goes into the defender balance. Research and ships of both sides are at the same height.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulator: Das Ergebnis flackert beim Simulieren nicht mehr, beim Angreifer fehlt die unnötige Spalte Wiederaufgebaut, und die Verteidigung des Planeten hat einen Link zum IRak-Rechner.',
        en: 'Battle simulator: the result no longer flickers when simulating, the attacker no longer has the needless rebuilt column, and the planet defense links to the IPM calculator.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Beide Seiten können Recycler zum Trümmerfeld schicken. Der Dialog zeigt Flugzeit, Deuterium und Ladekapazität, das Deuterium geht in die Bilanz ein. Außerdem stehen die wahrscheinliche Rundenzahl im Ergebnis und die Forschung beider Seiten auf einer Linie.',
        en: 'Battle simulator: both sides can send recyclers to the debris field. The dialog shows flight time, deuterium and cargo space, the deuterium goes into the balance. The result also shows the likely number of rounds, and the research of both sides is on one line.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Die Flotten tragen Namen. Aus dem Raid-Planer kommen die Mitglieder und Gastspieler mit, aus Plan und Spionagebericht der Zielspieler. Per Doppelklick auf eine Flotte lässt sie sich umbenennen.',
        en: 'Battle simulator: fleets carry names. From the raid planner come the members and guest players, from the plan and spy report the target player. Double-click a fleet to rename it.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Für jede Einheit steht jetzt das Verlustrisiko da, und die Durchschnitte haben Nachkommastellen (z. B. 1,8 von 2 Kleinen Transportern übrig). So sieht man auch bei kleinen Kämpfen, wie wahrscheinlich ein Verlust ist.',
        en: 'Battle simulator: each unit now shows its loss risk, and the averages have decimals (e.g. 1.8 of 2 small cargos left). Even small battles show how likely a loss is.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Enter startet die Simulation, die Gewinnchancen stehen neben dem Knopf. Die Menüs der Seiten können alle Flotten entfernen oder nur die Schiffe zurücksetzen. Standard für die Flotte im Trümmerfeld ist jetzt 40 %.',
        en: 'Battle simulator: Enter starts the simulation, the win chances stand next to the button. The menus of both sides can remove all fleets or only reset the ships. The default share of the fleet in the debris field is now 40 %.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Angreifer und Verteidiger stehen sich auf gleicher Höhe gegenüber. Der Spionagebericht wird über das „⋯“-Menü der Verteidiger eingefügt, beide Menüs können alle Flotten entfernen. Jede Flotte lässt sich über ein × in ihrem Tab entfernen. Solarsatelliten stehen beim Verteidiger nach den Schiffen.',
        en: 'Battle simulator: attackers and defenders face each other at the same height. The spy report is pasted from the "⋯" menu of the defenders, both menus can remove all fleets. Each fleet can be removed with an × in its tab. Solar satellites are listed after the ships on the defender side.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Für Angreifer und Verteidiger steht jetzt die Bilanz in Metall, Kristall, Deuterium und DSE da, mit Verlusten, Beute, Treibstoff und Trümmerfeld. Ein Schalter legt fest, wer das Trümmerfeld bekommt, vorbelegt mit dem Gewinner.',
        en: 'Battle simulator: attacker and defender now show their balance in metal, crystal, deuterium and DSU, with losses, loot, fuel and debris. A switch sets who gets the debris field, the winner by default.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: Angreifer und Verteidiger stehen nebeneinander, das Ergebnis darunter. Mehrere Simulationen lassen sich in Tabs offen halten wie im Flugzeitrechner, und die Anzahl der Kämpfe ist frei einstellbar.',
        en: 'Battle simulator: attackers and defenders side by side, the result below. Several simulations can stay open in tabs like in the flight calculator, and the number of battles can be set freely.',
      },
      {
        kind: 'new',
        de: 'API: Der Kampfsimulator lässt sich mit einem API-Token (Account → API-Tokens) auch aus Skripten und von KI-Agenten nutzen, auf Wunsch mit dem neuesten Spionagebericht eures Ziels.',
        en: 'API: the battle simulator can be used with an API token (Account → API tokens) from scripts and AI agents too, optionally with your newest spy report of the target.',
      },
      {
        kind: 'new',
        de: 'Kampfsimulator: „Schildkuppeln zuerst“ ist eine Einstellung pro Universum (standardmäßig aus), weil nicht jedes Universum diese Regel hat.',
        en: 'Battle simulator: "Shield domes first" is a setting per universe (off by default), as not every universe has this rule.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer und Spionage-Verlauf öffnen den neuen Kampfsimulator mit allen Flotten, Forschungen und dem Spionagebericht. Im Spionage-Verlauf stehen die drei Simulatoren jetzt in einem Menü „Simulieren“. Admins stellen pro Universum ein, wie viel Flotte und Verteidigung ins Trümmerfeld geht.',
        en: 'The raid planner and the spy history open the new battle simulator with all fleets, research and the spy report. In the spy history the three simulators are now in one "Simulate" menu. Admins set per universe how much fleet and defense goes into the debris field.',
      },
      {
        kind: 'new',
        de: 'Neues Tool: Kampfsimulator. Er rechnet jeden Kampf viele Male mit der Kampf-Engine des Spiels, auch mit dem Stun der Ionengeschütze. Er zeigt Gewinnchance, Verluste, Trümmerfeld, Beute, Mondchance und Flugzeiten, mit AKS und eingefügtem Spionagebericht. Die Anteile von Flotte und Verteidigung im Trümmerfeld sind einstellbar.',
        en: "New tool: battle simulator. It runs each battle many times on the game's battle engine, including the stun of ion cannons. It shows win chance, losses, debris, loot, moon chance and flight times, with ACS and a pasted spy report. The fleet and defense shares of the debris field can be set.",
      },
      {
        kind: 'fix',
        de: 'Tools: Auf dem Handy überlappen sich lange Feldnamen mit Info-Knopf nicht mehr. Die Köpfe der Tools zeigen nur noch den Titel.',
        en: 'Tools: on phones long field names with an info button no longer overlap. The tool headers show the title only.',
      },
    ],
  },
  {
    date: '2026-10-25',
    items: [
      {
        kind: 'new',
        de: 'Der Link zum IRak-Rechner startet vom nächsten eigenen Planeten mit Raketensilo und trägt dessen Silo-Stufe und Interplanetarraketen aus dem Imperium ein.',
        en: 'The link to the IPM calculator starts from the nearest own planet with a missile silo and fills in its silo level and interplanetary missiles from the empire page.',
      },
      {
        kind: 'new',
        de: 'Im Spionage-Verlauf, im Aktionsmenü eines Planeten und im Angriffsplaner gibt es einen Link zum IRak-Rechner. Aus dem Spionage-Verlauf sind Verteidigung, Abfangraketen und Panzerung schon eingetragen, bei einem Mond die Abfangraketen des Planeten.',
        en: 'The spy history, the action menu of a planet and the raid planner link to the IPM calculator. From the spy history, defense, interceptors and armour are already filled in, for a moon the interceptors of its planet.',
      },
      {
        kind: 'new',
        de: 'Neues Tool: der IRak-Rechner. Er zeigt, was Interplanetarraketen zerstören (mit Abfangraketen, Primärziel, Waffen und Panzerung wie im Spiel), wie viele Raketen für alles oder das Primärziel nötig sind, Reichweite und Flugzeit. Einen Spionagebericht kannst du direkt einfügen.',
        en: 'New tool: the IPM calculator. It shows what interplanetary missiles destroy (with interceptors, primary target, weapons and armour as in the game), how many missiles clear everything or the primary target, range and flight time. You can paste a spy report straight in.',
      },
      {
        kind: 'new',
        de: 'Flugrechner gibt es jetzt auch auf Deutsch. Flugrechner, Beuterechner und die Tool-Übersicht haben denselben Kopf mit EN/DE-Umschalter und „Link teilen“; die gewählte Sprache gilt für alle Tools, bis zur ersten Wahl ist es Englisch.',
        en: 'The flight calculator is now available in German. Flight calculator, loot calculator and the tools overview share the same header with an EN/DE switch and "Share link"; the chosen language applies to all tools, English until you pick one.',
      },
      {
        kind: 'new',
        de: 'Die Tools-Startseite und die einzelnen Tools (Flugrechner, Beuterechner, IRak-Rechner) verlinken im Footer den Quellcode.',
        en: 'The tools index and the single tools (flight calculator, loot calculator, IPM calculator) link to the source code in the footer.',
      },
      {
        kind: 'new',
        de: 'Unter Neuigkeiten gibt es jetzt einen Link zum Quellcode des Hubs.',
        en: "What's new now has a link to the hub's source code.",
      },
      {
        kind: 'fix',
        de: 'Sicherheit: Passwort-Links für Mitglieder mit Konto erstellen nur noch globale Admins. Wer so ein Link nutzt, wird überall sonst abgemeldet, API-Tokens werden gelöscht.',
        en: 'Security: only global admins can create password links for members with an account. Using such a link logs the account out everywhere else and deletes its API tokens.',
      },
      {
        kind: 'fix',
        de: 'Große eingefügte Seiten werden schneller verarbeitet und brauchen weniger Speicher auf dem Server.',
        en: 'Big pasted pages are processed faster and need less memory on the server.',
      },
      {
        kind: 'fix',
        de: 'Übersicht und Statistik laden deutlich schneller, vor allem in Universen mit langer Statistik-Historie.',
        en: 'Overview and statistics load much faster, above all in universes with a long statistics history.',
      },
      {
        kind: 'new',
        de: 'Admin: Neuer Bereich „System“ mit Datenbankgröße und Wachstum, Speicher, Antwortzeiten und Nutzung des Hubs.',
        en: 'Admin: new "System" section with the hub\'s database size and growth, memory, response times and usage.',
      },
      {
        kind: 'fix',
        de: 'Flugrechner: Auf dem Handy lässt sich die Seite nicht mehr seitlich verschieben.',
        en: 'Flight calculator: the page no longer scrolls sideways on mobile.',
      },
      {
        kind: 'new',
        de: 'Galaxie: Die universe.json lässt sich jetzt auch direkt im Menü neben dem Titel herunterladen.',
        en: 'Galaxy: the universe.json can now also be downloaded right from the menu next to the title.',
      },
      {
        kind: 'fix',
        de: 'Expeditionen: Die Spielerauswahl steht jetzt bei der Verteilung, auf die sie wirkt, und zeigt zuerst deine eigenen Expeditionen. Die Erträge der Allianz zeigen weiterhin alle.',
        en: 'Expeditions: the player choice now sits at the distribution it applies to and starts with your own expeditions. The alliance yields still show everyone.',
      },
      {
        kind: 'new',
        de: 'Nachrichten mit aufgeräumten Filtern, Allianz-Seiten mit einklappbarem Stand je Mitglied, Mitglieder-Auswahl im Imperium und im Deck oben neben dem Titel. „Abrechnung aus Bericht“ öffnet sich als Fenster.',
        en: 'Messages with tidier filters, alliance pages with a collapsible sync state per member, the member select in the empire and the deck next to the title. "Settlement from report" opens as a dialog.',
      },
      {
        kind: 'fix',
        de: 'Statistik: Die grünen/roten Kästchen zeigen jetzt auch bei älteren Kategorien und Seiten rot an, sobald ein neuerer Stand eingefügt wurde.',
        en: 'Statistics: the green/red boxes now also turn red for older categories and pages as soon as a newer update has been pasted.',
      },
      {
        kind: 'new',
        de: 'Kürzere Seiten: Abrechnung mit einklappbaren Bereichen, lange Listen (Raids, Recycling, Expeditionen, Feindspionage) zeigen zuerst die neuesten 20 mit „Alle anzeigen“. Die Aktualitätskarte der Galaxie ist einklappbar und passt aufs Handy.',
        en: 'Shorter pages: settlements with collapsible sections, long lists (raids, recycling, expeditions, hostile spying) show the newest 20 first with "Show all". The galaxy freshness map is collapsible and fits phones.',
      },
      {
        kind: 'new',
        de: 'Kurze Bestätigungen im Raid-Planer (z. B. „Plan angelegt“, „Gespeichert“) und Platzhalter beim Laden statt leerer Seiten.',
        en: 'Short confirmations in the raid planner (e.g. "Plan created", "Saved") and placeholders while loading instead of empty pages.',
      },
      {
        kind: 'new',
        de: 'Admin-Bereich mit einklappbaren Abschnitten. Statistik: Kategorie auf dem Handy als Auswahl. Bauen & Forschen: aufgeräumte Umschalter, Filter auf dem Handy als Auswahl. Spionage-Verlauf mit beschrifteten Feldern.',
        en: 'Admin area with collapsible sections. Statistics: category as a select on phones. Build & research: tidier switches, filters as a select on phones. Spy history with labelled fields.',
      },
      {
        kind: 'new',
        de: 'Neue Einstellung „Aktivität“ im Konto: Du kannst ausblenden, auf welcher Seite du gerade bist. Andere sehen dich dann weiter als online, aber ohne Seite.',
        en: 'New "Activity" setting in your account: you can hide which page you are currently on. Others still see you as online, but without the page.',
      },
      {
        kind: 'fix',
        de: 'Wer aus der letzten Allianz entfernt wird, wird abgemeldet und seine API-Tokens werden gelöscht.',
        en: 'Anyone removed from their last alliance is logged out and their API tokens are deleted.',
      },
      {
        kind: 'new',
        de: 'Handy: Abrechnung, Kampfberichte, Retime-Tabelle und weitere Listen passen jetzt ohne seitliches Scrollen auf den Bildschirm. Lange Bereiche (Forschung und Statusverlauf beim Spieler, Flotten im Imperium, Aktivitäts-Tage) lassen sich einklappen. „Mehr“ in der Leiste unten zeigt, wenn Angriffe oder Raid-Pläne warten.',
        en: 'Phones: settlements, battle reports, the retime table and other lists now fit the screen without scrolling sideways. Long sections (research and status history of a player, fleets in the empire, activity days) can be collapsed. "More" in the bottom bar shows when attacks or raid plans are waiting.',
      },
      {
        kind: 'new',
        de: 'Übersicht: Filter aufgeräumt. Suche und Umschalter Planeten/Spieler bleiben sichtbar, die übrigen Filter sind gruppiert hinter „Filter“ (auf dem Handy als Fenster von unten). Aktive Filter erscheinen als Chips und lassen sich einzeln entfernen oder alle zurücksetzen. Inaktive: alle, ausblenden oder nur Inaktive.',
        en: 'Overview: filters tidied up. Search and the planets/players switch stay visible, the other filters are grouped behind "Filters" (a sheet from the bottom on phones). Active filters show as chips that can be removed one by one or reset. Inactive: all, hide or only inactive.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer neu aufgebaut: Die Übersicht zeigt zuerst deine nächsten Starts, feindliche Angriffe und die aktuellen Pläne als kompakte Liste. Jeder Plan hat eine eigene Seite mit dem nächsten Schritt für dich (z. B. Flotte hinzufügen oder Startzeit mit Countdown), den Flotten aller Mitglieder und einem Menü für alles Weitere. Formulare öffnen sich als Dialog, auf dem Handy von unten.',
        en: 'Raid planner rebuilt: the overview shows your next launches, hostile attacks and the current plans as a compact list first. Every plan has its own page with your next step (e.g. add your fleet, or the launch time with a countdown), the fleets of all members and a menu for everything else. Forms open as dialogs, on phones from the bottom.',
      },
      {
        kind: 'new',
        de: 'Neue, einheitliche Symbole statt Emojis überall im Hub (Glocken, Monde, Pfeile, Warnungen, Schließen-Knöpfe), mit besserer Lesbarkeit für Screenreader. Auf dem Handy ist alles etwas kompakter, Bereiche wie die Phalanx-Liste in der Galaxie lassen sich einklappen und merken sich das.',
        en: 'New, consistent icons instead of emoji throughout the hub (bells, moons, arrows, warnings, close buttons), also readable for screen readers. On phones everything is a bit more compact; sections like the phalanx list in the galaxy view can be collapsed and remember it.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulationen: Mitglieder ohne bekannte Forschung bekommen Waffen, Schild und Panzerung aus der Simulation, statt mit 0 in den Simulator zu gehen.',
        en: 'Battle simulations: members without known research get weapons, shields and armour from the simulation instead of going into the simulator with 0.',
      },
      {
        kind: 'fix',
        de: 'Kampfsimulationen: Forschungen werden richtig übernommen (250 % sind Stufe 15, nicht 25). Bereits übernommene Simulationen bitte neu einfügen. Eine Simulation wird beim Sync und bei Abrechnungen nicht mehr als echter Kampf mit ihrer Zeit gespeichert.',
        en: 'Battle simulations: research is taken over correctly (250 % is level 15, not 25). Please paste simulations taken over before again. A simulation is no longer stored as a real battle with its time when syncing or settling.',
      },
      {
        kind: 'new',
        de: 'Abgebrochene Angriffe kommen aus dem Übersichts-Sync in den Raid-Planer: Fliegt eine Flotte laut Übersicht vor der Ankunft zurück, gilt sie als zurückgerufen. Sind alle Flotten zurückgerufen, wird der Plan abgebrochen und die Reservierung freigegeben.',
        en: 'Recalled attacks reach the raid planner from the overview sync: if the overview shows a fleet flying back before it arrived, it counts as recalled. Once all fleets are recalled, the plan is cancelled and the claim released.',
      },
      {
        kind: 'new',
        de: 'Raid-Pläne lassen sich aus einer geteilten Kampfsimulation updaten: Der Verteidiger landet in den Simulator-Links, auch ohne Spionagebericht. Angreiferflotten werden nur angepasst, wenn sie eindeutig erkannt werden.',
        en: 'Raid plans can be updated from a shared battle simulation: the defender goes into the simulator links, even without a spy report. Attacker fleets are only adjusted when they are clearly recognised.',
      },
      {
        kind: 'fix',
        de: 'Raid-Pläne aus einem laufenden Angriff bleiben aktuell: Kommen später weitere Flotten in den Verband oder verschiebt sich die Ankunft, übernimmt der Plan das automatisch.',
        en: 'Raid plans made from a running attack stay up to date: if more fleets join the ACS later or the arrival moves, the plan picks it up automatically.',
      },
      {
        kind: 'new',
        de: 'Beuteabrechnungen können jetzt von allen Mitgliedern kommentiert werden. Wer in einer Abrechnung mitgeschrieben hat, wird über neue Kommentare benachrichtigt.',
        en: 'All members can now comment on loot settlements. Whoever wrote in a settlement is notified about new comments.',
      },
      {
        kind: 'fix',
        de: 'Online-Liste: Bei mehreren offenen Tabs oder Geräten zeigt der Hub jetzt den Tab, den das Mitglied gerade benutzt. Vorher konnte etwa ein vergessener Raid-Planer-Tab stehen bleiben. Wer 5 Minuten nichts tut, gilt als abwesend (gelber Punkt) und bekommt dann wieder Push- und Discord-Benachrichtigungen.',
        en: 'Online list: with several tabs or devices open, the hub now shows the tab the member is actually using. Before, a forgotten raid planner tab could stay shown. Whoever does nothing for 5 minutes counts as away (yellow dot) and gets push and Discord notifications again.',
      },
      {
        kind: 'new',
        de: 'Beuteabrechnung wie die AKS-Excel: Deut-Kosten (Flüge, Recycler, verlorene Schiffe) werden zuerst mit erbeutetem Deut ersetzt, nur was fehlt (z. B. nur Trümmerfeld) in Metall und Kristall. Übriges Deut ist Gewinn.',
        en: 'Loot settlement like the ACS spreadsheet: deuterium costs (flights, recyclers, lost ships) are paid back with captured deuterium first, only what is missing (e.g. debris only) in metal and crystal. Deuterium left over is profit.',
      },
      {
        kind: 'fix',
        de: 'Beuteabrechnung: Abrechnungen ohne Kosten der Teilnehmer, aber mit hoher Deuterium-Erstattung für Recycler-Helfer, werden wieder richtig berechnet.',
        en: 'Loot settlement: settlements without participant costs but with a large recycler deuterium refund for helpers are calculated correctly again.',
      },
      {
        kind: 'fix',
        de: 'In der Beuteabrechnung eingefügte Kampf- und Recyclingberichte bekommen die Spielzeit; „Aktualisieren“ übernimmt sie außerhalb deutscher Zeit nicht mehr doppelt.',
        en: 'Battle and recycling reports pasted into a loot settlement get the game time; "Update" no longer takes them in twice outside German time.',
      },
      {
        kind: 'fix',
        de: 'Beuterechner: Die vorgeschlagenen Beuteanteile berücksichtigen bereits eingetragene Beute anderer Flotten.',
        en: 'Loot calculator: the suggested loot shares take loot already entered for other fleets into account.',
      },
      {
        kind: 'fix',
        de: 'Flotten, die in der doppelten Stunde der Zeitumstellung (2–3 Uhr) eingefügt wurden, zeigen keine Stunde zu viel Flugzeit mehr.',
        en: 'Fleets pasted in the repeated hour of the clock change (2–3 am) no longer show an hour too much flight time.',
      },
      {
        kind: 'fix',
        de: 'Ankunftszeiten eingefügter Flotten stimmen jetzt auch bei der Zeitumstellung (vorher eine Stunde daneben).',
        en: 'Arrival times of pasted fleets are now right around the daylight saving switch too (before, an hour off).',
      },
    ],
  },
  {
    date: '2026-10-24',
    items: [
      {
        kind: 'fix',
        de: 'Ein als Text eingefügter Kampfbericht wird nicht mehr doppelt gespeichert, wenn derselbe Kampf später über den Link synchronisiert wird.',
        en: 'A battle report pasted as text is no longer saved twice when the same battle is synced from its link later.',
      },
      {
        kind: 'fix',
        de: 'Kampfberichte zeigen jetzt die Beute und die Koordinaten des Ziels und laufen mobil nicht mehr seitlich über. Ein über den Link gespeicherter Bericht wird beim Einfügen des vollständigen Texts um Koordinaten und Beute ergänzt.',
        en: 'Battle reports now show the loot and the target coordinates and no longer overflow sideways on mobile. A report saved from its link gets the coordinates and loot when you paste its full text.',
      },
      {
        kind: 'new',
        de: 'Links zum AKS-Beuterechner sind jetzt etwa viermal kürzer. Alte Links funktionieren weiter.',
        en: 'Links to the ACS loot calculator are now about four times shorter. Old links still work.',
      },
      {
        kind: 'fix',
        de: 'Beute abrechnen: Deut-Kosten (Flüge, Recycler, verlorene Schiffe) werden in Metall und Kristall ersetzt, erbeutetes Deut wird als Gewinn nach Anteil verteilt. Die Beute je Flotte kommt jetzt zuerst aus den Flottenrückkehr-Nachrichten (beim Nachrichten-Sync mit einfügen), sonst aus der Übersicht – dort zählt nur noch der Rückflug dieses Kampfs, nicht mehr ein späterer Raid aufs selbe Ziel –, sonst aus dem Laderaum laut Kampfbericht. Bestehende Abrechnungen mit „Neu aus Hub-Daten“ neu rechnen.',
        en: 'Settle loot: deuterium costs (flights, recyclers, lost ships) are paid back in metal and crystal, captured deuterium is profit and shared by the shares. The loot of each fleet now comes first from the fleet return messages (sync them with the messages), else from the overview – only the flight home of this battle, no longer a later raid on the same target –, else from the cargo space by the battle report. Recompute existing settlements with "Refill from hub data".',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen: „Aktualisieren aus Hub-Daten“ übernimmt, was seitdem synchronisiert wurde (z. B. fehlende Recyclerberichte), ohne die Abrechnung neu anzufangen. Alles Eingetragene und Geänderte bleibt stehen.',
        en: 'Settle loot: "Update from hub data" takes what was synced since (e.g. missing recycling reports) without starting the settlement over. Everything entered or changed stays.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen und AKS-Beuterechner: Beim Recycling steht jetzt, wie groß das Trümmerfeld war, wie viel davon abgebaut wurde und was noch übrig ist. Ist das Feld leer, aber nicht alles von euch abgebaut, zeigt der Hub, wie viel andere geholt haben.',
        en: 'Settle loot and ACS loot calculator: the recycling now shows how big the debris field was, how much of it was recycled and what is left. If the field is empty but you did not recycle all of it, the hub shows how much others took.',
      },
      {
        kind: 'fix',
        de: 'Die Recycling-Tabelle passt jetzt auch auf dem Handy auf den Bildschirm.',
        en: 'The recycling table now fits on phone screens.',
      },
      {
        kind: 'new',
        de: 'Raid Planer, Abrechnungen: „Aus Kampfbericht anlegen“ rechnet auch Kämpfe ohne Plan ab. Kampfbericht einfügen, der Hub legt den Plan mit den Flotten der Mitglieder und ihren Startplaneten an, rechnet das Deut aus und öffnet die Abrechnung. Haben Mitglieder verteidigt, wird es ein Halten. Gibt es schon einen Plan für den Kampf, öffnet sich dieser.',
        en: 'Raid planner, settlements: "Create from battle report" settles battles without a plan too. Paste the battle report, the hub makes the plan with the members\u2019 fleets and their start planets, computes the deuterium and opens the settlement. If members defended, it becomes a hold. If the battle already has a plan, that one opens.',
      },
      {
        kind: 'new',
        de: 'Beute abrechnen: Recyclerberichte lassen sich einfügen, auch mehrere auf einmal, für eine wählbare Person. Recycling-Zeilen lassen sich entfernen.',
        en: 'Settle loot: recycling reports can be pasted, several at once too, for a chosen person. Recycling rows can be removed.',
      },
      {
        kind: 'new',
        de: 'AKS-Beuterechner: Recyclerberichte lassen sich einfügen, auch mehrere auf einmal. Jeder Bericht ergibt eine Recycling-Zeile mit Metall und Kristall für die gewählte Person.',
        en: 'ACS loot calculator: recycling reports can be pasted, several at once too. Each report adds a recycling row with metal and crystal for the chosen person.',
      },
      {
        kind: 'new',
        de: 'Raid Planer: Feindliche Angriffe lassen sich ausblenden, für die ganze Gruppe. Ausgeblendete Angriffe stehen in einem aufklappbaren Abschnitt am Ende der Seite und lassen sich dort wieder einblenden.',
        en: 'Raid planner: hostile attacks can be hidden, for the whole group. Hidden attacks are listed in a collapsible section at the end of the page and can be shown again from there.',
      },
      {
        kind: 'new',
        de: 'Raid Planer: neuer Reiter „Abrechnungen“ mit allen gestarteten und erledigten Angriffen und Halte-Aktionen, ob ein Kampfbericht da ist und wie viele Lieferungen schon erledigt sind. Halten wird jetzt wie ein AKS abgerechnet: Die Verteidiger teilen sich das Trümmerfeld, um ihre Verluste zu decken.',
        en: 'Raid planner: new tab "Settlements" with all launched and done attacks and holds, whether a battle report is there and how many deliveries are done. Holds are now settled like an ACS: the defenders share the debris to cover their losses.',
      },
      {
        kind: 'new',
        de: 'Benachrichtigung bei vollem Lager: Läuft Metall, Kristall oder Deuterium auf einem deiner Planeten voll, meldet das die Glocke, per Push und auf Discord. Der Hub rechnet die Produktion und ankommende Flotten seit deinem letzten Sync hoch. Monde zählen nicht, sie haben keine Produktion. Unter Konto lässt sich das für Push und Discord abschalten.',
        en: 'Full storage notifications: when metal, crystal or deuterium storage on one of your planets runs full, the bell, push and Discord tell you. The hub projects the production and arriving fleets since your last sync. Moons do not count, they have no production. Under Account it can be switched off for push and Discord.',
      },
      {
        kind: 'new',
        de: 'Kampfberichte lassen sich als Text synchronisieren: Kampfbericht im Spiel öffnen, alles kopieren und einfügen. Die Beute-Abrechnung übernimmt daraus Schiffe, Verluste und Beute; auf der Abrechnungsseite kann ein Kampfbericht auch direkt eingefügt werden.',
        en: 'Battle reports can be synced as text: open the battle report in the game, copy everything and paste it. The loot settlement takes ships, losses and loot from it; on the settlement page a battle report can also be pasted directly.',
      },
      {
        kind: 'new',
        de: 'Raid Planer: „Beute abrechnen“ bei gestarteten und erledigten Angriffen. Der Hub füllt Teilnehmer, Verluste, Beute, Recycling und Deut aus Kampfbericht, Flotten und Recyclingberichten selbst aus. Alle sehen, wer was bekommt und wer wem was schickt, und haken ihre Lieferungen ab. Helfer, die nur recycelt haben, behalten bis zu 20 % ihres Recyclings; ihr Deut kann auf Wunsch zusätzlich erstattet werden.',
        en: 'Raid planner: "Settle loot" on launched and done attacks. The hub fills in participants, losses, loot, recycling and deuterium from the battle report, fleets and recycling reports. Everyone sees who gets what and who sends what to whom, and ticks off their deliveries. Helpers who only recycled keep up to 20 % of what they recycled; their deuterium can be refunded on top if you like.',
      },
      {
        kind: 'new',
        de: 'Neues Tool bei den pr0game-Tools: der AKS-Beuterechner. Er ersetzt allen Teilnehmern eines AKS die verlorenen Schiffe, das Deuterium und die Raketen, teilt den Rest gleichmäßig oder nach eingesetzter Flotte auf und schlägt vor, wer wem was schickt – mit möglichst wenigen Flügen. Einfach den Kampfbericht einfügen, Recycler und Helfer ergänzen, fertig.',
        en: 'New in the pr0game tools: the ACS loot calculator. It pays every ACS participant back for lost ships, deuterium and missiles, splits the rest equally or by the fleet sent and suggests who sends what to whom, with as few flights as possible. Paste the battle report, add recyclers and helpers, done.',
      },
      {
        kind: 'new',
        de: 'Flotten-Benachrichtigung: Im Imperium hat jede deiner Flotten im Flug eine Glocke. Damit wirst du bei der Ankunft benachrichtigt – oder 1 bis 10 Minuten vorher, z. B. vor dem Einschlag eines Angriffs. So weißt du, wann deine Recycler zurück sind. Wird die Flotte zurückgerufen, entfällt die Benachrichtigung. Push und Discord lassen sich unter Konto dafür an- und abschalten.',
        en: 'Fleet notifications: in the Imperium each of your fleets in flight has a bell. It notifies you on arrival, or 1 to 10 minutes before, e.g. before an attack hits. That way you know when your recyclers are back. If the fleet is recalled, the notification is dropped. Push and Discord can be switched on and off for it under Account.',
      },
      {
        kind: 'new',
        de: 'Synchronisieren für andere: Beim Synchronisieren kannst du unter „Für“ ein Mitglied wählen, z. B. wenn es dir einen Recycling-Bericht geschickt hat. Die Daten zählen dann für dieses Mitglied. Ohne Auswahl synchronisierst du wie bisher für dich selbst.',
        en: 'Sync for others: when syncing you can pick a member under "For", e.g. when they sent you a recycling report. The data then counts for that member. Without a choice you sync for yourself as before.',
      },
      {
        kind: 'new',
        de: 'Raid Planer: Deine laufenden Angriffe und Verbände aus der Übersicht stehen oben, solange es keinen Plan dafür gibt. Nur du und die Teilnehmer des Verbands sehen sie. Mit „Planen“ wird daraus ein Plan mit den fliegenden Schiffen, den alle sehen. Flotten von Spielern ohne Hub-Konto kommen als Gastflotten mit in die Kampfsimulatoren.',
        en: 'Raid planner: your attacks and ACS attacks in flight from the overview are listed at the top as long as there is no plan for them. Only you and the participants of the ACS see them. "Plan" turns one into a plan with the ships flying that everyone sees. Fleets of players without a hub account go into the combat simulators as guest fleets.',
      },
      {
        kind: 'fix',
        de: 'Forschung: Kosten und Forschungszeiten stimmen mit einer echten Forschungs-Seite überein. Forschungen, die das Spiel mit „nutzlose ausblenden“ weglässt, behalten ihre richtige Stufe.',
        en: 'Research: costs and research times match a real research page. Research the game leaves out with "hide useless" keeps its correct level.',
      },
      {
        kind: 'new',
        de: '„Gebäude“ heißt jetzt „Bauen & Forschen“ und hat einen zweiten Tab für Forschungen: wie im Spiel siehst du pro Planet Stufe, Voraussetzungen, Kosten, fehlende Rohstoffe, wann es losgehen kann und die Forschungszeit mit Labor, Forschungsnetzwerk und TechnoDome. Auch hier gibt es die Glocke für eine Benachrichtigung. Die Forschungs-Seite aus dem Spiel kannst du jetzt ebenfalls synchronisieren. Im Menü steht der Punkt jetzt nach Statistik und Mein Imperium.',
        en: 'Buildings is now called Build & Research and has a second tab for research: like in the game you see per planet the level, requirements, costs, missing resources, when it can start and the research time with lab, research network and TechnoDome. The bell for a notification works here too. You can now also sync the research page from the game. In the menu it now comes after Statistics and My Empire.',
      },
      {
        kind: 'fix',
        de: 'Gebäude-Seite: Kosten und Bauzeiten stimmen jetzt aufs Ressourcen-Stück und auf die Sekunde mit dem Spiel überein. Der Aufhol-Bonus wird genau statt gerundet verwendet und nach einer neuen Statistik wie im Spiel neu berechnet.',
        en: 'Buildings page: costs and build times now match the game to the unit and the second. The catch-up bonus is used exactly instead of rounded and recalculated like in the game after a new statistics update.',
      },
      {
        kind: 'new',
        de: 'Gebäude-Seite: Ausgeblendete Gebäude werden jetzt in deinem Hub-Konto gespeichert und gelten auf allen Geräten. Forschungslabor, TechnoDome, Nanitenfabrik und Raumschiffwerft werden wie im Spiel als beschäftigt angezeigt, solange Forschung oder Werft laufen. Die Bauzeit berücksichtigt Roboter- und Nanitenfabrik, die noch in der Bauschleife sind.',
        en: 'Buildings page: hidden buildings are now kept in your hub account and apply on all devices. Research lab, TechnoDome, nanite factory and shipyard show as busy while research or the shipyard run, like in the game. Build times take robot and nanite factories still in the build queue into account.',
      },
      {
        kind: 'new',
        de: 'Gebäude-Seite: Gebäude, die dich nicht interessieren, kannst du ausblenden und jederzeit wieder einblenden. Dazu gibt es einen Namensfilter.',
        en: "Buildings page: hide buildings you don't care about and show them again any time. There is also a name filter.",
      },
      {
        kind: 'new',
        de: 'Neue Seite „Gebäude“: Für jeden deiner Planeten und Monde siehst du wie im Spiel Stufe, Voraussetzungen und Kosten der nächsten Stufe, dazu wie viele Rohstoffe fehlen und wann sie da sind – mit Produktion und Rohstoffen von Flotten, die noch ankommen. Mit der Glocke wirst du benachrichtigt (Hub, Push, Discord), sobald die nächste Stufe baubar ist. Grundlage ist dein Imperium oder die Gebäude-Seite aus dem Spiel, die du jetzt auch synchronisieren kannst.',
        en: "New \"Buildings\" page: for each of your planets and moons you see the level, requirements and cost of the next level like in the game, plus how many resources are missing and when they are there, counting production and resources of fleets still on their way. The bell notifies you (hub, push, Discord) as soon as the next level can be built. It uses your empire page or the game's buildings page, which you can now sync too.",
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Fliegt eine Flotte laut Übersicht mit anderen Schiffen als geplant, zeigt der Plan sie an und übernimmt sie per Knopfdruck.',
        en: 'Raid planner: if the overview shows a fleet flying with other ships than planned, the plan shows them and takes them over at the press of a button.',
      },
      {
        kind: 'fix',
        de: 'Raid-Planer: Eine Verbandsflotte aus der Übersicht eines anderen Teilnehmers wird nur dem Mitglied zugeordnet, dem der Startplanet gehört.',
        en: "Raid planner: an ACS fleet from another participant's overview is only matched to the member who owns its starting planet.",
      },
      {
        kind: 'fix',
        de: 'Raid-Planer: Fliegt ein Verband, erkennt der Hub alle Plan-Flotten darin, sobald ein Teilnehmer seine Übersicht synchronisiert. Die Rückkehrzeit gestarteter Flotten stimmt jetzt, und statt der Startzeit steht bei ihnen klar die Ankunft.',
        en: 'Raid planner: once an ACS is flying, the hub recognizes all plan fleets in it as soon as one participant syncs their overview. The return time of launched fleets is right now, and they clearly show their arrival instead of a launch time.',
      },
      {
        kind: 'fix',
        de: 'Raid-Planer: Feindliche Angriffe bleiben nach dem Einschlag in der Liste, bis die Flotte spätestens zu Hause sein kann. So lässt sich ein Retime auch noch planen, wenn die Übersicht danach neu synchronisiert wurde.',
        en: 'Raid planner: hostile attacks stay in the list after the impact, until the fleet can be home at the latest. So a retime can still be planned after the overview was synced again.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Halten-Pläne zeigen die Flotte auf dem angegriffenen Planeten. Sie ist aus dem Imperium vorausgefüllt und lässt sich ändern, etwa wenn Schiffe vor dem Einschlag weggeschickt werden. Die Kampfsimulatoren rechnen damit.',
        en: 'Raid planner: hold plans show the fleet on the attacked planet. It is filled in from the empire page and can be changed, e.g. when ships are sent away before the impact. The combat simulators use it.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Auch Halten-Pläne haben jetzt Links zum Kampfsimulator und zu TrashSim. Die feindlichen Flotten greifen an, euer Planet und die eingetragenen Flotten verteidigen.',
        en: 'Raid planner: hold plans now have links to the combat simulator and TrashSim too. The enemy fleets attack, your planet and the planned fleets defend.',
      },
      {
        kind: 'fix',
        de: 'Flottenbewegungen: Recycler, die zu einem Mond zurückkehren, werden dem Mond zugeordnet statt einem Planeten.',
        en: 'Fleet movements: recyclers returning to a moon are now assigned to the moon instead of a planet.',
      },
      {
        kind: 'fix',
        de: 'Retime-Planer: Werden die Einstellungen des Universums (Entfernungen, Flottengeschwindigkeit) korrigiert, rechnen offene Retime-Pläne ihre Zielzeit automatisch neu.',
        en: 'Retime planner: when the universe settings (distances, fleet speed) are corrected, open retime plans recalculate their target time automatically.',
      },
      {
        kind: 'fix',
        de: 'Retime-Planer: Die Startzeiten passen wieder zur angezeigten Zielzeit. Verzögert der Gegner, wandert die Zielzeit mit, und weicht der Plan einmal ab, weist das Retime-Feld darauf hin und Speichern übernimmt die richtige Zeit.',
        en: 'Retime planner: launch times match the shown target time again. If the enemy delays, the target time moves along, and if the plan ever differs, the retime box points it out and saving applies the right time.',
      },
      {
        kind: 'fix',
        de: 'Kontoeinstellungen auf dem Handy: Die Seite passt wieder auf den Bildschirm, die untere Leiste bleibt an ihrem Platz.',
        en: 'Account settings on your phone: the page fits the screen again and the bottom bar stays in place.',
      },
    ],
  },
  {
    date: '2026-10-23',
    items: [
      {
        kind: 'new',
        de: 'Discord-Benachrichtigungen: Unter Konto kannst du einen eigenen Discord-Webhook eintragen und wählen, was dort ankommt. Allianz-Admins können zusätzlich einen Allianz-Kanal einrichten, der Angriffe auf Mitglieder, neue Raid-Pläne und Starttermine meldet und Betroffene erwähnt.',
        en: 'Discord notifications: under Account you can add your own Discord webhook and choose what arrives there. Alliance admins can also set up an alliance channel that reports attacks on members, new raid plans and launch times and mentions those affected.',
      },
      {
        kind: 'new',
        de: 'Push-Benachrichtigungen: Der Hub meldet Angriffe, Einladungen, neue Kommentare und deine Starttermine auch, wenn er nicht offen ist – am PC und auf dem Handy. Einschalten und auswählen, was gemeldet wird, unter Konto.',
        en: 'Push notifications: the hub tells you about attacks, invitations, new comments and your launch times even when it is not open, on your computer and your phone. Switch it on and choose what to get under Account.',
      },
      {
        kind: 'new',
        de: 'Glocke: zeigt jetzt auch neue Kommentare in Threads, in denen du geschrieben hast, und erinnert eine Stunde vorher an den Start deiner Flotten im Raid-Planer.',
        en: 'Bell: now also shows new comments in threads you wrote in, and reminds you an hour ahead of launching your fleets in the raid planner.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Antriebe lassen sich pro Flotte von Hand eintragen. Ohne Imperium-Seite kommen Planeten, Schiffe und Antriebe eines Mitglieds jetzt aus den Spionageberichten. Einladen kann jetzt jeder, die Glocke zeigt, wer eingeladen hat.',
        en: 'Raid planner: drives can be entered per fleet by hand. Without an empire page, a member\'s planets, ships and drives now come from the spy reports. Anyone can now invite, and the bell shows who sent the invitation.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Wer eine Flotte im Plan hat, kann jetzt auch die Flotten der anderen eintragen und ändern, etwa für Mitglieder, die gerade nicht da sind oder kein Konto haben. Ohne Imperium-Seite lässt sich der Startplanet von Hand eingeben.',
        en: "Raid planner: anyone with a fleet in a plan can now enter and change the other fleets too, e.g. for members who are away or have no account. Without an empire page the start planet can be typed in.",
      },
      {
        kind: 'new',
        de: 'Schönere Datums- und Zeitfelder am Desktop, im Format des Hubs statt des Browsers (z. B. 23.10.2026 statt 10/23/2026). Unter Konto lässt sich das Datumsformat wählen; am Handy bleiben die gewohnten Felder des Geräts.',
        en: "Nicer date and time fields on desktop, in the hub's format instead of the browser's (e.g. 23/10/2026 instead of 10/23/2026). The date format can be chosen under Account; on mobile the device's usual fields stay.",
      },
      {
        kind: 'new',
        de: 'Einladungen im Raid-Planer erscheinen jetzt in der Glocke (blau, weniger dringend als Angriffe). Ein Klick öffnet den Plan.',
        en: 'Raid planner invitations now show up in the bell (blue, less urgent than attacks). A click opens the plan.',
      },
      {
        kind: 'fix',
        de: 'Phalanx: Kopierte Phalanx-Ergebnisse werden jetzt richtig gelesen. Im normalen Sync werden sie nicht mehr als eigene Flotten gespeichert, sondern mit Hinweis auf „Phalanx einfügen“ im Raid-Planer abgewiesen.',
        en: 'Phalanx: copied phalanx results are now read correctly. The normal sync no longer stores them as your own fleets but points to "Paste phalanx" in the raid planner.',
      },
      {
        kind: 'new',
        de: 'Unter Konto kannst du persönliche API-Tokens anlegen (nur Lesen) mit denselben Allianz-Daten wie in der Oberfläche. OpenAPI-Beschreibung unter /hub/api/openapi.json.',
        en: 'Under Account you can create personal read-only API tokens with the same alliance data as the web app. OpenAPI description at /hub/api/openapi.json.',
      },
      {
        kind: 'new',
        de: 'Allianz-Admins können für Mitglieder mit Konto einen Passwort-Link erzeugen (in der Mitglieder-Tabelle). Damit lässt sich ein neues Passwort setzen, wenn das alte vergessen ist.',
        en: 'Alliance admins can create a password link for members who already have an account (in the members table). It lets them set a new password when the old one was forgotten.',
      },
      {
        kind: 'new',
        de: 'Unter Konto kannst du den Online-Status abschalten: Du erscheinst dann für andere als offline.',
        en: 'Under Account you can turn off your online status: you then appear offline to others.',
      },
      {
        kind: 'fix',
        de: 'Administration: Claim-Links nur noch in der Mitglieder-Tabelle (beim Anlegen automatisch). Allgemeine Einladungslinks entfallen. Globale Admins heißen „Admin“; die Allianz-Rolle wählst du nur zwischen Mitglied und Allianz-Admin.',
        en: 'Administration: claim links only in the members table (created when you add someone). Generic invite links are gone. Global admins show as "Admin"; alliance role is member or alliance admin only.',
      },
      {
        kind: 'new',
        de: 'Allianz-Admins können Mitglieder per Ingame-Namen anlegen, auch ohne Hub-Konto. Ein Claim-Link lässt sie sich später registrieren oder ein bestehendes Konto übernimmt den Eintrag.',
        en: 'Alliance admins can add members by in-game name even without a hub account. A claim link lets them register later, or an existing account can take over the entry.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Pläne lassen sich einklappen (mit Kurzzeile: Zielzeit, Flotten, dein Start), Erklärungen stehen jetzt hinter i-Symbolen, und auf dem Handy ist ein Plan aufgeräumter (Startzeit gleich unter dem Mitglied).',
        en: 'Raid planner: plans can be collapsed (with a summary: target time, fleets, your launch), explanations sit behind info icons, and a plan is tidier on the phone (launch right below the member).',
      },
      {
        kind: 'new',
        de: 'Rollen: Allianz-Admins heißen jetzt auch so. In der Online-Liste erscheinen globale Admins hellblau und Allianz-Admins grün. Sync-Historie, Spieler zusammenführen und Aktivitätslog nachfüllen gibt es nur noch für globale Admins; Allianz-Admins verwalten ihre Allianz, Mitglieder und Einladungen.',
        en: 'Roles: alliance admins are now called that. In the online list global admins show in light blue and alliance admins in green. Sync history, merging players and backfilling the activity log are left to global admins; alliance admins manage their alliance, members and invites.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Neben „Retime planen“ gibt es bei feindlichen Angriffen „Halten planen“. Die Halteflotten landen standardmäßig 1 Sekunde vor dem Einschlag, jede für sich, und die Zeit folgt einer Verzögerung des Gegners.',
        en: 'Raid planner: next to "Plan retime", hostile attacks now offer "Plan hold". Hold fleets land 1 second before the impact by default, each on its own, and the time follows a delay of the enemy.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: „Phalanx einfügen“ übernimmt die Angriffe aus einem Phalanx-Ergebnis in die Liste der feindlichen Angriffe, darauf lassen sich Retime oder Halten planen. Zeigt die Phalanx die Rückkehr (der gescannte Spieler greift selbst an), gilt sie direkt.',
        en: 'Raid planner: "Paste phalanx" takes the attacks of a phalanx result into the list of hostile attacks, to plan a retime or a hold on them. If the phalanx shows the return (the scanned player attacks), it counts directly.',
      },
      {
        kind: 'new',
        de: 'Menü: Beim Raid-Planer steht, wie viele Pläne gerade in Planung (grau) und gestartet (grün) sind.',
        en: 'Menu: the raid planner shows how many plans are being planned (grey) and launched (green).',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Sind die Koordinaten eines Plans noch offen, können Ersteller und alle Teilnehmer (auch eingeladene) sie mit einem Klick auf „Koordinaten noch offen“ eintragen.',
        en: 'Raid planner: when a plan\'s coordinates are still open, the creator and every participant (also invited ones) can fill them in with a click on "Coordinates not known yet".',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Auch TrashSim bekommt jetzt alle Flotten des Plans mit (mit Forschung, Start und Geschwindigkeit).',
        en: 'Raid planner: TrashSim now also gets all fleets of the plan (with research, start and speed).',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Der Simulator im Spiel bekommt jetzt auch alle Flotten des Plans mit (je Flotte ein Slot, mit Waffen, Schild und Panzerung).',
        en: 'Raid planner: the simulator in the game now also gets all fleets of the plan (one slot per fleet, with weapons, shields and armour).',
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Links zum Simulator im Spiel und zu TrashSim mit dem neuesten Spionagebericht des Ziels. Auch der Spionage-Verlauf verlinkt jetzt TrashSim.',
        en: "Raid planner: links to the simulator in the game and to TrashSim with the target's newest spy report. The spy history now links TrashSim too.",
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Taucht deine Flotte in deiner eingefügten Übersicht auf dem Weg zum Ziel auf, gilt sie als gestartet, und die Tabelle zeigt ihre echte Ankunft im Vergleich zur Zielzeit.',
        en: 'Raid planner: once your pasted overview shows your fleet on its way to the target, it counts as launched, and the table shows its real arrival against the target time.',
      },
      {
        kind: 'new',
        de: 'Retime: Verschwindet ein Angriff vor dem Einschlag aus der Übersicht des Angegriffenen, schlägt der Hub das Zeitfenster als Rückruf vor (ein Klick übernimmt es).',
        en: "Retime: when an attack vanishes from the attacked member's overview before the impact, the hub suggests that time window as a recall (one click takes it over).",
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Flotten und das Retime-Panel öffnen sich mit allen Werten im Flugzeitrechner.',
        en: 'Raid planner: fleets and the retime panel open in the flight calculator with all their values.',
      },
      {
        kind: 'new',
        de: 'Retime: Der Puffer nach der Rückkehr des Gegners steht standardmäßig auf 1 Sekunde, und der Hub zeigt, wie gut der Retime ist (bis 1 s gut, 2–3 s schlecht, ab 4 s sehr schlecht).',
        en: "Retime: the buffer after the enemy's return defaults to 1 second, and the hub shows how good the retime is (up to 1 s good, 2-3 s poor, from 4 s very poor).",
      },
      {
        kind: 'new',
        de: 'Raid-Planer: Die Geschwindigkeit einer Flotte lässt sich direkt in der Tabelle umstellen, ohne „Bearbeiten“.',
        en: 'Raid planner: the speed of a fleet can be changed right in the table, without "Edit".',
      },
      {
        kind: 'fix',
        de: 'Flotten: Bei feindlichen Angriffen steht jetzt der Spieler dabei (aus der Galaxie, das Spiel nennt ihn nicht), ein Verbandsangriff ist in der Flottenliste eine aufklappbare Zeile mit allen Schiffen, Schiffszahlen stehen voll aus. Uhrzeiten überall im 24-Stunden-Format.',
        en: 'Fleets: hostile attacks now show the player (from the galaxy data, the game names none), an ACS attack is one row in the fleet list that opens to its fleets, with all ships, and ship amounts are shown in full. Times everywhere in 24 hours.',
      },
      {
        kind: 'new',
        de: 'Allianz: Unter den Flottenbewegungen gibt es jetzt ebenfalls den aufklappbaren Verlauf der letzten 12 Stunden. In den Kontoeinstellungen lässt sich unter „Flottenbewegungen teilen“ abschalten, dass die anderen deine Historie sehen.',
        en: 'Alliance: the fleet movements now also have the collapsible history of the last 12 hours. Under "Share fleet movements" in the account settings you can stop the others from seeing your history.',
      },
      {
        kind: 'new',
        de: 'Raid-Planer – Retime: Feindliche Angriffe auf Mitglieder stehen oben im Raid-Planer. „Retime planen“ legt einen Plan auf den Herkunftsplaneten an; für jede Geschwindigkeit zeigt der Hub, wann die Gegnerflotte wieder zu Hause ist. Abflug- und Rückrufzeitraum, Antriebe und Puffer grenzen das ein, alle Teilnehmer können sie ändern. Die gewählte Rückkehr plus Puffer wird die Zielzeit, die Startzeiten folgen.',
        en: 'Raid planner – retime: hostile attacks on members are listed on top of the raid planner. "Plan retime" creates a plan on the origin; for every speed the hub shows when the enemy fleet is back home. Departure and recall window, drives and buffer narrow it down, every participant can change them. The chosen return plus the buffer becomes the target time, and the launch times follow.',
      },
      {
        kind: 'new',
        de: 'Imperium: Unter den Flottenbewegungen gibt es einen aufklappbaren Verlauf mit den Flotten der letzten 12 Stunden, die schon angekommen sind.',
        en: 'Empire: below the fleet movements there is a collapsible history of the fleets that arrived in the last 12 hours.',
      },
      {
        kind: 'fix',
        de: 'Imperium und Allianz: Die Seiten wurden jede Sekunde komplett neu aufgebaut, wodurch offene Auswahllisten, Tooltips und markierter Text flackerten oder verschwanden. Jetzt laufen nur noch die Ressourcen und Countdowns selbst weiter.',
        en: 'Empire and alliance: the pages were rebuilt completely every second, so open drop-downs, tooltips and selected text flickered or got lost. Now only the resources and countdowns themselves keep ticking.',
      },
      {
        kind: 'new',
        de: 'Admin: Allianzen lassen sich umbenennen, Mitglieder- und Synchronisationsliste sind sortierbar und auf dem Handy besser lesbar. Niemand kann sich selbst oder den Hub-Inhaber aus einer Allianz entfernen.',
        en: 'Admin: alliances can be renamed, the member and sync lists are sortable and easier to read on phones. Nobody can remove themselves or the hub owner from an alliance.',
      },
      {
        kind: 'fix',
        de: 'Raid-Planer: In den Auswahllisten sprang die Markierung jede Sekunde nach oben, solange die Liste offen war.',
        en: 'Raid planner: in the drop-down lists the highlight jumped back to the top every second while the list was open.',
      },
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

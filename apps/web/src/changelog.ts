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
    date: '2026-10-24',
    items: [
      {
        kind: 'new',
        de: 'Kampfberichte lassen sich als Text synchronisieren: Kampfbericht im Spiel öffnen, alles kopieren und einfügen. Die Beute-Abrechnung übernimmt daraus Schiffe, Verluste und Beute; auf der Abrechnungsseite kann ein Kampfbericht auch direkt eingefügt werden.',
        en: 'Battle reports can be synced as text: open the battle report in the game, copy everything and paste it. The loot settlement takes ships, losses and loot from it; on the settlement page a battle report can also be pasted directly.',
      },
      {
        kind: 'new',
        de: 'Raid Planer: „Beute abrechnen“ bei gestarteten und erledigten Angriffen. Der Hub füllt Teilnehmer, Verluste, Beute, Recycling und Deut aus Kampfbericht, Flotten und Recyclingberichten selbst aus. Alle sehen, wer was bekommt und wer wem was schickt, und haken ihre Lieferungen ab. Helfer, die nur recycelt haben, behalten bis zu 20 % ihres Recyclings.',
        en: 'Raid planner: "Settle loot" on launched and done attacks. The hub fills in participants, losses, loot, recycling and deuterium from the battle report, fleets and recycling reports. Everyone sees who gets what and who sends what to whom, and ticks off their deliveries. Helpers who only recycled keep up to 20 % of what they recycled.',
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

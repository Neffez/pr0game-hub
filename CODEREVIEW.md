# Code-Review: Commits seit `36ef37a3`

Umfang: 24 Commits (`4c153b3` … `d45063b`), 73 Dateien, +3117 / −354. Gelesen wurde der komplette Diff ohne
Fixtures, Locales und Changelogs; Verdachtsfälle habe ich im aktuellen Quellcode nachgeprüft. Tests habe ich nicht
laufen lassen.

Schweregrade: **Hoch** = falsches Verhalten im Normalbetrieb · **Mittel** = falsches Verhalten in realistischen
Randfällen · **Niedrig** = Wartbarkeit, Performance, Projektregeln.

---

## Hoch

### 1. „Aktualisieren“ in der Beuteabrechnung markiert die Abrechnung immer als geändert
`apps/web/src/views/LootSettlementView.vue:141` (Commit `a4372ed`)

`update()` setzt jetzt immer `state.value = merged`, auch wenn `mergeDraft` nichts übernommen hat. Weil
`merged` eine tiefe Kopie ist, feuert der Deep-Watcher (`:93`) und setzt `dirty = true`, `filling` ist dabei
nicht gesetzt.

Szenario: Eine gespeicherte Abrechnung öffnen, „Aktualisieren“ klicken, es gibt nichts Neues. Die Meldung lautet
„aktuell“, trotzdem:
- ist „Speichern“ aktiv, und die Zeile „gespeichert von …“ verschwindet,
- können Transfers nicht mehr abgehakt werden (`mayTick` verlangt `!dirty`),
- greift kein Live-Reload mehr (`load()` bricht bei `dirty` ab).

Fix: nur zuweisen, wenn sich etwas geändert hat (`parts.length || refRates geändert`), oder die Zuweisung mit
`filling = true` kapseln wie in `fill()`.

### 2. Galaxie-Markierungen trotz vorheriger Spionage: Ursachen
`apps/server/src/repo/activity.ts` (`galaxyMark`, `galaxySyncedAt`, `galaxyMarkCausedByForeignAction`),
`apps/web/src/activity.ts`

Die Regel „eine Spionage oder ein Kampf in der Stunde vor dem Sync erklärt die Markierung“ ist gewollt und kein
Bug. Untersucht wurde, warum trotzdem Markierungen erscheinen. Die Fälle a und b sind mit einem temporären Test
nachgestellt (gegen den aktuellen Code, danach wieder gelöscht). Zum Vergleich: Bericht vor dem Sync, Bericht erst
nach der Galaxie gepastet, Spionage auf dem Mond und zweiter Sync in derselben Stunde werden korrekt verworfen.

**a) Die Galaxie-Ansicht verwendet die Paste-Zeit statt der Serverzeit (Ursache bestätigt).**
Spionage- und Kampfberichte tragen die Spielzeit aus der Nachricht. Der Zeitpunkt der Galaxie-Ansicht (`seenAt`) ist
dagegen die Uhr des Hub-Servers beim Einfügen (`store.ts` `galaxy()`: `r.seenAt ?? now()`; beim Reparse und im
Backfill `raw_ingests.created_at`). Die Serverzeit der Seite wird nicht ausgelesen, obwohl die Galaxie sie zeigt:
- Kopie als Text: Kopfzeile `Serverzeit : Okt Do 22 17:33:10` (steht in `test/fixtures/galaxy.txt`),
- Seitenquelltext: `serverTimeDelta = new Date(…)` im Script, wie bei Übersicht, Gebäuden und Imperium.

`parseGalaxyHtml`/`parseGalaxyText` setzen kein `pageTime`, und `GalaxyRecord` hat dafür kein Feld. Die passenden
Helfer gibt es schon: `pageTime($)` (`parsers/empire.ts`) und `parseServerClock(text)` (`parsers/overview.ts`),
die Fleets- und Overview-Parser nutzen sie.

Folgen:
- *Später gepastete Galaxie:* Jemand kopiert die Ansicht um 12:00 und pastet um 12:30. Dann gelten 12:30 als
  Zeitpunkt, und auch alle Markierungszeiten (`seenAt − minutes·60`) verschieben sich um 30 min. Das Fenster
  „Spionage in der Stunde vor dem Sync“ reicht nur noch bis 11:30 zurück, eine Spionage um 11:20 wird nicht mehr als
  Ursache erkannt. Die Markierung bleibt stehen und liegt zudem zur falschen Uhrzeit in der Kurve.
- *Uhrabweichung Spiel ↔ Hub:* Der Bericht muss `<= sync + 60` sein. Spioniert man und pastet die Galaxie sofort,
  liegen nur Sekunden dazwischen. Geht die Spieluhr mehr als etwa eine Minute vor, liegt der Bericht scheinbar
  *nach* dem Sync. Im Test: Bericht 90 s nach `seenAt`, die Markierung wird gespeichert und angezeigt.
- Eine falsche Zeitzone in den Universums-Settings verschiebt alles um ganze Stunden.

Ein später gesyncter *Bericht* ist dagegen kein Problem: Er hat die Spielzeit der Nachricht und wird beim Anzeigen
nachträglich gegen die gespeicherten Markierungen geprüft (im Test: Bericht nach der Galaxie gepastet → verworfen).

Fix:
1. `GalaxyRecord.pageTime` ergänzen. HTML: `pageTime($) ?? parseServerClock($.root().text())`, denn eine
   Zwischenablage-Kopie hat kein Script, aber die Kopfzeile. Text: `parseServerClock(text)`.
2. `Store.galaxy`: `seenAt = epoch(pageTime) ?? r.seenAt ?? now()`, wie schon bei `marketplace()`. Mit
   Plausibilitätsgrenze gegen die Paste-Zeit, etwa höchstens einen Tag davor und wenige Minuten danach. Die Reihenfolge
   ist wichtig, weil `reparse` `seenAt` mit `created_at` vorbelegt.
3. `backfillActivity` (`ingest.ts`) ebenso: die Serverzeit der Seite statt `raw.created_at`.
4. Danach liegen Bericht und Ansicht beide in Spielzeit. Dann reichen 60 s nach oben, und das Fenster nach unten
   stimmt auch bei spät gepasteten Ansichten. Nur ohne Serverzeit (alte Raws, Ausschnitt ohne Kopfzeile) bleibt
   der Fallback auf die Paste-Zeit, dann mit größerer Toleranz.

**b) Lesen und Schreiben prüfen unterschiedliche Fenster (bestätigt, wirkt in die andere Richtung).**
`galaxySyncedAt` nimmt bei jeder Markierung ab „(7 min)“ statt `created_at` (Sync-Zeit) die geschätzte
Aktivitätszeit, denn `created_at > seen + 300` gilt immer, sobald `minutes·60 − 60 > 300`. Gedacht ist das nur für
spät nachgefüllte Zeilen. Beim Lesen läuft das Fenster deshalb von der Aktivitätszeit eine Stunde zurück statt vom
Sync. Im Test: Spionage 70 min vor dem Sync, Sync zeigt „(30 min)“. Beim Speichern wird die Markierung behalten,
beim Lesen aber verworfen. Nach deiner Regel wäre sie genuin, denn die Spionage liegt vor der Aktivität. Auch
`syncedAt` im API-Ergebnis, die Gruppierung pro Sync-Stunde und der Offline-Filter rechnen dann mit der falschen Zeit.
Fix: Die Fallback-Bedingung muss erkennen, ob `created_at` wirklich eine Nachfüllzeit ist. Am einfachsten speichert
man die Sync-Zeit immer explizit (`syncedAt` wird bei jedem Aufruf mitgegeben, auch im Backfill) und lässt den
Fallback weg oder beschränkt ihn auf Zeilen ohne `galaxy:`-Key im neuen Format.

**c) Fremdaktionen, die der Hub nicht kennt (Datenlücke, wahrscheinlich die Hauptursache).** Geprüft wird nur gegen
*gepastete* Spionage- und Kampfberichte. Markierungen erscheinen weiter, wenn
- ein Mitglied spioniert oder angreift, den Bericht aber nicht synct,
- eine andere Allianz oder ein Dritter spioniert,
- eigene Flotten mit anderer Mission ankommen (Transport, Halten, Verbandsverteidigung, Raketenangriff).

Verbesserung: Die eigenen Flotten der Mitglieder aus `fleet_snapshots` (Phase `out`, Ziel = Koordinate, Ankunft im
Fenster vor dem Sync, beliebige Mission inklusive Spionage) zusätzlich als Ursache werten. Die Übersicht der
Mitglieder zeigt ihre Sonden mit Ankunftszeit auch dann, wenn der Bericht nie gepastet wird.

**d) Die Kurve ist auf Maximum 1 normiert (Wahrnehmung).** `activityCurve` skaliert auf die Spitze. Hat ein Spieler
fast nur Galaxie-Markierungen, bestimmen sie die Form der Kurve vollständig, egal wie klein `weight` ist (0,2–0,4).
Außerdem bekommt jede Markierung einen eigenen Strich unter der Kurve. Dadurch „fühlt“ sich auch wenig belastbare
Evidenz wie volle Aktivität an. Ideen: die Kurve nicht auf 1 normieren, sondern auf die Summe der Gewichte bzw.
eine Mindestevidenz (dann bleibt sie bei reinen Galaxie-Markierungen flach), oder Galaxie-Striche blasser und
kürzer darstellen.

Nebenbefund: `… BETWEEN lo AND hi AND report_time <= hi` ist redundant (zweimal dieselbe Obergrenze).

---

## Mittel

### 3. Endloses Scrollen in der Spionage-Historie: Race beim Live-Reload und instabile Offsets
`apps/web/src/views/SpyView.vue:66-85`, `apps/server/src/routes/spy.ts:36` (Commits `8eeb3aa`/`58f1c21`)

- **Race:** Läuft `appendRecent()` gerade (`recentLoading = true`) und löst ein Live-Reload `loadRecent()` aus,
  leert `loadRecent` die Liste, und sein eigener `appendRecent()` bricht wegen `recentLoading` sofort ab. Danach
  hängt der noch laufende alte Request seinen Stapel (Offset N) an die leere Liste. Die Liste beginnt dann mitten
  in der Historie, die neuesten Berichte fehlen.
- **Offset-Paginierung bei laufenden Einfügungen:** Kommt zwischen zwei Seiten ein neuer Bericht hinzu, verschiebt
  sich alles um eins. Ein Bericht kommt dann doppelt, mit doppeltem `:key="r.id"` in `v-for`, oder fällt aus.
- **Keine eindeutige Sortierung:** `ORDER BY sr.report_time DESC` hat keinen Tie-Breaker. Berichte mit gleicher
  Sekunde, wie sie bei Mehrfachsonden häufig sind, können zwischen Seiten springen.

Fix: Request-Generation oder AbortController in `appendRecent`, `ORDER BY sr.report_time DESC, sr.id DESC` und
besser Keyset-Paginierung (`before=<report_time,id>`) statt `offset`. Hilfsweise beim Anhängen nach `id`
deduplizieren.

### 4. Kampfhalle und Kampfberichte: Umbenennungen gelten als „Namensverlust“ und frieren den Eintrag ein
`apps/server/src/battleParticipants.ts:16`, `apps/server/src/store.ts:607-613`, `:860` (Commit `70c0ce9`)

`participantNamesDegraded` gibt `true` zurück, sobald ein gespeicherter Name nicht mehr in den neuen Namen
vorkommt. Das trifft auch auf eine normale Umbenennung zu (`['Alice']` → `['Alicia']`). Folgen:
- In der Kampfhalle bleibt der alte Name für immer stehen. Zusätzlich werden `winner` und `units` des Eintrags
  nicht mehr aktualisiert (`namesDegraded ? row.winner : …`).
- Bei `combat_reports` werden die `fleets` nie mehr überschrieben, auch wenn der neue Parse vollständigere Daten
  hätte.

Gemeint ist der Fall gelöschter Accounts, also leere Namen oder „-“. Vorschlag: nur dann als degradiert werten,
wenn die Zahl der brauchbaren Namen sinkt oder ein Name zu leer/„-“ wird, nicht bei einem anderen nicht-leeren
Namen. `winner` und `units` unabhängig von den Namen übernehmen.

### 5. ActionMenu fängt Pfeiltasten in eingebetteten Formularfeldern ab (Claim-Box)
`apps/web/src/components/ActionMenu.vue:103` (Commit `0889ff9`)

`PlanetActions` hängt jetzt die Claim-Box (Selects, Notizfeld) über den Default-Slot in `ActionMenu`. Dessen
`keydown`-Handler liegt auf `document` und ruft bei ArrowUp/ArrowDown immer `preventDefault()` auf, danach springt
der Fokus auf einen Menüeintrag. Auf dem Desktop lassen sich Art und Dauer des Claims dadurch nicht mehr per
Tastatur wählen, und der Cursor im Notizfeld lässt sich nicht bewegen.

Außerdem fällt das alte `closeUnlessTyping` aus `PlanetActions` weg: `resize` und `scroll` schließen das Popover
jetzt immer. Auf Touch-Geräten mit ≥ 800 px Breite (Tablets) schließt die Bildschirmtastatur das Menü, während man
die Notiz tippt.

Fix: in `onKey` Events ignorieren, deren Ziel `input`, `select` oder `textarea` ist. Für `scroll`/`resize` wieder
prüfen, ob der Fokus im Menü liegt.

### 6. Feindliche Spionage: Spieler-Link über den *heutigen* Besitzer der Startkoordinate
`apps/server/src/routes/reports.ts:159-161` (Commit `8b54ca5`)

`from_player_id` kommt in erster Linie vom aktuellen Besitzer des Planeten an den Startkoordinaten, der Name wird
nur als Fallback genutzt. Hat der Planet seitdem den Besitzer gewechselt oder wurde er aufgegeben und neu besiedelt,
verlinkt die Zeile mit dem Namen „X“ auf das Profil eines anderen Spielers. In `bySpy` wird dagegen nur der Name
verwendet, die beiden Tabellen können sich also widersprechen.

Fix: den Koordinaten-Treffer nur nehmen, wenn sein Name oder ein Alias zu `from_player` passt, sonst `byName`.
Nebenbei: Das sind bis zu 1000 Einzelabfragen pro Request (N+1). Ein `LEFT JOIN planets` in der Liste würde reichen.

### 7. Teilkopie eines Systems als Text erzeugt falsche „Planet zerstört“-Einträge
`apps/server/src/store.ts:374` (Commit `35cecfd`) · *plausibel, nicht reproduziert*

Positionen, die im Sync fehlen, gelten als leer, und jetzt wird zusätzlich `planet_destroyed` geloggt. Beim
HTML-Sync ist das korrekt. Kopiert jemand per Text nur einen Teil der Galaxieansicht, bekommt jeder Planet unterhalb
der Markierung einen Eintrag „Planet zerstört“ im Aktivitätslog, und der Planet wird gelöscht. Das Löschen gab es
schon vorher, der Log macht den Fehler jetzt aber sichtbar und erzeugt Push- und Discord-Rauschen, falls diese Art
dort abonniert werden kann.

Vorschlag: `planet_destroyed` nur loggen, wenn der Text-Parser das ganze System gesehen hat (letzte Position
erkannt) oder die Quelle HTML ist.

---

## Niedrig

### 8. Neue Admin-Endpunkte fehlen in `openapi.yaml` (Projektregel)
`apps/server/src/routes/admin.ts:360`, `:373` (Commits `1bb16b6`, `40a7118`)

`GET /api/admin/groups/{id}/fleet-attacks` und `POST …/fleet-attacks/remove` sind neu, ohne Eintrag in der Spec.
Andere Admin-Endpunkte (`discord`, `system`, `access-requests`) sind dort dokumentiert. Laut CLAUDE.md muss jeder
Commit mit API-Änderung die Spec mitziehen. Dasselbe gilt für das neue Body-Feld `isDefault` von
`PUT /api/admin/universes/{slug}`, sofern dieser Pfad dokumentiert werden soll; bisher ist er es nicht.

### 9. Admin-Entfernen eines Angriffs trifft bei gleichen Wellen nur die erste
`apps/server/src/repo/hostile.ts` (`removeStoredAttack`)

Mehrere Solo-Angriffe mit gleicher Route und gleichen Schiffen (zwei Wellen) haben denselben `attackKey`.
`find(...)` nimmt pro Snapshot nur die erste Gruppe. Die zweite Welle bleibt stehen, und das Admin-Panel zeigt
weiter einen Eintrag mit demselben Key. Das ist meistens gewollt, aber dann sollte die Liste die Wellen
unterscheiden, zum Beispiel über Key plus Ankunft.

### 10. Aktivitätsmuster: N+1-Abfragen pro Galaxie-Markierung
`apps/server/src/repo/activity.ts:339`

`playerActivity` ruft für jede gespeicherte Galaxie-Markierung `galaxyMarkBlocked` auf, also einen eigenen
UNION-Query über `spy_reports` und `battle_reports`, und das bei jedem Laden des Spielerprofils. Bei Vielsyncern
sind das schnell Hunderte Abfragen. Besser wäre, die Berichte der betroffenen Koordinaten einmal im Zeitraum zu
laden und im Speicher abzugleichen. Die neue Bedingung
`(pa.time >= ? OR (pa.source = 'galaxy' AND pa.created_at >= ?))` kann außerdem einen Index auf `time` aushebeln.

### 11. Kampfhallen-Suche: N+1 und unbegrenzte Namensliste
`apps/server/src/repo/players.ts:155`

Bei kurzer Suche („a“) passen fast alle Spieler. Dann läuft für jeden ein `namesOf`-Query, und alle Namen landen
als JSON-Liste im `IN (json_each(?))`, das für jede Zeile der Kampfhalle ausgewertet wird. Vorschlag: Mindestlänge
für den Alias-Pfad oder ein einziger Query
(`SELECT name FROM players WHERE id IN (…) UNION SELECT name FROM player_aliases WHERE player_id IN (…)`).

### 12. Doppelter `likeTerm` und verwaister Import
`apps/server/src/repo/players.ts:137` definiert `likeTerm` ein zweites Mal (identisch zu `routes/util.ts:14`).
`apps/server/src/routes/reports.ts:7` importiert `likeTerm` noch, nutzt es aber nicht mehr.

### 13. Seiteneffekt in einer `computed`
`apps/web/src/views/UniverseLayout.vue:31`: `toolsUrl` ruft `setToolsUrl()` auf. Der zusätzliche `watch`
mit `flush: 'sync'` deckt das schon ab, der Aufruf in der `computed` ist überflüssig. Allgemein sind `toolsBase`
und `marketRate` als modulweiter Zustand in `format.ts` fragil (Tests, Wechsel der Gruppe). Das funktioniert, ist
aber leicht zu brechen.

### 14. Marktplatz: uneinheitliche Zuordnung von Sync und Kurs
`apps/server/src/store.ts:~700-712`: `market_syncs.user_id` nutzt `this.t.syncedBy ?? this.t.userId`,
`market_rates.user_id` dagegen `this.t.userId`. Bei einem Sync im Auftrag eines anderen Mitglieds zeigen
„Stand von …“ (Kurs) und „synchronisiert von …“ (Angebote) unterschiedliche Personen.

Außerdem blockiert `exactNear` (`:647`) Text-Schätzungen auch durch *manuell* gesetzte Kurse (`source <> 'text'`)
eine Stunde lang. Das ist vermutlich gewollt, im Kommentar ist aber nur vom „exakten“ Kurs die Rede.

### 15. Offline-Meldung verwirft Galaxie-Markierungen auch *vor* der Meldung
`apps/server/src/repo/activity.ts:338`

Markierungen im Abstand von ±1 h zu einer Offline-Meldung werden verworfen. „Jetzt offline“ widerspricht aber nicht
einer Aktivität von vor 40 Minuten. Fachlich prüfen, ob das Fenster einseitig sein sollte (nur Markierungen nach
der Meldung, bzw. deren Schätzzeit nach der Meldung).

### 16. Kleinigkeiten
- `apps/server/src/routes/admin.ts`: `storageMultiplier` muss ganzzahlig und ≥ 0 sein. `0` ist erlaubt und ergibt
  Speicherkapazität 0, sinnvoll wäre ≥ 1.
- `packages/parser/src/parsers/fleets.ts`: `LINE_RE` hat jetzt das Flag `i`, damit passt `[Wdhms]` auch auf
  `D/H/M/S`. Harmlos, aber nicht beabsichtigt; das `T` hätte man gezielt aufnehmen können.
- `packages/parser/src/parsers/marketplace.ts`: `TRADE_RE` wird aus `GAME_DATE_RE.source.replace(/^\\b/, '')`
  gebaut. Das bricht still, wenn sich `GAME_DATE_RE` ändert.
- `market_trades`: `UNIQUE (group_id, time, give…, want…)` fasst zwei identische Trades in derselben Sekunde
  zusammen (selten).

---

## Geprüft, ohne Befund
- Gruppen-Isolation: neue Queries (`market_*`, `player_activity` über die gruppengebundene `player_id`,
  Admin-Routen über `requireAdmin` und Mitgliedschaftsprüfung) bleiben innerhalb der Gruppe.
- `mergeDraft` (Marktkurs-Übernahme) und `estimateMarketRate` (Least Squares, Fallback ohne Kopplung) sind
  korrekt und getestet.
- Projektregeln Changelog / User-Changelog sind in allen Commits eingehalten (nur Dev-Commits ohne `changelog.ts`).
  Keine Automatisierung auf Spielseiten.

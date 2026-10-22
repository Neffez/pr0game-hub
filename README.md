# pr0game Hub

Externe Auswertung für pr0game auf Basis **manuell kopierter Seiten**: Seite öffnen, `Strg+A`, `Strg+C`, im Hub einfügen.
Die Daten werden pro Universum und Gruppe (Allianz) gesammelt und sind nur für Mitglieder der Gruppe sichtbar.

## Features

- **Einfügen**: Plaintext, HTML aus der Zwischenablage, Seitenquelltext (`Strg+U`) oder gespeicherte Seite. Vor dem Speichern gibt es eine Vorschau.
  - Statistik (Spieler/Allianz, alle Kategorien)
  - Nachrichten: Spionage-, Kampf- und Expeditionsberichte, Spionage-Aktivität
  - Galaxie, Imperium
- **Übersicht**: Punkte je Kategorie mit Δ über 6h/12h/24h/48h/7d, Rangveränderung, Status, Filter
- **Spieler-Detail**: Punkteverlauf (Chart), Planeten, Status-Historie, Notiz
- **Spionage-Verlauf** mit Diff-Ansicht pro Koordinate
- **Planetenliste** mit Entfernung/Flugzeit und letztem Spionagestand
- **Gala-Aktualität** (Heatmap)
- **Raids**, **Expeditionen**, **Expo-Deck** (Kartenzählen), **Allianz-Übersicht** (Imperium), **Fremdspionage**
- **Admin**: Universen (Größe, Distanzfaktoren, Flottengeschwindigkeit, Zeitzone, Deck), Gruppen, Einladungslinks, Ingest-Log mit Reparse, Spieler-Merge

Spieler-IDs, Allianz-IDs und Rangveränderungen gibt es nur in HTML/Quelltext. Bei reinem Plaintext werden Spieler über den Namen zugeordnet.

## Aufbau

```
packages/parser   @pr0hub/core – Parser (cheerio), Deck-Rechnung, Tech-Namen (DE/EN)
apps/server       Fastify + SQLite (better-sqlite3), Auth, Ingest, APIs, liefert die SPA aus
apps/web          Vue 3 SPA (Basis /hub/)
```

## Entwicklung

```bash
pnpm install
pnpm --filter @pr0hub/core build
pnpm test

# Server (Port 3000) + Vite (Port 5173, Proxy auf /hub/api)
ADMIN_BOOTSTRAP_USER=admin ADMIN_BOOTSTRAP_PASSWORD=changeme pnpm --filter @pr0hub/server dev
pnpm --filter @pr0hub/web dev
# -> http://localhost:5173/hub/
```

Element-Namen neu erzeugen (aus dem pr0game-Repo daneben): `pnpm gen:tech`.

Erster Start: Mit dem Bootstrap-Admin anmelden und unter **Admin** ein Universum (z. B. `u8`) sowie eine Gruppe anlegen. Danach Einladungslinks erzeugen.

## Konfiguration (env)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `BASE_PATH` | `/hub` | Pfadpräfix hinter dem Proxy |
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite-Datenbank `hub.db` |
| `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` | – | legt den ersten Admin an, solange noch kein Benutzer existiert |
| `SECURE_COOKIES` | `true` in production | |
| `SESSION_DAYS` | `30` | |
| `BODY_LIMIT_MB` | `8` | |

## Deployment

Docker-Image (`Dockerfile`, Port 3000, Volume `/data`), konfiguriert über die Umgebungsvariablen oben.

CI (`.github/workflows/ci.yml`): Typecheck, Tests und Build bei jedem Push und Pull Request. Nach grünen Tests auf `main`
bekommt optional ein Deployment-Repo einen `repository_dispatch` (Secrets `DISPATCH_REPO` = `owner/name` und
`DISPATCH_TOKEN` = Token mit Schreibrecht auf dessen Inhalte); ohne die Secrets entfällt der Schritt.

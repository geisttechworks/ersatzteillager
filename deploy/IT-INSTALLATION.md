# IT-Installation des Ersatzteillagers

Herausgeber: **Geist Techworks** · Kontakt: [geisttechworks@proton.me](mailto:geisttechworks@proton.me)

## Lizenz

Der eigene Programmcode steht unter der **PolyForm Noncommercial License 1.0.0**. Private und sonstige nicht-kommerzielle Nutzung ist kostenlos; kommerzielle Nutzung erfordert eine vorherige schriftliche Genehmigung von Geist Techworks. Die Lizenz ist nicht OSI-konform. Drittanbieterkomponenten bleiben unter ihren jeweiligen Lizenzen; Einzelheiten stehen in `licenses/THIRD-PARTY-LICENSES.md`.

## 1. Paket prüfen und vorbereiten

Das ZIP in einen dauerhaft gesicherten Anwendungsordner entpacken. Die mitgelieferte externe `*.sha256`-Datei prüft das ZIP; `SHA256SUMS.txt` prüft die Dateien im entpackten Paket. Bei einer abweichenden Prüfsumme nicht starten.

`.env.example` nach `.env` kopieren. `.env` darf nicht in Tickets, Quellcodeverwaltung oder ungeschützte Backups gelangen.

Wichtige Werte:

- `APP_ORIGIN=https://lager.firma.example`: vollständige öffentliche HTTPS-Origin ohne Pfad.
- `PB_HOST=127.0.0.1`, `PB_PORT=8090`: interner PocketBase-Endpunkt hinter dem Reverse Proxy.
- `PB_DATA_DIR`: dauerhaftes Datenverzeichnis.
- `PB_BACKUP_TARGET`: getrenntes, beschreibbares Backup-Ziel; ein eingebundenes Sicherungslaufwerk ist empfohlen.
- `PB_BACKUP_RETENTION_DAYS=30`: lokale Aufbewahrung der gespiegelten Tagesbackups.
- `PB_ENCRYPTION_KEY`: optional genau 32 zufällige Zeichen für verschlüsselte PocketBase-Einstellungen. Der Wert muss bei jeder Wiederherstellung verfügbar sein.

Das Paket ist so getrennt, dass `pb_public`, `pb_migrations`, Binärdateien, Konfiguration und Laufzeitdaten später unverändert in einen Dienst oder Container übernommen werden können.

## 2. Ersteinrichtung

### Windows

PowerShell 7 im Paketordner öffnen:

```powershell
Copy-Item .env.example .env
notepad .env
./scripts/windows/setup.ps1
./scripts/windows/start.ps1
```

Das Setup fragt den PocketBase-Superuser und den ersten App-Administrator verdeckt ab. Beide Konten sind getrennt zu behandeln. Passwörter werden nicht gespeichert oder ausgegeben.

Stoppen:

```powershell
./scripts/windows/stop.ps1
```

### Linux amd64

```bash
cp .env.example .env
chmod 600 .env
chmod +x bin/linux-amd64/pocketbase scripts/linux/*.sh
editor .env
bash scripts/linux/setup.sh
bash scripts/linux/start.sh
```

Stoppen:

```bash
bash scripts/linux/stop.sh
```

Für den späteren Dauerbetrieb soll die IT die Start-/Stoppskripte durch einen verwalteten Windows-Dienst beziehungsweise eine systemd-Unit aufrufen. PocketBase bleibt dabei an Loopback gebunden.

## 3. Reverse Proxy und HTTPS

DNS muss `lager.firma.example` intern auf den Reverse Proxy auflösen. Die Smartphones benötigen Zugriff über Firmen-WLAN oder VPN. Das TLS-Zertifikat wird von der IT bereitgestellt und muss von iOS und Android ohne Warnung als vertrauenswürdig erkannt werden. Selbstsignierte Einzelzertifikate sind nicht vorgesehen.

### Caddy

`reverse-proxy/Caddyfile.example` verwenden und `APP_HOST`, `TLS_CERT_FILE`, `TLS_KEY_FILE` sowie `POCKETBASE_UPSTREAM` in der Caddy-Dienstumgebung aus `.env` bereitstellen. Danach Konfiguration validieren und Caddy geordnet neu laden.

### nginx

Die Vorlage enthält `${...}`-Platzhalter. Auf einem administrativen System mit gesetzten Variablen rendern:

```bash
set -a
. ./.env
set +a
envsubst '${APP_HOST} ${TLS_CERT_FILE} ${TLS_KEY_FILE} ${POCKETBASE_UPSTREAM}' \
  < reverse-proxy/nginx.conf.template > /etc/nginx/conf.d/ersatzteillager.conf
nginx -t
```

Erst nach erfolgreichem `nginx -t` neu laden. Port 8090 nicht im LAN freigeben; extern wird ausschließlich HTTPS/443 angeboten.

## 4. Backups und Aufbewahrung

PocketBase erstellt durch die Migration täglich um 02:00 Uhr einen vollständigen ZIP-Snapshot unter `PB_DATA_DIR/backups` und behält intern höchstens 30 Tagesgenerationen. Der zusammen mit PocketBase gestartete Backup-Spiegel kopiert fertige ZIPs atomar nach `PB_BACKUP_TARGET`. Dort entfernt er ausschließlich `*.zip`, deren Änderungszeit mehr als `PB_BACKUP_RETENTION_DAYS` zurückliegt.

Die IT muss zusätzlich sicherstellen:

- Backup-Ziel liegt auf getrenntem, zugriffsgeschütztem Speicher.
- Freier Platz reicht mindestens für zwei vollständige Datenbestände plus 30 Generationen.
- Fehlerprotokolle `logs/backup-mirror-error.log` werden überwacht.
- Mindestens regelmäßig wird eine Wiederherstellung in einer isolierten Umgebung getestet.

### Wiederherstellungstest

1. Testinstanz stoppen und deren aktuelles Datenverzeichnis separat sichern.
2. Ein Backup-ZIP in ein neues, leeres Test-Datenverzeichnis entpacken.
3. `PB_DATA_DIR` der isolierten Testinstanz auf dieses Verzeichnis setzen.
4. Testinstanz ohne Verbindung zur Produktion starten.
5. Login, Teil anlegen, Zugang, Entnahme, Lieferscheinimport und Historie prüfen.
6. Testinstanz wieder stoppen und Ergebnis mit Datum dokumentieren.

Eine produktive Wiederherstellung ist eine bewusste IT-Änderung und wird absichtlich nicht automatisiert. Vor dem Ersetzen von `PB_DATA_DIR` immer PocketBase stoppen und den bisherigen Stand unverändert sichern.

## 5. Abnahme

- `https://lager.firma.example/api/health` liefert einen erfolgreichen Status.
- Login und Buchungen funktionieren nur über HTTPS.
- `/installieren` zeigt auf iPhone und Android die passenden Schritte.
- QR-Scanner fragt auf beiden echten Geräten nach der Kamera und liest einen Test-QR-Code.
- Auf mobilen bzw. Touch-Geräten sind Etiketten- und Druckfunktionen nicht sichtbar.
- Auf einem Desktop bleiben Etikettendruck, Größenwahl und „Als PDF speichern“ verfügbar.
- Ein Backup erscheint am Folgetag im konfigurierten Ziel; ein isolierter Restore wird protokolliert.

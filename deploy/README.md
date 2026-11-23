# Ersatzteillager - Serverpaket

Dieses ZIP enthält die gebaute Web-App, PocketBase für Windows und Linux (amd64), sämtliche Migrationen sowie Start-, Stopp-, Einrichtungs- und Backup-Skripte. Es enthält keine Datenbank, Benutzer oder Zugangsdaten.

Herausgeber: **Geist Techworks** · Kontakt: [geisttechworks@proton.me](mailto:geisttechworks@proton.me)

Der eigene Programmcode steht unter der **PolyForm Noncommercial License 1.0.0**. Kommerzielle Nutzung erfordert eine vorherige schriftliche Genehmigung. Drittanbieterkomponenten behalten ihre jeweiligen Lizenzen; siehe `licenses/THIRD-PARTY-LICENSES.md`.

## Schnellstart

1. `SHA256SUMS.txt` prüfen.
2. `.env.example` nach `.env` kopieren und mindestens `APP_ORIGIN`, `APP_HOST`, Zertifikatspfade und Backup-Ziel anpassen.
3. Windows: `./scripts/windows/setup.ps1`, danach `./scripts/windows/start.ps1`.
4. Linux: zunächst `chmod +x bin/linux-amd64/pocketbase scripts/linux/*.sh`, dann `bash scripts/linux/setup.sh` und `bash scripts/linux/start.sh`.
5. Den von der IT betriebenen Reverse Proxy nach `docs/IT-INSTALLATION.md` einrichten.
6. `https://lager.firma.example/installieren` mit einem aktuellen iPhone und Android-Gerät prüfen.

Die Anwendung darf produktiv ausschließlich hinter einem vertrauenswürdigen HTTPS-Zertifikat betrieben werden. Eine Veröffentlichung ins Internet ist nicht erforderlich; Firmen-WLAN oder VPN genügen.

Ausführliche Installation, Backup und Wiederherstellung: `docs/IT-INSTALLATION.md`.

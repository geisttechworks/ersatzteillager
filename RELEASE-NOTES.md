# Release Notes

Herausgeber: **Geist Techworks** · Kontakt: [geisttechworks@proton.me](mailto:geisttechworks@proton.me)

## Lizenz

Der eigene Programmcode wird unter der **PolyForm Noncommercial License 1.0.0** veröffentlicht. Private und andere nicht-kommerzielle Nutzung ist kostenlos; kommerzielle Nutzung setzt eine vorherige schriftliche Genehmigung voraus. Die Lizenz ist keine Open-Source-Lizenz im Sinne der OSI. PocketBase, Caddy und npm-Abhängigkeiten behalten ihre jeweiligen Lizenzen; das vollständige Inventar steht in `THIRD-PARTY-LICENSES.md` und wird den Paketen beigefügt.

## Version 1.0.2

Diese Version behebt zwei Fehler der Ersteinrichtung unter einem frischen Windows-Konto:

- Das Fenster für die ersten Zugangsdaten wird sichtbar im Vordergrund geöffnet; der Installer wartet nicht mehr auf ein verborgenes Fenster.
- Vor dem Start werden die Ports 8080, 8090 und 8443 geprüft. Bei Konflikten zeigt der Dialog Prozessname und Port und bietet „Erneut prüfen“ oder „Abbrechen“.
- Nach zehn Minuten ohne Abschluss beendet sich die Ersteinrichtung kontrolliert und verweist auf `%LOCALAPPDATA%\Ersatzteillager\logs\first-run.log`. Das Protokoll enthält keine Zugangsdaten.
- Vor dem Entfernen des temporären Bootstrap-Zugangs wird ein dauerhaft abgesicherter Recovery-Superuser mit verworfenem Zufallspasswort angelegt. Reste abgebrochener Einrichtungsversuche werden beim nächsten Lauf bereinigt.
- Alle PowerShell-Skripte des Windows-Pakets werden als UTF-8 mit BOM ausgeliefert, damit Umlaute in Windows PowerShell 5.1 korrekt erscheinen.
- Der lokale HTTPS-Healthcheck und der Zertifikatimport funktionieren ohne PowerShell-7-Module oder ein vorinitialisiertes `Cert:`-Laufwerk auch unter Windows PowerShell 5.1.
- Der Installer-Test prüft den sichtbaren First-Run-Dialog, Portkonflikt, Zeitlimit, Superuser-Bereinigung, PocketBase-/Caddy-Start und Einrichtungsseite.

Der allgemeine Windows-Installer richtet eine neue, leere Ersatzteillager-Instanz für den Selbstbetrieb ein.

Enthalten:

- Produktions-Build der React/Vite-App und vollständige PocketBase-Migrationen
- PocketBase 0.40.6 und Caddy 2.11.9 als fest versionierte, SHA-256-geprüfte Komponenten
- interaktive Ersteinrichtung des eigenen ersten App-Administrators ohne feste Zugangsdaten
- lokales HTTPS im privaten WLAN mit einmalig zu installierendem Stammzertifikat
- neutrale Einrichtungsseite mit QR-Codes und getrennten Anleitungen für iPhone und Android
- SHA-256-Fingerabdruck des tatsächlich ausgelieferten Stammzertifikats auf der Einrichtungsseite zum Vergleich mit dem Mobilgerät
- kontrollierte Start-/Stoppskripte, optionaler Windows-Autostart und Firewallregeln nur für das Profil **Privat**
- manuelles konsistentes ZIP-Backup mit SHA-256-Prüfsumme und vorherigem Hinweis auf das kurze Anhalten der Anwendung
- Update über dieselbe Installer-App-ID; Daten bleiben bei Update und Deinstallation erhalten

Sicherheitsgrenzen:

- kein Cloudflare-Tunnel und kein eingebauter Clouddienst
- keine vorgesehene Erreichbarkeit aus dem Internet
- keine Router-Portfreigabe einrichten
- privater Schlüssel der lokalen Zertifizierungsstelle bleibt auf dem Betreiber-PC
- `%LOCALAPPDATA%` und damit Datenbank, Zertifizierungsstelle und Protokolle gehören zum Windows-Konto, das die Ersteinrichtung ausführt
- das Stammzertifikat sollte auf PC und Mobilgeräten entfernt werden, sobald der lokale Zugang nicht mehr benötigt wird
- Installer ist nicht codesigniert; Windows SmartScreen kann deshalb einen Warnhinweis anzeigen
- Inno Setup gestattet laut Softwarelizenz kommerzielle Anwendungen; der Hersteller bittet kommerzielle Nutzer dennoch um den Kauf einer kommerziellen Lizenz. Die zuständige Stelle muss dies vor betrieblicher Verteilung freigeben.

Vor produktiver Nutzung müssen Betreiber die Installation auf ihren tatsächlichen Windows-, iPhone- und Android-Geräten, das Backup sowie eine isolierte Wiederherstellung prüfen.

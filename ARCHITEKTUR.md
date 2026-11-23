# Architektur

## Überblick

Die Anwendung ist eine Single-Page-App aus React, TypeScript und Vite. Sie spricht über das PocketBase-JavaScript-SDK mit einer PocketBase-Instanz. Im Produktionsbetrieb liefert PocketBase den statischen Build aus `pb_public` und die API unter derselben HTTPS-Origin aus.

```text
Browser/PWA ── HTTPS ── Reverse Proxy ── Loopback ── PocketBase
    │                                                ├─ pb_public
    │                                                └─ pb_data (nicht in Git)
    └─ optionaler KI-Endpunkt für Lieferscheine
```

Der allgemeine Windows-Installer setzt dieselbe Architektur ohne externen DNS-Namen um:

```text
Mobilgerät im privaten WLAN ── HTTPS PC-IP:8443 ── Caddy ── 127.0.0.1:8090 ── PocketBase
PC-Browser                 ── HTTPS PC-IP:8443 ─────┘
Einrichtungsseite          ── HTTP  PC-IP:8080 (Anleitung und öffentliches Stammzertifikat)
```

Caddy erzeugt pro Installation eine lokale Zertifizierungsstelle. Deren privater Schlüssel bleibt im Benutzerprofil des Betreiber-PCs; nur das öffentliche Stammzertifikat wird an freigegebene Mobilgeräte verteilt. Die Windows-Firewall öffnet 8080 und 8443 ausschließlich für das Profil **Privat**. Es gibt keinen Cloudflare-Tunnel, keine Portfreigabe im Router und keine vorgesehene Erreichbarkeit aus dem Internet.

## Datenmodell

- `categories`: Name und Beschreibung einer Kategorie.
- `spare_parts`: Stammdaten, Lagerort, Preis, Mindest- und Istbestand.
- `inventory_log`: unveränderbare Buchungshistorie mit Richtung, Delta, altem/neuem Bestand, Benutzer sowie Lieferschein-, Lieferanten- und Auftragsbezug.
- `users`: PocketBase-Auth-Collection mit zusätzlichem Feld `is_admin`.

Die einzige Migration `pb_migrations/1800000000_factory_schema.js` legt alle fachlichen Collections, Felder, Indizes, Regeln und Backup-Einstellungen auf einer leeren PocketBase an. Sie erzeugt keine Datensätze.

## Sicherheitsgrenzen

Alle fachlichen Daten erfordern einen angemeldeten Benutzer. Benutzerverwaltung und Importe sind App-Administratoren vorbehalten. Benutzer dürfen das eigene Passwort nur mit dem bisherigen Passwort ändern; Admins erhalten Manage-Rechte ausschließlich für andere Konten. SQLite-Trigger verhindern, dass der letzte App-Admin gelöscht oder herabgestuft wird. Bestandsänderung und Logeintrag werden in einem PocketBase-Batch gemeinsam übertragen. Serverseitige Regeln und Zahlenfelder verhindern negative Bestände. Freie Filterwerte werden ausschließlich über `pb.filter()` parametrisiert.

Das optionale Gemini-Gateway läuft als eigener Node-Prozess. Sein Schlüssel verbleibt serverseitig in einer ignorierten lokalen Umgebungsdatei und wird nicht an den Browser ausgeliefert. In Produktion muss die IT den Endpunkt per HTTPS, Authentisierung, Größenlimit und Netzwerkregel absichern.

## Betrieb

`Setup-Factory.ps1` provisioniert die lokale Laufzeit; `Build-Production.ps1` erstellt `pb_public`; `Start-Production.ps1` bindet PocketBase standardmäßig nur an Loopback. Laufzeitdaten, Binärdateien, Logs, Exporte, Backups und Geheimnisse sind per `.gitignore` ausgeschlossen.

Das Universal-Release trennt `bin/`, `pb_public/`, `pb_migrations/`, `scripts/`, `.env` und `data/`. Dadurch können dieselben Verzeichnisse später von einem Windows-Dienst, einer systemd-Unit oder einem Container verwendet werden, ohne die Anwendung umzubauen. Caddy oder nginx terminiert das von der IT bereitgestellte TLS-Zertifikat; PocketBase bleibt am internen Loopback-Endpunkt.

Der Windows-Installer ist daneben eine Einzelplatz-/Kleinbetriebsvariante. Programmdateien liegen unter `Program Files`, Laufzeitdaten und die lokale PKI unter `%LOCALAPPDATA%\Ersatzteillager`. Aktualisierungen ersetzen nur die Programmdateien. Deinstallation und Update lassen `pb_data` sowie die lokale PKI absichtlich bestehen. Ein interaktives Backup stoppt die kontrollierten Prozesse kurz, kopiert `pb_data` konsistent in ein ZIP und erzeugt eine SHA-256-Prüfsumme.

Die PWA ist bewusst online-only. Der Service Worker puffert ausschließlich unveränderliche statische Ressourcen und beantwortet weder Navigationen noch API-Aufrufe offline. `/installieren` ist öffentlich erreichbar; fachliche Ansichten erfordern weiterhin ein gültiges Benutzerkonto. Der mobile Assistent speichert seinen Abschluss pro Benutzer ausschließlich lokal im Browser.

PocketBase erstellt täglich einen konsistenten ZIP-Snapshot. Ein plattformspezifischer, aber gleich konfigurierter Spiegelprozess kopiert fertige Archive nach `PB_BACKUP_TARGET` und setzt dort die 30-Tage-Aufbewahrung um. Eine Wiederherstellung bleibt eine kontrollierte IT-Tätigkeit und wird nicht automatisch ausgelöst.

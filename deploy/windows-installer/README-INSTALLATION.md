# Ersatzteillager selbst betreiben – Windows-Installation

Diese Installationsdatei richtet eine eigenständige Ersatzteillager-Instanz auf einem Windows-PC ein. Anwendung, Datenbank und Lagerdaten bleiben auf diesem PC. Der Zugriff vom Handy erfolgt ausschließlich im gleichen privaten WLAN über lokales HTTPS. Das Paket verwendet keinen Cloudflare-Tunnel und veröffentlicht keine Dienste im Internet.

Herausgeber: **Geist Techworks** · Kontakt: [geisttechworks@proton.me](mailto:geisttechworks@proton.me)

## Lizenz

Der eigene Programmcode steht unter der **PolyForm Noncommercial License 1.0.0**. Private und andere nicht-kommerzielle Nutzung ist kostenlos. Kommerzielle Nutzung erfordert eine vorherige schriftliche Genehmigung; Anfragen richten Sie an [geisttechworks@proton.me](mailto:geisttechworks@proton.me). Diese Lizenz ist keine Open-Source-Lizenz im Sinne der OSI. Die mitgelieferten Drittanbieterkomponenten behalten ihre jeweiligen Lizenzen; die vollständige Übersicht liegt unter `licenses/THIRD-PARTY-LICENSES.md`.

## Voraussetzungen

- Windows 10 oder Windows 11, 64 Bit
- ein Windows-Konto mit Administratorrechten für die Installation
- PC und Mobilgeräte im gleichen vertrauenswürdigen privaten WLAN
- iPhone ab iOS 16 mit aktuellem Safari oder Android ab Version 10 mit aktuellem Chrome
- keine Geräteisolation im WLAN; Gast-WLANs sind üblicherweise ungeeignet

Der PC muss für die Nutzung eingeschaltet sein. Richten Sie keine Portfreigabe im Router ein.

## Prüfsumme vor dem Start kontrollieren

Legen Sie die EXE und die gleichnamige `.sha256`-Datei in denselben Ordner. Öffnen Sie dort PowerShell und berechnen Sie die Prüfsumme:

```powershell
Get-FileHash .\Ersatzteillager-Setup-1.0.1.exe -Algorithm SHA256
```

PowerShell zeigt unter `Hash` eine lange Zeichenfolge. Öffnen Sie anschließend `Ersatzteillager-Setup-1.0.1.exe.sha256` mit einem Texteditor und vergleichen Sie den ersten Wert vollständig mit `Hash`; Groß-/Kleinschreibung ist dabei unerheblich. Starten Sie die EXE nur, wenn beide Werte übereinstimmen. Dieser Vergleich lässt sich auch eindeutig automatisieren:

```powershell
$actual = (Get-FileHash .\Ersatzteillager-Setup-1.0.1.exe -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = ((Get-Content .\Ersatzteillager-Setup-1.0.1.exe.sha256 -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actual -eq $expected
```

Nur die Ausgabe `True` bestätigt eine Übereinstimmung. Bei `False` darf die Installationsdatei nicht ausgeführt werden.

## Installation und Ersteinrichtung

1. Starten Sie `Ersatzteillager-Setup-1.0.1.exe` per Doppelklick.
2. Falls Windows SmartScreen erscheint, wählen Sie **Weitere Informationen → Trotzdem ausführen**. Dieser Hinweis ist zu erwarten, weil das Installationspaket nicht mit einer kommerziellen Codesignatur signiert ist. Prüfen Sie vor dem Start die mitgelieferte SHA-256-Datei.
3. Bestätigen Sie die Windows-Rückfrage und den Installationsordner.
4. Geben Sie im Einrichtungsassistenten Ihre eigene E-Mail-Adresse, einen Anzeigenamen und ein Passwort mit mindestens 12 Zeichen ein.
5. Wählen Sie **Einrichten und starten**. Das Schema wird automatisch migriert, der erste App-Administrator wird angelegt und der lokale HTTPS-Zugang gestartet.

Es gibt keine vorgegebenen Konten oder Passwörter. Zugangsdaten werden weder im Paket noch in Protokollen gespeichert. Die Ersteinrichtung verwendet nur vorübergehend ein zufälliges Bootstrap-Konto und entfernt dieses anschließend.

Der Installer wird mit Inno Setup gebaut. Dessen Softwarelizenz gestattet auch kommerzielle Anwendungen; der Hersteller bittet kommerzielle Nutzer zusätzlich um den Kauf einer kommerziellen Inno-Setup-Lizenz. Betreiber und verteilende Stellen müssen diese Beschaffungsentscheidung vor dem betrieblichen Einsatz eigenständig freigeben. Dies ist unabhängig von der fehlenden Codesignatur der erzeugten EXE.

## Windows-Konto und Datenordner

`%LOCALAPPDATA%` gehört immer zu einem bestimmten Windows-Konto. Der Einrichtungsassistent wird mit dem ursprünglichen Konto ausgeführt, das den Installer gestartet hat, auch wenn Windows für die Installation zusätzlich Administratorrechte anfordert. Dessen Daten liegen unter `%LOCALAPPDATA%\Ersatzteillager`.

Meldet sich ein anderes Windows-Konto am selben PC an und startet die Verknüpfung, verwendet es einen eigenen `%LOCALAPPDATA%`-Ordner und sieht deshalb nicht automatisch dieselbe Datenbank. Für einen gemeinsamen Betrieb muss festgelegt werden, unter welchem Windows-Konto die Anwendung gestartet und gesichert wird.

## Start, Stopp und automatischer Start

- **Ersatzteillager starten** auf dem Desktop startet die Anwendung und öffnet sie im Browser.
- **Handy verbinden** im Windows-Startmenü öffnet die Einrichtungsseite mit den aktuellen QR-Codes.
- **Ersatzteillager beenden** stoppt HTTPS und Datenbank kontrolliert.
- **Backup erstellen** fragt nach einem Zielordner und erzeugt ein ZIP mit SHA-256-Prüfsumme.
- Der optionale Autostart startet die Serverprozesse nach der Windows-Anmeldung im Hintergrund.

Wenn sich die IP-Adresse des PCs ändert, führen Sie **Ersatzteillager starten** erneut aus und verwenden Sie den neu angezeigten QR-Code. Das lokale Stammzertifikat bleibt gültig.

## Handy-Zugang und lokales Zertifikat

Die Einrichtungsseite zeigt zwei QR-Codes und den SHA-256-Fingerabdruck des tatsächlich angebotenen Stammzertifikats. Öffnen Sie zuerst die unverschlüsselte Einrichtungsseite im privaten WLAN, installieren Sie von dort das öffentliche lokale Stammzertifikat und öffnen Sie erst danach die HTTPS-App. Lesen Sie den Fingerabdruck am Betreiber-PC ab und vergleichen Sie ihn vor dem Vertrauen vollständig mit den Zertifikatsdetails des Mobilgeräts. Die genaue Position der Zertifikatsdetails unterscheidet sich nach iOS-/Android-Version und Gerätehersteller. Ein Vergleich ausschließlich innerhalb derselben unverschlüsselten Handyseite wäre kein unabhängiger Sicherheitsnachweis.

Der private Schlüssel der Zertifizierungsstelle bleibt ausschließlich auf dem Betreiber-PC unter `%LOCALAPPDATA%\Ersatzteillager\caddy-data`. Wer diesen Schlüssel kopiert oder das Betreiberkonto übernimmt, könnte für alle Geräte, die dieser lokalen CA vertrauen, weitere als vertrauenswürdig erscheinende Zertifikate ausstellen. Schützen und sichern Sie deshalb PC und Windows-Konto. Installieren Sie das Zertifikat nur auf eigenen oder ausdrücklich freigegebenen Geräten. Entfernen Sie „Ersatzteillager WLAN“ auf PC und Mobilgerät, sobald der Zugang nicht mehr benötigt wird.

### iPhone / Safari

1. Scannen Sie den ersten QR-Code mit der normalen Kamera-App.
2. Laden Sie das **WLAN-Zertifikat** und bestätigen Sie den Download.
3. Öffnen Sie **Einstellungen → Profil geladen** und installieren Sie das Profil. Alternativ: **Allgemein → VPN und Geräteverwaltung**.
4. Öffnen Sie die Zertifikatsdetails, vergleichen Sie den SHA-256-Fingerabdruck mit der Anzeige am Betreiber-PC und brechen Sie bei einer Abweichung ab.
5. Öffnen Sie **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** und aktivieren Sie das vollständige Vertrauen für „Ersatzteillager WLAN“.
6. Öffnen Sie die sichere App über den zweiten QR-Code. In Safari wählen Sie **Teilen → Zum Home-Bildschirm → Hinzufügen**.
7. Erlauben Sie beim ersten QR-Scan den Kamerazugriff.

### Android / Chrome

1. Scannen Sie den ersten QR-Code mit der normalen Kamera-App.
2. Laden Sie das **WLAN-Zertifikat**.
3. Öffnen Sie je nach Hersteller **Einstellungen → Sicherheit und Datenschutz → Weitere Sicherheitseinstellungen → Zertifikat installieren → CA-Zertifikat**. Verwenden Sie als Namen „Ersatzteillager WLAN“.
4. Öffnen Sie die Zertifikatsdetails, vergleichen Sie den SHA-256-Fingerabdruck mit der Anzeige am Betreiber-PC und brechen Sie bei einer Abweichung ab.
5. Öffnen Sie die sichere App über den zweiten QR-Code. Wählen Sie in Chrome **⋮ → App installieren** oder **Zum Startbildschirm hinzufügen**.
6. Erlauben Sie beim ersten QR-Scan den Kamerazugriff.

## Netzwerk und Sicherheit

- Caddy stellt die Einrichtungsseite auf Port 8080 und die App über HTTPS auf Port 8443 bereit.
- Die Windows-Firewall gibt diese Ports ausschließlich im Netzwerkprofil **Privat** frei.
- PocketBase lauscht nur auf `127.0.0.1:8090` und ist nicht direkt aus dem WLAN erreichbar.
- Die CORS-Freigabe wird beim Start auf die aktuelle lokale HTTPS-Adresse begrenzt.
- Die Anwendung besitzt keinen Cloudflare-Tunnel und keinen eingebauten Cloudzugang.
- Verwenden Sie das Paket nicht in öffentlichen oder nicht vertrauenswürdigen WLANs.

## Backup und Wiederherstellung

Erstellen Sie regelmäßig über **Backup erstellen** eine Sicherung auf einem anderen Datenträger. Der Dialog weist vor der Ordnerauswahl darauf hin, dass Datenbank und HTTPS für die konsistente Kopie kurz angehalten und anschließend automatisch neu gestartet werden. Während dieses kurzen Zeitfensters sind PC- und Handyzugriffe nicht möglich. Das Backup enthält den vollständigen Ordner `pb_data` und eine separate SHA-256-Datei.

PocketBase erstellt zusätzlich täglich interne Snapshots und hält bis zu 30 Generationen. Interne Snapshots ersetzen keine externe Sicherung, weil sie auf demselben PC liegen.

Wiederherstellung:

1. Beenden Sie die Anwendung.
2. Sichern Sie den aktuellen Ordner `%LOCALAPPDATA%\Ersatzteillager\pb_data` zusätzlich.
3. Entpacken Sie den Ordner `pb_data` aus dem gewünschten Backup.
4. Ersetzen Sie den vorhandenen Datenordner nur nach ausdrücklicher Prüfung.
5. Starten Sie die Anwendung und prüfen Sie Login, Bestände, Historie und Anhänge.

Testen Sie die Wiederherstellung regelmäßig zuerst auf einem getrennten Windows-Konto oder Test-PC.

## Update

1. Erstellen Sie ein geprüftes Backup.
2. Beenden Sie die Anwendung.
3. Prüfen Sie Prüfsumme und Release Notes der neuen Installationsdatei.
4. Starten Sie die neue `Ersatzteillager-Setup-<Version>.exe`. Dieselbe App-ID aktualisiert die Programmdateien; der Datenordner unter `%LOCALAPPDATA%` bleibt erhalten.
5. Starten Sie die Anwendung und prüfen Sie Migration, Login, Buchung und Handy-Zugang.

Ein Rücksprung auf eine ältere Version darf nur zusammen mit einem dazu passenden, zuvor getesteten Datenbank-Backup erfolgen.

## Deinstallation

Deinstallieren Sie **Ersatzteillager** über die Windows-Einstellungen. Serverprozesse und Firewallregeln werden entfernt. Die Lagerdaten und die lokale Zertifizierungsstelle bleiben absichtlich unter `%LOCALAPPDATA%\Ersatzteillager` erhalten, damit keine Daten unbemerkt verloren gehen.

Wenn Sie diese Daten endgültig löschen möchten, erstellen und prüfen Sie zuerst ein Backup. Entfernen Sie danach den Datenordner und das Zertifikat „Ersatzteillager WLAN“ manuell aus dem Windows-Zertifikatsspeicher und aus den verbundenen Mobilgeräten.

## Fehlerhilfe

- **Seite nicht erreichbar:** Prüfen Sie, ob PC und Mobilgerät im gleichen privaten WLAN sind, das Windows-Netzwerkprofil **Privat** verwendet wird und keine Geräteisolation aktiv ist.
- **Zertifikatswarnung:** Installieren Sie das Stammzertifikat vollständig; auf dem iPhone muss es zusätzlich ausdrücklich als vertrauenswürdig aktiviert werden.
- **Kamera fehlt:** Öffnen Sie die App ausschließlich über die Adresse mit `https://` und Port 8443 und prüfen Sie die Browserberechtigung.
- **Start schlägt fehl:** Protokolle liegen unter `%LOCALAPPDATA%\Ersatzteillager\logs`. Sie enthalten keine Passwörter.

## Enthaltene Komponenten

- Ersatzteillager-Webanwendung
- PocketBase 0.40.6
- Caddy 2.11.9

Die PolyForm Noncommercial License 1.0.0 der Anwendung liegt als `LICENSE.md` im Installationsordner. Das Drittanbieterinventar und die unveränderten Lizenztexte liegen unter `licenses/THIRD-PARTY-LICENSES.md`; die separat aus den offiziellen Archiven übernommenen PocketBase- und Caddy-Texte befinden sich im selben Ordner.

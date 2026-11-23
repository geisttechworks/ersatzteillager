# Datenschutz- und Löschkonzept (Vorschlag)

## Verarbeitete personenbezogene Daten

- E-Mail-Adresse und optionaler Anzeigename der App-Benutzer
- Benutzerkennung beziehungsweise E-Mail im Buchungsprotokoll
- technische Browserkennung (`user_agent`) im Buchungsprotokoll
- vom Anwender eingegebene Freitexte; diese dürfen keine unnötigen Personendaten enthalten

Das Repository enthält keine Benutzer-, Firmen-, Liefer- oder Produktivdaten. Laufzeitdaten liegen ausschließlich in `pb_data` und in separat verwalteten Sicherungen.

Beim allgemeinen Windows-Installer liegen diese Laufzeitdaten lokal unter `%LOCALAPPDATA%\Ersatzteillager`. Der Handy-Zugriff erfolgt ausschließlich im privaten WLAN über lokales HTTPS; es wird kein Cloudflare-Tunnel oder anderer externer Vermittlungsdienst verwendet. Das öffentliche lokale Stammzertifikat enthält keine Benutzerzugangsdaten. Der zugehörige private Schlüssel verbleibt auf dem Betreiber-PC und darf nicht weitergegeben oder in Backups an unbefugte Stellen übermittelt werden.

## Zweck und Zugriff

Kontodaten dienen Anmeldung und Rechteverwaltung. Die Benutzerangabe im unveränderbaren Buchungslog dient Nachvollziehbarkeit und Revisionsfähigkeit. Zugriff erhalten nur autorisierte, angemeldete Benutzer; die Benutzerverwaltung ist auf Administratoren begrenzt.

## Aufbewahrungsvorschlag

- aktive Benutzerkonten: Dauer des Beschäftigungs-/Berechtigungsverhältnisses
- deaktivierte oder ausgeschiedene Konten: nach Freigabe durch Verantwortliche löschen oder sperren
- Buchungsprotokolle: nach betrieblicher und gesetzlicher Vorgabe, Vorschlag 10 Jahre
- technische `user_agent`-Angaben: sofern nicht erforderlich, nach 90 Tagen anonymisieren oder künftig nicht mehr erheben
- Backups: 30 tägliche Generationen; externe Sicherungen gemäß IT-Backup-Richtlinie

Für selbst betriebene Windows-Installationen entscheidet der Betreiber über Ziel, Zugriff und Aufbewahrung externer ZIP-Backups. Mindestens eine regelmäßig geprüfte Kopie sollte auf einem getrennten Datenträger liegen. Bei Deinstallation bleiben Daten und lokale PKI zum Schutz vor versehentlichem Verlust erhalten und müssen nach Ablauf der festgelegten Fristen bewusst entfernt werden.

## Löschen und Auskunft

Vor Löschung eines Kontos muss entschieden werden, wie dessen historische Buchungen nachvollziehbar bleiben. Empfohlen ist, im Log eine sachliche pseudonyme Kennung beizubehalten und Kontostammdaten nach Ablauf der Frist zu entfernen. Freitextfelder und Importe sind in Auskunfts- und Löschsuchen einzubeziehen. Löschungen, Wiederherstellungen und Auskünfte werden durch die zuständige Stelle dokumentiert.

## Offene organisatorische Entscheidungen

Die verantwortliche Stelle muss Rechtsgrundlage, konkrete Fristen, Rollen, Auftragsverarbeitung des optionalen KI-Dienstes, Speicherort der Backups und Verfahren für Betroffenenrechte verbindlich freigeben.

# Optionaler Lieferschein-KI-Adapter

Der Adapter ist nicht für den Grundbetrieb erforderlich. Ohne konfigurierte Endpunkte bleibt die manuelle JSON-Eingabe verfügbar.

1. `.env.gemini.example` nach `.env.gemini.local` kopieren.
2. API-Schlüssel, API-Basisadresse, freigegebenes Modell, Host, Port und erlaubte Origins eintragen. Die IT legt Werte und Berechtigungen fest.
3. `Start-Gemini-Adapter-Konsole.bat` starten.
4. In `.env.local` `VITE_LOCAL_AI_ENDPOINT` auf den von der IT freigegebenen Adapter-Endpunkt setzen und die App neu bauen/starten.

Der Schlüssel bleibt im Adapter und wird nie in Vite-Variablen eingetragen. `.env.gemini.local` ist ignoriert. In Produktion darf der Adapter nicht ungeschützt ins Netz gestellt werden: HTTPS, Authentisierung, CORS-Allowlist, Rate-/Dateigrößenlimit, Protokollminimierung und ein Vertrag zur Datenverarbeitung sind vorab zu klären. Lieferscheine können Lieferanten-, Bestell- und möglicherweise personenbezogene Daten enthalten.

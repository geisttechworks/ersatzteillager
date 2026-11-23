import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QRCodeSVG } from 'qrcode.react'
import './styles.css'

type SetupConfig = {
  appUrl?: string
  setupUrl?: string
  computerName?: string
  caFile?: string
  caSha256?: string
}

declare global {
  interface Window {
    ERSATZTEILLAGER_SETUP?: SetupConfig
  }
}

const fallbackHost = window.location.hostname
const config = window.ERSATZTEILLAGER_SETUP ?? {}
const setupUrl = config.setupUrl || `${window.location.protocol}//${window.location.host}/`
const appUrl = config.appUrl || `https://${fallbackHost}:8443/`
const caFile = config.caFile || './ersatzteillager-wlan-ca.cer'
const caSha256 = config.caSha256 || 'Fingerabdruck wird beim Serverstart erzeugt.'

function QrCard({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <section className="qr-card">
      <h3>{title}</h3>
      <div className="qr-frame">
        <QRCodeSVG value={value} size={190} level="M" marginSize={2} />
      </div>
      <p>{caption}</p>
    </section>
  )
}

function App() {
  const [platform, setPlatform] = useState<'iphone' | 'android'>('iphone')
  const hostname = useMemo(() => config.computerName || fallbackHost, [])

  return (
    <main>
      <header className="hero">
        <img src="./geist-techworks.png" alt="Geist Techworks" />
        <div>
          <p className="eyebrow">Einrichtung im privaten WLAN</p>
          <h1>Ersatzteillager auf dem Handy</h1>
          <p>
            Der PC <strong>{hostname}</strong> stellt die App im selben WLAN bereit. Die Lagerdaten
            bleiben auf diesem PC.
          </p>
        </div>
      </header>

      <section className="notice">
        <strong>Wichtig:</strong> Der PC muss eingeschaltet und die Verknüpfung „Ersatzteillager
        starten“ muss ausgeführt sein. Handy und PC müssen im gleichen privaten WLAN sein.
      </section>

      <section className="qr-grid">
        <QrCard
          title="1. Einrichtungsseite öffnen"
          value={setupUrl}
          caption="Scannen Sie diesen QR-Code zuerst mit der normalen Handykamera."
        />
        <QrCard
          title="2. App öffnen"
          value={appUrl}
          caption="Scannen Sie diesen QR-Code erst nach der Zertifikatseinrichtung."
        />
      </section>

      <section className="steps">
        <div className="tabs" role="tablist" aria-label="Handy auswählen">
          <button
            type="button"
            className={platform === 'iphone' ? 'active' : ''}
            onClick={() => setPlatform('iphone')}
          >
            iPhone / Safari
          </button>
          <button
            type="button"
            className={platform === 'android' ? 'active' : ''}
            onClick={() => setPlatform('android')}
          >
            Android / Chrome
          </button>
        </div>

        {platform === 'iphone' ? (
          <ol>
            <li>
              <a className="primary" href={caFile} download>
                WLAN-Zertifikat laden
              </a>{' '}
              und bestätigen Sie den Download.
            </li>
            <li>
              Tippen Sie in <strong>Einstellungen</strong> auf <strong>Profil geladen</strong> und
              installieren Sie das Profil. Falls der Punkt fehlt: Einstellungen → Allgemein → VPN und
              Geräteverwaltung.
            </li>
            <li>
              Öffnen Sie vor dem Vertrauen die Zertifikatsdetails und vergleichen Sie den dortigen
              SHA-256-Fingerabdruck mit der Anzeige auf dem Betreiber-PC.
            </li>
            <li>
              Öffnen Sie Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen und
              vertrauen Sie „Ersatzteillager WLAN“ vollständig.
            </li>
            <li>
              <a className="primary" href={appUrl}>App sicher öffnen</a>. Wählen Sie in Safari Teilen →
              „Zum Home-Bildschirm“ → „Hinzufügen“.
            </li>
            <li>
              Erlauben Sie beim ersten QR-Scan den Kamerazugriff. Bei einer Ablehnung: Einstellungen →
              Safari → Kamera → Erlauben.
            </li>
          </ol>
        ) : (
          <ol>
            <li>
              <a className="primary" href={caFile} download>
                WLAN-Zertifikat laden
              </a>.
            </li>
            <li>
              Einstellungen → Sicherheit und Datenschutz → Weitere Sicherheitseinstellungen →
              Zertifikat installieren → CA-Zertifikat. Die Bezeichnungen unterscheiden sich je
              nach Hersteller. Verwenden Sie als Namen „Ersatzteillager WLAN“.
            </li>
            <li>
              Öffnen Sie die Zertifikatsdetails und vergleichen Sie den SHA-256-Fingerabdruck mit
              der Anzeige auf dem Betreiber-PC, bevor Sie das Zertifikat als vertrauenswürdig verwenden.
            </li>
            <li>
              <a className="primary" href={appUrl}>App sicher öffnen</a>. Tippen Sie in Chrome im Menü
              ⋮ auf „App installieren“ oder „Zum Startbildschirm hinzufügen“.
            </li>
            <li>
              Erlauben Sie beim ersten QR-Scan den Kamerazugriff. Bei einer Ablehnung: Einstellungen →
              Apps → Chrome → Berechtigungen → Kamera → Zulassen.
            </li>
          </ol>
        )}
      </section>

      <section className="fingerprint" aria-labelledby="fingerprint-heading">
        <h2 id="fingerprint-heading">Stammzertifikat prüfen</h2>
        <p>SHA-256-Fingerabdruck des angebotenen Zertifikats – am Betreiber-PC ablesen und mit dem Mobilgerät vergleichen:</p>
        <code>{caSha256}</code>
        <p>
          Der private CA-Schlüssel bleibt auf diesem PC. Wer ihn kopiert oder den PC übernimmt,
          könnte für Geräte, die dieser CA vertrauen, weitere Zertifikate ausstellen. Schützen Sie
          deshalb das Windows-Konto und entfernen Sie „Ersatzteillager WLAN“ auf PC und Mobilgerät,
          sobald der Zugang nicht mehr benötigt wird.
        </p>
      </section>

      <section className="help">
        <h2>Wenn es nicht klappt</h2>
        <ul>
          <li>„Seite nicht erreichbar“: Prüfen Sie das gleiche WLAN; Gast-WLANs sperren Geräte oft gegeneinander.</li>
          <li>Zertifikatswarnung: Das Zertifikat wurde noch nicht installiert oder nicht vollständig vertraut.</li>
          <li>Kamera fehlt: Öffnen Sie die App über die Adresse mit <strong>https://</strong>.</li>
          <li>PC-Adresse hat sich geändert: Führen Sie „Ersatzteillager starten“ erneut aus und verwenden Sie den neuen QR-Code.</li>
        </ul>
      </section>

      <footer>
        <p>App-Adresse: <a href={appUrl}>{appUrl}</a></p>
        <p>Nur für ein vertrauenswürdiges privates WLAN. Geben Sie die App nicht ins Internet frei.</p>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

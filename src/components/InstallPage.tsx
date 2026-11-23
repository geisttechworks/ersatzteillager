import { useMemo, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, Download, LockKeyhole, Share2, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { detectMobilePlatform, isTrustedAppContext, type MobilePlatform } from '../lib/platform'
import { usePwaInstall } from '../lib/usePwaInstall'

const platformLabels: Record<'ios' | 'android', string> = {
  ios: 'iPhone / iPad',
  android: 'Android',
}

export default function InstallPage() {
  const detected = detectMobilePlatform()
  const [selected, setSelected] = useState<'ios' | 'android'>(detected === 'android' ? 'android' : 'ios')
  const { canPrompt, installed, install } = usePwaInstall()
  const secure = isTrustedAppContext()
  const installUrl = useMemo(() => `${window.location.origin}/installieren`, [])

  const steps = selected === 'ios'
    ? [
        ['Safari öffnen', 'Rufe diese HTTPS-Adresse in Safari auf.'],
        ['Teilen', 'Tippen Sie auf das Teilen-Symbol und danach auf „Zum Home-Bildschirm“.'],
        ['Als Web-App öffnen', 'Aktivieren Sie die Option, tippen Sie auf „Hinzufügen“ und starten Sie das neue Symbol.'],
      ]
    : [
        ['Chrome öffnen', 'Rufe diese HTTPS-Adresse im aktuellen Chrome auf.'],
        ['Installieren', 'Öffnen Sie ⋮ und wählen Sie „App installieren“ oder „Zum Startbildschirm hinzufügen“.'],
        ['Bestätigen', 'Bestätigen Sie die Installation und starten Sie die App über das neue Symbol.'],
      ]

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:py-10">
      <div className="mx-auto max-w-5xl">
        <a href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-900">
          <ArrowLeft className="h-4 w-4" /> Zur Anmeldung
        </a>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/30">
          <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
            <div className="p-5 sm:p-8 lg:p-10">
              <div className="flex items-center gap-3 text-cyan-300">
                <span className="rounded-2xl bg-cyan-950 p-3"><Smartphone className="h-6 w-6" /></span>
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">Mobile Einrichtung</span>
              </div>
              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Ersatzteillager installieren</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                Keine App-Store-Installation: Fügen Sie die geschützte Web-App direkt zum Startbildschirm hinzu. Für Buchungen bleibt eine Verbindung zum freigegebenen WLAN oder VPN erforderlich.
              </p>

              {!secure && (
                <div role="alert" className="mt-5 rounded-2xl border border-rose-800 bg-rose-950/50 p-4 text-sm text-rose-200">
                  <strong>Unsichere Verbindung:</strong> Installation und Kamera sind nur über eine vertrauenswürdige HTTPS-Adresse möglich. Bitte verwende den von der IT bereitgestellten Link.
                </div>
              )}
              {installed && (
                <div role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> Diese Seite läuft bereits als installierte Web-App.
                </div>
              )}

              <div className="mt-7 flex gap-2" role="tablist" aria-label="Gerät auswählen">
                {(Object.keys(platformLabels) as Array<'ios' | 'android'>).map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    role="tab"
                    aria-selected={selected === platform}
                    onClick={() => setSelected(platform)}
                    className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold ${selected === platform ? 'bg-cyan-700 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                  >
                    {platformLabels[platform]}
                  </button>
                ))}
              </div>

              <ol className="mt-6 grid gap-4 sm:grid-cols-3">
                {steps.map(([title, description], index) => (
                  <li key={title} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-950 font-bold text-cyan-300">{index + 1}</span>
                      {index === 0 ? <Smartphone className="h-5 w-5 text-slate-600" /> : index === 1 ? <Share2 className="h-5 w-5 text-slate-600" /> : <Download className="h-5 w-5 text-slate-600" />}
                    </div>
                    <h2 className="mt-4 font-semibold text-slate-100">{title}</h2>
                    <p className="mt-2 text-sm leading-5 text-slate-400">{description}</p>
                  </li>
                ))}
              </ol>

              {selected === 'android' && canPrompt && !installed && (
                <button type="button" onClick={() => void install()} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-5 py-3 font-semibold text-white hover:bg-cyan-600 sm:w-auto">
                  <Download className="h-5 w-5" /> Jetzt installieren
                </button>
              )}

              <div className="mt-7 grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
                <div className="flex gap-3 rounded-xl border border-slate-800 p-4"><LockKeyhole className="h-5 w-5 shrink-0 text-cyan-400" /><span>Nur die freigegebene HTTPS-Adresse verwenden.</span></div>
                <div className="flex gap-3 rounded-xl border border-slate-800 p-4"><Camera className="h-5 w-5 shrink-0 text-cyan-400" /><span>Erlauben Sie den Kamerazugriff erst beim QR-Scanner.</span></div>
              </div>
            </div>

            <aside className="flex flex-col items-center justify-center border-t border-slate-800 bg-slate-950/70 p-6 text-center lg:border-l lg:border-t-0">
              <div className="rounded-3xl bg-white p-5 shadow-xl">
                <QRCodeSVG value={installUrl} size={220} level="M" fgColor="#07111f" />
              </div>
              <h2 className="mt-5 font-semibold">Auf einem anderen Gerät öffnen</h2>
              <p className="mt-2 text-sm leading-5 text-slate-500">Scannen Sie den QR-Code mit der normalen Handykamera. Er enthält nur die aktuelle Installationsadresse.</p>
              <code className="mt-4 max-w-full break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-400">{installUrl}</code>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}

export function platformName(platform: MobilePlatform): string {
  if (platform === 'ios') return 'iPhone oder iPad'
  if (platform === 'android') return 'Android-Gerät'
  return 'Gerät'
}

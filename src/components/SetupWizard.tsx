import { useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, Download, PackageCheck, Smartphone, X } from 'lucide-react'
import { cameraPermissionHelp, detectMobilePlatform, isStandaloneMode, isTrustedAppContext } from '../lib/platform'
import { usePwaInstall } from '../lib/usePwaInstall'

interface SetupWizardProps {
  userId: string
  onOpenStock: () => void
  onAddPart: () => void
}

type WizardStep = 1 | 2 | 3 | 4

interface StoredSetup {
  step: WizardStep
  bookingActive?: boolean
  complete?: boolean
}

export default function SetupWizard({ userId, onOpenStock, onAddPart }: SetupWizardProps) {
  const storageKey = useMemo(() => `ersatzteillager.mobile-setup.v1.${userId}`, [userId])
  const [state, setState] = useState<StoredSetup>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{"step":1}') as StoredSetup
    } catch {
      return { step: 1 }
    }
  })
  const [sessionHidden, setSessionHidden] = useState(false)
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [cameraMessage, setCameraMessage] = useState('')
  const platform = detectMobilePlatform()
  const { canPrompt, installed, install } = usePwaInstall()

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state, storageKey])

  useEffect(() => {
    const onBooking = () => {
      setState((current) => current.bookingActive ? { step: 4, bookingActive: false } : current)
      setSessionHidden(false)
    }
    window.addEventListener('ersatzteillager:booking-completed', onBooking)
    return () => window.removeEventListener('ersatzteillager:booking-completed', onBooking)
  }, [])

  if (state.complete || sessionHidden) return null

  if (state.bookingActive) {
    return (
      <aside className="fixed bottom-3 left-3 right-3 z-[70] mx-auto max-w-xl rounded-2xl border border-cyan-800 bg-slate-900 p-4 shadow-2xl" aria-label="Einrichtungsassistent Testbuchung">
        <div className="flex items-start gap-3">
          <PackageCheck className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-100">Testbuchung läuft</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">Öffnen Sie ein freigegebenes Teil und buchen Sie einen Zugang oder eine Entnahme. Der Assistent erkennt die erfolgreiche Buchung automatisch.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setSessionHidden(true); onOpenStock() }} className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white">Bestand öffnen</button>
              <button type="button" onClick={() => { setSessionHidden(true); onAddPart() }} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Kein Teil vorhanden: anlegen</button>
            </div>
          </div>
          <button type="button" onClick={() => setSessionHidden(true)} aria-label="Einrichtungsassistent später fortsetzen" className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200"><X className="h-5 w-5" /></button>
        </div>
      </aside>
    )
  }

  const testCamera = async () => {
    setCameraMessage('')
    if (!isTrustedAppContext()) {
      setCameraStatus('error')
      setCameraMessage('Die Kamera ist nur über eine vertrauenswürdige HTTPS-Adresse verfügbar. Öffnen Sie den Link der IT erneut.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      setCameraMessage('Dieser Browser stellt keinen Kamerazugriff bereit. Aktualisiere Safari bzw. Chrome.')
      return
    }
    try {
      setCameraStatus('checking')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      stream.getTracks().forEach((track) => track.stop())
      setCameraStatus('ok')
      setCameraMessage('Kamera wurde erfolgreich erkannt. Der Test hat kein Bild gespeichert.')
    } catch {
      setCameraStatus('error')
      setCameraMessage(`Kamerazugriff wurde nicht erteilt. ${cameraPermissionHelp(platform)}`)
    }
  }

  const headings: Record<WizardStep, string> = {
    1: 'App zum Startbildschirm hinzufügen',
    2: 'Kamera für QR-Codes prüfen',
    3: 'Eine echte Testbuchung durchführen',
    4: 'Einrichtung abgeschlossen',
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <section className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">Mobile Einrichtung · Schritt {Math.min(state.step, 3)} von 3</p>
            <h1 id="setup-title" className="mt-2 text-xl font-bold text-slate-100">{headings[state.step]}</h1>
          </div>
          <button type="button" onClick={() => setSessionHidden(true)} aria-label="Einrichtung später fortsetzen" className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 flex gap-2" aria-hidden="true">
          {[1, 2, 3].map((step) => <span key={step} className={`h-1.5 flex-1 rounded-full ${state.step >= step ? 'bg-cyan-500' : 'bg-slate-800'}`} />)}
        </div>

        {state.step === 1 && (
          <div className="mt-6">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <Smartphone className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
              <p className="text-sm leading-6 text-slate-300">
                {installed || isStandaloneMode()
                  ? 'Die App wurde im eigenständigen Startbildschirm-Modus geöffnet.'
                  : platform === 'ios'
                    ? 'Öffnen Sie in Safari „Teilen → Zum Home-Bildschirm“ und aktivieren Sie „Als Web-App öffnen“.'
                    : 'Öffnen Sie in Chrome ⋮ und wählen Sie „App installieren“ oder „Zum Startbildschirm hinzufügen“.'}
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {platform === 'android' && canPrompt && !installed && <button type="button" onClick={() => void install()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 font-semibold text-white"><Download className="h-5 w-5" /> Installieren</button>}
              <a href="/installieren" target="_blank" rel="noreferrer" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300">Anleitung öffnen</a>
              <button type="button" onClick={() => setState({ step: 2 })} className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4 font-semibold text-slate-950">Weiter</button>
            </div>
          </div>
        )}

        {state.step === 2 && (
          <div className="mt-6">
            <p className="text-sm leading-6 text-slate-400">Der Test fordert einmalig Kamerazugriff an, beendet die Kamera sofort wieder und speichert kein Bild.</p>
            {cameraMessage && <div role="status" className={`mt-4 rounded-xl border p-4 text-sm leading-5 ${cameraStatus === 'ok' ? 'border-emerald-900 bg-emerald-950/40 text-emerald-200' : 'border-rose-900 bg-rose-950/40 text-rose-200'}`}>{cameraMessage}</div>}
            <button type="button" disabled={cameraStatus === 'checking'} onClick={() => void testCamera()} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 font-semibold text-white disabled:opacity-60"><Camera className="h-5 w-5" /> {cameraStatus === 'checking' ? 'Kamera wird geprüft …' : 'Kamera prüfen'}</button>
            {cameraStatus === 'ok' && <button type="button" onClick={() => setState({ step: 3 })} className="mt-3 min-h-12 w-full rounded-xl bg-slate-100 px-4 font-semibold text-slate-950">Weiter zur Testbuchung</button>}
          </div>
        )}

        {state.step === 3 && (
          <div className="mt-6">
            <p className="text-sm leading-6 text-slate-300">Verwende ein von der IT freigegebenes Schulungs- oder Testteil. Der Assistent legt keine Demo-Daten an und ändert keinen Bestand automatisch.</p>
            <ol className="mt-4 list-inside list-decimal space-y-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              <li>Bestand öffnen und Teil auswählen.</li>
              <li>„Zugang“ oder „Entnahme“ wählen.</li>
              <li>Menge und Grund prüfen und einmal buchen.</li>
            </ol>
            <button type="button" onClick={() => { setState({ step: 3, bookingActive: true }); onOpenStock() }} className="mt-5 min-h-12 w-full rounded-xl bg-cyan-700 px-4 font-semibold text-white">Testbuchung starten</button>
          </div>
        )}

        {state.step === 4 && (
          <div className="mt-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-400" />
            <p className="mt-4 text-sm leading-6 text-slate-300">Installation, Kamerazugriff und Buchungsablauf wurden geführt geprüft.</p>
            <button type="button" onClick={() => setState({ step: 4, complete: true })} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-700 px-4 font-semibold text-white">Einrichtung abschließen</button>
          </div>
        )}
      </section>
    </div>
  )
}

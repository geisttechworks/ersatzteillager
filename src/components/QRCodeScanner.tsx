import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { getSparePartById, getSparePartDisplayId, type SparePart } from '../lib/pocketbaseServices'
import {
  CameraStartCoordinator,
  getCameraErrorDetails,
  startScannerWithFallback,
  type CameraErrorDetails,
} from '../lib/qrScannerCamera'

let scannerInstanceCounter = 0

function releaseResidualCameraStreams(containerId: string) {
  const container = document.getElementById(containerId)
  container?.querySelectorAll('video').forEach((video) => {
    const stream = video.srcObject
    if (stream && 'getTracks' in stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    video.srcObject = null
  })
}

export default function QRCodeScanner() {
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [scannedSparePart, setScannedSparePart] = useState<SparePart | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<CameraErrorDetails | null>(null)
  const [scanRegionId] = useState(() => `qr-reader-${++scannerInstanceCounter}`)
  const [cameraCoordinator] = useState(() => new CameraStartCoordinator(
    () => releaseResidualCameraStreams(scanRegionId),
  ))
  const mountedRef = useRef(false)
  const startRequestedRef = useRef(false)

  const reportCameraError = useCallback((caughtError: unknown, secureContext = true) => {
    const details = getCameraErrorDetails(caughtError, secureContext)
    console.error('[QR-Scanner] Kamerafehler', { name: details.displayName })
    if (mountedRef.current) setCameraError(details)
  }, [])

  const stopScanning = useCallback(async (showCleanupError = true) => {
    if (mountedRef.current) setStopping(true)
    try {
      await cameraCoordinator.stop()
    } catch (caughtError) {
      if (showCleanupError) {
        reportCameraError(caughtError)
      } else {
        console.error('[QR-Scanner] Kamera-Cleanup fehlgeschlagen', {
          name: getCameraErrorDetails(caughtError).displayName,
        })
      }
    } finally {
      if (mountedRef.current) {
        setScanning(false)
        setStarting(false)
        setStopping(false)
      }
    }
  }, [cameraCoordinator, reportCameraError])

  const handleDecodedText = useCallback(async (decodedText: string) => {
    try {
      if (!decodedText) {
        if (mountedRef.current) setError('Ungültiger QR-Code: Keine gültige ID')
        return
      }

      const sparePart = await getSparePartById(decodedText)
      await stopScanning(false)
      if (mountedRef.current) setScannedSparePart(sparePart)
    } catch {
      if (mountedRef.current) setError(`Ersatzteil nicht gefunden: ${decodedText}`)
    }
  }, [stopScanning])

  const startScanning = useCallback(async () => {
    if (startRequestedRef.current || cameraCoordinator.isBusy || starting || stopping) return

    const secureContext = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    if (!secureContext) {
      reportCameraError({ name: 'SecurityError' }, false)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      reportCameraError({ name: 'NotFoundError' })
      return
    }

    setError(null)
    setCameraError(null)
    setStarting(true)
    startRequestedRef.current = true

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const didStart = await cameraCoordinator.start(() => startScannerWithFallback(
        () => new Html5Qrcode(scanRegionId),
        {
          onSuccess: (decodedText) => { void handleDecodedText(decodedText) },
          onScanError: () => undefined,
        },
        () => releaseResidualCameraStreams(scanRegionId),
      ))
      if (mountedRef.current) setScanning(didStart)
    } catch (caughtError) {
      reportCameraError(caughtError, secureContext)
      if (mountedRef.current) setScanning(false)
    } finally {
      startRequestedRef.current = false
      if (mountedRef.current) setStarting(false)
    }
  }, [cameraCoordinator, handleDecodedText, reportCameraError, scanRegionId, starting, stopping])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void cameraCoordinator.stop().catch((caughtError) => {
        console.error('[QR-Scanner] Kamera-Cleanup beim Verlassen fehlgeschlagen', {
          name: getCameraErrorDetails(caughtError).displayName,
        })
      })
      releaseResidualCameraStreams(scanRegionId)
    }
  }, [cameraCoordinator, scanRegionId])

  const handleReset = useCallback(async () => {
    await stopScanning(false)
    if (mountedRef.current) {
      setScannedSparePart(null)
      setError(null)
      setCameraError(null)
    }
  }, [stopScanning])

  return (
    <div className="rounded-lg bg-slate-900 p-6 shadow">
      <h2 className="mb-4 text-xl font-semibold text-slate-100">📱 QR-Code Scanner</h2>

      <div className="space-y-4">
        {!scanning && !scannedSparePart && (
          <div className="py-8 text-center">
            <p className="mb-4 text-slate-400">Scannen Sie einen QR-Code, um das Ersatzteil anzuzeigen</p>
            <button
              type="button"
              onClick={() => { void startScanning() }}
              disabled={starting || stopping}
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {starting ? '⏳ Kamera startet …' : '📷 Kamera starten'}
            </button>
          </div>
        )}

        {cameraError && (
          <div className="rounded-lg border border-rose-900/70 bg-rose-950/40 p-4">
            <p className="text-rose-200">{cameraError.message}</p>
            <p className="mt-2 text-xs text-rose-300/80">Fehlername: {cameraError.displayName}</p>
            <button
              type="button"
              onClick={() => { void handleReset() }}
              disabled={stopping}
              className="mt-2 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
            >
              {stopping ? 'Kamera wird freigegeben …' : 'Zurücksetzen'}
            </button>
          </div>
        )}

        <div className={scanning || starting ? 'space-y-4' : 'hidden'} aria-hidden={!scanning && !starting}>
          <div id={scanRegionId} className="overflow-hidden rounded-lg" />
          <button
            type="button"
            onClick={() => { void stopScanning() }}
            disabled={stopping}
            className="w-full rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
          >
            {stopping ? 'Kamera wird freigegeben …' : '❌ Abbrechen'}
          </button>
        </div>

        {scannedSparePart && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/30 p-4">
              <h3 className="mb-3 font-semibold text-emerald-200">✅ Ersatzteil gefunden</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">ID:</span>
                  <span className="font-mono text-slate-100">{getSparePartDisplayId(scannedSparePart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Name:</span>
                  <span className="text-slate-100">{scannedSparePart.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Artikelnummer:</span>
                  <span className="text-slate-100">{scannedSparePart.article_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bestand:</span>
                  <span className="text-slate-100">{scannedSparePart.quantity}</span>
                </div>
                {scannedSparePart.category && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Kategorie:</span>
                    <span className="text-slate-100">{scannedSparePart.category.name}</span>
                  </div>
                )}
                {scannedSparePart.location && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Lagerort:</span>
                    <span className="text-slate-100">{scannedSparePart.location.name}</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => { void handleReset() }}
              disabled={stopping}
              className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {stopping ? 'Kamera wird freigegeben …' : '🔄 Neuer Scan'}
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-yellow-900/70 bg-yellow-950/30 p-4">
            <p className="text-yellow-200">{error}</p>
          </div>
        )}

        <div className="rounded-lg bg-slate-950/60 p-4 text-sm text-slate-400">
          <h4 className="mb-2 font-semibold">Tipps:</h4>
          <ul className="list-inside list-disc space-y-1">
            <li>Halten Sie den QR-Code ca. 10–20 cm entfernt</li>
            <li>Gute Beleuchtung ist wichtig</li>
            <li>QR-Code sollte gerade ausgerichtet sein</li>
            <li>Der QR-Code enthält die ID des Ersatzteils</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

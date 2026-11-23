import type {
  Html5QrcodeCameraScanConfig,
  QrcodeErrorCallback,
  QrcodeSuccessCallback,
} from 'html5-qrcode'

export interface CameraScanner {
  readonly isScanning: boolean
  start(
    cameraIdOrConfig: string | MediaTrackConstraints,
    configuration: Html5QrcodeCameraScanConfig,
    onSuccess: QrcodeSuccessCallback,
    onError: QrcodeErrorCallback,
  ): Promise<unknown>
  stop(): Promise<void>
  clear(): void | Promise<void>
}

export interface CameraCallbacks {
  onSuccess: QrcodeSuccessCallback
  onScanError: QrcodeErrorCallback
}

export interface CameraErrorDetails {
  name: string
  displayName: string
  message: string
}

const knownCameraErrors = [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'SecurityError',
] as const

function extractKnownErrorName(value: string): string | null {
  const compactValue = value.replace(/\s+/g, '')
  return knownCameraErrors.find((name) => compactValue.toLowerCase().includes(name.toLowerCase())) ?? null
}

export function getCameraErrorName(error: unknown, secureContext = true): string {
  if (!secureContext) return 'SecurityError'

  const objectName = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : ''
  const objectMessage = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : ''
  const stringValue = typeof error === 'string' ? error : ''
  const combinedValue = `${objectName} ${objectMessage} ${stringValue}`
  const knownName = extractKnownErrorName(combinedValue)
  if (knownName) return knownName

  if (/permission|denied|notallowed/i.test(combinedValue)) return 'NotAllowedError'
  return objectName && objectName !== 'Error' ? objectName : 'UnknownError'
}

export function getCameraErrorDetails(error: unknown, secureContext = true): CameraErrorDetails {
  const name = getCameraErrorName(error, secureContext)
  const messages: Record<string, string> = {
    NotAllowedError: 'Der Kamerazugriff wurde verweigert. iPhone: Safari → aA → Website-Einstellungen → Kamera → Erlauben. Android: Chrome → Website-Einstellungen → Berechtigungen → Kamera → Zulassen. PC: Schloss-Symbol → Websiteberechtigungen → Kamera → Zulassen.',
    NotFoundError: 'Es wurde keine Kamera gefunden. Prüfen Sie, ob das Gerät eine Kamera besitzt und sie im Betriebssystem aktiviert ist.',
    NotReadableError: 'Die Kamera ist vorhanden, kann aber nicht geöffnet werden. Schließen Sie andere Apps oder Browser-Tabs, die die Kamera verwenden, und versuchen Sie es erneut.',
    OverconstrainedError: 'Es konnte keine passende Kamera ausgewählt werden. Prüfen Sie die verfügbaren Kameras und versuchen Sie es erneut.',
    SecurityError: 'Der Kamerazugriff ist nur über HTTPS oder localhost möglich. Öffnen Sie die App über die sichere HTTPS-Adresse.',
    UnknownError: 'Die Kamera konnte nicht gestartet werden. Prüfen Sie Browserfreigabe, Geräteberechtigung und verfügbare Kamera.',
  }

  return {
    name,
    displayName: name.toLowerCase(),
    message: messages[name] ?? messages.UnknownError,
  }
}

export function shouldFallbackToAnyCamera(error: unknown): boolean {
  const name = getCameraErrorName(error)
  return name === 'NotFoundError' || name === 'OverconstrainedError'
}

export async function stopAndClearScanner(
  scanner: CameraScanner,
  releaseResidualStreams: () => void = () => undefined,
): Promise<void> {
  let firstError: unknown = null

  try {
    if (scanner.isScanning) await scanner.stop()
  } catch (error) {
    firstError = error
  }

  try {
    releaseResidualStreams()
  } catch (error) {
    firstError ??= error
  }

  try {
    await Promise.resolve(scanner.clear())
  } catch (error) {
    firstError ??= error
  }

  if (firstError) throw firstError
}

const scanConfiguration = {
  fps: 10,
  qrbox: { width: 250, height: 250 },
}

export async function startScannerWithFallback(
  createScanner: () => CameraScanner,
  callbacks: CameraCallbacks,
  releaseResidualStreams: () => void = () => undefined,
): Promise<CameraScanner> {
  const preferredScanner = createScanner()

  try {
    await preferredScanner.start(
      { facingMode: 'environment' },
      {
        ...scanConfiguration,
        videoConstraints: { facingMode: { ideal: 'environment' } },
      },
      callbacks.onSuccess,
      callbacks.onScanError,
    )
    return preferredScanner
  } catch (preferredError) {
    await stopAndClearScanner(preferredScanner, releaseResidualStreams).catch(() => undefined)
    if (!shouldFallbackToAnyCamera(preferredError)) throw preferredError

    console.info('[QR-Scanner] Rückkamera nicht verfügbar; Fallback auf beliebige Kamera.', {
      name: getCameraErrorName(preferredError).toLowerCase(),
    })
  }

  const fallbackScanner = createScanner()
  try {
    await fallbackScanner.start(
      { facingMode: 'user' },
      {
        ...scanConfiguration,
        videoConstraints: {},
      },
      callbacks.onSuccess,
      callbacks.onScanError,
    )
    return fallbackScanner
  } catch (fallbackError) {
    await stopAndClearScanner(fallbackScanner, releaseResidualStreams).catch(() => undefined)
    throw fallbackError
  }
}

export class CameraStartCoordinator {
  private activeScanner: CameraScanner | null = null
  private startTask: Promise<boolean> | null = null
  private cleanupTask: Promise<void> = Promise.resolve()
  private generation = 0
  private readonly releaseResidualStreams: () => void

  constructor(releaseResidualStreams: () => void = () => undefined) {
    this.releaseResidualStreams = releaseResidualStreams
  }

  get isBusy(): boolean {
    return this.activeScanner !== null || this.startTask !== null
  }

  async start(starter: () => Promise<CameraScanner>): Promise<boolean> {
    if (this.isBusy) return false

    const startGeneration = this.generation
    const task = (async () => {
      await this.cleanupTask.catch(() => undefined)
      const scanner = await starter()
      if (startGeneration !== this.generation) {
        await stopAndClearScanner(scanner, this.releaseResidualStreams).catch(() => undefined)
        return false
      }
      this.activeScanner = scanner
      return true
    })()
    this.startTask = task

    try {
      return await task
    } finally {
      if (this.startTask === task) this.startTask = null
    }
  }

  async stop(): Promise<void> {
    this.generation += 1
    const pendingStart = this.startTask
    if (pendingStart) await pendingStart.catch(() => undefined)

    const scanner = this.activeScanner
    this.activeScanner = null
    if (!scanner) {
      await this.cleanupTask.catch(() => undefined)
      return
    }

    const cleanup = stopAndClearScanner(scanner, this.releaseResidualStreams)
    this.cleanupTask = cleanup.catch(() => undefined)
    await cleanup
  }
}

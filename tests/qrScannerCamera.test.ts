import { describe, expect, it, vi } from 'vitest'
import {
  CameraStartCoordinator,
  getCameraErrorDetails,
  startScannerWithFallback,
  stopAndClearScanner,
  type CameraScanner,
} from '../src/lib/qrScannerCamera'

function createScanner(options: {
  isScanning?: boolean
  startError?: unknown
  calls?: string[]
} = {}): CameraScanner {
  const calls = options.calls ?? []
  return {
    isScanning: options.isScanning ?? false,
    start: vi.fn(async (_camera, _configuration) => {
      calls.push('start')
      if (options.startError) throw options.startError
      return null
    }),
    stop: vi.fn(async () => { calls.push('stop') }),
    clear: vi.fn(() => { calls.push('clear') }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('Kamerafehler', () => {
  it.each([
    ['NotAllowedError', 'notallowederror', 'iPhone'],
    ['NotFoundError', 'notfounderror', 'keine Kamera'],
    ['NotReadableError', 'notreadableerror', 'andere Apps'],
    ['OverconstrainedError', 'overconstrainederror', 'passende Kamera'],
    ['SecurityError', 'securityerror', 'HTTPS'],
  ])('ordnet %s einer verständlichen Meldung zu', (name, displayName, messagePart) => {
    const details = getCameraErrorDetails({ name })
    expect(details.displayName).toBe(displayName)
    expect(details.message).toContain(messagePart)
  })

  it('erzwingt SecurityError in einem unsicheren Kontext', () => {
    expect(getCameraErrorDetails({ name: 'NotFoundError' }, false).name).toBe('SecurityError')
  })

  it('erkennt Fehlernamen auch in Fehlertexten der Scannerbibliothek', () => {
    expect(getCameraErrorDetails('NotAllowedError: Permission denied').name).toBe('NotAllowedError')
  })
})

describe('Kameraauswahl', () => {
  it('fällt ohne exakte Geräte-ID von der bevorzugten Rückkamera auf eine beliebige Kamera zurück', async () => {
    const preferred = createScanner({ startError: { name: 'OverconstrainedError' } })
    const fallback = createScanner()
    const scanners = [preferred, fallback]

    const result = await startScannerWithFallback(
      () => scanners.shift()!,
      { onSuccess: vi.fn(), onScanError: vi.fn() },
    )

    expect(result).toBe(fallback)
    expect(preferred.clear).toHaveBeenCalledOnce()
    expect(preferred.start).toHaveBeenCalledWith(
      { facingMode: 'environment' },
      expect.objectContaining({ videoConstraints: { facingMode: { ideal: 'environment' } } }),
      expect.any(Function),
      expect.any(Function),
    )
    expect(fallback.start).toHaveBeenCalledWith(
      { facingMode: 'user' },
      expect.objectContaining({ videoConstraints: {} }),
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('wiederholt eine verweigerte Berechtigung nicht', async () => {
    const factory = vi.fn(() => createScanner({ startError: { name: 'NotAllowedError' } }))

    await expect(startScannerWithFallback(
      factory,
      { onSuccess: vi.fn(), onScanError: vi.fn() },
    )).rejects.toMatchObject({ name: 'NotAllowedError' })

    expect(factory).toHaveBeenCalledOnce()
  })
})

describe('Scanner-Lebenszyklus', () => {
  it('wartet beim Beenden auf stop, gibt Reststreams frei und ruft danach clear auf', async () => {
    const calls: string[] = []
    const scanner = createScanner({ isScanning: true, calls })

    await stopAndClearScanner(scanner, () => { calls.push('release') })

    expect(calls).toEqual(['stop', 'release', 'clear'])
  })

  it('ignoriert einen schnellen zweiten Start', async () => {
    const pending = deferred<CameraScanner>()
    const coordinator = new CameraStartCoordinator()
    const firstStart = coordinator.start(() => pending.promise)
    const secondStart = coordinator.start(async () => createScanner())

    expect(await secondStart).toBe(false)
    pending.resolve(createScanner())
    expect(await firstStart).toBe(true)
    await coordinator.stop()
  })

  it('räumt einen während des Starts abgebrochenen Scanner vollständig auf', async () => {
    const pending = deferred<CameraScanner>()
    const calls: string[] = []
    const scanner = createScanner({ isScanning: true, calls })
    const coordinator = new CameraStartCoordinator(() => { calls.push('release') })
    const start = coordinator.start(() => pending.promise)
    const stop = coordinator.stop()

    pending.resolve(scanner)
    expect(await start).toBe(false)
    await stop
    expect(calls).toEqual(['stop', 'release', 'clear'])
  })

  it('kann nach Stop und Clear erneut starten', async () => {
    const first = createScanner({ isScanning: true })
    const second = createScanner({ isScanning: true })
    const coordinator = new CameraStartCoordinator()

    expect(await coordinator.start(async () => first)).toBe(true)
    await coordinator.stop()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(first.clear).toHaveBeenCalledOnce()

    expect(await coordinator.start(async () => second)).toBe(true)
    await coordinator.stop()
    expect(second.stop).toHaveBeenCalledOnce()
    expect(second.clear).toHaveBeenCalledOnce()
  })
})

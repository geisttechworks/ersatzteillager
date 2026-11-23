export type MobilePlatform = 'ios' | 'android' | 'desktop'

export function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const userAgent = navigator.userAgent || ''
  const isIPadDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/i.test(userAgent) || isIPadDesktopMode) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'desktop'
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

export function isTrustedAppContext(): boolean {
  if (typeof window === 'undefined') return true
  return window.isSecureContext || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

export function isMobileOrTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768
    || navigator.maxTouchPoints > 0
    || window.matchMedia('(pointer: coarse)').matches
}

export function cameraPermissionHelp(platform = detectMobilePlatform()): string {
  if (platform === 'ios') {
    return 'Öffnen Sie Einstellungen → Safari → Kamera und erlauben Sie den Zugriff. Öffnen Sie die App danach neu.'
  }
  if (platform === 'android') {
    return 'Öffnen Sie Chrome → Einstellungen → Website-Einstellungen → Kamera und erlauben Sie den Zugriff für diese Adresse.'
  }
  return 'Erlauben Sie den Kamerazugriff in den Website-Einstellungen des Browsers und laden Sie die Seite neu.'
}

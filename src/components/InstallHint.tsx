import { Download, ShieldAlert } from 'lucide-react'
import { detectMobilePlatform, isStandaloneMode, isTrustedAppContext } from '../lib/platform'

export default function InstallHint() {
  const platform = detectMobilePlatform()
  const installed = isStandaloneMode()
  const secure = isTrustedAppContext()

  return (
    <div className="mt-5 space-y-3 border-t border-slate-800 pt-5 text-left">
      {!secure && (
        <div role="alert" className="flex gap-2 rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-xs leading-5 text-rose-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Diese Adresse verwendet kein vertrauenswürdiges HTTPS. Installation und Kamera sind hier nicht verfügbar.
        </div>
      )}
      {!installed && (
        <a href="/installieren" className="flex min-h-12 items-center gap-3 rounded-xl border border-cyan-900 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-200 hover:bg-cyan-950/60">
          <Download className="h-5 w-5 shrink-0" />
          <span><strong>App installieren</strong><span className="block text-xs font-normal text-slate-400">Anleitung für {platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'iPhone und Android'}</span></span>
        </a>
      )}
    </div>
  )
}

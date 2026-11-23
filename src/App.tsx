import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard,
  Boxes,
  PlusCircle,
  QrCode,
  History,
  Tags,
  BarChart3,
  LogOut,
  Users,
  FolderPlus,
  HardDrive,
  Search,
  Upload,
  CircleUserRound,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import SparePartList from './pages/SparePartList'
import AddSparePartForm from './components/AddSparePartForm'
import HistoryView from './components/HistoryView'
import LoginModal from './components/LoginModal'
import UserManagement from './components/UserManagement'
import CategoryManagement from './components/CategoryManagement'
import ProfileSettings from './components/ProfileSettings'
import InstallPage from './components/InstallPage'
import SetupWizard from './components/SetupWizard'
import pb from './lib/pocketbase'
import { isMobileOrTouchDevice } from './lib/platform'

const ExcelImport = lazy(() => import('./components/ExcelImport'))
const BackupSettings = lazy(() => import('./components/BackupSettings'))
const QRCodeScanner = lazy(() => import('./components/QRCodeScanner'))
const LabelPrint = lazy(() => import('./components/LabelPrint'))

type View = 'dashboard' | 'list' | 'add' | 'import' | 'qr' | 'labels' | 'history' | 'reports'
type SearchRequest = { query: string; id: number }

const navItems: { view: View; label: string; title: string; Icon: typeof LayoutDashboard }[] = [
  { view: 'dashboard', label: 'Übersicht', title: 'Dashboard', Icon: LayoutDashboard },
  { view: 'list', label: 'Bestand', title: 'Bestandsliste', Icon: Boxes },
  { view: 'add', label: 'Neu', title: 'Ersatzteil hinzufügen', Icon: PlusCircle },
  { view: 'qr', label: 'QR-Scanner', title: 'QR-Code scannen', Icon: QrCode },
  { view: 'labels', label: 'Etiketten', title: 'Etiketten drucken', Icon: Tags },
  { view: 'history', label: 'Historie', title: 'Bestandsbewegungen', Icon: History },
  { view: 'reports', label: 'Berichte', title: 'Berichte', Icon: BarChart3 },
]

const navButtonBase = 'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150'

function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard')
  const [currentUser, setCurrentUserState] = useState(pb.authStore.model)
  const isAdminUser = currentUser?.is_admin === true
  const [showUserManagement, setShowUserManagement] = useState(false)
  const [showCategoryManagement, setShowCategoryManagement] = useState(false)
  const [showBackupSettings, setShowBackupSettings] = useState(false)
  const [showProfileSettings, setShowProfileSettings] = useState(false)
  const [initialFilterStock, setInitialFilterStock] = useState<string | undefined>(undefined)
  const [initialHistoryDateFrom, setInitialHistoryDateFrom] = useState<string | undefined>(undefined)
  const [initialHistoryPartId, setInitialHistoryPartId] = useState<string | undefined>(undefined)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchRequest, setSearchRequest] = useState<SearchRequest>({ query: '', id: 0 })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const logoClickCountRef = useRef(0)
  const logoResetTimeoutRef = useRef<number | null>(null)
  const logoOverlayTimeoutRef = useRef<number | null>(null)
  const logoOverlayTriggeredRef = useRef(false)
  const [showLogoOverlay, setShowLogoOverlay] = useState(false)
  const [desktopPrintingAllowed, setDesktopPrintingAllowed] = useState(() => !isMobileOrTouchDevice())

  useEffect(() => {
    const updatePrintingAvailability = () => setDesktopPrintingAllowed(!isMobileOrTouchDevice())
    updatePrintingAvailability()
    window.addEventListener('resize', updatePrintingAvailability)
    return () => window.removeEventListener('resize', updatePrintingAvailability)
  }, [])

  useEffect(() => {
    if (!desktopPrintingAllowed && currentView === 'labels') setCurrentView('dashboard')
  }, [currentView, desktopPrintingAllowed])

  useEffect(() => {
    if (pb.authStore.isValid) setCurrentUserState(pb.authStore.model)
  }, [])

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, model) => {
      if (model) {
        setCurrentUserState(model)
      } else {
        setCurrentUserState(null)
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => () => {
    if (logoResetTimeoutRef.current !== null) window.clearTimeout(logoResetTimeoutRef.current)
    if (logoOverlayTimeoutRef.current !== null) window.clearTimeout(logoOverlayTimeoutRef.current)
  }, [])

  useEffect(() => {
    const checkAndCreateBackup = async () => {
      try {
        const backupService = await import('./lib/backupService')
        if (await backupService.shouldBackup()) {
          const settings = await backupService.getBackupSettings()
          if (settings.directoryHandle) await backupService.createBackup()
        }
      } catch {
        // Automatische Backups werden zusätzlich in den Backup-Einstellungen gemeldet.
      }
    }
    if (pb.authStore.isValid) void checkAndCreateBackup()
  }, [])

  const handleLogin = () => {
    setCurrentUserState(pb.authStore.model)
  }

  const handleLogout = () => {
    pb.authStore.clear()
    setCurrentUserState(null)
    setCurrentView('dashboard')
  }

  const navigate = (view: View) => {
    setCurrentView(view)
    setInitialHistoryPartId(undefined)
    setInitialHistoryDateFrom(undefined)
    if (view === 'list') setInitialFilterStock(undefined)
  }

  const handleNavigateToLowStock = () => {
    setInitialFilterStock('low')
    setInitialHistoryPartId(undefined)
    setCurrentView('list')
  }

  const handleNavigateToHistory = () => {
    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
    setInitialHistoryDateFrom(oneMonthAgo.toISOString().split('T')[0])
    setInitialHistoryPartId(undefined)
    setCurrentView('history')
  }

  const handleNavigateToArticleHistory = (partId: string) => {
    setInitialHistoryPartId(partId)
    setInitialHistoryDateFrom(undefined)
    setCurrentView('history')
  }

  const handleGlobalSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInitialHistoryPartId(undefined)
    setInitialHistoryDateFrom(undefined)
    setInitialFilterStock(undefined)
    setSearchRequest((previous) => ({ query: globalSearch.trim(), id: previous.id + 1 }))
    setCurrentView('list')
  }

  const handleLogoClick = () => {
    if (logoOverlayTriggeredRef.current) return

    if (logoResetTimeoutRef.current !== null) window.clearTimeout(logoResetTimeoutRef.current)
    logoClickCountRef.current += 1

    if (logoClickCountRef.current >= 5) {
      logoClickCountRef.current = 0
      logoOverlayTriggeredRef.current = true
      setShowLogoOverlay(true)
      logoOverlayTimeoutRef.current = window.setTimeout(() => {
        setShowLogoOverlay(false)
        logoOverlayTimeoutRef.current = null
      }, 33_000)
      return
    }

    logoResetTimeoutRef.current = window.setTimeout(() => {
      logoClickCountRef.current = 0
      logoResetTimeoutRef.current = null
    }, 1_300)
  }

  if (window.location.pathname.replace(/\/+$/, '') === '/installieren') return <InstallPage />

  if (!pb.authStore.isValid) return <LoginModal onLogin={handleLogin} />

  const currentUserLabel = currentUser?.name || currentUser?.email || 'Angemeldet'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 print:bg-white print:text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 shadow-lg shadow-black/10 backdrop-blur-sm print:hidden">
        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-3 py-3 sm:px-5 lg:px-7">
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={handleLogoClick}
              aria-label="Ersatzteillager-Logo"
              title="Ersatzteillager"
              className="flex h-10 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-900 transition-colors duration-150 hover:border-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700"
            >
              <img src="/geist-techworks.png" alt="Geist Techworks" className="h-full w-full object-contain" />
            </button>
            <div className="hidden sm:block">
              <p className="text-[11px] leading-tight text-slate-500">Ersatzteillager</p>
            </div>
          </div>

          <form onSubmit={handleGlobalSearch} className="relative ml-auto flex min-w-0 max-w-xl flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" />
            <input
              ref={searchInputRef}
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Global suchen …"
              aria-label="Globale Suche"
              className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900 pl-9 pr-20 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-500 focus:border-cyan-700 focus:ring-2 focus:ring-cyan-900/60"
            />
            {globalSearch && (
              <button type="button" onClick={() => setGlobalSearch('')} aria-label="Suche leeren" className="absolute right-[4.8rem] rounded p-1 text-slate-500 hover:text-slate-200">
                <span className="sr-only">Leeren</span>×
              </button>
            )}
            <kbd className="pointer-events-none absolute right-2 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-500">⌘ / Ctrl K</kbd>
          </form>

          <div className="hidden shrink-0 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400 md:flex" title={currentUserLabel}>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="max-w-36 truncate">{currentUserLabel}</span>
          </div>
        </div>

        <nav aria-label="Hauptnavigation und Verwaltung" className="mx-auto flex max-w-[1800px] items-center gap-2 overflow-x-auto px-3 pb-3 sm:px-5 lg:px-7">
          <div className="flex shrink-0 items-center gap-1">
            {navItems.map(({ view, label, title, Icon }) => (
              <button
                key={view}
                type="button"
                onClick={() => navigate(view)}
                aria-current={currentView === view ? 'page' : undefined}
                className={`${navButtonBase} ${view === 'labels' ? 'desktop-print-only' : ''} ${currentView === view ? 'bg-cyan-950/70 text-cyan-300 ring-1 ring-cyan-900' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}
                title={title}
                hidden={view === 'labels' && !desktopPrintingAllowed}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <span className="mx-1 h-7 w-px shrink-0 bg-slate-800" />
          <span className="hidden shrink-0 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 xl:inline">Verwaltung</span>
          <button type="button" onClick={() => setShowCategoryManagement(true)} className={`${navButtonBase} text-slate-400 hover:bg-slate-900 hover:text-slate-100`} title="Kategorien verwalten">
            <FolderPlus className="h-4 w-4" /><span>Kategorien</span>
          </button>
          <button type="button" onClick={() => setShowBackupSettings(true)} className={`${navButtonBase} text-slate-400 hover:bg-slate-900 hover:text-slate-100`} title="Datensicherung">
            <HardDrive className="h-4 w-4" /><span>Backup</span>
          </button>
          <button type="button" onClick={() => setShowProfileSettings(true)} className={`${navButtonBase} text-slate-400 hover:bg-slate-900 hover:text-slate-100`} title="Eigenes Profil und Passwort">
            <CircleUserRound className="h-4 w-4" /><span>Profil</span>
          </button>
          {isAdminUser && (
            <>
              <button type="button" onClick={() => navigate('import')} aria-current={currentView === 'import' ? 'page' : undefined} className={`${navButtonBase} ${currentView === 'import' ? 'bg-cyan-950/70 text-cyan-300 ring-1 ring-cyan-900' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`} title="Excel- und Lieferschein-Import">
                <Upload className="h-4 w-4" /><span>Import</span>
              </button>
              <button type="button" onClick={() => setShowUserManagement(true)} className={`${navButtonBase} text-slate-400 hover:bg-slate-900 hover:text-slate-100`} title="Benutzer verwalten">
                <Users className="h-4 w-4" /><span>Benutzer</span>
              </button>
            </>
          )}
          <button type="button" onClick={handleLogout} className={`${navButtonBase} ml-auto text-slate-400 hover:bg-rose-950/60 hover:text-rose-300`} title="Abmelden">
            <LogOut className="h-4 w-4" /><span>Abmelden</span>
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-[1800px] px-3 py-5 sm:px-5 lg:px-7 lg:py-7">
        {currentView === 'dashboard' && <Dashboard onNavigateToLowStock={handleNavigateToLowStock} onNavigateToHistory={handleNavigateToHistory} />}
        {currentView === 'list' && (
          <SparePartList
            initialFilterStock={initialFilterStock}
            initialSearchRequest={searchRequest}
            onNavigateToHistory={handleNavigateToArticleHistory}
          />
        )}
        {currentView === 'add' && <AddSparePartForm onSuccess={() => navigate('list')} />}
        {currentView === 'import' && isAdminUser && <Suspense fallback={<div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">Import wird geladen …</div>}><ExcelImport onSuccess={() => navigate('list')} /></Suspense>}
        {currentView === 'qr' && <Suspense fallback={<div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">QR-Scanner wird geladen …</div>}><QRCodeScanner /></Suspense>}
        {currentView === 'labels' && desktopPrintingAllowed && <Suspense fallback={<div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">Etiketten werden geladen …</div>}><LabelPrint /></Suspense>}
        {currentView === 'history' && <HistoryView sparePartId={initialHistoryPartId} initialDateFrom={initialHistoryDateFrom} />}
        {currentView === 'reports' && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
            <h1 className="text-lg font-semibold text-slate-100">Berichte</h1>
            <p className="mt-2 text-sm text-slate-400">Berichte werden in Kürze verfügbar sein.</p>
          </section>
        )}
      </main>

      {showUserManagement && <UserManagement onClose={() => setShowUserManagement(false)} />}
      {showCategoryManagement && <CategoryManagement onClose={() => setShowCategoryManagement(false)} />}
      {showBackupSettings && <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 text-slate-200">Backup wird geladen …</div>}><BackupSettings onClose={() => setShowBackupSettings(false)} /></Suspense>}
      {showProfileSettings && <ProfileSettings onClose={() => setShowProfileSettings(false)} onUpdated={() => setCurrentUserState(pb.authStore.model)} />}
      {currentUser?.id && isMobileOrTouchDevice() && (
        <SetupWizard
          userId={currentUser.id}
          onOpenStock={() => navigate('list')}
          onAddPart={() => navigate('add')}
        />
      )}
      {showLogoOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Ersatzteillager">
          <div className="w-[92vw] max-w-[1600px]">
            <img src="/geist-techworks.png" alt="Geist Techworks" className="max-h-[84vh] w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}

export default App

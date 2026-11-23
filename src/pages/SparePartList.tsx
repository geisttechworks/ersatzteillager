import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  History,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import {
  getInventoryLog,
  getSpareParts,
  getSparePartDisplayId,
  deleteSparePart,
  type InventoryLog,
  type SparePart,
} from '../lib/pocketbaseServices'
import StockMovementDialog from '../components/StockMovementDialog'
import EditSparePartForm from '../components/EditSparePartForm'
import ExistingTextField from '../components/ExistingTextField'
import pb from '../lib/pocketbase'

const DeliveryNoteJsonImport = lazy(() => import('../components/DeliveryNoteJsonImport'))
const QRCodeGenerator = lazy(() => import('../components/QRCodeGenerator'))

interface SearchRequest {
  query: string
  id: number
}

interface SparePartListProps {
  initialFilterStock?: string
  initialSearchRequest?: SearchRequest
  onNavigateToHistory?: (sparePartId: string) => void
}

type SearchScope = 'article_number' | 'location' | 'installation_location' | null

function generateLocationCode(part: SparePart): string {
  if (part.location_data?.display_code) return String(part.location_data.display_code)
  if (!part.location_type || part.location_type === 'NONE') return 'Kein Lagerort'
  if (['S', 'ES', 'R'].includes(part.location_type)) {
    const num = part.location_number || '?'
    const place = part.location_place || '?'
    return `${part.location_type}.${num} P.${place}`
  }
  if (part.location_type === 'PID') return `PID ${part.location_pid || '?'}`
  if (part.location_type === 'CUSTOM') return part.location_number || part.location_data?.custom_code || 'Eigener Lagerort'
  return 'Kein Lagerort'
}

function parseSearchTerm(searchTerm: string): { term: string; scope: SearchScope } {
  const trimmed = searchTerm.trim()
  const prefix = /^(?:(art(?:ikel)?\.?\s*nr\.?|artikelnr\.?)|(lagerort)|(einbauort))\s*:?\s*(.*)$/i.exec(trimmed)
  if (!prefix) return { term: trimmed, scope: null }
  if (prefix[1]) return { term: prefix[4], scope: 'article_number' }
  if (prefix[2]) return { term: prefix[4], scope: 'location' }
  return { term: prefix[4], scope: 'installation_location' }
}

function formatPrice(price: unknown): string | null {
  if (price === null || price === undefined || price === '') return null
  const value = typeof price === 'number' ? price : Number(String(price).replace(',', '.'))
  return Number.isFinite(value) ? value.toFixed(2) : null
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function highlightText(text: string | null | undefined, searchTerm: string, field?: Exclude<SearchScope, null>): ReactNode {
  if (!text) return text ?? ''
  const { term, scope } = parseSearchTerm(searchTerm)
  if ((scope && scope !== field) || !term) return text
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, index) => index % 2 === 1
      ? <mark key={`${part}-${index}`} className="rounded bg-amber-300 px-0.5 text-slate-950">{part}</mark>
      : part)
  } catch {
    return text
  }
}

function InfoCell({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  )
}

export default function SparePartList({ initialFilterStock, initialSearchRequest, onNavigateToHistory }: SparePartListProps) {
  const [allSpareParts, setAllSpareParts] = useState<SparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterInstallationLocation, setFilterInstallationLocation] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStock, setFilterStock] = useState(initialFilterStock || 'all')
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [dialogPart, setDialogPart] = useState<SparePart | null>(null)
  const [dialogAction, setDialogAction] = useState<'in' | 'out' | null>(null)
  const [editPart, setEditPart] = useState<SparePart | null>(null)
  const [history, setHistory] = useState<InventoryLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyReload, setHistoryReload] = useState(0)
  const isAdminUser = pb.authStore.model?.is_admin === true

  const loadSpareParts = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setLoadError(null)
      const data = await getSpareParts()
      setAllSpareParts(data)
    } catch {
      setLoadError('Die Ersatzteile konnten nicht geladen werden. Prüfen Sie die Verbindung zu PocketBase und versuchen Sie es erneut.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSpareParts()
  }, [loadSpareParts])

  useEffect(() => {
    if (initialFilterStock) setFilterStock(initialFilterStock)
  }, [initialFilterStock])

  useEffect(() => {
    if (!initialSearchRequest || initialSearchRequest.id === 0) return
    setSearchTerm(initialSearchRequest.query)
    setFilterLocation('')
    setFilterInstallationLocation('')
    setFilterStock('all')
    setFilterCategory('all')
  }, [initialSearchRequest])

  const categories = useMemo(() => {
    const unique = new Map<string, string>()
    allSpareParts.forEach((part) => {
      if (part.category_id && part.category?.name) unique.set(part.category_id, part.category.name)
    })
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'))
  }, [allSpareParts])

  const locationSuggestions = useMemo(() => [...new Set(
    allSpareParts
      .map(generateLocationCode)
      .filter((location) => location && location !== 'Kein Lagerort'),
  )].sort((a, b) => a.localeCompare(b, 'de')), [allSpareParts])

  const installationLocationSuggestions = useMemo(() => [...new Set(
    allSpareParts
      .map((part) => part.installation_location?.trim() || '')
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'de')), [allSpareParts])

  const spareParts = useMemo(() => {
    let filtered = allSpareParts
    const { term: rawTerm, scope } = parseSearchTerm(searchTerm)
    const term = rawTerm.toLocaleLowerCase('de-DE')
    if (term) {
      filtered = filtered.filter((part) => {
        const locationCode = generateLocationCode(part).toLocaleLowerCase('de-DE')
        if (scope === 'installation_location') return Boolean(part.installation_location?.toLocaleLowerCase('de-DE').includes(term))
        if (scope === 'article_number') return part.article_number.toLocaleLowerCase('de-DE').includes(term)
        if (scope === 'location') {
          return locationCode.includes(term)
            || Boolean(part.location_type?.toLocaleLowerCase('de-DE').includes(term))
            || Boolean(part.location_number?.toLocaleLowerCase('de-DE').includes(term))
            || Boolean(part.location_place?.toLocaleLowerCase('de-DE').includes(term))
            || Boolean(part.location_pid?.toLocaleLowerCase('de-DE').includes(term))
        }
        return part.name.toLocaleLowerCase('de-DE').includes(term)
          || part.article_number.toLocaleLowerCase('de-DE').includes(term)
          || getSparePartDisplayId(part).toLocaleLowerCase('de-DE').includes(term)
          || Boolean(part.installation_location?.toLocaleLowerCase('de-DE').includes(term))
          || Boolean(part.anlage?.toLocaleLowerCase('de-DE').includes(term))
          || Boolean(part.manufacturer?.toLocaleLowerCase('de-DE').includes(term))
          || Boolean(part.supplier?.toLocaleLowerCase('de-DE').includes(term))
          || Boolean(part.category?.name.toLocaleLowerCase('de-DE').includes(term))
          || locationCode.includes(term)
      })
    }
    const locationTerm = filterLocation.trim().toLocaleLowerCase('de-DE')
    if (locationTerm) {
      filtered = filtered.filter((part) => {
        const searchableLocation = [
          generateLocationCode(part),
          part.location_type,
          part.location_number,
          part.location_place,
          part.location_pid,
        ].filter(Boolean).join(' ').toLocaleLowerCase('de-DE')
        return searchableLocation.includes(locationTerm)
      })
    }
    const installationLocationTerm = filterInstallationLocation.trim().toLocaleLowerCase('de-DE')
    if (installationLocationTerm) {
      filtered = filtered.filter((part) => Boolean(
        part.installation_location?.toLocaleLowerCase('de-DE').includes(installationLocationTerm),
      ))
    }
    if (filterCategory !== 'all') filtered = filtered.filter((part) => part.category_id === filterCategory)
    if (filterStock === 'low') filtered = filtered.filter((part) => part.quantity < part.min_quantity)
    return filtered
  }, [allSpareParts, searchTerm, filterCategory, filterStock, filterLocation, filterInstallationLocation])

  const selectedPart = useMemo(
    () => spareParts.find((part) => part.id === selectedPartId) || null,
    [spareParts, selectedPartId],
  )

  useEffect(() => {
    if (spareParts.length === 0) {
      if (selectedPartId !== null) setSelectedPartId(null)
      return
    }
    if (!spareParts.some((part) => part.id === selectedPartId)) setSelectedPartId(spareParts[0].id)
  }, [spareParts, selectedPartId])

  useEffect(() => {
    if (!selectedPart) {
      setHistory([])
      setHistoryLoading(false)
      return
    }
    let active = true
    setHistory([])
    setHistoryLoading(true)
    setHistoryError(null)
    getInventoryLog(selectedPart.id, 5)
      .then((data) => { if (active) setHistory(data) })
      .catch(() => {
        if (active) setHistoryError('Die Bestandsbewegungen konnten nicht geladen werden.')
      })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [selectedPart, historyReload])

  const getStockStatus = (part: SparePart) => part.quantity < part.min_quantity
    ? { label: 'Nachbestellen', icon: AlertTriangle, classes: 'border-amber-800/70 bg-amber-950/50 text-amber-300' }
    : { label: 'OK', icon: CheckCircle2, classes: 'border-emerald-900 bg-emerald-950/45 text-emerald-300' }

  const openMovement = (part: SparePart, action: 'in' | 'out') => {
    if (action === 'out' && part.quantity <= 0) return
    setDialogPart(part)
    setDialogAction(action)
  }

  const handleMovementSuccess = () => {
    void loadSpareParts(true)
    setHistoryReload((value) => value + 1)
    setDialogPart(null)
    setDialogAction(null)
  }

  const handleEditSuccess = () => {
    void loadSpareParts(true)
    setHistoryReload((value) => value + 1)
    setEditPart(null)
  }

  const handleDelete = async (part: SparePart) => {
    if (!confirm(`Möchten Sie „${part.name}“ wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
    try {
      await deleteSparePart(part.id)
      setHistory([])
      await loadSpareParts(true)
    } catch (error) {
      alert(`Fehler beim Löschen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    }
  }

  const movementLabel = (log: InventoryLog) => {
    if (log.reason === 'Lieferung/Wareneingang') return 'Wareneingang'
    if (log.action === 'out') return 'Entnahme'
    if (log.reason) return log.reason
    return 'Zugang'
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 text-slate-400">
        <Activity className="h-4 w-4 animate-spin" /> Bestand wird geladen …
      </div>
    )
  }

  if (loadError) {
    return (
      <section className="rounded-2xl border border-rose-900/70 bg-slate-900 p-6">
        <h1 className="font-semibold text-slate-100">Bestand konnte nicht geladen werden</h1>
        <p className="mt-2 text-sm text-rose-300">{loadError}</p>
        <button type="button" onClick={() => void loadSpareParts()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700">
          <RefreshCw className="h-4 w-4" /> Erneut laden
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-500">Lagerübersicht</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">Bestand</h1>
          <p className="mt-1 text-sm text-slate-500">Artikel wählen, Details prüfen und Bewegungen direkt buchen.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-slate-300">{spareParts.length.toLocaleString('de-DE')}</span>
          <span>Artikel angezeigt</span>
          <button type="button" onClick={() => void loadSpareParts(true)} className="ml-1 rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors duration-150 hover:border-slate-700 hover:text-cyan-300" title="Bestand aktualisieren">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-xl shadow-black/10 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Name, Art.Nr., ID, Lagerort: …, Einbauort: …"
              aria-label="Bestand durchsuchen"
              className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-10 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-600 focus:border-cyan-700 focus:ring-2 focus:ring-cyan-950"
            />
            {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label="Suche leeren" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-slate-500">
              <span className="sr-only">Kategorie</span>
              <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} className="max-w-40 bg-transparent text-sm text-slate-300 outline-none">
                <option value="all" className="bg-slate-900">Alle Kategorien</option>
                {categories.map(([id, name]) => <option key={id} value={id} className="bg-slate-900">{name}</option>)}
              </select>
            </label>
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-slate-500">
              <span className="sr-only">Bestandsstatus</span>
              <select value={filterStock} onChange={(event) => setFilterStock(event.target.value)} className="bg-transparent text-sm text-slate-300 outline-none">
                <option value="all" className="bg-slate-900">Alle Bestände</option>
                <option value="low" className="bg-slate-900">Nachbestellen</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-3 grid gap-3 border-t border-slate-800 pt-3 md:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400"><MapPin className="h-3.5 w-3.5 text-cyan-500" /> Lagerort filtern</span>
            <ExistingTextField
              value={filterLocation}
              onChange={setFilterLocation}
              suggestions={locationSuggestions}
              placeholder="Lagerort eingeben oder auswählen …"
              className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-600 focus:border-cyan-700 focus:ring-2 focus:ring-cyan-950"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400"><MapPin className="h-3.5 w-3.5 text-cyan-500" /> Einbauort filtern</span>
            <ExistingTextField
              value={filterInstallationLocation}
              onChange={setFilterInstallationLocation}
              suggestions={installationLocationSuggestions}
              placeholder="Einbauort eingeben oder auswählen …"
              className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-600 focus:border-cyan-700 focus:ring-2 focus:ring-cyan-950"
            />
          </label>
        </div>
        {isAdminUser && <div className="mt-3 border-t border-slate-800 pt-3"><Suspense fallback={<div className="py-2 text-xs text-slate-500">Lieferschein-Import wird geladen …</div>}><DeliveryNoteJsonImport onImportComplete={() => { void loadSpareParts(true); setHistoryReload((value) => value + 1) }} /></Suspense></div>}
      </section>

      <div className="grid min-h-[690px] gap-4 xl:grid-cols-[minmax(340px,0.92fr)_minmax(0,1.45fr)]">
        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/10">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Artikel</h2>
              <p className="mt-0.5 text-xs text-slate-500">{spareParts.length.toLocaleString('de-DE')} Treffer</p>
            </div>
            <span className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-500">LISTE</span>
          </div>
          {spareParts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
              <Package className="h-8 w-8 text-slate-700" />
              <p className="mt-3 text-sm font-medium text-slate-300">Keine Artikel gefunden</p>
              <p className="mt-1 text-xs text-slate-500">Passe Suche oder Filter an.</p>
            </div>
          ) : (
            <div className="max-h-[72vh] flex-1 divide-y divide-slate-800/80 overflow-y-auto">
              {spareParts.map((part) => {
                const status = getStockStatus(part)
                const StatusIcon = status.icon
                const selected = part.id === selectedPart?.id
                return (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => setSelectedPartId(part.id)}
                    aria-pressed={selected}
                    className={`group w-full border-l-2 px-4 py-3 text-left transition-colors duration-150 ${selected ? 'border-cyan-400 bg-cyan-950/35' : 'border-transparent hover:bg-slate-800/60'}`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${selected ? 'text-slate-50' : 'text-slate-200'}`}>{highlightText(part.name, searchTerm)}</p>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="font-mono text-slate-500">Art.Nr. {highlightText(part.article_number, searchTerm, 'article_number')}</span>
                          <span className="text-slate-700">·</span>
                          <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-md border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-slate-400" title={generateLocationCode(part)}>
                            <MapPin className="h-3 w-3 shrink-0 text-slate-600" />{highlightText(generateLocationCode(part), searchTerm, 'location')}
                          </span>
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${status.classes}`}>
                        <StatusIcon className="h-3 w-3" />{status.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="truncate text-[11px] text-slate-600">{part.category?.name || 'Ohne Kategorie'}</span>
                      <span className={`font-mono text-xs ${part.quantity < part.min_quantity ? 'text-amber-300' : 'text-slate-300'}`}>{part.quantity} <span className="text-slate-600">{part.unit || 'Stk'}</span></span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/10">
          {!selectedPart ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center p-8 text-center">
              <Package className="h-10 w-10 text-slate-700" />
              <p className="mt-3 text-sm font-medium text-slate-300">Artikel auswählen</p>
              <p className="mt-1 text-xs text-slate-500">Details und Bestandsverlauf erscheinen hier.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-800 p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-start">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-500"><Package className="h-3.5 w-3.5" /> Artikel-Inspector</div>
                    <h2 className="mt-2 break-words text-xl font-semibold tracking-tight text-slate-50">{selectedPart.name}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>Art.Nr. <span className="font-mono text-slate-300">{selectedPart.article_number}</span></span>
                      <span className="text-slate-700">·</span>
                      <span>ID <span className="font-mono text-slate-300">{getSparePartDisplayId(selectedPart)}</span></span>
                      {selectedPart.category?.name && <><span className="text-slate-700">·</span><span>{selectedPart.category.name}</span></>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Suspense fallback={<span className="text-xs text-slate-500">QR-Code wird geladen …</span>}><QRCodeGenerator sparePartId={getSparePartDisplayId(selectedPart)} sparePartName={selectedPart.name} /></Suspense>
                    <button type="button" onClick={() => openMovement(selectedPart, 'in')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 text-xs font-medium text-emerald-300 transition-colors duration-150 hover:bg-emerald-900/70" title="Zugang buchen"><Plus className="h-4 w-4" /> Zugang</button>
                    <button type="button" onClick={() => openMovement(selectedPart, 'out')} disabled={selectedPart.quantity <= 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-900 bg-rose-950/40 px-3 text-xs font-medium text-rose-300 transition-colors duration-150 hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-40" title="Entnahme buchen"><span className="text-base leading-none">−</span> Entnahme</button>
                    <button type="button" onClick={() => setEditPart(selectedPart)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-300 transition-colors duration-150 hover:bg-slate-700 hover:text-white"><Pencil className="h-3.5 w-3.5" /> Bearbeiten</button>
                    {isAdminUser && <button type="button" onClick={() => void handleDelete(selectedPart)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-950 bg-slate-950 px-3 text-xs font-medium text-rose-400 transition-colors duration-150 hover:border-rose-800 hover:bg-rose-950/40"><Trash2 className="h-3.5 w-3.5" /> Löschen</button>}
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Stammdaten</h3>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${getStockStatus(selectedPart).classes}`}>{getStockStatus(selectedPart).label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <InfoCell label="Art.Nr." value={selectedPart.article_number} mono />
                    <InfoCell label="ID / QR-Wert" value={getSparePartDisplayId(selectedPart)} mono />
                    <InfoCell label="Lagerort" value={generateLocationCode(selectedPart)} mono />
                    <InfoCell label="Einbauort" value={selectedPart.installation_location || '—'} />
                    <InfoCell label="Bestand / Minimum" value={<><span className="font-mono">{selectedPart.quantity}</span><span className="mx-1 text-slate-600">/</span><span className="font-mono text-slate-400">{selectedPart.min_quantity}</span><span className="ml-1 text-xs text-slate-500">{selectedPart.unit || 'Stk'}</span></>} mono />
                    <InfoCell label="Einheit / Preis" value={<>{selectedPart.unit || '—'}<span className="mx-1 text-slate-600">/</span>{formatPrice(selectedPart.price) !== null ? `${formatPrice(selectedPart.price)} €` : '—'}</>} />
                    <InfoCell label="Anlage" value={selectedPart.anlage || '—'} />
                    <InfoCell label="Hersteller" value={selectedPart.manufacturer || '—'} />
                    <InfoCell label="Lieferant" value={selectedPart.supplier || '—'} />
                  </div>
                </div>

                {(selectedPart.technical_data || selectedPart.description || selectedPart.additional_info || selectedPart.attachment || selectedPart.link) && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Technische Angaben</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      {selectedPart.technical_data && <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Wrench className="h-3.5 w-3.5" /> Technische Daten</div><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{selectedPart.technical_data}</p></div>}
                      {selectedPart.description && <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><FileText className="h-3.5 w-3.5" /> Beschreibung</div><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{selectedPart.description}</p></div>}
                      {selectedPart.additional_info && <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="mb-1 text-xs font-medium text-slate-400">Zusätzliche Angaben</div><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{selectedPart.additional_info}</p></div>}
                      {selectedPart.attachment && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          {selectedPart.attachment.startsWith('data:image/') && <img src={selectedPart.attachment} alt={`Technische Abbildung: ${selectedPart.name}`} loading="lazy" className="mb-3 max-h-48 w-full rounded-lg object-contain" />}
                          <a href={selectedPart.attachment} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ExternalLink className="h-3.5 w-3.5" /> Anhang / Abbildung öffnen</a>
                        </div>
                      )}
                      {selectedPart.link && /^https?:\/\//i.test(selectedPart.link) && <a href={selectedPart.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-cyan-300 transition-colors duration-150 hover:border-slate-700 hover:bg-slate-950"><ExternalLink className="h-3.5 w-3.5" /> Hersteller-/Lieferantenlink</a>}
                    </div>
                  </div>
                )}

                <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-3 sm:px-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><History className="h-4 w-4 text-cyan-500" /> Bestandsverlauf</h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">Letzte Bewegungen für diesen Artikel</p>
                    </div>
                    <button type="button" onClick={() => onNavigateToHistory?.(selectedPart.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors duration-150 hover:border-cyan-900 hover:bg-cyan-950/40 hover:text-cyan-300">
                      Alle anzeigen <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {historyLoading ? (
                    <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-500"><Activity className="h-4 w-4 animate-spin" /> Verlauf wird geladen …</div>
                  ) : historyError ? (
                    <div className="px-4 py-5 text-xs text-rose-300">{historyError}</div>
                  ) : history.length === 0 ? (
                    <div className="px-4 py-6 text-xs text-slate-500">Für diesen Artikel sind noch keine Bewegungen vorhanden.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left text-xs">
                        <thead className="bg-slate-900/70 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 font-medium sm:px-4">Datum</th>
                            <th className="px-3 py-2.5 font-medium">Ereignis</th>
                            <th className="px-3 py-2.5 text-right font-medium">Menge</th>
                            <th className="px-3 py-2.5 text-right font-medium">Neuer Bestand</th>
                            <th className="px-3 py-2.5 font-medium">Benutzer</th>
                            <th className="px-3 py-2.5 font-medium">Bemerkung</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          {history.map((log) => {
                            const isIn = log.action === 'in'
                            const quantityLabel = `${isIn ? '+' : '−'}${Math.abs(log.quantity)} ${selectedPart.unit || 'Stk'}`
                            return (
                              <tr key={log.id} className="text-slate-300">
                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-500 sm:px-4">{formatDate(log.created)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5"><span className={`inline-flex items-center gap-1.5 ${isIn ? 'text-emerald-300' : 'text-rose-300'}`}>{isIn ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{movementLabel(log)}</span></td>
                                <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono ${isIn ? 'text-emerald-300' : 'text-rose-300'}`}>{quantityLabel}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-slate-200">{log.new_quantity} {selectedPart.unit || 'Stk'}</td>
                                <td className="max-w-32 truncate px-3 py-2.5 text-slate-400" title={log.user_name || 'Unbekannt'}>{log.user_name || 'Unbekannt'}</td>
                                <td className="max-w-48 truncate px-3 py-2.5 text-slate-500" title={log.notes || log.reason || ''}>{log.notes || (log.reason === 'Lieferung/Wareneingang' ? '—' : log.reason || '—')}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </section>
      </div>

      {dialogPart && dialogAction && <StockMovementDialog sparePart={dialogPart} action={dialogAction} onClose={() => { setDialogPart(null); setDialogAction(null) }} onSuccess={handleMovementSuccess} />}
      {editPart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <EditSparePartForm sparePart={editPart} onSuccess={handleEditSuccess} onCancel={() => setEditPart(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

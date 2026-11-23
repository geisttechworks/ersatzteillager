import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, History, Printer, Search, X } from 'lucide-react'
import { getInventoryLog, type InventoryLog } from '../lib/pocketbaseServices'

interface HistoryViewProps {
  sparePartId?: string
  limit?: number
  initialDateFrom?: string
}

export default function HistoryView({ sparePartId, limit = 50, initialDateFrom }: HistoryViewProps) {
  const [history, setHistory] = useState<InventoryLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFrom, setDateFrom] = useState(initialDateFrom || '')
  const [dateTo, setDateTo] = useState('')

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getInventoryLog(sparePartId, limit)
      setHistory(data)
    } catch {
      setError('Die Buchungshistorie konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [sparePartId, limit])

  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => { setDateFrom(initialDateFrom || '') }, [initialDateFrom])

  const filteredHistory = useMemo(() => {
    let filtered = [...history]
    const term = searchTerm.toLocaleLowerCase('de-DE').trim()
    if (term) {
      filtered = filtered.filter((log) =>
        log.spare_part?.name?.toLocaleLowerCase('de-DE').includes(term)
        || log.spare_part?.article_number?.toLocaleLowerCase('de-DE').includes(term)
        || log.user_name?.toLocaleLowerCase('de-DE').includes(term)
        || log.reason?.toLocaleLowerCase('de-DE').includes(term)
        || log.supplier?.toLocaleLowerCase('de-DE').includes(term)
        || log.order_number?.toLocaleLowerCase('de-DE').includes(term)
        || log.delivery_note_number?.toLocaleLowerCase('de-DE').includes(term)
        || (log.metadata?.source === 'delivery_note_json_import' && 'lieferschein-import importiert automatisch'.includes(term))
        || log.notes?.toLocaleLowerCase('de-DE').includes(term),
      )
    }
    if (dateFrom) {
      const fromDate = new Date(`${dateFrom}T00:00:00`)
      filtered = filtered.filter((log) => new Date(log.created) >= fromDate)
    }
    if (dateTo) {
      const toDate = new Date(`${dateTo}T23:59:59.999`)
      filtered = filtered.filter((log) => new Date(log.created) <= toDate)
    }
    return filtered
  }, [history, searchTerm, dateFrom, dateTo])

  const filteredPart = history.find((log) => log.spare_part)?.spare_part
  const title = sparePartId ? `Verlauf · ${filteredPart?.name || 'Artikel'}` : 'Buchungshistorie'

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const eventLabel = (log: InventoryLog) => {
    if (log.reason === 'Lieferung/Wareneingang') return 'Wareneingang'
    if (log.action === 'out') return 'Entnahme'
    return log.reason || 'Zugang'
  }

  const resetFilters = () => {
    setSearchTerm('')
    setDateFrom('')
    setDateTo('')
  }

  if (loading) {
    return <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400"><Activity className="h-4 w-4 animate-spin" /> Historie wird geladen …</div>
  }
  if (error) {
    return <div className="rounded-2xl border border-rose-900/60 bg-slate-900 p-6 text-sm text-rose-300">{error}<button type="button" onClick={() => void loadHistory()} className="ml-3 underline">Erneut laden</button></div>
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 sm:p-5">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-500"><History className="h-4 w-4" /> Bewegungsprotokoll</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">{title}</h1>
          {sparePartId && filteredPart?.article_number && <p className="mt-1 font-mono text-xs text-slate-500">Art.Nr. {filteredPart.article_number}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">{filteredHistory.length} / {history.length}</span>
          <button type="button" onClick={() => window.print()} className="desktop-print-only inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 print:hidden"><Printer className="h-4 w-4" /> Drucken</button>
        </div>
      </div>

      <div className="grid gap-2 border-b border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-[minmax(220px,1fr)_170px_170px_auto] sm:p-4 print:hidden">
        <label className="relative block">
          <span className="sr-only">Historie durchsuchen</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Artikel, Benutzer, Grund …" className="h-10 w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-700" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 text-[11px] text-slate-500">
          <span>Von</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 text-[11px] text-slate-500">
          <span>Bis</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none" />
        </label>
        {(searchTerm || dateFrom || dateTo) && <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg px-3 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X className="h-3.5 w-3.5" /> Filter löschen</button>}
      </div>

      {filteredHistory.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500">{history.length ? 'Keine Buchungen für diese Filter.' : 'Keine Buchungen vorhanden.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/50 text-[10px] uppercase tracking-[0.13em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Datum</th>
                {!sparePartId && <th className="px-4 py-3 font-medium">Artikel</th>}
                <th className="px-4 py-3 font-medium">Ereignis</th>
                <th className="px-4 py-3 text-right font-medium">Menge</th>
                <th className="px-4 py-3 text-right font-medium">Neuer Bestand</th>
                <th className="px-4 py-3 font-medium">Benutzer</th>
                <th className="px-4 py-3 font-medium">Bemerkung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredHistory.map((log) => {
                const isIn = log.action === 'in'
                return (
                  <tr key={log.id} className="text-slate-300 transition-colors duration-150 hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{formatDate(log.created)}</td>
                    {!sparePartId && <td className="max-w-64 px-4 py-3"><div className="truncate font-medium text-slate-200">{log.spare_part?.name || 'Unbekannt'}</div><div className="mt-0.5 font-mono text-[11px] text-slate-500">{log.spare_part?.article_number ? `Art.Nr. ${log.spare_part.article_number}` : '—'}</div></td>}
                    <td className="whitespace-nowrap px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs ${isIn ? 'text-emerald-300' : 'text-rose-300'}`}>{isIn ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{eventLabel(log)}</span></td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono text-xs ${isIn ? 'text-emerald-300' : 'text-rose-300'}`}>{isIn ? '+' : '−'}{Math.abs(log.quantity)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-200">{log.new_quantity}</td>
                    <td className="max-w-40 truncate px-4 py-3 text-xs text-slate-400" title={log.user_name || 'Unbekannt'}>{log.user_name || 'Unbekannt'}</td>
                    <td className="max-w-64 px-4 py-3 text-xs text-slate-500"><div className="truncate" title={log.notes || log.reason || ''}>{log.notes || log.reason || log.supplier || '—'}</div>{log.metadata?.source === 'delivery_note_json_import' && <div className="mt-1 inline-flex rounded border border-cyan-900/70 bg-cyan-950/50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">Lieferschein-Import</div>}{log.delivery_note_number && <div className="mt-0.5 truncate text-[10px] text-slate-600">LS {log.delivery_note_number}</div>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

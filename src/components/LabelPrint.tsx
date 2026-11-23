import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlignCenter, Printer, RotateCcw, Ruler } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { getSpareParts, getSparePartDisplayId, type SparePart } from '../lib/pocketbaseServices'

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const SETTINGS_KEY = 'ersatzteillager-label-print-settings-v1'

interface PrintSettings {
  marginLeft: number
  marginTop: number
  gapHorizontal: number
  gapVertical: number
  labelWidth: number
  labelHeight: number
  columns: number
  rows: number
  shiftX: number
  shiftY: number
  startPosition: number
}

const DEFAULT_SETTINGS: PrintSettings = {
  marginLeft: 25,
  marginTop: 28.5,
  gapHorizontal: 0,
  gapVertical: 0,
  labelWidth: 40,
  labelHeight: 40,
  columns: 4,
  rows: 6,
  shiftX: 0,
  shiftY: 0,
  startPosition: 1,
}

function normalizeSettings(value: unknown): PrintSettings {
  const stored = value && typeof value === 'object' ? value as Partial<PrintSettings> : {}
  const number = (key: keyof PrintSettings, fallback: number, min: number, max: number, integer = false) => {
    const candidate = Number(stored[key])
    const finite = Number.isFinite(candidate) ? candidate : fallback
    const bounded = Math.min(max, Math.max(min, finite))
    return integer ? Math.round(bounded) : Math.round(bounded * 10) / 10
  }
  const columns = number('columns', DEFAULT_SETTINGS.columns, 1, 10, true)
  const rows = number('rows', DEFAULT_SETTINGS.rows, 1, 15, true)
  const capacity = columns * rows

  return {
    marginLeft: number('marginLeft', DEFAULT_SETTINGS.marginLeft, 0, PAGE_WIDTH_MM, false),
    marginTop: number('marginTop', DEFAULT_SETTINGS.marginTop, 0, PAGE_HEIGHT_MM, false),
    gapHorizontal: number('gapHorizontal', DEFAULT_SETTINGS.gapHorizontal, 0, 30, false),
    gapVertical: number('gapVertical', DEFAULT_SETTINGS.gapVertical, 0, 30, false),
    labelWidth: number('labelWidth', DEFAULT_SETTINGS.labelWidth, 10, PAGE_WIDTH_MM, false),
    labelHeight: number('labelHeight', DEFAULT_SETTINGS.labelHeight, 10, PAGE_HEIGHT_MM, false),
    columns,
    rows,
    shiftX: number('shiftX', DEFAULT_SETTINGS.shiftX, -10, 10, false),
    shiftY: number('shiftY', DEFAULT_SETTINGS.shiftY, -10, 10, false),
    startPosition: number('startPosition', DEFAULT_SETTINGS.startPosition, 1, capacity, true),
  }
}

function loadSettings(): PrintSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? normalizeSettings(JSON.parse(stored)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function createPages(items: SparePart[], settings: PrintSettings): Array<Array<SparePart | null>> {
  const capacity = settings.columns * settings.rows
  if (items.length === 0) return []

  const pages: Array<Array<SparePart | null>> = []
  const firstPage = Array<SparePart | null>(capacity).fill(null)
  const firstOffset = settings.startPosition - 1
  const firstPageCount = Math.min(capacity - firstOffset, items.length)
  for (let index = 0; index < firstPageCount; index += 1) {
    firstPage[firstOffset + index] = items[index]
  }
  pages.push(firstPage)

  let itemIndex = firstPageCount
  while (itemIndex < items.length) {
    const page = Array<SparePart | null>(capacity).fill(null)
    const count = Math.min(capacity, items.length - itemIndex)
    for (let position = 0; position < count; position += 1) {
      page[position] = items[itemIndex + position]
    }
    pages.push(page)
    itemIndex += count
  }
  return pages
}

function getGridStyle(settings: PrintSettings): CSSProperties {
  return {
    '--label-columns': settings.columns,
    '--label-rows': settings.rows,
    '--label-width': `${settings.labelWidth}mm`,
    '--label-height': `${settings.labelHeight}mm`,
    '--gap-horizontal': `${settings.gapHorizontal}mm`,
    '--gap-vertical': `${settings.gapVertical}mm`,
    '--margin-left': `${settings.marginLeft}mm`,
    '--margin-top': `${settings.marginTop}mm`,
    '--shift-x': `${settings.shiftX}mm`,
    '--shift-y': `${settings.shiftY}mm`,
  } as CSSProperties
}

function MillimeterField({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
  max = 210,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <span className="flex items-center rounded-lg border border-slate-700 bg-slate-950 focus-within:border-cyan-700 focus-within:ring-2 focus-within:ring-cyan-950">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const nextValue = Number(draft)
            if (draft.trim() && Number.isFinite(nextValue)) onChange(nextValue)
            else setDraft(String(value))
          }}
          className="w-full min-w-0 border-0 bg-transparent px-3 py-2 text-sm text-slate-100 outline-none focus:ring-0"
        />
        <span className="pr-3 text-xs text-slate-500">mm</span>
      </span>
    </label>
  )
}

function CountField({
  label,
  value,
  onChange,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  max: number
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        min={1}
        max={max}
        step={1}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          if (Number.isFinite(nextValue)) onChange(nextValue)
        }}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-950"
      />
    </label>
  )
}

export default function LabelPrint() {
  const [spareParts, setSpareParts] = useState<SparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PrintSettings>(loadSettings)
  const [testPrint, setTestPrint] = useState(false)

  useEffect(() => {
    let active = true
    const loadSpareParts = async () => {
      try {
        setLoading(true)
        const data = await getSpareParts()
        if (active) setSpareParts(data)
      } catch {
        if (active) setError('Fehler beim Laden der Ersatzteile')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadSpareParts()
    return () => { active = false }
  }, [])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const resetTestMode = () => setTestPrint(false)
    window.addEventListener('afterprint', resetTestMode)
    return () => window.removeEventListener('afterprint', resetTestMode)
  }, [])

  const labelsPerPage = settings.columns * settings.rows
  const pages = useMemo(() => createPages(spareParts, settings), [spareParts, settings])
  const firstPageSlots = pages[0] || Array<SparePart | null>(labelsPerPage).fill(null)
  const gridStyle = getGridStyle(settings)
  const gridWidth = settings.columns * settings.labelWidth + (settings.columns - 1) * settings.gapHorizontal
  const gridHeight = settings.rows * settings.labelHeight + (settings.rows - 1) * settings.gapVertical
  const leftEdge = settings.marginLeft + settings.shiftX
  const topEdge = settings.marginTop + settings.shiftY
  const fitsPage = leftEdge >= 0 && topEdge >= 0
    && leftEdge + gridWidth <= PAGE_WIDTH_MM
    && topEdge + gridHeight <= PAGE_HEIGHT_MM

  const updateSetting = (key: keyof PrintSettings, value: number) => {
    setSettings((current) => normalizeSettings({ ...current, [key]: value }))
  }

  const centerGrid = () => {
    setSettings((current) => normalizeSettings({
      ...current,
      marginLeft: (PAGE_WIDTH_MM - (current.columns * current.labelWidth + (current.columns - 1) * current.gapHorizontal)) / 2,
      marginTop: (PAGE_HEIGHT_MM - (current.rows * current.labelHeight + (current.rows - 1) * current.gapVertical)) / 2,
    }))
  }

  const resetSettings = () => setSettings(DEFAULT_SETTINGS)

  const print = (isTestPrint: boolean) => {
    setTestPrint(isTestPrint)
    window.setTimeout(() => window.print(), 80)
  }

  const renderLabel = (part: SparePart | null, key: string | number, isTest = false) => (
    <div key={key} className={`label-cell ${part ? '' : 'label-cell-empty'} ${isTest ? 'label-cell-test' : ''}`}>
      {!isTest && part && (
        <>
          <div className="label-qr">
            <QRCodeSVG value={getSparePartDisplayId(part)} size={260} level="H" includeMargin />
          </div>
          <div className="label-article-number" title={`Art.Nr. ${part.article_number}`}>Art.Nr. {part.article_number}</div>
          <div className="label-description" title={part.name}>{part.name}</div>
        </>
      )}
    </div>
  )

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold text-slate-100">Etikettendruck</h1>
        <p className="mt-2 text-sm text-slate-400">Ersatzteile werden geladen …</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-rose-900/70 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold text-slate-100">Etikettendruck</h1>
        <p className="mt-2 text-sm text-rose-300">{error}</p>
      </section>
    )
  }

  return (
    <div className="label-print-root space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-200 shadow-xl shadow-black/10 sm:p-6" data-test-print={testPrint ? 'true' : 'false'}>
      <style>{`
        .label-page-preview {
          position: relative;
          width: 210mm;
          height: 297mm;
          overflow: hidden;
          background: #fff;
          color: #000;
          box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
        }
        .label-grid {
          position: absolute;
          left: calc(var(--margin-left) + var(--shift-x));
          top: calc(var(--margin-top) + var(--shift-y));
          display: grid;
          grid-template-columns: repeat(var(--label-columns), var(--label-width));
          grid-template-rows: repeat(var(--label-rows), var(--label-height));
          column-gap: var(--gap-horizontal);
          row-gap: var(--gap-vertical);
          width: max-content;
          height: max-content;
        }
        .label-cell {
          box-sizing: border-box;
          display: flex;
          width: var(--label-width);
          height: var(--label-height);
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          overflow: hidden;
          border: 0.15mm solid #cbd5e1;
          padding: 0.75mm;
          background: #fff;
          color: #000;
          text-align: center;
        }
        .label-qr {
          display: flex;
          width: 26mm;
          height: 26mm;
          flex: 0 0 26mm;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.25mm;
          background: #fff;
        }
        .label-qr svg {
          display: block;
          width: 26mm !important;
          height: 26mm !important;
        }
        .label-article-number {
          width: 100%;
          overflow: hidden;
          flex: 0 0 auto;
          font-family: Arial, sans-serif;
          font-size: 2.7mm;
          font-weight: 700;
          line-height: 3mm;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .label-description {
          display: -webkit-box;
          width: 100%;
          max-height: 6.2mm;
          overflow: hidden;
          font-family: Arial, sans-serif;
          font-size: 2.6mm;
          line-height: 3.1mm;
          overflow-wrap: anywhere;
          text-align: center;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          *, *::before, *::after {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body, #root {
            width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          body * { visibility: hidden !important; }
          .label-print-root, .label-print-root * { visibility: visible !important; }
          .label-print-root {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 210mm !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            box-shadow: none !important;
          }
          .label-print-root > * { margin: 0 !important; }
          .label-screen-controls, .label-screen-preview { display: none !important; }
          .label-print-output { display: block !important; margin: 0 !important; padding: 0 !important; }
          .label-page-preview {
            position: relative !important;
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            overflow: hidden !important;
            background: #fff !important;
            box-shadow: none !important;
            page-break-after: always;
            break-after: page;
          }
          .label-page-preview:last-child { page-break-after: auto; break-after: auto; }
          .label-cell {
            border: 0 !important;
            border-radius: 0 !important;
            padding: 0.75mm !important;
            background: #fff !important;
            color: #000 !important;
          }
          .label-cell-test { border: 0.15mm solid #000 !important; }
          .label-cell-test > * { display: none !important; }
          .label-article-number, .label-description { color: #000 !important; }
        }
      `}</style>

      <section className="label-screen-controls space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-500"><Ruler className="h-4 w-4" /> Bogendruck · Artikel 9642</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">Etikettendruck</h1>
            <p className="mt-1 text-sm text-slate-400">DIN A4 · 24 QR-Code-Etiketten · 40 × 40 mm · {spareParts.length.toLocaleString('de-DE')} Artikel</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => print(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700">
              <Ruler className="h-4 w-4" /> Testdruck
            </button>
            <button type="button" onClick={() => print(false)} disabled={spareParts.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">
              <Printer className="h-4 w-4" /> {pages.length > 1 ? `${pages.length} Seiten drucken` : 'Etiketten drucken'}
            </button>
          </div>
        </header>

        <div className="grid gap-5 2xl:grid-cols-[minmax(320px,390px)_1fr]">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Druckeinstellungen</h2>
                <p className="mt-1 text-xs text-slate-500">Werte in Millimetern · automatisch im Browser gespeichert</p>
              </div>
              <button type="button" onClick={resetSettings} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800">
                <RotateCcw className="h-3.5 w-3.5" /> Zurücksetzen
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MillimeterField label="Rand links" value={settings.marginLeft} onChange={(value) => updateSetting('marginLeft', value)} max={PAGE_WIDTH_MM} />
              <MillimeterField label="Rand oben" value={settings.marginTop} onChange={(value) => updateSetting('marginTop', value)} max={PAGE_HEIGHT_MM} />
              <MillimeterField label="Abstand horizontal" value={settings.gapHorizontal} onChange={(value) => updateSetting('gapHorizontal', value)} max={30} />
              <MillimeterField label="Abstand vertikal" value={settings.gapVertical} onChange={(value) => updateSetting('gapVertical', value)} max={30} />
              <MillimeterField label="Etikettenbreite" value={settings.labelWidth} onChange={(value) => updateSetting('labelWidth', value)} min={10} max={PAGE_WIDTH_MM} />
              <MillimeterField label="Etikettenhöhe" value={settings.labelHeight} onChange={(value) => updateSetting('labelHeight', value)} min={10} max={PAGE_HEIGHT_MM} />
              <CountField label="Anzahl Spalten" value={settings.columns} onChange={(value) => updateSetting('columns', value)} max={10} />
              <CountField label="Anzahl Reihen" value={settings.rows} onChange={(value) => updateSetting('rows', value)} max={15} />
              <MillimeterField label="Verschiebung X" value={settings.shiftX} onChange={(value) => updateSetting('shiftX', value)} min={-10} max={10} />
              <MillimeterField label="Verschiebung Y" value={settings.shiftY} onChange={(value) => updateSetting('shiftY', value)} min={-10} max={10} />
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Startposition auf dem Bogen</span>
                <select value={settings.startPosition} onChange={(event) => updateSetting('startPosition', Number(event.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-950">
                  {Array.from({ length: labelsPerPage }, (_, index) => <option key={index + 1} value={index + 1}>Etikett {index + 1} · {index + 1} von {labelsPerPage}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">Vor der Startposition bleiben die Felder auf der ersten Seite leer.</span>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-500">Raster: {gridWidth.toFixed(1)} × {gridHeight.toFixed(1)} mm</p>
              <button type="button" onClick={centerGrid} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-900/70 bg-cyan-950/40 px-3 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-950/70">
                <AlignCenter className="h-4 w-4" /> Zentrieren
              </button>
            </div>
            {!fitsPage && <p className="mt-3 rounded-lg border border-amber-900/70 bg-amber-950/30 p-2.5 text-xs text-amber-200">Das Raster reicht mit diesen Werten über das A4-Blatt hinaus. Bitte Maße, Ränder oder Abstände anpassen.</p>}
          </section>

          <section className="label-screen-preview min-w-0 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Maßstabsgetreue Vorschau</h2>
                <p className="mt-1 text-xs text-slate-500">Erste A4-Seite · {labelsPerPage} Felder · Rasterstart bei Etikett {settings.startPosition}</p>
              </div>
              <span className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-400">210 × 297 mm</span>
            </div>
            <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="label-page-preview mx-auto" style={{ width: '210mm', height: '297mm' }}>
                <div className="label-grid" style={gridStyle}>
                  {firstPageSlots.map((part, index) => (
                    <div key={part?.id || `empty-${index}`} className={`label-cell ${part ? '' : 'label-cell-empty'}`}>
                      {part && (
                        <>
                          <div className="label-qr"><QRCodeSVG value={getSparePartDisplayId(part)} size={260} level="H" includeMargin /></div>
                          <div className="label-article-number" title={`Art.Nr. ${part.article_number}`}>Art.Nr. {part.article_number}</div>
                          <div className="label-description" title={part.name}>{part.name}</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">Die Vorschau nutzt dieselben Maße und Abstände wie der Druck. Im Druckdialog „Tatsächliche Größe“ oder 100 % wählen.</p>
          </section>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-xs text-slate-400">
          QR-Code = interne Artikel-ID. Unter dem Code stehen Artikelnummer und Bezeichnung. Etiketten nach dem 24. Feld beginnen automatisch auf einem neuen A4-Blatt.
        </div>
      </section>

      <div className={`label-print-output ${testPrint ? 'test-print' : ''}`} style={{ display: 'none' }}>
        {testPrint ? (
          <div className="label-page-preview">
            <div className="label-grid" style={gridStyle}>
              {Array.from({ length: labelsPerPage }, (_, index) => renderLabel(null, `test-${index}`, true))}
            </div>
          </div>
        ) : pages.map((page, pageIndex) => (
          <div key={`page-${pageIndex}`} className="label-page-preview">
            <div className="label-grid" style={gridStyle}>
              {page.map((part, index) => renderLabel(part, part?.id || `empty-${pageIndex}-${index}`))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

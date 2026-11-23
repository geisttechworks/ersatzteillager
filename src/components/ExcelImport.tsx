import { useState } from 'react';
import { importExcelFile, downloadImportReport, type ImportResult } from '../lib/excelImport';
import pb from '../lib/pocketbase';

interface ExcelImportProps {
  onSuccess?: () => void;
}

export default function ExcelImport({ onSuccess }: ExcelImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const hasExcelExtension = /\.xlsx?$/i.test(selectedFile.name);
      
      if (hasExcelExtension && selectedFile.size > 0 && selectedFile.size <= 20 * 1024 * 1024) {
        setFile(selectedFile);
        setError(null);
        setResult(null);
      } else {
        setError('Bitte eine Excel-Datei (.xlsx oder .xls) bis maximal 20 MB auswählen.');
        setFile(null);
      }
    }
  };

  const handleImport = async () => {
    if (!file) return;
    if (pb.authStore.model?.is_admin !== true) {
      setError('Der Excel-Import ist nur für Administratoren verfügbar.');
      return;
    }

    try {
      setImporting(true);
      setError(null);
      
      const importResult = await importExcelFile(file);
      setResult(importResult);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Import');
    } finally {
      setImporting(false);
    }
  };

  if (pb.authStore.model?.is_admin !== true) {
    return <p role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 p-4 text-rose-200">Der Excel-Import ist nur für Administratoren verfügbar.</p>;
  }

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-slate-100 mb-4">
        📥 Excel-Import
      </h2>

      <div className="space-y-4">
        {/* Datei-Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Excel-Datei auswählen (.xlsx oder .xls)
          </label>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={handleFileChange}
            className="w-full px-4 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
          />
        </div>

        {/* Datei-Info */}
        {file && (
          <div className="bg-blue-950/40 border border-blue-900/70 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📄</span>
              <div>
                <p className="font-medium text-blue-200">{file.name}</p>
                <p className="text-sm text-blue-300">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleImport}
            disabled={!file || importing}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {importing ? '🔄 Importiere...' : '📥 Importieren'}
          </button>
          <button
            onClick={handleReset}
            disabled={importing}
            className="flex-1 bg-slate-950/600 hover:bg-slate-600 disabled:bg-slate-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            🔄 Zurücksetzen
          </button>
        </div>

        {/* Ergebnis */}
        {result && (
          <div className="space-y-4">
            <div className="bg-emerald-950/30 border border-emerald-900/70 rounded-lg p-4">
              <h3 className="font-semibold text-emerald-200 mb-2">
                ✅ Import abgeschlossen
              </h3>
              <div className="text-emerald-300 space-y-1">
                <p>{result.success} Ersatzteil{result.success !== 1 ? 'e' : ''} erfolgreich importiert</p>
                {result.skipped > 0 && (
                  <p>{result.skipped} Zeile{result.skipped !== 1 ? 'n' : ''} übersprungen</p>
                )}
                {result.warnings.length > 0 && (
                  <p>{result.warnings.length} Hinweis{result.warnings.length !== 1 ? 'e' : ''} (z. B. ungültige Links ausgelassen)</p>
                )}
                {result.errors.length > 0 && (
                  <p>{result.errors.length} Fehler</p>
                )}
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="bg-amber-950/30 border border-amber-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-amber-200 mb-2">
                  ℹ️ Hinweise ({result.warnings.length})
                </h3>
                <ul className="text-sm text-amber-300 space-y-1 max-h-48 overflow-y-auto">
                  {result.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.skippedRows.length > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-200 mb-2">
                  ⚠️ Übersprungene Zeilen ({result.skippedRows.length})
                </h3>
                <div className="text-sm text-yellow-300 max-h-48 overflow-y-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-yellow-800">
                        <th className="py-1 px-2">Zeile</th>
                        <th className="py-1 px-2">Bezeichnung</th>
                        <th className="py-1 px-2">Artikel-Nr</th>
                        <th className="py-1 px-2">Grund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.skippedRows.map((row, index) => (
                        <tr key={index} className="border-b border-yellow-900/70">
                          <td className="py-1 px-2">{row.rowNumber}</td>
                          <td className="py-1 px-2">{row.designation}</td>
                          <td className="py-1 px-2">{row.articleNumber}</td>
                          <td className="py-1 px-2">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-rose-200 mb-2">
                  ⚠️ {result.errors.length} Fehler
                </h3>
                <ul className="text-sm text-rose-300 space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={() => {
                  if (file) {
                    downloadImportReport(result, file.name);
                  }
                }}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                📄 Auswertung herunterladen
              </button>
              <button
                onClick={() => {
                  handleReset();
                  if (onSuccess) onSuccess();
                }}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                ✅ Fertig
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-4">
            <p className="text-rose-200">{error}</p>
          </div>
        )}

        {/* Hinweise */}
        <div className="bg-slate-950/60 rounded-lg p-4 text-sm text-slate-400">
          <h4 className="font-semibold mb-2">Hinweise zum Excel-Format:</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Spalten müssen folgenden Namen haben: <code>Bezeichnung</code>, <code>Artikel Nr:</code>, <code>Technische Daten</code>, <code>Zusätzliche Angaben</code>, <code>Lagerort</code>, <code>Ist</code>, <code>Soll</code>, <code>Einheit</code>, <code>Hersteller</code>, <code>Lieferant</code>, <code>Link</code>, <code>Preis</code></li>
            <li>Lagerorte werden übernommen (als benutzerdefinierter Lagerort)</li>
            <li>Artikelnummern werden übernommen oder automatisch generiert (ab 2000)</li>
            <li>Excel-IDs werden als ursprüngliche ID übernommen und in der App angezeigt</li>
            <li>QR-Codes werden automatisch zur Identifikation generiert</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

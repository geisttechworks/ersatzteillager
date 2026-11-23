import { useState, useEffect } from 'react';
import { Package, AlertTriangle, Activity, CheckCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { getStatistics } from '../lib/pocketbaseServices';

interface DashboardProps {
  onNavigateToLowStock?: () => void;
  onNavigateToHistory?: () => void;
}

export default function Dashboard({ onNavigateToLowStock, onNavigateToHistory }: DashboardProps) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getStatistics>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getStatistics();
      setStats(data);
    } catch {
      setError('Statistiken konnten nicht geladen werden. Prüfen Sie die Verbindung zu PocketBase und versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10">
        <div className="flex items-center justify-center h-32 gap-3">
          <Activity className="w-5 h-5 text-slate-400 animate-spin" />
          <span className="text-slate-400">Statistiken werden geladen...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-900/70 bg-slate-900 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 flex-shrink-0 mt-0.5 text-rose-400" />
          <div className="flex-1">
            <h3 className="mb-2 text-lg font-semibold text-rose-200">Fehler</h3>
            <p className="mb-4 text-rose-300">{error}</p>
            <button 
              onClick={loadStatistics}
              className="rounded-lg bg-rose-700 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-600"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10">
        <div className="flex items-center justify-center h-32 gap-3">
          <Package className="w-5 h-5 text-slate-400" />
          <span className="text-slate-400">Keine Daten verfügbar</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Übersicht-Karten */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400">Gesamt Ersatzteile</p>
              <p className="mt-1 text-3xl font-bold text-slate-100">{stats.totalSpareParts || 0}</p>
            </div>
            <div className="rounded-xl border border-indigo-900/70 bg-indigo-950/60 p-3 text-indigo-300">
              <Package className="w-6 h-6" />
            </div>
          </div>
        </div>

        <div
          onClick={onNavigateToLowStock}
          className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10 transition-colors duration-150 hover:border-rose-900 hover:bg-slate-800/80"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400">Unter Mindestbestand</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{stats.lowStockCount || 0}</p>
            </div>
            <div className="rounded-xl border border-rose-900/70 bg-rose-950/50 p-3 text-rose-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div
          onClick={onNavigateToHistory}
          className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10 transition-colors duration-150 hover:border-blue-900 hover:bg-slate-800/80"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400">Letzte Aktivitäten</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{stats.recentActivity?.length || 0}</p>
            </div>
            <div className="rounded-xl border border-blue-900/70 bg-blue-950/50 p-3 text-blue-300">
              <Activity className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Mindestbestand-Warnungen */}
      {stats.lowStockItems && stats.lowStockItems.length > 0 && (
        <div className="rounded-xl border border-amber-900/70 border-l-4 border-l-amber-500 bg-amber-950/20 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-amber-200">
            <AlertTriangle className="w-5 h-5" />
            Teile unter Mindestbestand
          </h2>
          <div className="space-y-3">
            {stats.lowStockItems.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="flex-1">
                  <p className="font-semibold text-slate-100">{item.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {item.article_number} • {item.location?.name || 'Kein Lagerort'}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <div className="text-right">
                    <p className="text-lg font-bold text-rose-300">{item.quantity} / {item.min_quantity}</p>
                    <p className="text-xs text-slate-500">Bestand / Mindest</p>
                  </div>
                  <div className="rounded-lg border border-rose-900/70 bg-rose-950/60 px-3 py-1.5 text-sm font-medium text-rose-300">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Low
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Letzte Aktivitäten */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-100">
          <Activity className="w-5 h-5" />
          Letzte Aktivitäten
        </h2>
        {!stats.recentActivity || stats.recentActivity.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <CheckCircle className="w-5 h-5 mr-2" />
            <span className="text-sm">Noch keine Aktivitäten</span>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.recentActivity.map((log: any, index: number) => (
              <div key={log.id} className={`pb-3 ${index !== stats.recentActivity.length - 1 ? 'border-b border-slate-800' : ''}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium text-slate-100">
                      {log.spare_part?.name || 'Unbekannt'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                        log.action === 'in' 
                          ? 'border border-emerald-900/70 bg-emerald-950/50 text-emerald-300' 
                          : 'border border-orange-900/70 bg-orange-950/50 text-orange-300'
                      }`}>
                        {log.action === 'in' ? (
                          <><ArrowUp className="w-3 h-3" /> Eingang</>
                        ) : (
                          <><ArrowDown className="w-3 h-3" /> Ausgang</>
                        )}
                      </span>
                      <span className="text-sm text-slate-400">{log.quantity} Stück</span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <div className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs font-medium text-slate-400">
                      {new Date(log.timestamp).toLocaleDateString('de-DE')}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(log.timestamp).toLocaleTimeString('de-DE')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

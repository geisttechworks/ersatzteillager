import { useState, useEffect } from 'react';
import { FolderOpen, Download, CheckCircle, AlertCircle, X } from 'lucide-react';
import {
  selectBackupDirectory,
  createBackup,
  getBackupSettings,
  updateBackupSettings,
  supportsDirectoryPicker,
  downloadBackup,
  type BackupSettings as BackupSettingsType
} from '../lib/backupService';

interface BackupSettingsProps {
  onClose: () => void;
}

interface BackupSettingsProps {
  onClose: () => void;
}

export default function BackupSettings({ onClose }: BackupSettingsProps) {
  const [settings, setSettings] = useState<BackupSettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await getBackupSettings();
      setSettings(data as BackupSettingsType);
    } catch {
      setBackupMessage({ type: 'error', text: 'Backup-Einstellungen konnten nicht geladen werden.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDirectory = async () => {
    const result = await selectBackupDirectory();
    if (result.success) {
      setBackupMessage({ type: 'success', text: result.message });
      await loadSettings();
    } else {
      setBackupMessage({ type: 'error', text: result.message });
    }
    setTimeout(() => setBackupMessage(null), 5000);
  };

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    setBackupMessage(null);

    const result = await createBackup();
    setBackupMessage({
      type: result.success ? 'success' : 'error',
      text: result.message
    });

    if (result.success) {
      await loadSettings();
    }

    setIsBackingUp(false);
    setTimeout(() => setBackupMessage(null), 5000);
  };

  const handleDownloadBackup = async () => {
    setIsBackingUp(true);
    try {
      await downloadBackup();
      setBackupMessage({ type: 'success', text: 'Backup als Download gestartet' });
    } catch {
      setBackupMessage({ type: 'error', text: 'Download fehlgeschlagen' });
    }
    setIsBackingUp(false);
    setTimeout(() => setBackupMessage(null), 5000);
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    await updateBackupSettings({ backupEnabled: enabled } as Partial<BackupSettingsType>);
    await loadSettings();
  };

  const handleIntervalChange = async (interval: 'daily' | 'weekly') => {
    await updateBackupSettings({ backupInterval: interval } as Partial<BackupSettingsType>);
    await loadSettings();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-slate-900 rounded-xl p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        </div>
      </div>
    );
  }

  const lastBackupDate = settings?.lastBackupDate
    ? new Date(settings.lastBackupDate).toLocaleString('de-DE')
    : 'Noch nie';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-100">Backup-Einstellungen</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-slate-800"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Browser-Unterstützung */}
        {!supportsDirectoryPicker() && (
          <div className="bg-amber-950/30 border border-amber-900/70 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">Browser unterstützt keine Ordner-Auswahl</p>
                <p className="text-sm text-amber-300 mt-1">
                  Bitte Chrome oder Edge verwenden für automatische Backups. Aktuell können Backups nur als Download heruntergeladen werden.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Backup-Ordner */}
        {supportsDirectoryPicker() && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Backup-Ordner</label>
            {settings?.directoryHandle ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-950/30 border border-emerald-900/70 rounded-lg">
                <CheckCircle className="w-5 h-5 text-emerald-300" />
                <span className="text-sm text-emerald-200 flex-1">Ordner ausgewählt</span>
                <button
                  onClick={handleSelectDirectory}
                  className="text-sm text-indigo-300 hover:text-indigo-300 font-medium"
                >
                  Ändern
                </button>
              </div>
            ) : (
              <button
                onClick={handleSelectDirectory}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-500 hover:bg-indigo-950/40 transition-colors"
              >
                <FolderOpen className="w-5 h-5 text-slate-600" />
                <span className="text-sm font-medium text-slate-700">Ordner auswählen</span>
              </button>
            )}
          </div>
        )}

        {/* Backup aktivieren */}
        {supportsDirectoryPicker() && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Automatisches Backup</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleToggleEnabled(!settings?.backupEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings?.backupEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-slate-900 rounded-full transition-transform ${
                    settings?.backupEnabled ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
              <span className="text-sm text-slate-700">
                {settings?.backupEnabled ? 'Aktiviert' : 'Deaktiviert'}
              </span>
            </div>
          </div>
        )}

        {/* Backup-Intervall */}
        {supportsDirectoryPicker() && settings?.backupEnabled && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Backup-Intervall</label>
            <select
              value={settings?.backupInterval || 'daily'}
              onChange={(e) => handleIntervalChange(e.target.value as 'daily' | 'weekly')}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            >
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
            </select>
          </div>
        )}

        {/* Letztes Backup */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">Letztes Backup</label>
          <p className="text-sm text-slate-600">{lastBackupDate}</p>
        </div>

        {/* Backup-Buttons */}
        <div className="space-y-3">
          {supportsDirectoryPicker() ? (
            <button
              onClick={handleCreateBackup}
              disabled={isBackingUp || !settings?.directoryHandle}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              {isBackingUp ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Backup wird erstellt...</span>
                </>
              ) : (
                <>
                  <FolderOpen className="w-5 h-5" />
                  <span>Backup jetzt erstellen</span>
                </>
              )}
            </button>
          ) : null}
          <button
            onClick={handleDownloadBackup}
            disabled={isBackingUp}
            className="w-full flex items-center justify-center gap-2 border border-indigo-700 bg-slate-900 hover:bg-indigo-950 disabled:opacity-50 text-indigo-200 font-medium py-3 px-4 rounded-lg transition-colors"
          >
            <Download className="w-5 h-5" />
            <span>Backup herunterladen</span>
          </button>
        </div>

        {/* Message */}
        {backupMessage && (
          <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
            backupMessage.type === 'success' ? 'bg-emerald-950/30 text-emerald-200' : 'bg-rose-950/40 text-rose-200'
          }`}>
            {backupMessage.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="text-sm">{backupMessage.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

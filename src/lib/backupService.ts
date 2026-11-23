import { getSpareParts, getInventoryLog, type SparePart, type InventoryLog } from './pocketbaseServices';
import * as XLSX from 'xlsx';

// Type Extensions for File System Access API
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    queryPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  }
}

// IndexedDB Setup
const DB_NAME = 'ErsatzteillagerBackup';
const DB_VERSION = 1;
const STORE_NAME = 'settings';

export interface BackupSettings {
  directoryHandle?: FileSystemDirectoryHandle;
  lastBackupDate?: string;
  backupEnabled: boolean;
  backupInterval: 'daily' | 'weekly';
}

// IndexedDB Funktionen
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getSettings(): Promise<BackupSettings> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('backupSettings');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const defaultSettings: BackupSettings = {
        backupEnabled: true,
        backupInterval: 'daily'
      };
      resolve(request.result || defaultSettings);
    };
  });
}

async function saveSettings(settings: BackupSettings): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(settings, 'backupSettings');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Alle Daten laden (für Backup) - PocketBase hat kein 1000er Limit
export async function getAllSpareParts(): Promise<SparePart[]> {
  return getSpareParts();
}

export async function getAllInventoryLog(): Promise<InventoryLog[]> {
  return getInventoryLog();
}

// Excel-Export
export async function exportToExcel(data: any[]): Promise<Blob> {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daten');
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Backup erstellen
export async function createBackup(directoryHandle?: FileSystemDirectoryHandle): Promise<{ success: boolean; message: string }> {
  try {
    const settings = await getSettings();
    const dirHandle = directoryHandle || settings.directoryHandle;

    if (!dirHandle) {
      return { success: false, message: 'Kein Backup-Ordner ausgewählt' };
    }

    // Prüfe ob Berechtigung noch besteht (falls Browser unterstützt)
    if (dirHandle.queryPermission && dirHandle.requestPermission) {
      const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const request = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (request !== 'granted') {
          return { success: false, message: 'Zugriff auf Ordner verweigert' };
        }
      }
    }

    // Datum für Dateinamen
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Alle Daten laden
    const spareParts = await getAllSpareParts();
    const inventoryLog = await getAllInventoryLog();

    // Excel-Dateien erstellen
    const sparePartsBlob = await exportToExcel(spareParts);
    const inventoryLogBlob = await exportToExcel(inventoryLog);

    // Dateien speichern
    const sparePartsFile = await dirHandle.getFileHandle(`Bestand_${dateStr}.xlsx`, { create: true });
    const writable1 = await sparePartsFile.createWritable();
    await writable1.write(sparePartsBlob);
    await writable1.close();

    const inventoryLogFile = await dirHandle.getFileHandle(`Buchungen_${dateStr}.xlsx`, { create: true });
    const writable2 = await inventoryLogFile.createWritable();
    await writable2.write(inventoryLogBlob);
    await writable2.close();

    // Backup-Zeitstempel speichern
    await saveSettings({
      ...settings,
      lastBackupDate: now.toISOString(),
      directoryHandle: dirHandle
    });

    return { success: true, message: `Backup erfolgreich erstellt (${spareParts.length} Artikel, ${inventoryLog.length} Buchungen)` };
  } catch (error) {
    return { success: false, message: `Backup fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}` };
  }
}

// Prüfe ob Backup nötig ist
export async function shouldBackup(): Promise<boolean> {
  const settings = await getSettings();

  if (!settings.backupEnabled || !settings.directoryHandle) {
    return false;
  }

  if (!settings.lastBackupDate) {
    return true;
  }

  const lastBackup = new Date(settings.lastBackupDate);
  const now = new Date();
  const hoursSinceBackup = (now.getTime() - lastBackup.getTime()) / (1000 * 60 * 60);

  if (settings.backupInterval === 'daily') {
    return hoursSinceBackup >= 24;
  } else if (settings.backupInterval === 'weekly') {
    return hoursSinceBackup >= 168; // 7 * 24
  }

  return false;
}

// Ordner auswählen
export async function selectBackupDirectory(): Promise<{ success: boolean; message: string }> {
  try {
    if (!window.showDirectoryPicker) {
      return { success: false, message: 'Browser unterstützt keine Ordner-Auswahl. Bitte Chrome oder Edge verwenden.' };
    }

    const dirHandle = await window.showDirectoryPicker();

    const settings = await getSettings();
    await saveSettings({
      ...settings,
      directoryHandle: dirHandle
    });

    return { success: true, message: 'Backup-Ordner ausgewählt' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'Ordner-Auswahl abgebrochen' };
    }
    return { success: false, message: `Fehler bei Ordner-Auswahl: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}` };
  }
}

// Backup-Settings abrufen
export async function getBackupSettings(): Promise<BackupSettings> {
  return getSettings();
}

// Backup-Settings speichern
export async function updateBackupSettings(settings: Partial<BackupSettings>): Promise<void> {
  const currentSettings = await getSettings();
  await saveSettings({ ...currentSettings, ...settings });
}

// Prüfe ob Browser Ordner-Auswahl unterstützt
export function supportsDirectoryPicker(): boolean {
  return 'showDirectoryPicker' in window;
}

// Backup als Download (Fallback für Browser ohne showDirectoryPicker)
export async function downloadBackup(): Promise<void> {
  const spareParts = await getAllSpareParts();
  const inventoryLog = await getAllInventoryLog();

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const sparePartsBlob = await exportToExcel(spareParts);
  const inventoryLogBlob = await exportToExcel(inventoryLog);

  // Download-Links erstellen
  const sparePartsUrl = URL.createObjectURL(sparePartsBlob);
  const inventoryLogUrl = URL.createObjectURL(inventoryLogBlob);

  const sparePartsLink = document.createElement('a');
  sparePartsLink.href = sparePartsUrl;
  sparePartsLink.download = `Bestand_${dateStr}.xlsx`;
  sparePartsLink.click();

  const inventoryLogLink = document.createElement('a');
  inventoryLogLink.href = inventoryLogUrl;
  inventoryLogLink.download = `Buchungen_${dateStr}.xlsx`;
  inventoryLogLink.click();

  // URLs freigeben
  setTimeout(() => {
    URL.revokeObjectURL(sparePartsUrl);
    URL.revokeObjectURL(inventoryLogUrl);
  }, 100);
}

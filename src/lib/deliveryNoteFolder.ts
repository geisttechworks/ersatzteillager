const DATABASE_NAME = 'ersatzteillager-browser-settings';
const STORE_NAME = 'handles';
const DIRECTORY_KEY = 'delivery-note-folder';

export interface ScannedDeliveryNoteFile {
  file: File;
  fingerprint: string;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
};

function openSettingsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Browser-Speicher konnte nicht geöffnet werden.'));
  });
}

export async function getSavedDeliveryNoteFolder(): Promise<FileSystemDirectoryHandle | null> {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DIRECTORY_KEY);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) || null);
    request.onerror = () => reject(request.error || new Error('Gespeicherter Ordner konnte nicht gelesen werden.'));
    request.transaction?.addEventListener('complete', () => database.close(), { once: true });
  });
}

async function saveDeliveryNoteFolder(folder: FileSystemDirectoryHandle): Promise<void> {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(folder, DIRECTORY_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Ordnerauswahl konnte nicht gespeichert werden.'));
    };
  });
}

export async function chooseOrGetDeliveryNoteFolder(
  savedFolder: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle> {
  const pickerWindow = window as DirectoryPickerWindow;
  if (!pickerWindow.showDirectoryPicker) {
    throw new Error('DIRECTORY_PICKER_UNAVAILABLE');
  }

  let folder = savedFolder;
  if (folder) {
    const permission = await folder.requestPermission({ mode: 'read' });
    if (permission === 'granted') return folder;
  }

  folder = await pickerWindow.showDirectoryPicker({ mode: 'read' });
  try {
    await saveDeliveryNoteFolder(folder);
  } catch {
    // Der ausgewählte Ordner bleibt für die aktuelle Sitzung verwendbar.
  }
  return folder;
}

export function isDeliveryNoteFile(fileName: string): boolean {
  return /\.(?:json|pdf|png|jpe?g|tiff?|webp)$/i.test(fileName);
}

export async function fingerprintFile(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function scanDeliveryNoteFolder(folder: FileSystemDirectoryHandle): Promise<ScannedDeliveryNoteFile[]> {
  const files: ScannedDeliveryNoteFile[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file' || !isDeliveryNoteFile(entry.name)) continue;
    const file = await entry.getFile();
    files.push({ file, fingerprint: await fingerprintFile(file) });
  }
  return files.sort((a, b) => a.file.name.localeCompare(b.file.name, 'de'));
}

export async function fingerprintSelectedFiles(fileList: FileList): Promise<ScannedDeliveryNoteFile[]> {
  const files = await Promise.all(Array.from(fileList)
    .filter((file) => isDeliveryNoteFile(file.name))
    .map(async (file) => ({ file, fingerprint: await fingerprintFile(file) })));
  return files.sort((a, b) => a.file.name.localeCompare(b.file.name, 'de'));
}

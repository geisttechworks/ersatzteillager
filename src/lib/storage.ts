export async function uploadAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Die Datei konnte nicht gelesen werden.'));
    };
    reader.onerror = () => reject(new Error('Fehler beim Lesen der Datei.'));
    reader.readAsDataURL(file);
  });
}

export async function deleteAttachment(_filePath: string): Promise<void> {
  // Anhänge werden als Data-URL im Datensatz gespeichert.
  void _filePath;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf';
}

import * as XLSX from 'xlsx';
import { getCategories, createSparePart, updateSparePart, getSparePartByArticleNumber, getSparePartById, getSparePartByLegacyId, type SparePart } from './pocketbaseServices';
import pb from './pocketbase';

export interface ExcelRow {
  legacy_id?: string | number;
  legacyId?: string | number;
  ID?: string | number;
  id?: string | number; // Alternative Spaltenname
  'Artikel Nr:'?: string;
  'Artikel-Nr'?: string; // Alternative Spaltenname
  ArtikelNr?: string; // Alternative Spaltenname
  Bezeichnung?: string;
  'Technische Daten'?: string;
  'Zusätzliche Angaben'?: string;
  Lagerort?: string;
  Einbauort?: string;
  Ist?: number;
  Soll?: number;
  Einheit?: string;
  Hersteller?: string;
  Lieferant?: string;
  Link?: string;
  Preis?: number;
  Anlage?: string;
}

export interface SkippedRow {
  rowNumber: number;
  designation: string;
  articleNumber: string;
  reason: string;
}

export interface ImportResult {
  success: number;
  skipped: number;
  warnings: string[];
  errors: string[];
  skippedRows: SkippedRow[];
}

function normalizeImportLink(value: unknown): string {
  let raw = value == null ? '' : String(value).trim();
  if (!raw) return '';

  // Some Excel exports wrap hyperlink values in # characters, e.g. #https://example.com#.
  if (raw.startsWith('#') && raw.endsWith('#')) {
    raw = raw.slice(1, -1).trim();
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.toString() : '';
  } catch {
    return '';
  }
}

function getImportAdditionalInfo(value: unknown, linkWasUnrecognized: boolean): string {
  const info = value == null ? '' : String(value).trim();
  if (!linkWasUnrecognized) return info;

  const note = 'Link: beim Import nicht erkannt';
  if (info.toLowerCase().includes(note.toLowerCase())) return info;
  return [info, note].filter(Boolean).join('\n');
}

export async function importExcelFile(file: File): Promise<ImportResult> {
    if (pb.authStore.model?.is_admin !== true) {
      throw new Error('Der Excel-Import ist nur für Administratoren verfügbar.');
    }
    if (!/\.xlsx?$/i.test(file.name) || file.size === 0 || file.size > 20 * 1024 * 1024) {
      throw new Error('Bitte eine Excel-Datei (.xls oder .xlsx) bis maximal 20 MB auswählen.');
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);
    

    const errors: string[] = [];
    const warnings: string[] = [];
    const skippedRows: SkippedRow[] = [];
    let successCount = 0;
    let skippedCount = 0;

    if (jsonData.length === 0) {
      errors.push('Excel-Datei ist leer oder hat keine Daten');
      return { success: 0, skipped: 0, warnings, errors, skippedRows };
    }
    if (jsonData.length > 5000) {
      throw new Error('Die Excel-Datei enthält mehr als 5.000 Datenzeilen.');
    }

    // Hole existierende Kategorien
    const categories = await getCategories();

    // Kategorie-Mapping
    const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

    for (let rowIndex = 0; rowIndex < jsonData.length; rowIndex++) {
      const row = jsonData[rowIndex];
      const rowNumber = rowIndex + 2; // Excel Zeilennummer (erste Zeile ist Header)
      
      try {
        
        // Flexible Spalten-Namen
        const sourceId = [row.legacy_id, row.legacyId, row.ID, row.id]
          .find((value) => value !== undefined && value !== null && String(value).trim() !== '');
        const rawArticleNumber = row['Artikel Nr:'] ?? row['Artikel-Nr'] ?? row.ArtikelNr;
        const articleNumber = rawArticleNumber == null ? '' : String(rawArticleNumber).trim();
        const location = row.Lagerort || row['Lagerort'] || '';
        const rawLink = row.Link == null ? '' : String(row.Link).trim();
        const link = normalizeImportLink(rawLink);
        const linkWasUnrecognized = !!rawLink && !link;

        if (linkWasUnrecognized) {
          warnings.push(`Zeile ${rowNumber} (${row.Bezeichnung || 'ohne Bezeichnung'}): Ungültiger Link wurde ausgelassen und in „Zusätzliche Angaben“ vermerkt.`);
        }
        
        
        // Wenn keine Bezeichnung vorhanden, Zeile überspringen
        if (!row.Bezeichnung) {
          skippedRows.push({
            rowNumber,
            designation: row.Bezeichnung || '(leer)',
            articleNumber: articleNumber || '(leer)',
            reason: 'Keine Bezeichnung'
          });
          skippedCount++;
          continue;
        }
        
        // Excel-IDs sind nicht automatisch PocketBase-IDs. Nur 15-stellige
        // PocketBase-Schlüssel dürfen direkt zum Aktualisieren verwendet werden.
        const sourceIdText = sourceId == null ? '' : String(sourceId).trim();
        let existingPart: SparePart | null = null;
        if (/^[a-z0-9]{15}$/.test(sourceIdText)) {
          try {
            existingPart = await getSparePartById(sourceIdText);
          } catch (error: any) {
            if (error?.status !== 404) throw error;
          }
        }

        const importedLegacyId = sourceIdText && !existingPart ? sourceIdText : '';
        if (importedLegacyId) {
          existingPart ||= await getSparePartByLegacyId(importedLegacyId);
        }

        if (articleNumber) {
          existingPart ||= await getSparePartByArticleNumber(articleNumber);
        }

        const sparePart: any = {
          legacy_id: importedLegacyId || existingPart?.legacy_id || '',
          installation_location: row.Einbauort || '',
          anlage: row.Anlage || '',
          name: row.Bezeichnung || '',
          article_number: articleNumber || existingPart?.article_number || '',
          category_id: row.Bezeichnung ? categoryMap.get('Standard') || null : null,
          manufacturer: row.Hersteller || '',
          supplier: row.Lieferant || '',
          description: existingPart?.description || '',
          technical_data: row['Technische Daten'] || '',
          additional_info: getImportAdditionalInfo(row['Zusätzliche Angaben'], linkWasUnrecognized),
          unit: row.Einheit || '',
          price: row.Preis ?? null,
          quantity: row.Ist || 0,
          min_quantity: row.Soll || 5,
          location_type: location ? 'CUSTOM' : null,
          location_number: location || undefined,
          link,
          attachment: null
        };

        if (existingPart) {
          await updateSparePart(existingPart.id, sparePart);
          successCount++;
        } else {
          await createSparePart(sparePart);
          successCount++;
        }
      } catch (err) {
        errors.push(`Zeile ${rowNumber} (${row.Bezeichnung}): ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
      }
    }
    
    return { success: successCount, skipped: skippedCount, warnings, errors, skippedRows };
}

export function generateImportReport(result: ImportResult, fileName: string): string {
  const timestamp = new Date().toLocaleString('de-DE');
  
  let report = `Excel-Import Auswertung\n`;
  report += `========================\n\n`;
  report += `Datei: ${fileName}\n`;
  report += `Zeitstempel: ${timestamp}\n\n`;
  report += `Statistik:\n`;
  report += `---------\n`;
  report += `Erfolgreich importiert: ${result.success}\n`;
  report += `Übersprungen: ${result.skipped}\n`;
  report += `Hinweise: ${result.warnings.length}\n`;
  report += `Fehler: ${result.errors.length}\n\n`;

  if (result.warnings.length > 0) {
    report += `Hinweise:\n`;
    report += `---------\n`;
    result.warnings.forEach((warning, index) => {
      report += `${index + 1}. ${warning}\n`;
    });
    report += `\n`;
  }
  
  if (result.skippedRows.length > 0) {
    report += `Übersprungene Zeilen:\n`;
    report += `-------------------\n`;
    result.skippedRows.forEach((row, index) => {
      report += `${index + 1}. Zeile ${row.rowNumber}: ${row.designation}\n`;
      report += `   Artikel-Nr: ${row.articleNumber}\n`;
      report += `   Grund: ${row.reason}\n\n`;
    });
  }
  
  if (result.errors.length > 0) {
    report += `Fehler:\n`;
    report += `------\n`;
    result.errors.forEach((error, index) => {
      report += `${index + 1}. ${error}\n`;
    });
  }
  
  return report;
}

export function downloadImportReport(result: ImportResult, fileName: string): void {
  const report = generateImportReport(result, fileName);
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `import-auswertung-${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

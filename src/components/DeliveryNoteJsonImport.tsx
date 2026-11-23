import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { getSparePartByArticleNumber, createSparePart, deleteSparePart, updateQuantityWithAudit, findDeliveryNoteImport } from '../lib/pocketbaseServices';
import { summarizeDeliveryNoteImport } from '../lib/inventoryMovement';
import pb from '../lib/pocketbase';
import {
  chooseOrGetDeliveryNoteFolder,
  fingerprintSelectedFiles,
  getSavedDeliveryNoteFolder,
  scanDeliveryNoteFolder,
  type ScannedDeliveryNoteFile,
} from '../lib/deliveryNoteFolder';

const COMPLETED_SCANS_KEY = 'delivery-note-completed-scans';
const COMPLETED_SCAN_ITEMS_KEY = 'delivery-note-completed-scan-items';
const PRIVATE_AI_ENDPOINT_KEY = 'delivery-note-private-ai-endpoint';
const LOCAL_GEMINI_ENDPOINT = (import.meta.env.VITE_LOCAL_AI_ENDPOINT || '').trim();
const GEMINI_KEY_SETUP_URL = (import.meta.env.VITE_GEMINI_KEY_SETUP_URL || '').trim();
const AI_EXTRACTION_PROMPT = 'Aufgabe: Lieferschein als OCR-Parser analysieren und AUSSCHLIESSLICH mit einem validen JSON-Objekt ohne Markdown-Codeblöcke antworten. Struktur: deliveryNoteNo, optional orderNumber, deliveryDate (YYYY-MM-DD), supplier, items Array mit supplierArticleNo, description, quantityDelivered (Number), unit.';
const AI_SETUP_REQUEST = `Wir möchten Lieferscheine in unserer Ersatzteillager-App automatisch auswerten. Bitte stellen Sie einen von der IT freigegebenen internen HTTPS-KI-Endpunkt bereit. Die App sendet eine PDF- oder Bilddatei als multipart/form-data im Feld "file". Der Endpunkt soll direkt ein JSON-Objekt mit deliveryNoteNo, optional orderNumber, deliveryDate (YYYY-MM-DD), supplier und items [{ supplierArticleNo, name, description, quantityDelivered, unit, price }] zurückgeben. Zugangsdaten/Geheimnisse müssen serverseitig bleiben und dürfen nicht in den Browser eingebaut werden. Bitte teilen Sie uns die freigegebene Endpunkt-URL und erforderliche Netz-/CORS-Freigaben mit.`;

function readCompletedScans(): Set<string> {
  try {
    const stored = localStorage.getItem(COMPLETED_SCANS_KEY);
    return new Set(stored ? JSON.parse(stored) as string[] : []);
  } catch {
    return new Set();
  }
}

function readCompletedScanItems(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(COMPLETED_SCAN_ITEMS_KEY) || '{}') as Record<string, number[]>;
  } catch {
    return {};
  }
}

function saveLocalState(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Der Import bleibt auch ohne lokale Fortschrittsspeicherung möglich.
  }
}

function readPrivateAiEndpoint(): string {
  try {
    return localStorage.getItem(PRIVATE_AI_ENDPOINT_KEY) || '';
  } catch {
    return '';
  }
}

function readableAdapterError(error: unknown, endpoint: string): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
    try {
      const url = new URL(endpoint)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return 'Der lokale KI-Adapter ist nicht erreichbar. Prüfen Sie die konfigurierte Adapter-Adresse und dessen Health-Endpunkt.'
      }
    } catch {
      // Die Meldung unten hilft auch bei ungültigen oder nicht erreichbaren URLs.
    }
    return 'Der KI-Adapter ist nicht erreichbar. Prüfen Sie die Adapter-Adresse, die Internetverbindung und die CORS-Freigabe.'
  }
  if (error instanceof SyntaxError) return 'Der KI-Adapter hat keine gültige JSON-Antwort zurückgegeben. Prüfen Sie die Adapter-Konsole.'
  if (error instanceof TypeError) return 'Die Antwort des KI-Adapters konnte nicht verarbeitet werden. Prüfen Sie die Adapter-Konsole.'
  return message || 'Unbekannter Fehler beim Kontakt mit dem KI-Adapter.'
}

function readableHttpError(status: number): string {
  if (status === 413) return 'Die Datei ist zu groß. Verwende eine kleinere Datei (höchstens 50 MB).'
  if (status === 429) return 'Das Gemini-Nutzungslimit ist erreicht. Warten Sie kurz oder prüfen Sie das Kontingent in Google AI Studio.'
  if (status === 502) return 'Der Gemini-Adapter konnte Gemini nicht erfolgreich erreichen. Prüfen Sie das Adapter-Fenster auf technische Details.'
  if (status === 503) return 'Der Gemini-Adapter ist noch nicht bereit. Prüfen Sie den API-Schlüssel und starten Sie Start-App.bat erneut.'
  return `Der KI-Adapter hat die Anfrage abgelehnt (HTTP ${status}). Prüfen Sie die Adapter-Adresse und die Adapter-Konsole.`
}

interface DeliveryNoteJson {
  deliveryNoteNo?: string;
  orderNumber?: string;
  supplier?: string;
  deliveryDate?: string; // ISO format "YYYY-MM-DD"
  items: Array<{
    supplierArticleNo?: string;
    name?: string;
    description?: string;
    quantity?: number;
    quantityDelivered?: number;
    unit?: string;
    price?: number;
  }>;
}

interface ParsedItem {
  supplierArticleNo?: string;
  name?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  existingArticle?: any;
  isNew: boolean;
  confirmed: boolean;
  adjustedQuantity?: number;
}

interface DeliveryNoteJsonImportProps {
  onImportComplete?: () => void;
}

// Helper-Funktion zum Sanitizing und Parsen von JSON oder Rohtext
function cleanAndParseJson(rawInput: string) {
  let text = rawInput.trim();
  if (!text) {
    throw new Error('Eingabe ist leer.');
  }

  // 1. Markdown Code-Blöcke (```json ... ``` oder ``` ... ```) bereinigen
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Falls Begleittext vorhanden ist, das erste '{' oder '[' und das letzte '}' oder ']' isolieren
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let jsonCandidate = text;

  let startIndex = -1;
  let isObject = false;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false;
  }

  if (startIndex !== -1) {
    const endChar = isObject ? '}' : ']';
    const lastIndex = text.lastIndexOf(endChar);
    if (lastIndex > startIndex) {
      jsonCandidate = text.substring(startIndex, lastIndex + 1);
    }
  }

  // Versuche JSON zu parsen
  try {
    return JSON.parse(jsonCandidate);
  } catch (jsonErr) {
    // 3. Fallback für Rohtext / Zeilenbasierten Text (wenn der Nutzer reinen Text einfügt)
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));

    if (lines.length > 0) {
      const items: any[] = [];

      for (const line of lines) {
        // Tab-, Semikolon- oder Komma-Trennung
        let parts = line.split('\t');
        if (parts.length < 2) parts = line.split(';');
        if (parts.length < 2 && line.includes(',')) parts = line.split(',');

        if (parts.length >= 2) {
          let artNo = '';
          let name = '';
          let qty = 1;
          let unit = 'ST';

          for (const p of parts) {
            const val = p.trim();
            const num = parseFloat(val.replace(',', '.'));
            if (!isNaN(num) && /^\d+(?:[.,]\d+)?$/.test(val)) {
              qty = num;
            } else if (!artNo && /^[A-Z0-9.\-_]{3,}$/i.test(val)) {
              artNo = val;
            } else if (!name) {
              name = val;
            } else if (['ST', 'STK', 'M', 'KG', 'L', 'METER', 'PAAR', 'SET'].includes(val.toUpperCase())) {
              unit = val.toUpperCase();
            }
          }

          if (name || artNo) {
            items.push({
              supplierArticleNo: artNo,
              name: name || artNo,
              quantity: qty,
              unit
            });
            continue;
          }
        }

        // Freitextzeile: z.B. "5x 2102184 Koppelrelais" oder "10 Stk Widerstand"
        const qtyMatch = line.match(/^(\d+)\s*(?:x|stk|st|stück)?\s+(.*)$/i);
        if (qtyMatch) {
          const qty = parseInt(qtyMatch[1], 10);
          const rest = qtyMatch[2].trim();
          const tokens = rest.split(/\s+/);
          let artNo = '';
          let nameTokens = tokens;

          if (tokens.length > 1 && /^[A-Z0-9.\-_]{3,}$/i.test(tokens[0])) {
            artNo = tokens[0];
            nameTokens = tokens.slice(1);
          }

          items.push({
            supplierArticleNo: artNo,
            name: nameTokens.join(' '),
            quantity: qty,
            unit: 'ST'
          });
          continue;
        }

        // Einfache Textzeile als Artikelname
        items.push({
          name: line,
          quantity: 1,
          unit: 'ST'
        });
      }

      if (items.length > 0) {
        return { items };
      }
    }

    throw new Error(`Konnte die Daten weder als JSON noch als Textzeilen lesen (${(jsonErr as Error).message}).`, { cause: jsonErr });
  }
}

// Validierungsfunktion für JSON- oder Textdatenstruktur
function validateDeliveryNoteJson(raw: any): { valid: boolean; error?: string; cleanedData?: DeliveryNoteJson } {
  if (!raw) {
    return { valid: false, error: 'Keine Daten vorhanden.' };
  }

  // Falls direkt ein Array übergeben wurde: [ { ... }, { ... } ]
  let data = raw;
  if (Array.isArray(raw)) {
    data = { items: raw };
  }

  // Flexible Feldsuche für die Artikelliste
  const itemsArray = data.items || data.positionen || data.artikel || data.articles || data.rows;

  if (!itemsArray) {
    return { valid: false, error: "Ungültiges Format: Die Liste der Artikel/Positionen ('items') fehlt." };
  }

  if (!Array.isArray(itemsArray)) {
    return { valid: false, error: "Ungültiges Format: 'items' muss eine Liste sein." };
  }

  if (itemsArray.length === 0) {
    return { valid: false, error: "Die Artikelliste ist leer." };
  }
  if (itemsArray.length > 1000 || itemsArray.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item))) {
    return { valid: false, error: 'Die Liste darf höchstens 1.000 gültige Artikel enthalten.' };
  }

  for (const item of itemsArray) {
    const rawQuantity = item.quantity ?? item.quantityDelivered ?? item.menge ?? item.anzahl ?? item.stueck ?? item.qty ?? item.count;
    if (rawQuantity !== undefined && rawQuantity !== null) {
      const quantity = typeof rawQuantity === 'number' ? rawQuantity : Number(String(rawQuantity).replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
        return { valid: false, error: 'Jede angegebene Menge muss größer als 0 und höchstens 1.000.000 sein.' };
      }
    }
    const rawPrice = item.price ?? item.preis ?? item.unitPrice ?? item.einzelpreis;
    if (rawPrice !== undefined && rawPrice !== null) {
      const price = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).replace(',', '.'));
      if (!Number.isFinite(price) || price < 0) {
        return { valid: false, error: 'Jeder angegebene Preis muss eine gültige Zahl ab 0 sein.' };
      }
    }
  }

  // Lieferscheinnummer flexibel ermitteln
  const deliveryNoteNo = String(
    data.deliveryNoteNo || 
    data.delivery_note_number || 
    data.deliveryNoteNumber || 
    data.lieferscheinNr || 
    data.lieferscheinnummer || 
    data.belegnummer || 
    data.orderNo || 
    ''
  ).trim() || undefined;

  // Lieferant flexibel ermitteln
  const supplier = String(
    data.supplier || 
    data.lieferant || 
    data.vendor || 
    data.hersteller || 
    ''
  ).trim() || undefined;

  const orderNumber = String(
    data.orderNumber || data.order_number || data.bestellnummer || data.bestellNr || data.orderNo || ''
  ).trim() || undefined;

  // Lieferdatum bereinigen (Fallback auf heute)
  let deliveryDate = new Date().toISOString().split('T')[0];
  const rawDate = data.deliveryDate || data.delivery_date || data.datum || data.date;
  if (typeof rawDate === 'string' && rawDate.trim()) {
    const trimmedDate = rawDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      deliveryDate = trimmedDate;
    } else {
      const parsedD = new Date(trimmedDate);
      if (!isNaN(parsedD.getTime())) {
        deliveryDate = parsedD.toISOString().split('T')[0];
      }
    }
  }

  // Items mit flexiblen Eigenschaftsnamen bereinigen
  const cleanedItems = itemsArray.map((item: any) => {
    const artNo = String(
      item.supplierArticleNo ||
      item.articleNo ||
      item.articleNumber ||
      item.artikelNr ||
      item.artikelnummer ||
      item.artikel_nr ||
      item.artNr ||
      item.sku ||
      item.id ||
      ''
    ).trim();

    const name = String(
      item.name ||
      item.bezeichnung ||
      item.titel ||
      item.title ||
      item.artikel ||
      item.item ||
      ''
    ).trim();

    const desc = String(
      item.description ||
      item.beschreibung ||
      item.text ||
      item.details ||
      item.zusatz ||
      ''
    ).trim();

    let qty = 1;
    const rawQty = item.quantity ?? item.quantityDelivered ?? item.menge ?? item.anzahl ?? item.stueck ?? item.qty ?? item.count;
    if (typeof rawQty === 'number' && !isNaN(rawQty) && rawQty > 0) {
      qty = rawQty;
    } else if (typeof rawQty === 'string') {
      const parsedNum = parseFloat(rawQty.replace(',', '.'));
      if (!isNaN(parsedNum) && parsedNum > 0) {
        qty = parsedNum;
      }
    }

    const unit = String(item.unit || item.einheit || item.uom || 'ST').trim() || 'ST';

    let price: number | undefined = undefined;
    const rawPrice = item.price ?? item.preis ?? item.unitPrice ?? item.einzelpreis;
    if (typeof rawPrice === 'number' && !isNaN(rawPrice)) {
      price = rawPrice;
    } else if (typeof rawPrice === 'string') {
      const parsedPrice = parseFloat(rawPrice.replace(',', '.'));
      if (!isNaN(parsedPrice)) {
        price = parsedPrice;
      }
    }

    return {
      supplierArticleNo: artNo,
      name: name || desc || artNo || 'Unbenannter Artikel',
      description: desc || (name !== desc ? name : ''),
      quantity: qty,
      unit,
      price,
    };
  });

  return {
    valid: true,
    cleanedData: {
      deliveryNoteNo,
      orderNumber,
      supplier,
      deliveryDate,
      items: cleanedItems,
    },
  };
}

export default function DeliveryNoteJsonImport({ onImportComplete }: DeliveryNoteJsonImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualStep, setManualStep] = useState<1 | 2 | 3 | 4>(1);
  const [automaticSetupMode, setAutomaticSetupMode] = useState<'choose' | 'it' | 'private' | null>(null);
  const [automaticProcessing, setAutomaticProcessing] = useState(false);
  const [privateAiEndpoint, setPrivateAiEndpoint] = useState(() => readPrivateAiEndpoint());
  const [geminiConnectionStatus, setGeminiConnectionStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checkingGeminiConnection, setCheckingGeminiConnection] = useState(false);
  const [manualSourcePrepared, setManualSourcePrepared] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<DeliveryNoteJson | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const importInProgress = useRef(false);
  const [duplicateImport, setDuplicateImport] = useState<{ user: string; date: string } | null>(null);
  const [allowDuplicateImport, setAllowDuplicateImport] = useState(false);
  const [importResults, setImportResults] = useState<Array<{
    success: boolean;
    imported?: boolean;
    item: ParsedItem;
    message: string;
  }>>([]);
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [savedFolder, setSavedFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState('');
  const [scannedFiles, setScannedFiles] = useState<ScannedDeliveryNoteFile[]>([]);
  const [scanMessage, setScanMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [completedScans, setCompletedScans] = useState<Set<string>>(() => readCompletedScans());
  const [completedScanItems, setCompletedScanItems] = useState<Record<string, number[]>>(() => readCompletedScanItems());
  const [activeSourceFingerprint, setActiveSourceFingerprint] = useState<string | null>(null);
  const [activeSourceName, setActiveSourceName] = useState<string | null>(null);
  const fallbackFolderInput = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLTextAreaElement>(null);
  const companyAiEndpoint = (import.meta.env.VITE_DELIVERY_NOTE_AI_ENDPOINT || '').trim();
  const hasAiConfiguration = Boolean(companyAiEndpoint || privateAiEndpoint.trim());
  const selectedScan = scannedFiles.find((scan) => scan.fingerprint === activeSourceFingerprint) || null;
  const importSummary = summarizeDeliveryNoteImport(importResults.map((result) => ({
    success: result.success,
    imported: result.imported,
    quantity: result.item.adjustedQuantity,
    isNew: result.item.isNew,
  })));

  useEffect(() => {
    getSavedDeliveryNoteFolder()
      .then((folder) => {
        setSavedFolder(folder);
        if (folder) setFolderName(folder.name);
      })
      .catch(() => setScanMessage('Der zuletzt verwendete Scan-Ordner konnte nicht geladen werden.'));
  }, []);

  const showNewScans = (files: ScannedDeliveryNoteFile[], selectedFolderName: string) => {
    setActiveSourceFingerprint(null);
    setActiveSourceName(null);
    setAutomaticSetupMode(null);
    setFolderName(selectedFolderName);
    const freshFiles = files.filter(({ fingerprint }) => !completedScans.has(fingerprint));
    setScannedFiles(freshFiles);
    setScanMessage(freshFiles.length
      ? `${freshFiles.length} neue Datei${freshFiles.length === 1 ? '' : 'en'} gefunden.`
      : 'Keine neuen Scans gefunden. Bereits importierte Dateien werden nicht erneut angeboten.');
  };

  const handleFallbackFolderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const fileList = input.files;
    if (!fileList) return;

    setScanning(true);
    try {
      const selectedFiles = await fingerprintSelectedFiles(fileList);
      const selectedFolderName = fileList[0]?.webkitRelativePath.split('/')[0] || 'ausgewählter Ordner';
      showNewScans(selectedFiles, selectedFolderName);
    } catch (err) {
      setScanMessage(err instanceof Error ? err.message : 'Der Ordner konnte nicht gelesen werden.');
    } finally {
      setScanning(false);
      input.value = '';
    }
  };

  const handleScanFolder = async () => {
    setError(null);
    setScanMessage('');

    const pickerWindow = window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (!pickerWindow.showDirectoryPicker) {
      const input = fallbackFolderInput.current;
      if (input) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.click();
      } else {
        setScanMessage('Dieser Browser kann keinen Ordner auswählen. Bitte verwenden Sie die JSON-Eingabe unten.');
      }
      return;
    }

    setScanning(true);
    try {
      const folder = await chooseOrGetDeliveryNoteFolder(savedFolder);
      setSavedFolder(folder);
      const files = await scanDeliveryNoteFolder(folder);
      showNewScans(files, folder.name);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setScanMessage(err instanceof Error ? err.message : 'Der Ordner konnte nicht geprüft werden.');
    } finally {
      setScanning(false);
    }
  };

  const handleLoadJsonScan = async (scan: ScannedDeliveryNoteFile) => {
    try {
      setManualMode(true);
      setManualStep(3);
      setManualSourcePrepared(false);
      const text = await scan.file.text();
      await handleParseJson(text, scan.fingerprint, scan.file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Die JSON-Datei konnte nicht gelesen werden.');
    }
  };

  const handleDownloadScannedFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = file.name;
    downloadLink.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleOpenImporter = () => {
    setManualMode(false);
    setAutomaticSetupMode(null);
    setAutomaticProcessing(false);
    setManualSourcePrepared(false);
    setManualStep(1);
    setActiveSourceFingerprint(null);
    setActiveSourceName(null);
    setIsOpen(true);
    void handleScanFolder();
  };

  const handleParseJson = async (
    inputText = jsonText,
    sourceFingerprint = activeSourceFingerprint,
    sourceName = activeSourceName,
  ) => {
    if (pb.authStore.model?.is_admin !== true) {
      setError('Der Lieferschein-Import ist nur für Administratoren verfügbar.');
      return;
    }
    if (inputText.length > 1_000_000) {
      setError('Die Eingabe ist zu groß (maximal 1 MB).');
      return;
    }
    setError(null);
    setParsedData(null);
    setParsedItems([]);
    setImportResults([]);
    setJsonText(inputText);
    setActiveSourceFingerprint(sourceFingerprint);
    setActiveSourceName(sourceName);

    try {
      // JSON sanitizing und parsen
      const parsed = cleanAndParseJson(inputText);
      
      // Validierung
      const validation = validateDeliveryNoteJson(parsed);
      
      if (!validation.valid) {
        setError(validation.error || 'Ungültiges JSON-Format');
        return;
      }

      const cleanedData = validation.cleanedData!;
      setParsedData(cleanedData);
      setManualStep(4);
      setDeliveryDate(cleanedData.deliveryDate || new Date().toISOString().split('T')[0]);
      
      // Für jedes Item Datenbank-Lookup durchführen
      const itemsWithLookup: ParsedItem[] = await Promise.all(
        cleanedData.items.map(async (item) => {
          let existingArticle = null;
          let isNew = true;

          if (item.supplierArticleNo) {
            try {
              existingArticle = await getSparePartByArticleNumber(item.supplierArticleNo);
              if (existingArticle) {
                isNew = false;
              }
            } catch {
              // Artikel nicht gefunden - ist okay, wird neu erstellt
            }
          }

          return {
            ...item,
            existingArticle,
            isNew,
            confirmed: true,
            adjustedQuantity: item.quantity,
          };
        })
      );

      setParsedItems(itemsWithLookup);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Fehler beim Parsen des JSON';
      setError(`JSON-Parsing-Fehler: ${errorMessage}`);
    }
  };

  const handlePasteAndParseClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setError('Die Zwischenablage ist leer. Kopieren Sie zuerst das JSON-Ergebnis der KI.');
        return;
      }
      await handleParseJson(clipboardText);
    } catch {
      setError('Die Zwischenablage konnte nicht gelesen werden. Fügen Sie das JSON-Ergebnis alternativ in das Feld darunter ein.');
    }
  };

  const handleStartManualMode = async () => {
    setAutomaticSetupMode(null);
    setError(null);
    setManualSourcePrepared(false);
    if (selectedScan?.file.name.toLowerCase().endsWith('.json')) {
      await handleLoadJsonScan(selectedScan);
      return;
    }
    setManualMode(true);
    setManualStep(selectedScan ? 2 : 1);
  };

  const handleStartAutomaticMode = () => {
    setError(null);
    setManualMode(false);
    setAutomaticSetupMode('choose');
  };

  const handleRunAutomaticAnalysis = async (endpoint: string) => {
    if (!selectedScan) {
      setError('Wählen Sie zuerst oben einen neuen Lieferschein aus.');
      return;
    }

    setAutomaticProcessing(true);
    setManualMode(false);
    setAutomaticSetupMode(null);
    try {
      if (selectedScan.file.name.toLowerCase().endsWith('.json')) {
        await handleParseJson(await selectedScan.file.text(), selectedScan.fingerprint, selectedScan.file.name);
        return;
      }

      const body = new FormData();
      body.append('file', selectedScan.file, selectedScan.file.name);
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        let details = '';
        try {
          const errorBody = await response.json();
          if (typeof errorBody.error === 'string') details = errorBody.error;
          else if (typeof errorBody.message === 'string') details = errorBody.message;
        } catch {
          // Verwende die Statusmeldung, wenn der Endpunkt kein JSON als Fehler liefert.
        }
        throw new Error(details || readableHttpError(response.status));
      }

      const result = await response.json();
      const jsonText = typeof result === 'string' ? result : JSON.stringify(result);
      await handleParseJson(jsonText, selectedScan.fingerprint, selectedScan.file.name);
    } catch (err) {
      setError(`Automatische Auswertung fehlgeschlagen: ${readableAdapterError(err, endpoint)}`);
    } finally {
      setAutomaticProcessing(false);
    }
  };

  const handleChooseCompanyAi = () => {
    if (!companyAiEndpoint) {
      setAutomaticSetupMode('it');
      return;
    }
    void handleRunAutomaticAnalysis(companyAiEndpoint);
  };

  const handleChoosePrivateAi = () => {
    const endpoint = privateAiEndpoint.trim();
    if (!endpoint) {
      setAutomaticSetupMode('private');
      return;
    }
    void handleRunAutomaticAnalysis(endpoint);
  };

  const handleSavePrivateAiEndpoint = () => {
    const endpoint = privateAiEndpoint.trim();
    try {
      const parsedEndpoint = new URL(endpoint);
      if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new Error();
      localStorage.setItem(PRIVATE_AI_ENDPOINT_KEY, parsedEndpoint.toString());
      setPrivateAiEndpoint(parsedEndpoint.toString());
      setError(null);
      setAutomaticSetupMode('choose');
    } catch {
      setError('Bitte geben Sie eine gültige HTTP- oder HTTPS-Adresse des KI-Adapters ein.');
    }
  };

  const handleConnectLocalGemini = async () => {
    setCheckingGeminiConnection(true);
    setGeminiConnectionStatus(null);
    try {
      if (!LOCAL_GEMINI_ENDPOINT) throw new Error('Für den lokalen KI-Adapter ist keine Adresse konfiguriert.');
      const verifyEndpoint = new URL('/verify-key', LOCAL_GEMINI_ENDPOINT).toString();
      const response = await fetch(verifyEndpoint, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || readableHttpError(response.status));
      localStorage.setItem(PRIVATE_AI_ENDPOINT_KEY, LOCAL_GEMINI_ENDPOINT);
      setPrivateAiEndpoint(LOCAL_GEMINI_ENDPOINT);
      setGeminiConnectionStatus({ ok: true, message: `${result.message || 'Gemini-Schlüssel geprüft.'} Die Adapter-Adresse wurde gespeichert. Kehren Sie zur Auswahl zurück und starten Sie die Auswertung.` });
      setError(null);
    } catch (err) {
      const message = err instanceof TypeError
        ? 'Der lokale KI-Adapter ist unter der konfigurierten Adresse nicht erreichbar.'
        : err instanceof Error ? err.message : 'Verbindung zum Gemini-Adapter fehlgeschlagen.';
      setGeminiConnectionStatus({ ok: false, message });
    } finally {
      setCheckingGeminiConnection(false);
    }
  };

  const handlePrepareManualAI = async () => {
    if (!selectedScan) {
      setError('Wählen Sie zuerst oben einen PDF- oder Bild-Scan aus.');
      return;
    }
    if (selectedScan.file.name.toLowerCase().endsWith('.json')) {
      await handleLoadJsonScan(selectedScan);
      return;
    }

    setError(null);
    handleDownloadScannedFile(selectedScan.file);
    try {
      await navigator.clipboard.writeText(AI_EXTRACTION_PROMPT);
    } catch {
      setError('Die Datei wurde heruntergeladen, aber der Prompt konnte nicht kopiert werden. Sie können ihn im nächsten Schritt erneut kopieren.');
    }
    setManualSourcePrepared(true);
    setManualMode(true);
    setManualStep(3);
  };

  const handleToggleConfirm = (index: number) => {
    const updated = [...parsedItems];
    updated[index].confirmed = !updated[index].confirmed;
    setParsedItems(updated);
  };

  const handleAdjustQuantity = (index: number, value: string) => {
    const updated = [...parsedItems];
    updated[index].adjustedQuantity = parseInt(value, 10) || 0;
    setParsedItems(updated);
  };

  const handleImport = async () => {
    if (importInProgress.current) return;
    if (pb.authStore.model?.is_admin !== true) {
      setError('Der Lieferschein-Import ist nur für Administratoren verfügbar.');
      return;
    }
    const deliveryNoteNo = parsedData?.deliveryNoteNo || 'Unbekannt';
    const supplier = parsedData?.supplier || 'Unbekannt';
    importInProgress.current = true;
    setProcessing(true);
    if (!allowDuplicateImport) {
      try {
        const existing = await findDeliveryNoteImport(deliveryNoteNo, supplier);
        if (existing) {
          setDuplicateImport({
            user: existing.user_name || 'Unbekannt',
            date: new Date(existing.created).toLocaleDateString('de-DE'),
          });
          setAllowDuplicateImport(true);
          importInProgress.current = false;
          setProcessing(false);
          return;
        }
      } catch (err) {
        setError(`Dublettenprüfung fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
        importInProgress.current = false;
        setProcessing(false);
        return;
      }
    }
    setImportResults([]);

    const results: Array<{
      success: boolean;
      imported?: boolean;
      item: ParsedItem;
      message: string;
    }> = [];

    const deliveryDateStr = deliveryDate || new Date().toISOString().split('T')[0];
    const sourceFingerprint = activeSourceFingerprint;
    const processedIndices = new Set(sourceFingerprint ? completedScanItems[sourceFingerprint] || [] : []);

    const markScanItemProcessed = (itemIndex: number) => {
      if (!sourceFingerprint) return;
      processedIndices.add(itemIndex);
      const nextItems = { ...completedScanItems, [sourceFingerprint]: Array.from(processedIndices) };
      saveLocalState(COMPLETED_SCAN_ITEMS_KEY, nextItems);
      setCompletedScanItems(nextItems);
    };

    for (const [itemIndex, item] of parsedItems.entries()) {
      if (sourceFingerprint && processedIndices.has(itemIndex)) {
        results.push({
          success: true,
          item,
          message: 'Diese Position wurde aus diesem Scan bereits gebucht und wird nicht erneut importiert.',
        });
        continue;
      }

      if (!item.confirmed || !item.adjustedQuantity || item.adjustedQuantity <= 0) {
        results.push({
          success: false,
          item,
          message: 'Nicht bestätigt oder ungültige Menge',
        });
        continue;
      }

      let createdPartId: string | null = null;
      try {
        if (item.isNew) {
          // Neuen Artikel mit Anfangsbestand 0 erstellen, damit die Einlagerung im Audit-Log korrekt erfasst wird
          const newArticle = await createSparePart({
            name: item.name || item.description || 'Unbenannt',
            article_number: item.supplierArticleNo || '', // Leer lassen für Auto-Generierung ab 2000
            description: item.description,
            supplier: supplier,
            unit: item.unit || 'Stk',
            price: item.price,
            quantity: 0,
            min_quantity: 1,
            location_type: undefined,
            location_number: undefined,
            location_place: undefined,
            location_pid: undefined,
            category_id: null,
            technical_data: null,
            additional_info: null,
            link: null,
            attachment: null,
            manufacturer: supplier || 'Unbekannt',
          });
          createdPartId = newArticle.id;

          // Bestand einbuchen & Audit-Log erstellen
          await updateQuantityWithAudit(newArticle.id, item.adjustedQuantity, 'in', {
            reason: 'Lieferung/Wareneingang',
            supplier: supplier,
            order_number: parsedData?.orderNumber,
            delivery_note_number: deliveryNoteNo,
            delivery_date: deliveryDateStr,
            notes: `Neuer Artikel aus Import: ${item.supplierArticleNo || newArticle.article_number}`,
            metadata: { source: 'delivery_note_json_import' },
          });
          createdPartId = null;

          results.push({
            success: true,
            imported: true,
            item,
            message: `Neuer Artikel erstellt (ID: ${newArticle.id})`,
          });
          markScanItemProcessed(itemIndex);
        } else if (item.existingArticle) {
          // Bestand aktualisieren
          const currentQuantity = item.existingArticle.quantity || 0;
          const newQuantity = currentQuantity + item.adjustedQuantity;

          await updateQuantityWithAudit(item.existingArticle.id, newQuantity, 'in', {
            reason: 'Lieferung/Wareneingang',
            supplier: supplier,
            order_number: parsedData?.orderNumber,
            delivery_note_number: deliveryNoteNo,
            delivery_date: deliveryDateStr,
            notes: `JSON-Import: ${item.supplierArticleNo}`,
            metadata: { source: 'delivery_note_json_import' },
          });

          results.push({
            success: true,
            imported: true,
            item,
            message: `Bestand aktualisiert (${currentQuantity} → ${newQuantity})`,
          });
          markScanItemProcessed(itemIndex);
        }
      } catch (err) {
        // Falls das Anlegen erfolgreich war, die transaktionale Bestandsbuchung
        // aber fehlschlug, bleibt kein ungebuchter Null-Bestand-Artikel zurück.
        if (createdPartId) {
          try {
            await deleteSparePart(createdPartId);
          } catch {
            // Der ursprüngliche Buchungsfehler wird angezeigt; eine fehlende
            // Berechtigung zum Aufräumen darf ihn nicht verdecken.
          }
        }
        results.push({
          success: false,
          item,
          message: err instanceof Error ? err.message : 'Unbekannter Fehler',
        });
      }
    }

    setImportResults(results);
    setProcessing(false);
    importInProgress.current = false;

    if (sourceFingerprint && results.length > 0 && results.every((result) => result.success)) {
      const nextCompletedScans = new Set(completedScans);
      nextCompletedScans.add(sourceFingerprint);
      saveLocalState(COMPLETED_SCANS_KEY, Array.from(nextCompletedScans));
      setCompletedScans(nextCompletedScans);
      setScannedFiles((files) => files.filter((scan) => scan.fingerprint !== sourceFingerprint));
    }

    if (results.every(r => r.success)) {
      // Erfolgreich - optional schließen
      if (onImportComplete) {
        onImportComplete();
      }
    }
  };

  if (pb.authStore.model?.is_admin !== true) return null;

  const handleReset = () => {
    importInProgress.current = false;
    setDuplicateImport(null);
    setAllowDuplicateImport(false);
    setJsonText('');
    setError(null);
    setParsedData(null);
    setParsedItems([]);
    setImportResults([]);
    setActiveSourceFingerprint(null);
    setActiveSourceName(null);
    setManualMode(false);
    setManualStep(1);
    setAutomaticSetupMode(null);
    setAutomaticProcessing(false);
    setManualSourcePrepared(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpenImporter}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
      >
        📋 Lieferschein importieren
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-slate-100">
              📋 Lieferschein importieren
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          {!parsedData && !importResults.length && (
            <div className="space-y-4">
              {error && (
                <div className="bg-rose-950/40 border-l-4 border-red-500 rounded-r-lg p-4">
                  <div className="flex items-start">
                    <span className="text-rose-300 text-xl mr-3">⚠️</span>
                    <div>
                      <h4 className="font-semibold text-rose-200 mb-1">Import-Fehler</h4>
                      <p className="text-rose-300 text-sm">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {(!manualMode || manualStep === 1) && !automaticSetupMode && !automaticProcessing && (
              <section className="rounded-lg border border-indigo-900/70 bg-indigo-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-indigo-200">1. Neue Scans aus dem Ordner prüfen</h3>
                    <p className="mt-1 text-xs text-indigo-300">
                      Der Ordner wird nur auf Klick geprüft{folderName ? `: ${folderName}` : ''}. Es läuft keine Hintergrundüberwachung.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleScanFolder}
                    disabled={scanning}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                  >
                    {scanning ? '🔄 Ordner wird geprüft…' : folderName ? '📂 Neue Scans prüfen' : '📂 Ordner auswählen und prüfen'}
                  </button>
                </div>

                <input
                  ref={fallbackFolderInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFallbackFolderChange}
                />

                {scanMessage && <p className="mt-3 text-sm text-indigo-200">{scanMessage}</p>}
                {scannedFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {scannedFiles.map((scan) => {
                      const isJson = scan.file.name.toLowerCase().endsWith('.json');
                      return (
                        <div key={scan.fingerprint} className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${activeSourceFingerprint === scan.fingerprint ? 'border-purple-400 bg-purple-950/40' : 'border-indigo-900/70 bg-slate-900'}`}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-100">{scan.file.name}</p>
                            <p className="text-xs text-slate-500">
                              {new Date(scan.file.lastModified).toLocaleString('de-DE')} · {(scan.file.size / 1024).toFixed(0)} KB
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSourceFingerprint(scan.fingerprint);
                              setActiveSourceName(scan.file.name);
                              setError(null);
                              setAutomaticSetupMode(null);
                              if (manualMode && !isJson) setManualStep(2);
                              if (manualMode && isJson) void handleLoadJsonScan(scan);
                            }}
                            className={`rounded px-3 py-1.5 text-sm font-medium ${activeSourceFingerprint === scan.fingerprint ? 'bg-purple-700 text-white' : 'border border-indigo-300 text-indigo-300 hover:bg-indigo-950/40'}`}
                          >
                            {activeSourceFingerprint === scan.fingerprint ? 'Ausgewählt' : isJson ? 'JSON auswählen' : 'Scan auswählen'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              )}

              {(!manualMode || manualStep === 1) && !automaticSetupMode && !automaticProcessing && (
                <div className="grid gap-3 md:grid-cols-2">
                  <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <h3 className="font-semibold text-slate-100">2. Automatisch mit KI</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      {hasAiConfiguration ? 'Wählen Sie den eingerichteten KI-Weg und werten Sie den Scan automatisch aus.' : 'Wählen Sie zwischen einer IT-freigegebenen Lösung und Ihrer eigenen KI.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleStartAutomaticMode()}
                      disabled={automaticProcessing}
                      className="mt-3 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-blue-300"
                    >
                      Automatik auswählen
                    </button>
                    {hasAiConfiguration && <p className="mt-2 text-xs text-emerald-300">Mindestens ein KI-Weg ist eingerichtet.</p>}
                  </section>
                  <section className="rounded-lg border border-purple-900/70 bg-purple-950/40 p-4">
                    <h3 className="font-semibold text-purple-200">2. Manuell mit KI oder JSON</h3>
                    <p className="mt-1 text-sm text-purple-300">Datei und Prompt für die KI vorbereiten oder vorhandenes JSON übernehmen.</p>
                    <button
                      type="button"
                      onClick={() => void handleStartManualMode()}
                      className="mt-3 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800"
                    >
                      Manuellen Weg starten
                    </button>
                  </section>
                </div>
              )}

              {automaticSetupMode === 'choose' && (
                <section className="space-y-3 rounded-lg border border-blue-900/70 bg-blue-950/40 p-4">
                  <div>
                    <h3 className="font-semibold text-blue-200">2. Automatik-Weg wählen</h3>
                    <p className="mt-1 text-sm text-blue-200">Wie soll der Lieferschein ausgewertet werden?</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <article className="rounded-lg border border-blue-900/70 bg-slate-900 p-4">
                      <h4 className="font-semibold text-slate-100">Unternehmensweg · IT-freigegebene KI</h4>
                      <p className="mt-1 text-sm text-slate-400">Für die Nutzung im Firmennetz. Die IT betreibt den sicheren KI-Endpunkt.</p>
                      {companyAiEndpoint && <p className="mt-2 text-xs text-emerald-300">IT-Endpunkt ist eingerichtet.</p>}
                      <button
                        type="button"
                        onClick={handleChooseCompanyAi}
                        disabled={automaticProcessing || (Boolean(companyAiEndpoint) && !selectedScan)}
                        className="mt-3 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-blue-300"
                      >
                        {companyAiEndpoint ? selectedScan ? 'Scan automatisch auswerten' : 'Zuerst Scan auswählen' : 'Unternehmensweg einrichten'}
                      </button>
                    </article>
                    <article className="rounded-lg border border-purple-900/70 bg-slate-900 p-4">
                      <h4 className="font-semibold text-slate-100">Eigene KI · Gemini auf diesem PC</h4>
                      <p className="mt-1 text-sm text-slate-400">Folgen Sie der Anleitung in der App. Für andere KI-Anbieter benötigen Sie einen eigenen Adapter.</p>
                      {privateAiEndpoint && <p className="mt-2 text-xs text-emerald-300">Eigener Adapter ist eingerichtet.</p>}
                      <button
                        type="button"
                        onClick={handleChoosePrivateAi}
                        disabled={automaticProcessing || (Boolean(privateAiEndpoint.trim()) && !selectedScan)}
                        className="mt-3 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:bg-purple-300"
                      >
                        {privateAiEndpoint.trim() ? selectedScan ? 'Scan mit eigener KI auswerten' : 'Zuerst Scan auswählen' : 'Eigene KI einrichten'}
                      </button>
                      {privateAiEndpoint.trim() && (
                        <button
                          type="button"
                          onClick={() => setAutomaticSetupMode('private')}
                          className="ml-2 mt-3 rounded-lg border border-purple-800 px-3 py-2 text-sm text-purple-300 hover:bg-purple-950/40"
                        >
                          Einrichtung / Hilfe
                        </button>
                      )}
                    </article>
                  </div>
                  <button type="button" onClick={() => setAutomaticSetupMode(null)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-300">
                    Zurück
                  </button>
                </section>
              )}

              {automaticSetupMode === 'it' && (
                <section className="space-y-3 rounded-lg border border-blue-900/70 bg-blue-950/40 p-4">
                  <h3 className="font-semibold text-blue-200">Unternehmensweg: IT-freigegebene KI einrichten</h3>
                  <ol className="list-inside list-decimal space-y-2 text-sm text-blue-200">
                    <li>Bitte IT um Freigabe eines internen KI-Dienstes für Lieferscheine.</li>
                    <li>IT stellt einen HTTPS-Endpunkt bereit, der eine PDF/Bilddatei annimmt und direkt das beschriebene JSON zurückgibt.</li>
                    <li>IT trägt die URL als <code className="rounded bg-slate-900 px-1">VITE_DELIVERY_NOTE_AI_ENDPOINT</code> ein und baut die App neu bzw. startet sie neu.</li>
                    <li>Danach zeigt der Unternehmensweg in der Auswahl „Scan automatisch auswerten“. Zugangsdaten bleiben auf dem Server und kommen nicht in den Browser.</li>
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(AI_SETUP_REQUEST);
                          alert('IT-Anfrage kopiert.');
                        } catch {
                          setError('IT-Anfrage konnte nicht kopiert werden.');
                        }
                      }}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
                    >
                      IT-Anfrage kopieren
                    </button>
                    <button type="button" onClick={() => setAutomaticSetupMode('choose')} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-blue-200">
                      Zurück zur Auswahl
                    </button>
                  </div>
                </section>
              )}

              {automaticSetupMode === 'private' && (
                <section className="space-y-3 rounded-lg border border-purple-900/70 bg-purple-950/40 p-4">
                  <div>
                    <h3 className="font-semibold text-purple-200">Gemini einmalig einrichten</h3>
                    <p className="mt-1 text-sm text-purple-200">Folgen Sie den vier Schritten der Reihe nach. Sie müssen keinen Code schreiben. Geben Sie Ihren API-Schlüssel nur in die lokale Datei auf diesem PC ein, niemals hier im Browser.</p>
                  </div>
                  <ol className="space-y-3">
                    <li className="rounded-lg border border-purple-900/70 bg-slate-900 p-3">
                      <h4 className="font-semibold text-purple-200">Schritt 1: Gemini-Schlüssel holen</h4>
                      <p className="mt-1 text-sm text-slate-300">Öffnen Sie Google AI Studio, melden Sie sich mit Ihrem Google-Konto an und erstellen Sie einen Gemini-API-Schlüssel. Kopieren Sie ihn. Wenn Google nach einem Projekt oder einer Abrechnung fragt, lesen Sie vor dem Fortfahren die dortigen Hinweise.</p>
                      {GEMINI_KEY_SETUP_URL && <a href={GEMINI_KEY_SETUP_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800">Konfigurierte Seite zur Schlüsselverwaltung öffnen</a>}
                    </li>
                    <li className="rounded-lg border border-purple-900/70 bg-slate-900 p-3">
                      <h4 className="font-semibold text-purple-200">Schritt 2: Schlüssel auf diesem PC speichern</h4>
                      <p className="mt-1 text-sm text-slate-300">Starten Sie <code className="rounded bg-slate-800 px-1">Einrichten-Gemini.bat</code> im Projektordner. Tragen Sie den Schlüssel ausschließlich in die lokale, von Git ignorierte Datei <code className="rounded bg-slate-800 px-1">.env.gemini.local</code> ein. Fügen Sie ihn nicht in Code, App, Chat oder Dokumentation ein.</p>
                    </li>
                    <li className="rounded-lg border border-purple-900/70 bg-slate-900 p-3">
                      <h4 className="font-semibold text-purple-200">Schritt 3: Adapter starten</h4>
                      <p className="mt-1 text-sm text-slate-300">Schließen Sie dieses App-Fenster. Doppelklicken Sie im selben Projektordner auf <code className="rounded bg-slate-800 px-1">Start-App.bat</code>. Dadurch startet die App zusammen mit dem Gemini-Adapter. Öffnen Sie in der App wieder „Lieferschein importieren“, prüfen Sie den Scan-Ordner und wählen Sie den Lieferschein erneut aus. Klicken Sie dann auf „Automatik auswählen“ und „Eigene KI einrichten“.</p>
                    </li>
                    <li className="rounded-lg border border-purple-900/70 bg-slate-900 p-3">
                      <h4 className="font-semibold text-purple-200">Schritt 4: Verbindung prüfen</h4>
                      <p className="mt-1 text-sm text-slate-300">Kehren Sie hierher zurück und klicken Sie auf den Knopf. Wenn „Verbunden“ erscheint, ist die Adresse gespeichert. Kehren Sie danach zur Auswahl zurück und starten Sie die Auswertung.</p>
                      <button
                        type="button"
                        onClick={() => void handleConnectLocalGemini()}
                        disabled={checkingGeminiConnection || !LOCAL_GEMINI_ENDPOINT}
                        className="mt-2 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:bg-purple-300"
                      >
                        {checkingGeminiConnection ? 'Schlüssel und Modell werden geprüft…' : 'Gemini-Schlüssel prüfen und speichern'}
                      </button>
                      {!LOCAL_GEMINI_ENDPOINT && <p className="mt-2 text-xs text-amber-300">Der lokale KI-Adapter ist in dieser Installation nicht konfiguriert.</p>}
                      {geminiConnectionStatus && (
                        <p className={`mt-2 text-sm ${geminiConnectionStatus.ok ? 'text-emerald-200' : 'text-rose-200'}`} role="status">
                          {geminiConnectionStatus.message}
                        </p>
                      )}
                    </li>
                  </ol>
                  <details className="rounded-lg border border-purple-900/70 bg-slate-900 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-purple-200">Ich habe eine andere Adapter-Adresse</summary>
                    <div className="mt-3 space-y-2">
                      <label className="block text-sm font-medium text-purple-200" htmlFor="private-ai-endpoint">Adresse des anderen Adapters</label>
                      <input
                        id="private-ai-endpoint"
                        type="url"
                        value={privateAiEndpoint}
                        onChange={(event) => setPrivateAiEndpoint(event.target.value)}
                        placeholder="https://mein-adapter.example/analyze"
                        className="w-full rounded-lg border border-purple-800 bg-slate-900 px-3 py-2 text-sm"
                      />
                      <button type="button" onClick={handleSavePrivateAiEndpoint} className="rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800">
                        Andere Adresse speichern
                      </button>
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    {privateAiEndpoint && (
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.removeItem(PRIVATE_AI_ENDPOINT_KEY);
                          setPrivateAiEndpoint('');
                          setGeminiConnectionStatus(null);
                          setError(null);
                        }}
                        className="rounded-lg border border-purple-800 bg-slate-900 px-3 py-2 text-sm text-purple-200"
                      >
                        Gespeicherte Adapter-Adresse entfernen
                      </button>
                    )}
                    <button type="button" onClick={() => setAutomaticSetupMode('choose')} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-purple-200">
                      Zurück zur Auswahl
                    </button>
                  </div>
                  <div className="border-t border-purple-900/70 pt-3">
                    <p className="text-sm text-purple-200"><strong>Sie möchten nichts einrichten?</strong> Dann können Sie den Lieferschein weiterhin manuell mit einer KI Ihrer Wahl bearbeiten:</p>
                    <button type="button" onClick={() => void handleStartManualMode()} className="mt-2 rounded-lg border border-purple-400 bg-slate-900 px-3 py-2 text-sm font-medium text-purple-200 hover:bg-purple-950/60">
                      Ohne Adapter manuell mit KI fortfahren
                    </button>
                  </div>
                </section>
              )}

              {automaticProcessing && (
                <div className="rounded-lg border border-blue-900/70 bg-blue-950/40 p-4 text-sm text-blue-200">
                  KI wertet <strong>{selectedScan?.file.name}</strong> aus. Bitte warten…
                </div>
              )}

              {manualMode && (
                <section className="space-y-3 rounded-lg border border-purple-900/70 p-4">
                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium">
                    {(['1 Datei', '2 KI', '3 JSON'] as const).map((label, index) => {
                      const step = (index + 1) as 1 | 2 | 3;
                      const isCurrent = manualStep === step;
                      const isDone = manualStep > step;
                      return (
                        <div key={label} className={`rounded px-2 py-2 ${isCurrent ? 'bg-purple-700 text-white' : isDone ? 'bg-emerald-950/60 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}>
                          {isDone ? '✓ ' : ''}{label}
                        </div>
                      );
                    })}
                  </div>

                  {manualStep === 1 && (
                    <div className="rounded-lg bg-purple-950/40 p-4">
                      <h3 className="font-semibold text-purple-200">Schritt 1: Datei auswählen</h3>
                      <p className="mt-1 text-sm text-purple-200">Wählen Sie oben einen Scan aus. Klicken Sie danach auf „Manuellen Weg starten“. Wenn bereits JSON vorliegt, können Sie die Datei überspringen.</p>
                      <button
                        type="button"
                        onClick={() => setManualStep(3)}
                        className="mt-3 rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800"
                      >
                        Ich habe schon JSON – weiter
                      </button>
                    </div>
                  )}

                  {manualStep === 2 && (
                    <div className="rounded-lg bg-amber-950/30 p-4 text-sm text-amber-200">
                      <h3 className="font-semibold">Schritt 2: Datei und Prompt für die KI vorbereiten</h3>
                      <p className="mt-1">Ausgewählte Datei: <strong>{activeSourceName || 'kein Ordner-Scan ausgewählt'}</strong></p>
                      <ol className="mt-2 list-inside list-decimal space-y-1">
                        <li>Der Knopf lädt den Lieferschein herunter und kopiert den Prompt.</li>
                        <li>Wechseln Sie zur freigegebenen KI, hängen Sie die Datei aus „Downloads“ an und fügen Sie den Prompt ein.</li>
                        <li>Senden Sie die Anfrage ab und kopieren Sie danach die JSON-Antwort.</li>
                      </ol>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePrepareManualAI()}
                          disabled={!selectedScan || selectedScan.file.name.toLowerCase().endsWith('.json')}
                          className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800 disabled:bg-amber-300"
                        >
                          Prompt kopieren + Datei herunterladen
                        </button>
                      </div>
                      <button type="button" onClick={() => setManualStep(1)} className="mt-3 text-xs underline">Zurück zur Dateiauswahl</button>
                    </div>
                  )}

                  {manualStep === 3 && (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-purple-950/40 p-4">
                        <h3 className="font-semibold text-purple-200">Schritt 3: JSON einfügen und prüfen</h3>
                        <p className="mt-1 text-sm text-purple-200">
                          {activeSourceName
                            ? manualSourcePrepared
                              ? 'Der Scan liegt in „Downloads“, der Prompt ist kopiert. Laden Sie die Datei in der KI hoch, senden Sie den Prompt und kopieren Sie die JSON-Antwort. Klicken Sie dann unten.'
                              : 'Laden Sie den Scan in der KI hoch, senden Sie den Prompt und kopieren Sie die JSON-Antwort. Klicken Sie dann unten.'
                            : 'Kopieren Sie die KI-JSON-Antwort und klicken Sie unten. Sie können sie auch in das Feld einfügen.'}
                        </p>
                      </div>
                      <textarea
                        ref={jsonInputRef}
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        placeholder={'JSON hier einfügen, z. B. { "deliveryNoteNo": "…", "items": [...] }'}
                        className={`w-full h-48 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm ${error ? 'border-red-500 bg-rose-950/40' : 'border-slate-700'}`}
                      />
                      <div className="flex flex-wrap gap-3">
                        {activeSourceName && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(AI_EXTRACTION_PROMPT);
                                setError(null);
                              } catch {
                                setError('Der Prompt konnte nicht kopiert werden.');
                              }
                            }}
                            className="rounded-lg border border-purple-800 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-950/40"
                          >
                            Prompt erneut kopieren
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handlePasteAndParseClipboard()}
                          className="flex-1 rounded-lg bg-purple-700 px-4 py-2 font-medium text-white hover:bg-purple-800"
                        >
                          Aus Zwischenablage einfügen & prüfen
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleParseJson()}
                          disabled={!jsonText.trim()}
                          className="rounded-lg border border-purple-800 px-4 py-2 font-medium text-purple-300 hover:bg-purple-950/40 disabled:text-slate-500"
                        >
                          Feld prüfen
                        </button>
                        {activeSourceName && <button type="button" onClick={() => setManualStep(2)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm">Zurück</button>}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {duplicateImport && !importResults.length && (
            <div role="alert" className="mb-4 rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-amber-100">
              <p className="font-semibold">Lieferschein {parsedData?.deliveryNoteNo || 'Unbekannt'} von {parsedData?.supplier || 'Unbekannt'} wurde bereits am {duplicateImport.date} durch Benutzer {duplicateImport.user} gebucht.</p>
              <p className="mt-1 text-sm">Bitte nur bei ausdrücklicher Freigabe erneut buchen.</p>
            </div>
          )}

          {parsedData && !importResults.length && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/30 p-4">
                <h3 className="font-semibold text-emerald-200">Schritt 4 von 4: Prüfen und importieren</h3>
                <p className="mt-1 text-sm text-emerald-200">Kontrollieren Sie Lieferant, Lieferscheinnummer, Datum und jede Menge. Nur angehakte Positionen werden gebucht. Wenn alles stimmt, klicken Sie unten auf „Geprüfte Positionen importieren“.</p>
              </div>
              <div className="bg-purple-950/40 border border-purple-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-purple-300 mb-3">
                  📋 Lieferschein-Informationen
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-purple-300 mb-1">
                      Lieferscheinnummer
                    </label>
                    <input
                      type="text"
                      value={parsedData.deliveryNoteNo || ''}
                      onChange={(e) => {
                        setParsedData({ ...parsedData, deliveryNoteNo: e.target.value });
                        setDuplicateImport(null);
                        setAllowDuplicateImport(false);
                      }}
                      className="w-full px-3 py-2 border border-purple-800 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      placeholder="LS-2024-1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-300 mb-1">Bestellnummer (optional)</label>
                    <input
                      type="text"
                      value={parsedData.orderNumber || ''}
                      onChange={(e) => setParsedData({ ...parsedData, orderNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-purple-800 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      placeholder="Bestellnummer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-300 mb-1">
                      Lieferant
                    </label>
                    <input
                      type="text"
                      value={parsedData.supplier || ''}
                      onChange={(e) => {
                        setParsedData({ ...parsedData, supplier: e.target.value });
                        setDuplicateImport(null);
                        setAllowDuplicateImport(false);
                      }}
                      className="w-full px-3 py-2 border border-purple-800 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      placeholder="Muster-Lieferant"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-300 mb-1">
                      Lieferdatum
                    </label>
                    <input
                      type="date"
                      value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      className="w-full px-3 py-2 border border-purple-800 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-blue-950/40 border border-blue-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-blue-200 mb-2">
                  📊 Positionen ({parsedItems.length})
                </h3>
                <div className="space-y-3">
                  {parsedItems.map((item, index) => (
                    <div
                      key={index}
                      className="bg-slate-900 border border-blue-900/70 rounded-lg p-3 flex items-start gap-3"
                    >
                      <input
                        type="checkbox"
                        checked={item.confirmed}
                        onChange={() => handleToggleConfirm(index)}
                        className="mt-1 w-5 h-5 text-blue-300 rounded focus:ring-cyan-900"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.isNew ? 'bg-emerald-950/60 text-emerald-300' : 'bg-blue-950/60 text-blue-300'}`}>
                            {item.isNew ? 'Neu' : 'Vorhanden'}
                          </span>
                          <span className="font-medium text-slate-100">
                            {item.name || item.description || 'Unbenannt'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 space-y-1">
                          <p>Art.-Nr: {item.supplierArticleNo || '-'}</p>
                          {item.existingArticle && (
                            <p>Aktueller Bestand: {item.existingArticle.quantity}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-400">Menge:</label>
                        <input
                          type="number"
                          min="1"
                          value={item.adjustedQuantity || ''}
                          onChange={(e) => handleAdjustQuantity(index, e.target.value)}
                          className="w-20 px-2 py-1 border border-slate-700 rounded text-sm focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handleImport}
                  disabled={processing}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {processing ? 'Importiere...' : duplicateImport ? 'Trotzdem erneut buchen' : '✅ Geprüfte Positionen importieren'}
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 bg-slate-950/600 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Zurücksetzen
                </button>
              </div>
            </div>
          )}

          {importResults.length > 0 && (
            <div className="space-y-4">
              <div className="bg-emerald-950/30 border border-emerald-900/70 rounded-lg p-4">
                <h3 className="font-semibold text-emerald-200 mb-3">
                  📊 Import-Ergebnisse
                </h3>
                <p className="mb-3 text-sm text-emerald-100">
                  {importSummary.quantityBooked} Teile zugebucht, {importSummary.newlyCreated} neu angelegt.
                </p>
                <div className="space-y-2">
                  {importResults.map((result, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-2 rounded ${
                        result.success ? 'bg-emerald-950/60' : 'bg-rose-950/60'
                      }`}
                    >
                      <span className="text-xl">
                        {result.success ? '✅' : '❌'}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-slate-100">
                          {result.item.name || result.item.description || 'Unbenannt'}
                        </p>
                        <p className="text-xs text-slate-400">{result.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Schließen
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 bg-slate-950/600 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Weiteren Import
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(projectRoot, '.env.gemini.local'), quiet: true });

const HOST = (process.env.GEMINI_HOST || '127.0.0.1').trim();
const PORT = Number(process.env.GEMINI_PORT || 3000);
const API_BASE_URL = (process.env.GEMINI_API_BASE_URL || '').trim().replace(/\/+$/, '');
const MODEL = (process.env.GEMINI_MODEL || '').trim();
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
const pidFile = path.join(projectRoot, '.gemini-adapter.pid');
writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8');
process.on('exit', () => {
  try {
    const storedPid = JSON.parse(readFileSync(pidFile, 'utf8')).pid;
    if (storedPid === process.pid) unlinkSync(pidFile);
  } catch {
    // Die PID-Datei wurde möglicherweise bereits beim Beenden entfernt.
  }
});
const allowedOrigins = new Set(
  (process.env.GEMINI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const extractionPrompt = `Lies den angehängten Lieferschein sorgfältig aus. Antworte ausschließlich mit einem JSON-Objekt, das exakt dem angegebenen Schema entspricht. Erfinde keine Artikelnummern, Mengen, Preise, Daten oder Lieferantennamen. Wenn ein Textfeld nicht lesbar oder nicht vorhanden ist, gib einen leeren Text zurück. Mengen müssen Zahlen größer 0 sein; wenn eine Menge unleserlich ist, setze 1 und schreibe in die Beschreibung "Menge auf Scan unleserlich – bitte prüfen". Preise nur ausgeben, wenn ein Einzelpreis eindeutig auf dem Dokument steht. deliveryDate im Format YYYY-MM-DD oder leer. Behalte die Reihenfolge aller Lieferscheinpositionen bei. Ignoriere Summen-, Steuer- und Versandpositionen, sofern sie keine gelieferten Ersatzteile sind.\n\nJSON-Schema: { deliveryNoteNo: string, deliveryDate: string, supplier: string, items: [{ supplierArticleNo: string, name: string, description: string, quantityDelivered: number, unit: string, price?: number }] }`;

const responseSchema = {
  type: 'object',
  properties: {
    deliveryNoteNo: { type: 'string', description: 'Lieferscheinnummer oder leerer Text.' },
    deliveryDate: { type: 'string', description: 'Lieferscheindatum als YYYY-MM-DD oder leerer Text.' },
    supplier: { type: 'string', description: 'Name des Lieferanten oder leerer Text.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          supplierArticleNo: { type: 'string', description: 'Lieferanten-Artikelnummer oder leerer Text.' },
          name: { type: 'string', description: 'Kurze Artikelbezeichnung.' },
          description: { type: 'string', description: 'Weitere erkannte Artikelangaben oder leerer Text.' },
          quantityDelivered: { type: 'number', description: 'Gelieferte Menge als positive Zahl.' },
          unit: { type: 'string', description: 'Einheit wie ST, Stück, m oder kg.' },
          price: { type: 'number', description: 'Eindeutiger Einzelpreis, falls angegeben.' },
        },
        required: ['supplierArticleNo', 'name', 'description', 'quantityDelivered', 'unit'],
      },
    },
  },
  required: ['deliveryNoteNo', 'deliveryDate', 'supplier', 'items'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, data, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(data));
}

function setCors(response, origin) {
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function readIncomingBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES && !tooLarge) {
        tooLarge = true;
        reject(new HttpError(413, 'Die Datei ist zu groß. Erlaubt sind höchstens 50 MB.'));
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function redactSecret(message) {
  if (!API_KEY) return String(message || 'Unbekannter Fehler');
  return String(message || 'Unbekannter Fehler').split(API_KEY).join('[API-Schlüssel ausgeblendet]');
}

function formatGeminiNetworkError(error) {
  const code = error?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Dieser PC kann generativelanguage.googleapis.com nicht per DNS finden. Prüfe Internetverbindung, VPN, DNS und Proxy. Der API-Schlüssel wurde dadurch nicht als falsch eingestuft.';
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || code === 'ETIMEDOUT') {
    return 'Google Gemini hat nicht rechtzeitig geantwortet. Prüfe Netzwerk, VPN oder Proxy und versuche es später erneut. Der API-Schlüssel wurde dadurch nicht als falsch eingestuft.';
  }
  return 'Gemini konnte nicht erreicht werden. Prüfe Internetverbindung, VPN, DNS oder Proxy. Der API-Schlüssel wurde dadurch nicht als falsch eingestuft.';
}

function isModelUnavailable(status, message) {
  return status === 404
    || /(?:model|models).{0,80}(?:not found|not supported|unknown|does not exist|unsupported|not available|invalid)/i.test(message)
    || /(?:not found|unsupported|unknown).{0,40}(?:model|models)/i.test(message);
}

function formatGeminiError(status, message, model) {
  if (status === 413 || /(file|image|document|payload|request).{0,80}(too large|exceeds? (the )?(size |size )?limit|maximum size)/i.test(message)) {
    return 'Die Datei ist für die Gemini-Auswertung zu groß. Verwende eine kleinere Datei (höchstens 50 MB).';
  }
  if (status === 401 || /api[_ -]?key.{0,50}(invalid|not valid|missing|expired|revoked)|api_key_invalid|unauthenticated/i.test(message)) {
    return 'Der Gemini-API-Schlüssel fehlt oder ist ungültig. Trage einen gültigen Schlüssel in .env.gemini.local ein und starte Start-App.bat erneut.';
  }
  if (status === 403) {
    return 'Gemini hat den Zugriff verweigert. Prüfe, ob der Schlüssel für die Gemini API freigegeben ist und das Google-Projekt Zugriff hat.';
  }
  if (status === 402 || /payment required|prepay.*(depleted|empty)|billing.*(required|disabled)/i.test(message)) {
    return 'Das Gemini-Guthaben oder die Abrechnung ist nicht verfügbar. Prüfe die Abrechnungseinstellungen des Google-Projekts.';
  }
  if (status === 429 || /resource_exhausted|quota|rate.?limit|too many requests/i.test(message)) {
    return 'Das Gemini-Nutzungslimit ist erreicht. Warte kurz oder prüfe Kontingent und Rate-Limits in Google AI Studio.';
  }
  if (isModelUnavailable(status, message)) {
    return `Das Gemini-Modell „${model}“ wurde nicht gefunden oder ist für diesen API-Zugang nicht verfügbar. Prüfe GEMINI_MODEL in .env.gemini.local.`;
  }
  if (status === 503 || status >= 500) {
    return 'Gemini ist gerade überlastet oder vorübergehend nicht erreichbar. Warte kurz und versuche es erneut.';
  }
  if (status === 400) {
    return 'Gemini hat die Anfrage abgelehnt. Prüfe Dateiformat und Adapterkonfiguration; technische Details stehen in der Adapter-Konsole.';
  }
  return `Gemini konnte den Lieferschein nicht auswerten (HTTP ${status}). Technische Details stehen in der Adapter-Konsole.`;
}

async function verifyGeminiKey() {
  if (!API_KEY) {
    throw new HttpError(503, 'Der Gemini-API-Schlüssel fehlt. Trage ihn mit Einrichten-Gemini.bat in .env.gemini.local ein und starte Start-App.bat erneut.');
  }
  if (!API_BASE_URL || !MODEL) {
    throw new HttpError(503, 'Gemini-API-Basisadresse und Modell müssen lokal konfiguriert sein.');
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/models/${encodeURIComponent(MODEL)}`, {
      headers: { 'x-goog-api-key': API_KEY },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new HttpError(503, formatGeminiNetworkError(error));
  }

  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    throw new HttpError(502, 'Google hat bei der Schlüsselprüfung eine nicht lesbare Antwort zurückgegeben.');
  }

  if (!response.ok) {
    const providerMessage = responseData?.error?.message || `HTTP ${response.status}`;
    throw new HttpError(response.status, formatGeminiError(response.status, providerMessage, MODEL));
  }

  return {
    ok: true,
    configured: true,
    model: MODEL,
    message: `Der Gemini-API-Schlüssel ist gültig und das Modell ${MODEL} ist erreichbar.`,
  };
}

function getOutputText(interaction) {
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim()) {
    return interaction.output_text.trim();
  }

  const contentBlocks = (interaction.steps || []).flatMap((step) => {
    if (Array.isArray(step.content)) return step.content;
    if (Array.isArray(step.output?.content)) return step.output.content;
    return [];
  });
  return contentBlocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRetryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 5000);
  }
  return attempt === 0 ? 1200 : 2400;
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new HttpError(502, 'Gemini hat kein gültiges JSON zurückgegeben.');
  }
}

function getMimeType(file) {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.pdf')) return 'application/pdf';
  const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  if (allowedImageTypes.has(file.type)) return file.type;
  const extensionTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };
  const extension = path.extname(fileName);
  return extensionTypes[extension] || null;
}

async function analyzeFile(request, response, origin) {
  if (!API_KEY) {
    throw new HttpError(503, 'Der Gemini-API-Schlüssel fehlt. Starte Einrichten-Gemini.bat, trage den Schlüssel in .env.gemini.local ein, speichere die Datei und starte Start-App.bat erneut.');
  }
  if (!API_BASE_URL || !MODEL) {
    throw new HttpError(503, 'Gemini-API-Basisadresse und Modell müssen lokal konfiguriert sein.');
  }

  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new HttpError(400, 'Die App muss die Datei als multipart/form-data im Feld "file" senden.');
  }

  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, 'Die Datei ist zu groß. Erlaubt sind höchstens 50 MB.');
  }
  const body = await readIncomingBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const formRequest = new Request(`http://${HOST}:${PORT}/analyze`, {
    method: 'POST',
    headers,
    body: new Uint8Array(body),
  });
  const form = await formRequest.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
    throw new HttpError(400, 'In der Anfrage wurde keine Datei im Feld "file" gefunden.');
  }
  if (!file.size) throw new HttpError(400, 'Die ausgewählte Datei ist leer.');
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Die Datei ist zu groß. Erlaubt sind höchstens 50 MB.');

  const mimeType = getMimeType(file);
  if (!mimeType) {
    throw new HttpError(415, 'Bitte verwende eine PDF-, JPG-, PNG-, WebP- oder HEIC-Datei.');
  }

  const mediaType = mimeType === 'application/pdf' ? 'document' : 'image';
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const modelsToTry = [...new Set([MODEL, ...FALLBACK_MODELS])];
  const input = [
    {
      type: mediaType,
      data: base64,
      mime_type: mimeType,
    },
    { type: 'text', text: extractionPrompt },
  ];
  let interaction = null;
  const providerFailures = [];

  for (const [modelIndex, model] of modelsToTry.entries()) {
    const attempts = modelIndex === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let geminiResponse;
      try {
        geminiResponse = await fetch(`${API_BASE_URL}/interactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': API_KEY,
            'Api-Revision': '2026-05-20',
          },
          body: JSON.stringify({
            model,
            store: false,
            input,
            response_format: {
              type: 'text',
              mime_type: 'application/json',
              schema: responseSchema,
            },
          }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        throw new HttpError(502, formatGeminiNetworkError(error));
      }

      const responseText = await geminiResponse.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        throw new HttpError(502, 'Gemini hat eine nicht lesbare Antwort zurückgegeben. Technische Details stehen in der Adapter-Konsole.');
      }

      if (geminiResponse.ok) {
        interaction = responseData;
        break;
      }

      const providerMessage = responseData?.error?.message || responseData?.message || `HTTP ${geminiResponse.status}`;
      const providerStatus = geminiResponse.status;

      if (providerStatus === 503 || providerStatus === 429 || isModelUnavailable(providerStatus, providerMessage)) {
        providerFailures.push({ status: providerStatus, model, message: providerMessage });
        if (providerStatus === 503 && attempt + 1 < attempts) {
          await wait(getRetryDelay(geminiResponse, attempt));
          continue;
        }
        break;
      }

      throw new HttpError(providerStatus, formatGeminiError(providerStatus, providerMessage, model));
    }
    if (interaction) break;
  }

  if (!interaction) {
    const finalFailure = providerFailures.find((failure) => failure.status === 429)
      || providerFailures.find((failure) => isModelUnavailable(failure.status, failure.message))
      || providerFailures.at(-1);
    if (finalFailure) {
      throw new HttpError(finalFailure.status, formatGeminiError(finalFailure.status, finalFailure.message, finalFailure.model));
    }
    throw new HttpError(503, 'Gemini ist gerade überlastet oder vorübergehend nicht erreichbar. Warte kurz und versuche es erneut.');
  }

  const outputText = getOutputText(interaction);
  if (!outputText) throw new HttpError(502, 'Gemini hat keine Auswertung zurückgegeben.');
  const result = parseModelJson(outputText);
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.items) || result.items.length === 0) {
    throw new HttpError(502, 'Die Gemini-Antwort enthält keine gültige Artikelliste.');
  }

  sendJson(response, 200, result, origin);
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: 'Diese App-Adresse ist für den lokalen Gemini-Adapter nicht freigegeben.' });
    return;
  }
  setCors(response, origin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'delivery-note-gemini-adapter',
      adapterVersion: 2,
      configured: Boolean(API_KEY && API_KEY !== 'HIER_API_SCHLUESSEL_EINFUEGEN'),
    }, origin);
    return;
  }
  if (request.method === 'GET' && request.url === '/verify-key') {
    try {
      sendJson(response, 200, await verifyGeminiKey(), origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const message = error instanceof Error ? redactSecret(error.message) : 'Die Schlüsselprüfung ist fehlgeschlagen.';
      sendJson(response, status, { error: message }, origin);
    }
    return;
  }
  if (request.method !== 'POST' || request.url !== '/analyze') {
    sendJson(response, 404, { error: 'Nicht gefunden.' }, origin);
    return;
  }

  try {
    await analyzeFile(request, response, origin);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    const message = error instanceof Error ? redactSecret(error.message) : 'Unbekannter Fehler beim Gemini-Adapter.';
    if (!response.headersSent) sendJson(response, status, { error: message }, origin);
    else response.destroy();
  }
});

server.listen(PORT, HOST);

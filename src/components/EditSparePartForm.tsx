import { useState, useEffect } from 'react';
import { updateSparePart, getCategories, getSpareParts, type Category, type SparePart } from '../lib/pocketbaseServices';
import { uploadAttachment, deleteAttachment } from '../lib/storage';
import LocationBuilder, { type LocationData, type LocationType } from './LocationBuilder';
import ExistingTextField from './ExistingTextField';
import { getExistingTextValues } from '../lib/formSuggestions';

interface EditSparePartFormProps {
  sparePart: SparePart;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function EditSparePartForm({ sparePart, onSuccess, onCancel }: EditSparePartFormProps) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [existingParts, setExistingParts] = useState<SparePart[]>([]);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string>(sparePart.attachment || '');
  
  // LocationData aus bestehenden Daten initialisieren
  const [locationData, setLocationData] = useState<LocationData>(() => {
    const type = sparePart.location_type as string;
    const validTypes = ['S', 'ES', 'R', 'PID', 'CUSTOM'];
    return {
      type: validTypes.includes(type) ? (type as LocationType) : null,
      number: sparePart.location_number || undefined,
      place: sparePart.location_place || undefined,
      pid: sparePart.location_pid || undefined,
    };
  });
  
  const [formData, setFormData] = useState<{
    name: string;
    article_number: string;
    installation_location: string;
    anlage: string;
    category_id: string | null;
    manufacturer: string;
    supplier: string;
    description: string;
    technical_data: string;
    additional_info: string;
    unit: string;
    price: string;
    quantity: number;
    min_quantity: number;
    link: string;
  }>({
    name: sparePart.name,
    article_number: sparePart.article_number,
    installation_location: sparePart.installation_location || '',
    anlage: sparePart.anlage || '',
    category_id: sparePart.category_id || null,
    manufacturer: sparePart.manufacturer,
    supplier: sparePart.supplier || '',
    description: sparePart.description || '',
    technical_data: sparePart.technical_data || '',
    additional_info: sparePart.additional_info || '',
    unit: sparePart.unit || '',
    price: sparePart.price ? sparePart.price.toString() : '',
    quantity: sparePart.quantity,
    min_quantity: sparePart.min_quantity,
    link: sparePart.link || ''
  });

  const loadData = async () => {
    try {
      const [cats, parts] = await Promise.all([getCategories(), getSpareParts()]);
      setCategories(cats);
      setExistingParts(parts);
    } catch {
      setError('Kategorien und Ersatzteile konnten nicht geladen werden. Prüfen Sie die Verbindung zu PocketBase.');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachmentFile(file);
    }
  };

  const handleUpload = async () => {
    if (!attachmentFile) return;

    try {
      setUploading(true);
      setError(null);
      const url = await uploadAttachment(attachmentFile);
      setAttachmentUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Upload');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = async () => {
    if (attachmentUrl) {
      try {
        await deleteAttachment(attachmentUrl);
      } catch {
        setError('Der Anhang konnte nicht entfernt werden.');
      }
    }
    setAttachmentFile(null);
    setAttachmentUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Bereinige die Daten vor dem Senden
      const updateData: any = {
        name: formData.name,
        article_number: formData.article_number,
        installation_location: formData.installation_location || null,
        anlage: formData.anlage || null,
        category_id: formData.category_id || null, // Explizit null wenn leer
        manufacturer: formData.manufacturer || null,
        supplier: formData.supplier || null,
        description: formData.description || null,
        technical_data: formData.technical_data || null,
        additional_info: formData.additional_info || null,
        unit: formData.unit || null,
        price: formData.price ? parseFloat(formData.price) : null,
        quantity: formData.quantity,
        min_quantity: formData.min_quantity,
        // Strukturierte Lagerort-Felder
        location_type: locationData.type || null,
        location_number: locationData.number || null,
        location_place: locationData.place || null,
        location_pid: locationData.pid || null,
        link: formData.link || null,
        attachment: attachmentUrl || null
      };

      const updatedPart = await updateSparePart(sparePart.id, updateData);
      setExistingParts((parts) => parts.map((part) => part.id === updatedPart.id ? updatedPart : part));

      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Aktualisieren des Ersatzteils');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-slate-100 mb-4">✏️ Ersatzteil bearbeiten: {sparePart.name}</h2>
      
      {error && (
        <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-3 mb-4">
          <p className="text-rose-200 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Name *
            </label>
            <ExistingTextField
              type="text"
              required
              value={formData.name}
              onChange={(value) => setFormData({ ...formData, name: value })}
              suggestions={getExistingTextValues(existingParts, 'name')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Artikelnummer *
            </label>
            <ExistingTextField
              type="text"
              required
              value={formData.article_number}
              onChange={(value) => setFormData({ ...formData, article_number: value })}
              suggestions={getExistingTextValues(existingParts, 'article_number')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Kategorie
            </label>
            <select
              value={formData.category_id || ''}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value || null })}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            >
              <option value="">-- Keine Kategorie --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Hersteller
            </label>
            <ExistingTextField
              type="text"
              value={formData.manufacturer}
              onChange={(value) => setFormData({ ...formData, manufacturer: value })}
              suggestions={getExistingTextValues(existingParts, 'manufacturer')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Lieferant
            </label>
            <ExistingTextField
              type="text"
              value={formData.supplier}
              onChange={(value) => setFormData({ ...formData, supplier: value })}
              suggestions={getExistingTextValues(existingParts, 'supplier')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Einbauort
            </label>
            <ExistingTextField
              type="text"
              value={formData.installation_location}
              onChange={(value) => setFormData({ ...formData, installation_location: value })}
              suggestions={getExistingTextValues(existingParts, 'installation_location')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
              placeholder="z.B. Anlage 1, Schaltschrank links"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Anlage
            </label>
            <ExistingTextField
              value={formData.anlage}
              onChange={(value) => setFormData({ ...formData, anlage: value })}
              suggestions={getExistingTextValues(existingParts, 'anlage')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Lagerort
            </label>
            <LocationBuilder 
              value={locationData}
              onChange={setLocationData}
              numberSuggestions={getExistingTextValues(existingParts, 'location_number')}
              placeSuggestions={getExistingTextValues(existingParts, 'location_place')}
              pidSuggestions={getExistingTextValues(existingParts, 'location_pid')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Bestand *
            </label>
            <input
              type="number"
              required
              min="0"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Mindestbestand *
            </label>
            <input
              type="number"
              required
              min="0"
              value={formData.min_quantity}
              onChange={(e) => setFormData({ ...formData, min_quantity: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Einheit
            </label>
            <ExistingTextField
              value={formData.unit}
              onChange={(value) => setFormData({ ...formData, unit: value })}
              suggestions={getExistingTextValues(existingParts, 'unit')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Preis (€)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Link
            </label>
            <ExistingTextField
              type="url"
              value={formData.link}
              onChange={(value) => setFormData({ ...formData, link: value })}
              suggestions={getExistingTextValues(existingParts, 'link')}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Beschreibung
          </label>
          <ExistingTextField
            rows={2}
            value={formData.description}
            onChange={(value) => setFormData({ ...formData, description: value })}
            suggestions={getExistingTextValues(existingParts, 'description')}
            className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Technische Daten
          </label>
          <ExistingTextField
            rows={2}
            value={formData.technical_data}
            onChange={(value) => setFormData({ ...formData, technical_data: value })}
            suggestions={getExistingTextValues(existingParts, 'technical_data')}
            className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Zusätzliche Angaben
          </label>
          <ExistingTextField
            rows={2}
            value={formData.additional_info}
            onChange={(value) => setFormData({ ...formData, additional_info: value })}
            suggestions={getExistingTextValues(existingParts, 'additional_info')}
            className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Anhang (PDF, Bild)
          </label>
          <div className="space-y-2">
            {!attachmentUrl ? (
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.gif"
                  onChange={handleFileChange}
                  className="flex-1 px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                />
                {attachmentFile && (
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={uploading}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    {uploading ? '🔄' : '📤'}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">📎</span>
                  <span className="text-sm text-slate-300">
                    Aktuelles Anhänge: {attachmentUrl}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  className="text-rose-300 hover:text-rose-300 font-medium"
                >
                  ✕
                </button>
              </div>
            )}
            <p className="text-xs text-slate-500">Erlaubt: PDF, JPG, PNG, GIF (max 10MB)</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="bg-slate-950/600 hover:bg-slate-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            {loading ? '🔄 Speichere...' : '💾 Änderungen speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}

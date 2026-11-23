import { useState } from 'react';
import { updateQuantityWithAudit, type SparePart } from '../lib/pocketbaseServices';

interface StockMovementDialogProps {
  sparePart: SparePart;
  action: 'in' | 'out';
  onClose: () => void;
  onSuccess: () => void;
}

export default function StockMovementDialog({ sparePart, action, onClose, onSuccess }: StockMovementDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<'Reparatur/Instandhaltung' | 'Lieferung/Wareneingang' | 'Inventur/Korrektur' | 'Zur Überholung' | 'Von Überholung zurück' | 'Verschrottung/Defekt' | 'Sonstiges'>('Sonstiges');
  const [supplier, setSupplier] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validierung
    if (quantity <= 0) {
      setError('Menge muss größer als 0 sein');
      return;
    }

    if (action === 'out' && sparePart.quantity < quantity) {
      setError('Nicht genügend Bestand verfügbar');
      return;
    }

    try {
      setLoading(true);
      
      const newQuantity = action === 'in' 
        ? sparePart.quantity + quantity 
        : sparePart.quantity - quantity;

      await updateQuantityWithAudit(sparePart.id, newQuantity, action, {
        reason,
        supplier: supplier || undefined,
        order_number: orderNumber || undefined,
        delivery_note_number: deliveryNoteNumber || undefined,
        notes: notes || undefined,
        metadata: {
          original_quantity: sparePart.quantity,
          movement_quantity: quantity
        }
      });

      window.dispatchEvent(new CustomEvent('ersatzteillager:booking-completed'));
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler bei der Buchung');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          <h3 className="text-xl font-semibold text-slate-100 mb-4">
            {action === 'in' ? '➕ Ersatzteil Zugang' : '➖ Ersatzteil Abgang'}
          </h3>

          <div className="mb-4 p-3 bg-slate-950/60 rounded-lg">
            <p className="font-medium text-slate-100">{sparePart.name}</p>
            <p className="text-sm text-slate-400">Artikel: {sparePart.article_number}</p>
            <p className="text-sm text-slate-400">Aktueller Bestand: {sparePart.quantity}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Menge *
              </label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Buchungsgrund *
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              >
                <option value="Reparatur/Instandhaltung">Reparatur/Instandhaltung</option>
                <option value="Lieferung/Wareneingang">Lieferung/Wareneingang</option>
                <option value="Inventur/Korrektur">Inventur/Korrektur</option>
                <option value="Zur Überholung">Zur Überholung</option>
                <option value="Von Überholung zurück">Von Überholung zurück</option>
                <option value="Verschrottung/Defekt">Verschrottung/Defekt</option>
                <option value="Sonstiges">Sonstiges</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Lieferant
              </label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                placeholder="z.B. RS Components"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Bestellnummer
              </label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                placeholder="z.B. PO-2024-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Lieferscheinnummer
              </label>
              <input
                type="text"
                value={deliveryNoteNumber}
                onChange={(e) => setDeliveryNoteNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                placeholder="z.B. LS-2024-0876"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Bemerkung
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                placeholder="Zusätzliche Informationen zur Buchung"
              />
            </div>

            {error && (
              <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-3">
                <p className="text-rose-200 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 bg-slate-950/600 hover:bg-slate-600 disabled:bg-slate-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Wird gebucht...' : action === 'in' ? 'Zugang buchen' : 'Abgang buchen'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { getCategories, createCategory, deleteCategory, type Category } from '../lib/pocketbaseServices';

interface CategoryManagementProps {
  onClose?: () => void;
}

export default function CategoryManagement({ onClose }: CategoryManagementProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const data = await getCategories();
      setCategories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Kategorien');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      setError(null);
      await createCategory(newCategoryName.trim(), newCategoryDescription.trim() || undefined);
      setNewCategoryName('');
      setNewCategoryDescription('');
      setShowAddForm(false);
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen der Kategorie');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Kategorie wirklich löschen?')) return;

    try {
      setError(null);
      await deleteCategory(id);
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Löschen der Kategorie');
    }
  };

  return (
    <div className="bg-slate-900 rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-slate-100">
          📁 Kategorie-Verwaltung
        </h2>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-3 mb-4">
          <p className="text-rose-200 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-500">
          Kategorien werden geladen...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Neue Kategorie hinzufügen */}
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              ➕ Neue Kategorie erstellen
            </button>
          ) : (
            <form onSubmit={handleAddCategory} className="bg-slate-950/60 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Kategorie-Name *
                </label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                  placeholder="z.B. Elektrotechnik"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Beschreibung (optional)
                </label>
                <textarea
                  value={newCategoryDescription}
                  onChange={(e) => setNewCategoryDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                  placeholder="Beschreibung der Kategorie"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  ✅ Erstellen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewCategoryName('');
                    setNewCategoryDescription('');
                  }}
                  className="flex-1 bg-slate-950/600 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}

          {/* Kategorien-Liste */}
          <div className="space-y-2">
            {categories.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                Keine Kategorien vorhanden
              </div>
            ) : (
              categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between bg-slate-950/60 rounded-lg p-3"
                >
                  <div>
                    <p className="font-medium text-slate-100">{category.name}</p>
                    {category.description && (
                      <p className="text-sm text-slate-400">{category.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    className="text-rose-300 hover:text-rose-300 font-medium px-2"
                  >
                    🗑️
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

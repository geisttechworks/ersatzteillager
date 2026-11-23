import { useState } from 'react';
import { KeyRound, UserRound } from 'lucide-react';
import pb from '../lib/pocketbase';

interface ProfileSettingsProps {
  onClose: () => void;
  onUpdated: () => void;
}

export default function ProfileSettings({ onClose, onUpdated }: ProfileSettingsProps) {
  const user = pb.authStore.model;
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!user) return null;

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword.length < 12) {
      setError('Das neue Passwort muss mindestens 12 Zeichen lang sein.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }

    try {
      setLoading(true);
      await pb.collection('users').update(user.id, {
        oldPassword,
        password: newPassword,
        passwordConfirm: newPasswordConfirm,
      });
      await pb.collection('users').authWithPassword(user.email, newPassword);
      setOldPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setSuccess('Passwort wurde geändert.');
      onUpdated();
    } catch {
      setError('Das Passwort konnte nicht geändert werden. Prüfen Sie das bisherige Passwort und versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-cyan-950 p-2 text-cyan-300"><UserRound className="h-6 w-6" /></span>
            <div>
              <h2 className="text-xl font-semibold text-slate-100">Profil</h2>
              <p className="text-sm text-slate-400">{user.name || user.email}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Profil schließen" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800">✕</button>
        </div>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <h3 className="flex items-center gap-2 font-medium text-slate-200"><KeyRound className="h-4 w-4" /> Passwort ändern</h3>
          {error && <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
          {success && <p role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200">{success}</p>}
          <label className="block text-sm text-slate-300">
            Bisheriges Passwort
            <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base" />
          </label>
          <label className="block text-sm text-slate-300">
            Neues Passwort
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base" />
          </label>
          <label className="block text-sm text-slate-300">
            Neues Passwort wiederholen
            <input type="password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={12} required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base" />
          </label>
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-cyan-700 px-4 py-3 font-medium text-white hover:bg-cyan-600 disabled:opacity-50">
            {loading ? 'Ändere Passwort …' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}

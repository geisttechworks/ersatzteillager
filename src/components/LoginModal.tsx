import { useState } from 'react';
import { Lock, User as UserIcon } from 'lucide-react';
import pb from '../lib/pocketbase';
import InstallHint from './InstallHint';

interface LoginModalProps {
  onLogin: () => void;
}

export default function LoginModal({ onLogin }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [resetStatus, setResetStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordResetEnabled = import.meta.env.VITE_PASSWORD_RESET_ENABLED === 'true';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await pb.collection('users').authWithPassword(email, password);
      onLogin();
    } catch (err: any) {
      if (err.status === 400) {
        setError('Ungültige Email oder Passwort');
      } else if (err.status === 403) {
        setError('Zugriff verweigert');
      } else {
        setError('Fehler beim Login: ' + (err.message || 'Unbekannter Fehler'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetRequest = async () => {
    setError('');
    setResetStatus('');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Geben Sie zuerst Ihre gültige E-Mail-Adresse ein.');
      return;
    }
    try {
      setLoading(true);
      await pb.collection('users').requestPasswordReset(email);
      setResetStatus('Wenn das Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.');
    } catch {
      setError('Die Reset-E-Mail konnte nicht angefordert werden. Wenden Sie sich an den Admin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="bg-indigo-600 text-white p-3 rounded-xl inline-flex mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-100">
            Anmelden
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Melden Sie sich am Ersatzteillager an
          </p>
        </div>

        {error && (
          <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-3 mb-4">
            <p className="text-rose-300 text-sm text-center">{error}</p>
          </div>
        )}
        {resetStatus && <p role="status" className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/40 p-3 text-center text-sm text-emerald-200">{resetStatus}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Email
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 w-5 h-5" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Passwort
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {loading ? 'Wird geprüft...' : 'Einloggen'}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-400">
          <p>Passwort vergessen? Wenden Sie sich an den Admin.</p>
          {passwordResetEnabled && (
            <button type="button" onClick={handlePasswordResetRequest} disabled={loading} className="mt-2 font-medium text-cyan-300 hover:text-cyan-200 disabled:opacity-50">
              Passwort vergessen – Reset-E-Mail anfordern
            </button>
          )}
        </div>

        <InstallHint />

      </div>
    </div>
  );
}

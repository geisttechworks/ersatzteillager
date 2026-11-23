import { useState, useEffect } from 'react';
import { Shield, UserPlus, Trash2, Lock, Unlock, RefreshCw, KeyRound } from 'lucide-react';
import pb from '../lib/pocketbase';

interface User {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created: string;
  updated: string;
}

interface UserManagementProps {
  onClose: () => void;
}

export default function UserManagement({ onClose }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    if (pb.authStore.model?.is_admin !== true) return;
    loadUsers();
    setCurrentUser(pb.authStore.model as unknown as User);
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const result = await pb.collection('users').getFullList<User>();
      setUsers(result);
    } catch (err: any) {
      setError('Fehler beim Laden der Benutzer: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 12) {
      setError('Das Passwort muss mindestens 12 Zeichen lang sein.');
      return;
    }
    setLoading(true);

    try {
      await pb.collection('users').create({
        email: newEmail,
        name: newName,
        password: newPassword,
        passwordConfirm: newPassword,
        emailVisibility: true,
        is_admin: newIsAdmin,
      });

      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNewIsAdmin(false);
      setShowAddUser(false);
      await loadUsers();
    } catch (err: any) {
      setError('Fehler beim Erstellen: ' + (err.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const target = users.find((user) => user.id === userId);
    if (target?.is_admin && users.filter((user) => user.is_admin).length <= 1) {
      setError('Der letzte Administrator kann nicht gelöscht werden.');
      return;
    }
    if (!confirm('Benutzer wirklich löschen?')) return;

    try {
      setLoading(true);
      await pb.collection('users').delete(userId);
      await loadUsers();
    } catch (err: any) {
      setError('Fehler beim Löschen: ' + (err.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    if (currentIsAdmin && users.filter((user) => user.is_admin).length <= 1) {
      setError('Dem letzten Administrator können die Admin-Rechte nicht entzogen werden.');
      return;
    }
    try {
      setLoading(true);
      await pb.collection('users').update(userId, {
        is_admin: !currentIsAdmin,
      });
      await loadUsers();
    } catch (err: any) {
      setError('Fehler beim Ändern der Admin-Rechte: ' + (err.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget) return;
    setError('');
    if (resetPassword.length < 12) {
      setError('Das Passwort muss mindestens 12 Zeichen lang sein.');
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    try {
      setLoading(true);
      await pb.collection('users').update(passwordTarget.id, {
        password: resetPassword,
        passwordConfirm: resetPasswordConfirm,
      });
      setPasswordTarget(null);
      setResetPassword('');
      setResetPasswordConfirm('');
    } catch (err: any) {
      setError('Fehler beim Ändern des Passworts: ' + (err.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = pb.authStore.model?.is_admin === true;
  const adminCount = users.filter((user) => user.is_admin).length;

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6">
          <p className="text-slate-300 mb-4">Zugriff nur für Administratoren.</p>
          <button onClick={onClose} className="bg-slate-800 px-4 py-2 rounded-lg">Schließen</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-2 rounded-xl">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100">Benutzer-Verwaltung</h2>
              <p className="text-sm text-slate-400">{isAdmin ? 'Admin-Bereich' : 'Benutzer-Übersicht'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadUsers}
              className="text-slate-500 hover:text-slate-400 p-2 hover:bg-slate-800 rounded-lg transition-colors"
              title="Aktualisieren"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              aria-label="Benutzerverwaltung schließen"
              className="text-slate-500 hover:text-slate-400 p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-rose-950/40 border border-rose-900/70 rounded-lg p-3 mb-4">
            <p className="text-rose-300 text-sm">{error}</p>
          </div>
        )}

        {!showAddUser ? (
          <>
            {isAdmin && (
              <div className="mb-4">
                <button
                  onClick={() => setShowAddUser(true)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <UserPlus className="w-5 h-5" />
                  Neuen Benutzer hinzufügen
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center py-8 text-slate-500">Laden...</div>
            ) : (
              <div className="space-y-3">
                {users.map((user) => {
                  const isLastAdmin = user.is_admin && adminCount === 1;
                  return (
                  <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${user.is_admin ? 'bg-indigo-950/60 text-indigo-300' : 'bg-slate-800 text-slate-400'}`}>
                        {user.is_admin ? <Shield className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-100">{user.name || user.email}</p>
                        <p className="text-xs text-slate-500">{user.email}</p>
                        <p className="text-xs text-slate-500">
                          {user.is_admin ? 'Administrator' : 'Techniker'}
                          {user.id === currentUser?.id && ' (Sie)'}
                          {isLastAdmin && ' · letzter Admin'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && user.id !== currentUser?.id && (
                        <>
                          <button
                            onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                            disabled={isLastAdmin}
                            className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            title={isLastAdmin ? 'Der letzte Admin kann nicht herabgestuft werden' : user.is_admin ? 'Admin-Rechte entziehen' : 'Admin-Rechte geben'}
                          >
                            {user.is_admin ? <Unlock className="w-4 h-4 text-slate-400" /> : <Lock className="w-4 h-4 text-slate-400" />}
                          </button>
                          <button
                            onClick={() => { setError(''); setPasswordTarget(user); }}
                            aria-label={`Passwort zurücksetzen für ${user.email || user.name}`}
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                            title="Neues Passwort für diesen Benutzer setzen"
                          >
                            <KeyRound className="w-4 h-4" />
                            Passwort zurücksetzen
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            disabled={isLastAdmin}
                            className="p-2 hover:bg-rose-950/60 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            title={isLastAdmin ? 'Der letzte Admin kann nicht gelöscht werden' : 'Benutzer löschen'}
                          >
                            <Trash2 className="w-4 h-4 text-rose-300" />
                          </button>
                        </>
                      )}
                      {user.id === currentUser?.id && <span className="text-xs text-slate-500">Eigenes Passwort unter „Profil“ ändern.</span>}
                    </div>
                  </div>
                )})}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleAddUser} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                E-Mail
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="benutzer@beispiel.de"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z.B. Techniker 1"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Passwort
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-900 focus:border-cyan-700"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isAdmin"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
                className="w-5 h-5 text-indigo-300 rounded focus:ring-cyan-900"
              />
              <label htmlFor="isAdmin" className="text-sm font-medium text-slate-300">
                Administrator (sonst Techniker)
              </label>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddUser(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 px-4 rounded-xl transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl transition-colors disabled:opacity-50"
              >
                {loading ? 'Erstellen...' : 'Benutzer erstellen'}
              </button>
            </div>
          </form>
        )}
      </div>
      {passwordTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <form onSubmit={handleResetPassword} className="bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-xl font-semibold text-slate-100">Passwort zurücksetzen</h3>
            <p className="text-sm text-slate-400">Neues Passwort für {passwordTarget.email} festlegen.</p>
            {error && <p role="alert" className="text-sm text-rose-300 bg-rose-950/40 border border-rose-900/70 rounded-lg p-3">{error}</p>}
            <label className="block text-sm font-medium text-slate-300">
              Neues Passwort
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
                className="mt-1 w-full px-4 py-3 border border-slate-300 rounded-xl"
              />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              Passwort wiederholen
              <input
                type="password"
                value={resetPasswordConfirm}
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
                className="mt-1 w-full px-4 py-3 border border-slate-300 rounded-xl"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setPasswordTarget(null); setResetPassword(''); setResetPasswordConfirm(''); setError(''); }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 px-4 rounded-xl"
              >Abbrechen</button>
              <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl disabled:opacity-50">
                {loading ? 'Speichern...' : 'Neues Passwort setzen'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

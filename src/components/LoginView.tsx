import React, { useState } from 'react';
import { Printer, ArrowRight, Lock, Mail } from 'lucide-react';
import type { User } from '../types';
import { ROLE_LABEL } from '../lib/format';
import { apiFetch } from '../lib/api';

interface LoginViewProps {
  accounts: User[];
  demoSwitchEnabled?: boolean;
  onAuthenticated: (user: User, token: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  accounts,
  demoSwitchEnabled = true,
  onAuthenticated,
}) => {
  const [email, setEmail] = useState('admin@reffoprint.id');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSwitch = async (userId: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/switch', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke akun divisi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left panel: Brand & Division Quick Access */}
        <div className="lg:col-span-7 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-white">
                  Reffo PrintFlow
                </h1>
                <p className="text-xs text-slate-400">Sistem Monitoring Cetak & ERP Percetakan</p>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white leading-tight">
                Kendalikan alur produksi percetakan dari nota hingga serah terima.
              </h2>
              <p className="mt-3 text-sm text-slate-300 leading-relaxed max-w-xl">
                Dirancang khusus untuk operasional workshop digital printing dan advertising.
                Terhubung langsung antara Kasir Admin, Desainer, Operator Cetak, Finishing,
                Tim Lapangan, dan Owner.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800">
            {demoSwitchEnabled ? (
              <>
                <p className="text-xs font-medium text-slate-400 mb-3">
                  Masuk cepat menggunakan akun divisi (kata sandi standar: <span className="font-mono text-slate-200">password123</span>)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {accounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickSwitch(acc.id)}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/60 px-3.5 py-2.5 text-left transition-colors hover:border-blue-500/60 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-500 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{acc.name}</p>
                        <p className="text-xs text-slate-400 truncate">{ROLE_LABEL[acc.role]}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-blue-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400 leading-relaxed">
                Mode produksi aktif. Login cepat divisi dinonaktifkan — gunakan email dan kata sandi
                resmi yang diberikan Owner.
              </p>
            )}
          </div>
        </div>

        {/* Right panel: Standard Login Form */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-8 flex flex-col justify-center">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">Masuk ke Akun Staf</h2>
            <p className="mt-1 text-sm text-slate-500">
              Gunakan kredensial divisi Anda untuk mengakses ruang kerja.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email Staf
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  placeholder="nama@reffoprint.id"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
            >
              {loading ? 'Memeriksa akses...' : 'Masuk ke Sistem'}
            </button>
          </form>

          <p className="mt-6 text-xs text-slate-500 leading-relaxed">
            Setiap peran memiliki pembatasan akses data (termasuk isolasi nominal tagihan untuk Divisi Advertising).
          </p>
        </div>
      </div>
    </div>
  );
};

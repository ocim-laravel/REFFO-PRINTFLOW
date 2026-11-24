import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck, UserX, KeyRound } from 'lucide-react';
import type { AuditLog, User, UserRole } from '../../types';
import { ROLE_LABEL, formatTanggal } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface OwnerStaffViewProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const ROLE_OPTIONS: UserRole[] = ['admin', 'desainer', 'operator_cetak', 'finishing', 'advertising', 'owner'];

export const OwnerStaffView: React.FC<OwnerStaffViewProps> = ({ onNotify }) => {
  const [staff, setStaff] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'staff' | 'audit'>('staff');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' as UserRole });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffRes, logRes] = await Promise.all([
        apiFetch<{ staff: User[] }>('/api/owner/staff'),
        apiFetch<{ logs: AuditLog[]; total: number }>('/api/owner/audit-logs?limit=300'),
      ]);
      setStaff(staffRes.staff);
      setLogs(logRes.logs);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat data staf.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/owner/staff', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ name: '', email: '', password: '', role: 'admin' });
      await load();
      onNotify('success', 'Akun staf baru berhasil dibuat.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membuat akun staf.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (user: User) => {
    if (!window.confirm(`${user.active === false ? 'Aktifkan' : 'Nonaktifkan'} akun ${user.name}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/owner/staff/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: user.active === false }),
      });
      await load();
      onNotify('success', `Status akun ${user.name} diperbarui.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memperbarui akun staf.');
    } finally {
      setBusy(false);
    }
  };

  const handleRole = async (user: User, role: UserRole) => {
    setBusy(true);
    try {
      await apiFetch(`/api/owner/staff/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      await load();
      onNotify('success', `Peran ${user.name} diubah menjadi ${ROLE_LABEL[role]}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengubah peran.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (user: User) => {
    const password = window.prompt(`Kata sandi baru untuk ${user.name} (min. 6 karakter):`);
    if (!password) return;
    setBusy(true);
    try {
      await apiFetch(`/api/owner/staff/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      await load();
      onNotify('success', `Kata sandi ${user.name} berhasil direset.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mereset kata sandi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Manajemen Staf & Audit Log</h2>
          <p className="text-sm text-slate-500">
            Kelola akun staf, reset kata sandi, dan telusuri aktivitas sensitif sistem.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setTab('staff')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${tab === 'staff' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              Staf ({staff.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${tab === 'audit' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              Audit Log ({logs.length})
            </button>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
        </div>
      </div>

      {tab === 'staff' ? (
        <>
          <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-700" />
              <h3 className="font-semibold text-slate-900 text-sm">Tambah Akun Staf</h3>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="text-xs font-medium text-slate-600">
                Nama
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Email
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Kata Sandi
                <input
                  required
                  type="password"
                  minLength={6}
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Peran
                <select
                  value={form.role}
                  onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="self-end rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
              >
                {busy ? 'Menyimpan...' : 'Tambah Staf'}
              </button>
            </div>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Nama</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Peran</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staff.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={busy}
                          onChange={(e) => handleRole(u, e.target.value as UserRole)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.active === false ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {u.active === false ? 'Nonaktif' : 'Aktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleResetPassword(u)}
                            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
                            title="Reset kata sandi"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggle(u)}
                            className={`rounded-md border p-1.5 cursor-pointer ${u.active === false ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}
                            title={u.active === false ? 'Aktifkan' : 'Nonaktifkan'}
                          >
                            {u.active === false ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">Waktu</th>
                  <th className="px-4 py-3 text-left">Staf</th>
                  <th className="px-4 py-3 text-left">Aksi</th>
                  <th className="px-4 py-3 text-left">Entitas</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatTanggal(log.created_at)}</td>
                    <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{log.user_name}<span className="block text-[11px] text-slate-400">{log.role}</span></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-700 whitespace-nowrap">{log.action}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">{log.entity}{log.entity_id ? ` #${log.entity_id}` : ''}</td>
                    <td className="px-4 py-2.5 text-slate-600">{log.detail}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">Belum ada audit log.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

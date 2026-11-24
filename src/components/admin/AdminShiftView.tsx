import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, LockKeyhole, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Shift } from '../../types';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface AdminShiftViewProps {
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const AdminShiftView: React.FC<AdminShiftViewProps> = ({ onRefresh, onNotify }) => {
  const [current, setCurrent] = useState<Shift | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState('0');
  const [actual, setActual] = useState({ tunai: '', transfer: '', qris: '' });
  const [catatan, setCatatan] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cur, list] = await Promise.all([
        apiFetch<{ shift: Shift | null }>('/api/shifts/current'),
        apiFetch<{ shifts: Shift[] }>('/api/shifts'),
      ]);
      setCurrent(cur.shift);
      setShifts(list.shifts);
      if (cur.shift) {
        setActual({
          tunai: String(cur.shift.expected_tunai),
          transfer: String(cur.shift.expected_transfer),
          qris: String(cur.shift.expected_qris),
        });
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat data shift.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const expectedTotal = useMemo(() => {
    if (!current) return 0;
    return current.expected_tunai + current.expected_transfer + current.expected_qris;
  }, [current]);

  const actualTotal = useMemo(
    () =>
      (Number(actual.tunai) || 0) + (Number(actual.transfer) || 0) + (Number(actual.qris) || 0),
    [actual],
  );

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ opening_cash: Number(openingCash) || 0 }),
      });
      await load();
      await onRefresh();
      onNotify('success', 'Shift kasir dibuka. Selamat bekerja!');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membuka shift.');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ shift: Shift }>(`/api/shifts/${current.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          actual_tunai: Number(actual.tunai) || 0,
          actual_transfer: Number(actual.transfer) || 0,
          actual_qris: Number(actual.qris) || 0,
          catatan,
        }),
      });
      await load();
      await onRefresh();
      const selisih = res.shift.selisih;
      onNotify(
        Math.abs(selisih) < 1 ? 'success' : 'error',
        Math.abs(selisih) < 1
          ? 'Shift ditutup. Kas fisik sesuai dengan sistem.'
          : `Shift ditutup dengan selisih ${formatRupiah(selisih)}. Periksa catatan kas.`,
      );
      setCatatan('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menutup shift.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Shift & Tutup Kasir Harian</h2>
          <p className="text-sm text-slate-500">
            Rekonsiliasi kas tunai, transfer, dan QRIS sebelum serah terima shift.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      {current ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-emerald-700">
              <Wallet className="h-5 w-5" />
              <h3 className="font-semibold text-slate-900">Shift Sedang Terbuka</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Dibuka {formatTanggal(current.opened_at)} · Kas awal {formatRupiah(current.opening_cash)}
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Ekspektasi Tunai</p>
                <p className="font-mono text-sm font-semibold text-slate-900">{formatRupiah(current.expected_tunai)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Ekspektasi Transfer</p>
                <p className="font-mono text-sm font-semibold text-slate-900">{formatRupiah(current.expected_transfer)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Ekspektasi QRIS</p>
                <p className="font-mono text-sm font-semibold text-slate-900">{formatRupiah(current.expected_qris)}</p>
              </div>
            </div>

            <form onSubmit={handleClose} className="mt-5 space-y-4">
              <h4 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
                Hitung Fisik Kas Saat Tutup Shift
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs font-medium text-slate-700">
                  Tunai
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={actual.tunai}
                    onChange={(e) => setActual((p) => ({ ...p, tunai: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Transfer
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={actual.transfer}
                    onChange={(e) => setActual((p) => ({ ...p, transfer: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  QRIS
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={actual.qris}
                    onChange={(e) => setActual((p) => ({ ...p, qris: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-slate-700">
                Catatan selisih / serah terima kas
                <textarea
                  rows={2}
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Contoh: selisih Rp 5.000 untuk kembalian, disetorkan ke Owner."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-600">
                  Ekspektasi sistem <span className="font-mono font-semibold">{formatRupiah(expectedTotal)}</span>
                  {' · '}Hitung fisik <span className="font-mono font-semibold">{formatRupiah(actualTotal)}</span>
                </div>
                <div
                  className={`text-sm font-semibold font-mono ${
                    Math.abs(actualTotal - expectedTotal) < 1 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  Selisih {formatRupiah(actualTotal - expectedTotal)}
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              >
                <LockKeyhole className="h-4 w-4" />
                {busy ? 'Menutup shift...' : 'Tutup Shift & Rekonsiliasi'}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Pengingat
            </div>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed list-disc pl-4">
              <li>Pastikan semua pembayaran nota hari ini sudah diinput sebelum menutup shift.</li>
              <li>Pembayaran yang tercatat tanpa shift terbuka tidak masuk rekonsiliasi shift.</li>
              <li>Selisih kas akan tercatat pada audit log dan riwayat shift Owner.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-xl">
          <div className="flex items-center gap-2 text-blue-700">
            <Wallet className="h-5 w-5" />
            <h3 className="font-semibold text-slate-900">Buka Shift Baru</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Masukkan saldo kas awal (uang kembalian) di laci kasir. Shift harus terbuka agar pembayaran
            masuk ke rekonsiliasi harian.
          </p>
          <form onSubmit={handleOpen} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-700">
              Kas Awal (Rp)
              <input
                type="number"
                min="0"
                step="1000"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="mt-1 block w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
            >
              {busy ? 'Membuka...' : 'Buka Shift'}
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">Riwayat Shift</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Dibuka</th>
                <th className="px-4 py-3 text-left">Ditutup</th>
                <th className="px-4 py-3 text-right">Kas Awal</th>
                <th className="px-4 py-3 text-right">Ekspektasi</th>
                <th className="px-4 py-3 text-right">Aktual</th>
                <th className="px-4 py-3 text-right">Selisih</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map((s) => {
                const exp = s.expected_tunai + s.expected_transfer + s.expected_qris;
                const act = s.actual_tunai + s.actual_transfer + s.actual_qris;
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{formatTanggal(s.opened_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{s.closed_at ? formatTanggal(s.closed_at) : '-'}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatRupiah(s.opening_cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatRupiah(exp)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatRupiah(act)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${Math.abs(s.selisih) < 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {formatRupiah(s.selisih)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === 'buka' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                        {s.status === 'buka' ? 'Buka' : 'Tutup'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Belum ada riwayat shift.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

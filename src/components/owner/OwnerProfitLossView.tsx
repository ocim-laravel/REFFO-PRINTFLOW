import React, { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ExpenseCategory, OperationalExpense } from '../../types';
import { formatDesimal, formatRupiah, formatTanggalSingkat } from '../../lib/format';
import { apiFetch } from '../../lib/api';

export interface ProfitLossData {
  omzet: {
    tagihan: number;
    cash_masuk: number;
    jumlah_nota: number;
  };
  komponen_hpp: {
    netto: { luas: number; biaya: number };
    finishing: { luas: number; biaya: number };
    potong: { luas: number; biaya: number };
    gagal: { luas: number; biaya: number };
  };
  hpp_bahan: number;
  hpp_satuan: number;
  hpp_produksi: number;
  total_operasional: number;
  laba_bersih: number;
  expenses: OperationalExpense[];
}

interface OwnerProfitLossViewProps {
  data: ProfitLossData | null;
  dari: string;
  sampai: string;
  onChangeFilter: (dari: string, sampai: string) => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
  loading: boolean;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Gaji',
  'Listrik & Air',
  'Tinta',
  'Perawatan Mesin',
  'Lain-lain',
];

export const OwnerProfitLossView: React.FC<OwnerProfitLossViewProps> = ({
  data,
  dari,
  sampai,
  onChangeFilter,
  onRefresh,
  onNotify,
  loading,
}) => {
  const [tanggal, setTanggal] = useState(new Date().toISOString().slice(0, 10));
  const [kategori, setKategori] = useState<ExpenseCategory>('Tinta');
  const [keterangan, setKeterangan] = useState('');
  const [nominal, setNominal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/owner/expenses', {
        method: 'POST',
        body: JSON.stringify({
          tanggal,
          kategori_biaya: kategori,
          keterangan: keterangan.trim(),
          nominal: Number(nominal),
        }),
      });
      setKeterangan('');
      setNominal('');
      await onRefresh();
      onNotify('success', 'Pengeluaran operasional berhasil dicatat.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan pengeluaran.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id: number) => {
    try {
      await apiFetch(`/api/owner/expenses/${id}`, { method: 'DELETE' });
      await onRefresh();
      onNotify('success', 'Data pengeluaran dihapus.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menghapus pengeluaran.');
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period & Top Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Laporan Laba Rugi Workshop
            </h2>
            <p className="text-xs text-slate-500">
              Laba Bersih = Omzet Tagihan &minus; HPP Produksi (termasuk waste &amp; gagal cetak) &minus; Biaya Operasional.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="date"
              value={dari}
              onChange={(e) => onChangeFilter(e.target.value, sampai)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
            <span className="text-slate-400">s/d</span>
            <input
              type="date"
              value={sampai}
              onChange={(e) => onChangeFilter(dari, e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
            {(dari || sampai) && (
              <button
                type="button"
                onClick={() => onChangeFilter('', '')}
                className="text-blue-700 font-medium underline cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Omzet Tagihan ({data.omzet.jumlah_nota} nota)</p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900">
              {formatRupiah(data.omzet.tagihan)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Cash Masuk: {formatRupiah(data.omzet.cash_masuk)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">HPP Produksi Total</p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900">
              {formatRupiah(data.hpp_produksi)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Bahan: {formatRupiah(data.hpp_bahan)} · Satuan: {formatRupiah(data.hpp_satuan)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Biaya Operasional</p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900">
              {formatRupiah(data.total_operasional)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">{data.expenses.length} transaksi</p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              data.laba_bersih >= 0
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-rose-200 bg-rose-50'
            }`}
          >
            <p
              className={`text-xs font-medium ${
                data.laba_bersih >= 0 ? 'text-emerald-800' : 'text-rose-800'
              }`}
            >
              Laba Bersih Estimasi
            </p>
            <p
              className={`mt-1 font-mono tabular-nums text-xl font-bold ${
                data.laba_bersih >= 0 ? 'text-emerald-900' : 'text-rose-900'
              }`}
            >
              {formatRupiah(data.laba_bersih)}
            </p>
          </div>
        </div>
      </div>

      {/* HPP Breakdown & Expense Input */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Rincian HPP Bahan Meteran (Harga Modal)
            </h3>
          </div>
          <div className="divide-y divide-slate-100 text-sm">
            {[
              { label: 'Luas Netto Tercetak', item: data.komponen_hpp.netto },
              { label: 'Ekstra Finishing (Wos)', item: data.komponen_hpp.finishing },
              { label: 'Sisa Potong (Wos)', item: data.komponen_hpp.potong },
              { label: 'Gagal Cetak (Kerugian)', item: data.komponen_hpp.gagal, danger: true },
            ].map((row) => (
              <div key={row.label} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className={`font-medium ${row.danger ? 'text-rose-700' : 'text-slate-900'}`}>
                    {row.label}
                  </p>
                  <p className="text-xs font-mono text-slate-500">{formatDesimal(row.item.luas)} m²</p>
                </div>
                <span
                  className={`font-mono tabular-nums font-semibold ${
                    row.danger ? 'text-rose-700' : 'text-slate-900'
                  }`}
                >
                  {formatRupiah(row.item.biaya)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Catat Pengeluaran Operasional Baru
          </h3>
          <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
              <input
                type="date"
                required
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
              <select
                value={kategori}
                onChange={(e) => setKategori(e.target.value as ExpenseCategory)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
              <input
                type="text"
                required
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Pembelian tinta / listrik..."
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (Rp)</label>
              <input
                type="number"
                min={1}
                required
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div className="sm:col-span-12 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Pengeluaran
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Riwayat Biaya Operasional ({data.expenses.length})
          </h3>
        </div>
        <table className="w-full text-sm responsive-table">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Tanggal</th>
              <th className="text-left px-4 py-3">Kategori</th>
              <th className="text-left px-4 py-3">Keterangan</th>
              <th className="text-right px-4 py-3">Nominal</th>
              <th className="text-right px-4 py-3">Hapus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.expenses.map((exp) => (
              <tr key={exp.id}>
                <td data-label="Tanggal" className="px-4 py-3 text-slate-600">
                  {formatTanggalSingkat(exp.tanggal)}
                </td>
                <td data-label="Kategori" className="px-4 py-3 font-medium text-slate-900">
                  {exp.kategori_biaya}
                </td>
                <td data-label="Keterangan" className="px-4 py-3 text-slate-700">
                  {exp.keterangan}
                </td>
                <td
                  data-label="Nominal"
                  className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900"
                >
                  {formatRupiah(exp.nominal)}
                </td>
                <td data-label="Hapus" className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleDeleteExpense(exp.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                    aria-label="Hapus pengeluaran"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { formatDesimal, formatRupiah } from '../../lib/format';
import { apiFetch, downloadAuthorized } from '../../lib/api';

interface ProfitProdukRow {
  product_id: number;
  nama_produk: string;
  kategori_produk: string;
  jumlah_item: number;
  qty: number;
  omzet: number;
  hpp: number;
  laba_kotor: number;
  margin_persen: number;
}

interface ProfitKlienRow {
  instansi_id: number;
  instansi: string;
  jumlah_nota: number;
  jumlah_item: number;
  omzet: number;
  hpp: number;
  laba_kotor: number;
  margin_persen: number;
  total_tagihan: number;
  piutang: number;
}

interface ProfitabilitasResponse {
  dari: string | null;
  sampai: string | null;
  ringkasan: {
    jumlah_nota: number;
    jumlah_item: number;
    omzet: number;
    hpp: number;
    laba_kotor: number;
    margin_persen: number;
  };
  per_produk: ProfitProdukRow[];
  per_klien: ProfitKlienRow[];
}

interface OwnerProfitabilitasViewProps {
  dari: string;
  sampai: string;
  onChangeFilter: (dari: string, sampai: string) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const OwnerProfitabilitasView: React.FC<OwnerProfitabilitasViewProps> = ({
  dari,
  sampai,
  onChangeFilter,
  onNotify,
}) => {
  const [data, setData] = useState<ProfitabilitasResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dari) qs.set('dari', dari);
      if (sampai) qs.set('sampai', sampai);
      const res = await apiFetch<ProfitabilitasResponse>(
        `/api/owner/reports/profitabilitas?${qs.toString()}`,
      );
      setData(res);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat analisis profitabilitas.');
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const unduh = async (type: 'profit_produk' | 'profit_pelanggan') => {
    const qs = new URLSearchParams({ type });
    if (dari) qs.set('dari', dari);
    if (sampai) qs.set('sampai', sampai);
    try {
      await downloadAuthorized(`/api/owner/reports/export?${qs.toString()}`, `reffo-${type}.csv`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengekspor laporan.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Analisis Profitabilitas</h2>
          <p className="text-sm text-slate-500">
            Laba kotor dihitung dari omzet item dikurangi HPP produk/master. Bisa dilihat per produk maupun per instansi.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-600">
            Dari
            <input
              type="date"
              value={dari}
              onChange={(e) => onChangeFilter(e.target.value, sampai)}
              className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Sampai
            <input
              type="date"
              value={sampai}
              onChange={(e) => onChangeFilter(dari, e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
            />
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        {[
          { label: 'Nota Aktif', value: formatDesimal(data?.ringkasan.jumlah_nota ?? 0, 0) },
          { label: 'Item Dijual', value: formatDesimal(data?.ringkasan.jumlah_item ?? 0, 0) },
          { label: 'Omzet Item', value: formatRupiah(data?.ringkasan.omzet ?? 0) },
          { label: 'HPP', value: formatRupiah(data?.ringkasan.hpp ?? 0) },
          { label: 'Laba Kotor', value: formatRupiah(data?.ringkasan.laba_kotor ?? 0) },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{card.label}</p>
            <p className="mt-1 font-display text-lg font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-700" />
            <h3 className="font-display text-sm font-semibold text-slate-900">Profit per Produk</h3>
          </div>
          <button
            type="button"
            onClick={() => unduh('profit_produk')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3 w-3" />
            Ekspor CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Produk</th>
                <th className="px-3 py-3 text-left">Kategori</th>
                <th className="px-3 py-3 text-right">Item</th>
                <th className="px-3 py-3 text-right">Qty</th>
                <th className="px-3 py-3 text-right">Omzet</th>
                <th className="px-3 py-3 text-right">HPP</th>
                <th className="px-3 py-3 text-right">Laba Kotor</th>
                <th className="px-4 py-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.per_produk ?? []).map((row) => (
                <tr key={row.product_id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.nama_produk}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.kategori_produk}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.jumlah_item}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatDesimal(row.qty)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.omzet)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.hpp)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-blue-700">{formatRupiah(row.laba_kotor)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatDesimal(row.margin_persen)}%</td>
                </tr>
              ))}
              {(data?.per_produk.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">
                    Belum ada item terjual pada periode ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-700" />
            <h3 className="font-display text-sm font-semibold text-slate-900">Profit per Instansi / Klien</h3>
          </div>
          <button
            type="button"
            onClick={() => unduh('profit_pelanggan')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3 w-3" />
            Ekspor CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Instansi</th>
                <th className="px-3 py-3 text-right">Nota</th>
                <th className="px-3 py-3 text-right">Item</th>
                <th className="px-3 py-3 text-right">Omzet</th>
                <th className="px-3 py-3 text-right">HPP</th>
                <th className="px-3 py-3 text-right">Laba Kotor</th>
                <th className="px-3 py-3 text-right">Margin</th>
                <th className="px-4 py-3 text-right">Piutang</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.per_klien ?? []).map((row) => (
                <tr key={row.instansi_id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.instansi}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.jumlah_nota}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.jumlah_item}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.omzet)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.hpp)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-blue-700">{formatRupiah(row.laba_kotor)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatDesimal(row.margin_persen)}%</td>
                  <td className="px-4 py-2.5 text-right font-mono text-rose-700">{formatRupiah(row.piutang)}</td>
                </tr>
              ))}
              {(data?.per_klien.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">
                    Belum ada nota aktif pada periode ini.
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

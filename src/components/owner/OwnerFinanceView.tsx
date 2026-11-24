import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { formatRupiah, formatTanggalSingkat } from '../../lib/format';
import { apiFetch, getApiToken } from '../../lib/api';

export interface FinanceData {
  dari: string | null;
  sampai: string | null;
  ringkasan: {
    omzet: number;
    jumlah_nota: number;
    cash_masuk: number;
    piutang: number;
    hpp: number;
    laba_kotor: number;
    total_operasional: number;
    laba_bersih: number;
    komisi_persen: number;
  };
  cashflow: {
    tunai: number;
    transfer: number;
    qris: number;
    total: number;
    jumlah_transaksi: number;
  };
  cashflow_harian: Array<{
    tanggal: string;
    tunai: number;
    transfer: number;
    qris: number;
    total: number;
  }>;
  aging: {
    lancar: number;
    '1-30': number;
    '31-60': number;
    '61-90': number;
    '>90': number;
    total: number;
  };
  piutang: Array<{
    order_id: number;
    no_nota: string;
    instansi: string;
    nama_pelanggan: string;
    total_tagihan: number;
    dibayar: number;
    sisa_tagihan: number;
    jatuh_tempo: string | null;
    umur_hari: number;
    bucket: string;
  }>;
  hutang: {
    total: number;
    items: Array<{
      purchase_order_id: number;
      no_po: string;
      supplier: string;
      total: number;
      dibayar: number;
      sisa: number;
      jatuh_tempo: string | null;
      umur_hari: number;
    }>;
    catatan: string;
  };
  margins: Array<{
    product_id: number;
    product_name: string;
    qty: number;
    omzet: number;
    hpp: number;
    margin: number;
    margin_persen: number;
  }>;
  komisi: Array<{
    user_id: number;
    user_name: string;
    role: string;
    jumlah_nota: number;
    omzet: number;
    komisi: number;
  }>;
}

interface OwnerFinanceViewProps {
  dari: string;
  sampai: string;
  onChangeFilter: (dari: string, sampai: string) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const AGING_LABEL: Record<string, string> = {
  lancar: 'Belum jatuh tempo',
  '1-30': '1–30 hari',
  '31-60': '31–60 hari',
  '61-90': '61–90 hari',
  '>90': '> 90 hari',
};

export const OwnerFinanceView: React.FC<OwnerFinanceViewProps> = ({
  dari,
  sampai,
  onChangeFilter,
  onNotify,
}) => {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dari) qs.set('dari', dari);
      if (sampai) qs.set('sampai', sampai);
      const res = await apiFetch<FinanceData>(`/api/owner/reports/finance?${qs.toString()}`);
      setData(res);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat laporan keuangan.');
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = (
    type: 'orders' | 'payments' | 'piutang' | 'hutang' | 'po' | 'supplier' | 'audit' | 'production' | 'stock',
  ) => {
    const qs = new URLSearchParams({ type });
    if (dari) qs.set('dari', dari);
    if (sampai) qs.set('sampai', sampai);
    const token = getApiToken();
    if (token) qs.set('token', token);
    window.open(`/api/owner/reports/export?${qs.toString()}`, '_blank', 'noopener');
  };

  const summaryCards = data
    ? [
        { label: 'Omzet Nota', value: data.ringkasan.omzet, note: `${data.ringkasan.jumlah_nota} nota aktif` },
        { label: 'Kas Masuk', value: data.ringkasan.cash_masuk, note: `${data.cashflow.jumlah_transaksi} transaksi` },
        { label: 'Piutang Berjalan', value: data.ringkasan.piutang, note: 'AR aktif' },
        { label: 'Hutang Dagang', value: data.hutang.total, note: 'PO diterima belum lunas' },
        { label: 'Laba Kotor', value: data.ringkasan.laba_kotor, note: 'Omzet − HPP' },
        { label: 'Laba Bersih', value: data.ringkasan.laba_bersih, note: 'Setelah operasional' },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Cashflow, Piutang & Margin</h2>
          <p className="text-sm text-slate-500">
            Laporan real-time per metode bayar, aging piutang, margin produk, dan komisi tim.
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Muat
          </button>
          <button
            type="button"
            onClick={() => handleExport('orders')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export Nota CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('payments')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Pembayaran
          </button>
          <button
            type="button"
            onClick={() => handleExport('piutang')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Piutang
          </button>
          <button
            type="button"
            onClick={() => handleExport('hutang')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Hutang
          </button>
          <button
            type="button"
            onClick={() => handleExport('production')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Produksi
          </button>
          <button
            type="button"
            onClick={() => handleExport('stock')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Stok
          </button>
          <button
            type="button"
            onClick={() => handleExport('audit')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Audit
          </button>
        </div>
      </div>

      {!data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          {loading ? 'Memuat laporan keuangan...' : 'Belum ada data.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{formatRupiah(card.value)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-blue-700" />
                <h3 className="font-semibold text-slate-900 text-sm">Cashflow per Metode Bayar</h3>
              </div>
              <div className="mt-4 space-y-2.5">
                {[
                  ['Tunai', data.cashflow.tunai],
                  ['Transfer', data.cashflow.transfer],
                  ['QRIS', data.cashflow.qris],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-mono font-semibold text-slate-900">{formatRupiah(Number(value))}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-sm font-semibold">
                  <span>Total Kas Masuk</span>
                  <span className="font-mono">{formatRupiah(data.cashflow.total)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <h3 className="font-semibold text-slate-900 text-sm">Aging Piutang</h3>
              </div>
              <div className="mt-4 space-y-2">
                {Object.keys(AGING_LABEL).map((key) => {
                  const value = data.aging[key as keyof typeof data.aging];
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{AGING_LABEL[key]}</span>
                      <span className="font-mono font-semibold text-slate-900">{formatRupiah(value)}</span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-sm font-semibold">
                  <span>Total Piutang</span>
                  <span className="font-mono">{formatRupiah(data.aging.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Hutang Dagang (Purchase Order)</h3>
                <p className="mt-0.5 text-xs text-slate-500">{data.hutang.catatan}</p>
              </div>
              <span className="font-mono text-sm font-semibold text-rose-700">{formatRupiah(data.hutang.total)}</span>
            </div>
            <div className="overflow-x-auto max-h-72">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left">No PO</th>
                    <th className="px-4 py-2.5 text-left">Supplier</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Dibayar</th>
                    <th className="px-4 py-2.5 text-right">Sisa</th>
                    <th className="px-4 py-2.5 text-left">Jatuh Tempo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.hutang.items.map((h) => (
                    <tr key={h.purchase_order_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{h.no_po}</td>
                      <td className="px-4 py-2.5 text-slate-700">{h.supplier}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(h.total)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(h.dibayar)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-rose-700">{formatRupiah(h.sisa)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{h.jatuh_tempo ? formatTanggalSingkat(h.jatuh_tempo) : '-'}</td>
                    </tr>
                  ))}
                  {data.hutang.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Tidak ada hutang dagang yang belum lunas.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 text-sm">Margin per Produk</h3>
                <TrendingUp className="h-4 w-4 text-emerald-700" />
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Produk</th>
                      <th className="px-4 py-2.5 text-right">Omzet</th>
                      <th className="px-4 py-2.5 text-right">Margin</th>
                      <th className="px-4 py-2.5 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.margins.map((m) => (
                      <tr key={m.product_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-700">{m.product_name}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(m.omzet)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${m.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatRupiah(m.margin)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{m.margin_persen.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {data.margins.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">Belum ada penjualan pada periode ini.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 text-sm">
                  Komisi Tim ({data.ringkasan.komisi_persen}% omzet)
                </h3>
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Staf</th>
                      <th className="px-4 py-2.5 text-right">Nota</th>
                      <th className="px-4 py-2.5 text-right">Omzet</th>
                      <th className="px-4 py-2.5 text-right">Komisi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.komisi.map((k) => (
                      <tr key={k.user_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-700">
                          {k.user_name}
                          <span className="ml-1.5 text-[11px] text-slate-400">{k.role}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{k.jumlah_nota}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(k.omzet)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700">{formatRupiah(k.komisi)}</td>
                      </tr>
                    ))}
                    {data.komisi.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">Belum ada komisi pada periode ini.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm">Daftar Piutang Aktif</h3>
              <span className="text-xs text-slate-500">{data.piutang.length} nota</span>
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left">No Nota</th>
                    <th className="px-4 py-2.5 text-left">Pelanggan</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Sisa</th>
                    <th className="px-4 py-2.5 text-left">Jatuh Tempo</th>
                    <th className="px-4 py-2.5 text-right">Umur</th>
                    <th className="px-4 py-2.5 text-left">Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.piutang.map((p) => (
                    <tr key={p.order_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{p.no_nota}</td>
                      <td className="px-4 py-2.5 text-slate-700">{p.instansi}<span className="block text-xs text-slate-400">{p.nama_pelanggan}</span></td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(p.total_tagihan)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-rose-700">{formatRupiah(p.sisa_tagihan)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{p.jatuh_tempo ? formatTanggalSingkat(p.jatuh_tempo) : '-'}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{p.umur_hari > 0 ? `${p.umur_hari} hr` : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{AGING_LABEL[p.bucket] ?? p.bucket}</td>
                    </tr>
                  ))}
                  {data.piutang.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Tidak ada piutang aktif. 🎉</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

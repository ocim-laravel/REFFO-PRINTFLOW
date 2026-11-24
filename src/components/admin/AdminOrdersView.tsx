import React, { useMemo, useState } from 'react';
import { Search, Eye, FileCheck2 } from 'lucide-react';
import type { Order } from '../../types';
import {
  KATEGORI_PELANGGAN_LABEL,
  STATUS_BAYAR_LABEL,
  STATUS_PRODUKSI_LABEL,
  formatRupiah,
  formatTanggalSingkat,
  statusBadgeStyle,
} from '../../lib/format';

interface AdminOrdersViewProps {
  orders: Order[];
  loading: boolean;
  readOnly?: boolean;
  onInspectOrder: (order: Order) => void;
  onGoToReview: () => void;
  onOpenCreate: () => void;
}

type OrderTab = 'semua' | 'produksi' | 'siap_diambil' | 'selesai';

function orderSummaryStatus(order: Order): { label: string; key: string } {
  if (order.items.length === 0) return { label: 'Kosong', key: 'menunggu_desain' };
  const unique = Array.from(new Set(order.items.map((i) => i.status_produksi)));
  if (unique.length === 1) {
    return { label: STATUS_PRODUKSI_LABEL[unique[0]], key: unique[0] };
  }
  return { label: `Beragam (${unique.length} tahap)`, key: unique[0] };
}

function isSiapDiambil(order: Order): boolean {
  if (order.items.length === 0 || order.waktu_serah_terima !== null) return false;
  return (
    order.items.some((i) => i.status_produksi === 'siap_diambil') &&
    order.items.every((i) => i.status_produksi === 'siap_diambil' || i.status_produksi === 'selesai')
  );
}

function isSelesai(order: Order): boolean {
  return order.items.length > 0 && order.items.every((i) => i.status_produksi === 'selesai');
}

export const AdminOrdersView: React.FC<AdminOrdersViewProps> = ({
  orders,
  loading,
  readOnly = false,
  onInspectOrder,
  onGoToReview,
  onOpenCreate,
}) => {
  const [tab, setTab] = useState<OrderTab>('semua');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const siap = orders.filter(isSiapDiambil).length;
    const selesai = orders.filter(isSelesai).length;
    const produksi = orders.length - siap - selesai;
    const menungguAcc = orders.filter((o) =>
      o.items.some((i) => i.status_produksi === 'menunggu_acc' && !i.acc_admin_id),
    ).length;
    return { total: orders.length, produksi, siap, selesai, menungguAcc };
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (tab === 'siap_diambil' && !isSiapDiambil(o)) return false;
      if (tab === 'selesai' && !isSelesai(o)) return false;
      if (tab === 'produksi' && (isSiapDiambil(o) || isSelesai(o))) return false;
      if (!q) return true;
      return (
        o.no_nota.toLowerCase().includes(q) ||
        (o.customer?.instansi ?? '').toLowerCase().includes(q) ||
        (o.customer?.nama_pelanggan ?? '').toLowerCase().includes(q)
      );
    });
  }, [orders, tab, query]);

  return (
    <div className="space-y-5">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Total Nota Aktif</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {counts.total}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Dalam Alur Produksi</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {counts.produksi}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Menunggu ACC Desain</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="font-mono tabular-nums text-2xl font-bold text-amber-700">
              {counts.menungguAcc}
            </p>
            {counts.menungguAcc > 0 && (
              <button
                type="button"
                onClick={onGoToReview}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileCheck2 className="h-3.5 w-3.5" />
                Review
              </button>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Siap Diambil Pelanggan</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-emerald-700">
            {counts.siap}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { key: 'semua', label: `Semua (${counts.total})` },
                { key: 'produksi', label: `Produksi (${counts.produksi})` },
                { key: 'siap_diambil', label: `Siap Diambil (${counts.siap})` },
                { key: 'selesai', label: `Selesai (${counts.selesai})` },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === t.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari no. nota, instansi, pelanggan..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              Belum ada nota yang cocok dengan filter saat ini.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ubah kata kunci pencarian atau buat nota order baru untuk memulai produksi.
            </p>
            {!readOnly && (
              <button
                type="button"
                onClick={onOpenCreate}
                className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                + Buat Nota Baru
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm responsive-table">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3">No. Nota &amp; Tanggal</th>
                  <th className="text-left px-4 py-3">Pelanggan / Instansi</th>
                  <th className="text-right px-4 py-3">Total Tagihan</th>
                  <th className="text-right px-4 py-3">Sisa Bayar</th>
                  <th className="text-left px-4 py-3">Pembayaran</th>
                  <th className="text-left px-4 py-3">Progres Produksi</th>
                  <th className="text-right px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((order) => {
                  const summary = orderSummaryStatus(order);
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td data-label="No. Nota" className="px-4 py-3">
                        <p className="font-mono font-semibold text-slate-900">{order.no_nota}</p>
                        <p className="text-xs text-slate-500">
                          {formatTanggalSingkat(order.created_at)}
                          {order.deadline ? ` · DL ${formatTanggalSingkat(order.deadline)}` : ''}
                        </p>
                      </td>
                      <td data-label="Pelanggan" className="px-4 py-3">
                        <p className="font-medium text-slate-900">{order.customer?.nama_pelanggan ?? '-'}</p>
                        <p className="text-xs text-slate-500">
                          {order.customer?.instansi ?? 'Perorangan'} ·{' '}
                          {order.customer?.kategori
                            ? KATEGORI_PELANGGAN_LABEL[order.customer.kategori]
                            : 'Umum'}
                        </p>
                      </td>
                      <td
                        data-label="Total Tagihan"
                        className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900"
                      >
                        {formatRupiah(order.total_tagihan)}
                      </td>
                      <td
                        data-label="Sisa Bayar"
                        className="px-4 py-3 text-right font-mono tabular-nums text-slate-700"
                      >
                        {formatRupiah(order.sisa_tagihan)}
                      </td>
                      <td data-label="Status Bayar" className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusBadgeStyle(
                            order.status_bayar,
                          )}`}
                        >
                          {STATUS_BAYAR_LABEL[order.status_bayar]}
                        </span>
                      </td>
                      <td data-label="Progres" className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusBadgeStyle(
                            summary.key,
                          )}`}
                        >
                          {summary.label}
                        </span>
                        <p className="text-xs text-slate-500 mt-0.5">{order.items.length} item</p>
                      </td>
                      <td data-label="Aksi" className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onInspectOrder(order)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ringkasan
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

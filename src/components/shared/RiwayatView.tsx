import React, { useMemo, useState } from 'react';
import { Eye, Search } from 'lucide-react';
import type { Order, UserRole } from '../../types';
import { formatTanggalSingkat, formatRupiah, statusBadgeStyle, STATUS_BAYAR_LABEL } from '../../lib/format';

interface RiwayatViewProps {
  orders: Order[];
  role: UserRole;
  loading: boolean;
  onInspectOrder: (order: Order) => void;
}

export const RiwayatView: React.FC<RiwayatViewProps> = ({
  orders,
  role,
  loading,
  onInspectOrder,
}) => {
  const [query, setQuery] = useState('');
  const isAdvertising = role === 'advertising';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.no_nota.toLowerCase().includes(q) ||
        (o.customer?.instansi ?? '').toLowerCase().includes(q) ||
        (o.customer?.nama_pelanggan ?? '').toLowerCase().includes(q),
    );
  }, [orders, query]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          Arsip pekerjaan yang telah diselesaikan pada divisi Anda.
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari no. nota atau instansi..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-6 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-semibold text-slate-800">Belum ada riwayat selesai</p>
        </div>
      ) : (
        <table className="w-full text-sm responsive-table">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">No. Nota</th>
              <th className="text-left px-4 py-3">Pelanggan / Instansi</th>
              <th className="text-left px-4 py-3">Tanggal</th>
              {!isAdvertising && <th className="text-right px-4 py-3">Nilai Nota</th>}
              {!isAdvertising && <th className="text-left px-4 py-3">Pembayaran</th>}
              <th className="text-right px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((order) => (
              <tr key={order.id}>
                <td data-label="No. Nota" className="px-4 py-3 font-mono font-semibold text-slate-900">
                  {order.no_nota}
                </td>
                <td data-label="Pelanggan" className="px-4 py-3">
                  <p className="font-medium text-slate-900">{order.customer?.nama_pelanggan}</p>
                  <p className="text-xs text-slate-500">{order.customer?.instansi}</p>
                </td>
                <td data-label="Tanggal" className="px-4 py-3 text-slate-600">
                  {formatTanggalSingkat(order.updated_at)}
                </td>
                {!isAdvertising && (
                  <td
                    data-label="Nilai Nota"
                    className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900"
                  >
                    {formatRupiah(order.total_tagihan)}
                  </td>
                )}
                {!isAdvertising && (
                  <td data-label="Pembayaran" className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                        order.status_bayar,
                      )}`}
                    >
                      {STATUS_BAYAR_LABEL[order.status_bayar]}
                    </span>
                  </td>
                )}
                <td data-label="Detail" className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onInspectOrder(order)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Lihat
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

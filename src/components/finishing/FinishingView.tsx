import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { SupplyItem } from '../../types';
import type { OperatorQueueItem } from '../operator/OperatorView';
import {
  STATUS_PRODUKSI_LABEL,
  formatDimensiItem,
  formatTanggalSingkat,
  statusBadgeStyle,
} from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface FinishingViewProps {
  items: OperatorQueueItem[];
  supplies: SupplyItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const FinishingView: React.FC<FinishingViewProps> = ({
  items,
  supplies,
  loading,
  onRefresh,
  onNotify,
}) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [finishItem, setFinishItem] = useState<OperatorQueueItem | null>(null);
  const [usageDrafts, setUsageDrafts] = useState<Record<number, string>>({});

  const finishingSupplies = supplies.filter(
    (s) => s.aktif && s.kategori === 'bahan_pembantu',
  );
  const lowSupplies = finishingSupplies.filter((s) => s.stok <= s.stok_minimum);

  const openKonfirmasi = (item: OperatorQueueItem) => {
    setFinishItem(item);
    setUsageDrafts({});
  };

  const handleKonfirmasi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishItem) return;
    const bahan_pembantu = finishingSupplies
      .filter((s) => Number(usageDrafts[s.id] ?? 0) > 0)
      .map((s) => ({ supply_id: s.id, jumlah: Number(usageDrafts[s.id]) }));
    setBusyId(finishItem.id);
    try {
      await apiFetch(`/api/finishing/items/${finishItem.id}/konfirmasi`, {
        method: 'POST',
        body: JSON.stringify({ bahan_pembantu }),
      });
      setFinishItem(null);
      await onRefresh();
      onNotify('success', `Finishing selesai untuk nota ${finishItem.no_nota}. Barang kini Siap Diambil.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyelesaikan finishing.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">Antrean finishing kosong</p>
        <p className="mt-1 text-xs text-slate-500">
          Item yang memerlukan siming, keling, atau kolong akan muncul setelah selesai dicetak.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {lowSupplies.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            <strong>Stok bahan pembantu menipis:</strong>{' '}
            {lowSupplies.map((s) => `${s.nama} (${s.stok} ${s.satuan})`).join(', ')}
          </span>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm responsive-table">
        <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
          <tr>
            <th className="text-left px-4 py-3">Nota &amp; Pelanggan</th>
            <th className="text-left px-4 py-3">Item &amp; Ukuran</th>
            <th className="text-left px-4 py-3">Instruksi Finishing</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50/70">
              <td data-label="Nota" className="px-4 py-3">
                <p className="font-mono font-semibold text-slate-900">{item.no_nota}</p>
                <p className="text-xs text-slate-500">
                  {item.nama_pelanggan} · {item.instansi}
                </p>
                {item.deadline && (
                  <p className="text-xs text-amber-700 font-medium">
                    DL {formatTanggalSingkat(item.deadline)}
                  </p>
                )}
              </td>
              <td data-label="Item" className="px-4 py-3">
                <p className="font-medium text-slate-900">{item.nama_item || item.product_name}</p>
                <p className="text-xs font-mono tabular-nums text-slate-600">
                  {formatDimensiItem(item)} · Qty {item.qty}
                </p>
              </td>
              <td data-label="Finishing" className="px-4 py-3">
                <p className="font-semibold text-slate-900">{item.finishing_name || 'Potong Pas'}</p>
                {item.ekstra_finishing && (
                  <p className="text-xs font-mono text-slate-500">
                    Ekstra: Ki {item.ekstra_finishing.kiri_cm}cm · Ka {item.ekstra_finishing.kanan_cm}cm · At{' '}
                    {item.ekstra_finishing.atas_cm}cm · Bw {item.ekstra_finishing.bawah_cm}cm
                  </p>
                )}
              </td>
              <td data-label="Status" className="px-4 py-3">
                <span
                  className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                    item.status_produksi,
                  )}`}
                >
                  {STATUS_PRODUKSI_LABEL[item.status_produksi]}
                </span>
              </td>
              <td data-label="Aksi" className="px-4 py-3 text-right">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => openKonfirmasi(item)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Selesai Finishing
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {finishItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleKonfirmasi}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Konfirmasi Finishing — {finishItem.no_nota}
            </h3>
            <p className="text-xs text-slate-600">
              Item: <strong>{finishItem.nama_item || finishItem.product_name}</strong> ·{' '}
              {finishItem.finishing_name || 'Potong Pas'}
            </p>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                Pemakaian Bahan Pembantu (opsional)
              </p>
              {finishingSupplies.length === 0 && (
                <p className="text-xs text-slate-500">Belum ada bahan pembantu aktif.</p>
              )}
              {finishingSupplies.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-900">{s.nama}</p>
                    <p className="text-[11px] text-slate-500">
                      Stok {s.stok} {s.satuan} · Minimal {s.stok_minimum} {s.satuan}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={s.stok}
                      value={usageDrafts[s.id] ?? ''}
                      onChange={(e) =>
                        setUsageDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      placeholder="0"
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                    <span className="text-[11px] text-slate-500">{s.satuan}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFinishItem(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busyId !== null}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                Simpan &amp; Selesaikan Finishing
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

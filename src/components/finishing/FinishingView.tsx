import React, { useState } from 'react';
import { Camera, CheckCircle2, ClipboardCheck } from 'lucide-react';
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

type ModalState = {
  item: OperatorQueueItem;
  mode: 'qc' | 'selesai';
};

export const FinishingView: React.FC<FinishingViewProps> = ({
  items,
  loading,
  onRefresh,
  onNotify,
}) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [hasil, setHasil] = useState<'lolos' | 'cacat'>('lolos');
  const [catatan, setCatatan] = useState('');
  const [foto, setFoto] = useState<File | null>(null);

  const openModal = (item: OperatorQueueItem, mode: 'qc' | 'selesai') => {
    setModal({ item, mode });
    setHasil('lolos');
    setCatatan('');
    setFoto(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || !foto) return;
    const formData = new FormData();
    formData.append('foto', foto);
    formData.append('catatan', catatan);
    if (modal.mode === 'qc') formData.append('hasil', hasil);
    const endpoint =
      modal.mode === 'qc'
        ? `/api/finishing/items/${modal.item.id}/qc`
        : `/api/finishing/items/${modal.item.id}/konfirmasi`;
    setBusyId(modal.item.id);
    try {
      await apiFetch(endpoint, { method: 'POST', body: formData });
      const message =
        modal.mode === 'qc'
          ? hasil === 'lolos'
            ? `QC lolos. Item ${modal.item.no_nota} lanjut ke finishing.`
            : `QC cacat. Item ${modal.item.no_nota} kembali ke antrean cetak ulang.`
          : `Finishing selesai untuk nota ${modal.item.no_nota}. Barang kini Siap Diambil.`;
      setModal(null);
      await onRefresh();
      onNotify('success', message);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memproses finishing.');
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
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Finishing bertindak sebagai QC hasil cetak. Catat cacat dengan foto untuk cetak ulang, lalu
        unggah foto bukti saat pekerjaan selesai. Pemakaian bahan pembantu tidak memotong stok.
      </div>
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
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => openModal(item, 'qc')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      QC Cetak
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => openModal(item, 'selesai')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Selesaikan
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              {modal.mode === 'qc' ? 'QC Hasil Cetak' : 'Selesaikan Finishing'} — {modal.item.no_nota}
            </h3>
            <p className="text-xs text-slate-600">
              Item: <strong>{modal.item.nama_item || modal.item.product_name}</strong> ·{' '}
              {modal.item.finishing_name || 'Potong Pas'}
            </p>
            {modal.mode === 'qc' && (
              <div className="grid grid-cols-2 gap-2">
                {(['lolos', 'cacat'] as const).map((value) => (
                  <label
                    key={value}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                      hasil === value
                        ? value === 'cacat'
                          ? 'border-rose-300 bg-rose-50 text-rose-700'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="hasil-qc"
                      value={value}
                      checked={hasil === value}
                      onChange={() => setHasil(value)}
                      className="sr-only"
                    />
                    {value === 'lolos' ? 'Lolos, lanjut finishing' : 'Cacat, cetak ulang'}
                  </label>
                ))}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {modal.mode === 'qc' ? 'Catatan QC' : 'Catatan finishing (opsional)'}
              </label>
              <textarea
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                placeholder={modal.mode === 'qc' ? 'Wajib diisi bila cacat' : 'Catatan hasil pekerjaan'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Foto bukti <span className="text-rose-600">*</span>
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
                <Camera className="h-4 w-4 text-slate-400 shrink-0" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                  className="w-full text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busyId !== null || !foto}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                Kirim
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

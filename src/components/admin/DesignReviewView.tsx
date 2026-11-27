import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, Image as ImageIcon } from 'lucide-react';
import type { Order } from '../../types';
import { formatDimensiItem, formatTanggal, statusBadgeStyle, STATUS_PRODUKSI_LABEL } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface DesignReviewViewProps {
  orders: Order[];
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const DesignReviewView: React.FC<DesignReviewViewProps> = ({
  orders,
  onRefresh,
  onNotify,
}) => {
  const [revisingOrderId, setRevisingOrderId] = useState<number | null>(null);
  const [catatanRevisi, setCatatanRevisi] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const queue = orders.filter((o) =>
    o.items.some((i) => i.status_produksi === 'menunggu_acc' || i.status_produksi === 'revisi'),
  );

  const handleApprove = async (order: Order) => {
    setBusyId(order.id);
    try {
      await apiFetch(`/api/admin/design-reviews/${order.id}/approve`, { method: 'POST' });
      await onRefresh();
      onNotify(
        'success',
        `Preview desain nota ${order.no_nota} disetujui. Desainer kini dapat mengunggah TIFF dan Master Desain.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyetujui desain.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevise = async (e: React.FormEvent, order: Order) => {
    e.preventDefault();
    if (!catatanRevisi.trim()) return;
    setBusyId(order.id);
    try {
      await apiFetch(`/api/admin/design-reviews/${order.id}/revise`, {
        method: 'POST',
        body: JSON.stringify({ catatan_revisi: catatanRevisi.trim() }),
      });
      setRevisingOrderId(null);
      setCatatanRevisi('');
      await onRefresh();
      onNotify('success', `Permintaan revisi nota ${order.no_nota} dikirim ke desainer.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengajukan revisi.');
    } finally {
      setBusyId(null);
    }
  };

  if (queue.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">Tidak ada preview desain yang menunggu review</p>
        <p className="mt-1 text-xs text-slate-500">
          Saat desainer mengunggah file preview (JPG/PNG), nota akan muncul di sini untuk ACC Admin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {queue.map((order) => {
        const isWaitingAcc = order.items.some((i) => i.status_produksi === 'menunggu_acc' && !i.acc_admin_id);
        const alreadyApproved = order.items.some((i) => Boolean(i.acc_admin_id));
        const previewSrc = order.items.find((i) => i.file_preview_acc)?.file_preview_acc ?? null;

        return (
          <div
            key={order.id}
            className="bg-white rounded-xl border border-slate-200 overflow-hidden grid grid-cols-1 lg:grid-cols-12"
          >
            {/* Preview Image Column */}
            <div className="lg:col-span-5 bg-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 flex items-center justify-center p-4 min-h-56">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt={`Preview desain ${order.no_nota}`}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-72 object-contain rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <div className="text-center text-slate-400 space-y-2 py-8">
                  <ImageIcon className="h-10 w-10 mx-auto" />
                  <p className="text-xs">Belum ada gambar preview diunggah</p>
                </div>
              )}
            </div>

            {/* Metadata & Review Actions Column */}
            <div className="lg:col-span-7 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-mono text-base font-bold text-slate-900">{order.no_nota}</h3>
                    <p className="text-xs text-slate-500">
                      {order.customer?.nama_pelanggan} · {order.customer?.instansi} · Desainer:{' '}
                      {order.designer_name ?? '-'}
                    </p>
                  </div>
                  <span
                    className={`inline-block rounded-md border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeStyle(
                      order.items[0]?.status_produksi ?? 'menunggu_acc',
                    )}`}
                  >
                    {alreadyApproved
                      ? 'Sudah ACC Admin (Menunggu TIFF)'
                      : order.approval_status === 'disetujui'
                        ? 'Disetujui Pelanggan (Menunggu ACC Admin)'
                        : STATUS_PRODUKSI_LABEL[order.items[0]?.status_produksi ?? 'menunggu_acc']}
                  </span>
                </div>

                {order.catatan_desain && (
                  <p className="text-xs text-slate-700 bg-slate-50 rounded-lg border border-slate-200 p-3">
                    <span className="font-semibold">Briefing Awal:</span> {order.catatan_desain}
                  </p>
                )}

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700">Item pada Nota:</p>
                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
                    {order.items.map((item) => (
                      <li key={item.id} className="px-3 py-2 flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-900">
                          {item.nama_item || item.product_name}{' '}
                          <span className="text-slate-500 font-normal">({item.product_name})</span>
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 shrink-0">
                          {formatDimensiItem(item)} · x{item.qty}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {order.design_revisions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-700">Catatan Revisi Terakhir:</p>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span className="font-semibold">
                        Revisi #{order.design_revisions[0]!.revisi_ke}:
                      </span>{' '}
                      {order.design_revisions[0]?.catatan_revisi}
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {formatTanggal(order.design_revisions[0]?.created_at)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Controls */}
              {revisingOrderId === order.id ? (
                <form onSubmit={(e) => handleRevise(e, order)} className="space-y-2.5 pt-2 border-t border-slate-200">
                  <label className="block text-xs font-semibold text-slate-800">
                    Catatan Revisi untuk Desainer *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={catatanRevisi}
                    onChange={(e) => setCatatanRevisi(e.target.value)}
                    placeholder="Jelaskan bagian yang perlu diperbaiki..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRevisingOrderId(null);
                        setCatatanRevisi('');
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={busyId === order.id}
                      className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 cursor-pointer"
                    >
                      Kirim Permintaan Revisi
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                  {isWaitingAcc && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRevisingOrderId(order.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Ajukan Revisi
                      </button>
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => handleApprove(order)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Setujui Preview (ACC)
                      </button>
                    </>
                  )}
                  {alreadyApproved && (
                    <span className="text-xs font-medium text-emerald-700">
                      Telah di-ACC Admin ({order.tanda_tangan_admin}). Menunggu Desainer mengunggah TIFF &amp; Master Desain.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React, { useState } from 'react';
import { Play, Upload, FileCheck, CheckCircle2, Paperclip, Eye } from 'lucide-react';
import type { Order } from '../../types';
import {
  STATUS_DESAIN_LABEL,
  STATUS_PRODUKSI_LABEL,
  computeProgresDesainNota,
  formatDimensiItem,
  formatTanggal,
  statusBadgeStyle,
} from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface DesainerViewProps {
  orders: Order[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onInspectOrder: (order: Order) => void;
}

export const DesainerView: React.FC<DesainerViewProps> = ({
  orders,
  loading,
  onRefresh,
  onNotify,
  onInspectOrder,
}) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewNote, setPreviewNote] = useState('');

  const [masterOrder, setMasterOrder] = useState<Order | null>(null);
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [ttdDesainer, setTtdDesainer] = useState('');

  const [bulkTiffOrder, setBulkTiffOrder] = useState<Order | null>(null);
  const [bulkTiffFiles, setBulkTiffFiles] = useState<File[]>([]);
  const [bulkTiffMap, setBulkTiffMap] = useState<Record<string, string>>({});
  const [preflightDpiOk, setPreflightDpiOk] = useState(false);
  const [preflightCmykOk, setPreflightCmykOk] = useState(false);
  const [preflightBleedOk, setPreflightBleedOk] = useState(false);
  const [preflightCatatan, setPreflightCatatan] = useState('');

  const handleTerimaJob = async (order: Order) => {
    setBusyKey(`terima-${order.id}`);
    try {
      await apiFetch(`/api/desainer/orders/${order.id}/terima`, { method: 'POST' });
      await onRefresh();
      onNotify('success', `Job nota ${order.no_nota} berhasil diterima. Timer desain dimulai.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menerima job.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUploadPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewOrder || !previewFile) return;
    setBusyKey(`preview-${previewOrder.id}`);
    try {
      const fd = new FormData();
      fd.append('file_preview', previewFile);
      if (previewNote.trim()) fd.append('catatan', previewNote.trim());
      await apiFetch(`/api/desainer/orders/${previewOrder.id}/preview`, {
        method: 'POST',
        body: fd,
      });
      setPreviewOrder(null);
      setPreviewFile(null);
      setPreviewNote('');
      await onRefresh();
      onNotify('success', 'Preview desain diunggah dan dikirim untuk Review Admin.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengunggah preview.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUploadTiff = async (itemId: number, file: File | null, fallbackName: string) => {
    setBusyKey(`tiff-${itemId}`);
    try {
      const fd = new FormData();
      if (file) {
        fd.append('file_cetak_tiff', file);
      } else {
        fd.append('filename', fallbackName);
      }
      fd.append('preflight_dpi_ok', preflightDpiOk ? 'true' : 'false');
      fd.append('preflight_cmyk_ok', preflightCmykOk ? 'true' : 'false');
      fd.append('preflight_bleed_ok', preflightBleedOk ? 'true' : 'false');
      if (preflightCatatan.trim()) fd.append('preflight_catatan', preflightCatatan.trim());
      await apiFetch(`/api/desainer/items/${itemId}/tiff`, {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      onNotify('success', 'File cetak .TIFF berhasil disimpan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengunggah TIFF.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleFinalisasiMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterOrder || !masterFile) return;
    setBusyKey(`master-${masterOrder.id}`);
    try {
      const fd = new FormData();
      fd.append('file_master_arsip', masterFile);
      fd.append('tanda_tangan', ttdDesainer.trim() || 'Budi');
      await apiFetch(`/api/desainer/orders/${masterOrder.id}/master`, {
        method: 'POST',
        body: fd,
      });
      setMasterOrder(null);
      setMasterFile(null);
      setTtdDesainer('');
      await onRefresh();
      onNotify('success', `Master editable nota ${masterOrder.no_nota} disimpan. Item dikirim ke Antrean Cetak.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyelesaikan master desain.');
    } finally {
      setBusyKey(null);
    }
  };

  const suggestItemForFile = (order: Order, filename: string): string => {
    const approvedItems = order.items.filter((i) => Boolean(i.acc_admin_id) && !i.file_cetak_tiff);
    const pool = approvedItems.length > 0 ? approvedItems : order.items.filter((i) => Boolean(i.acc_admin_id));
    const itemIdMatch = filename.match(/(?:^|[^a-z0-9])item[-_]?(\d+)(?:[^0-9]|$)/i);
    if (itemIdMatch) {
      const found = pool.find((i) => i.id === Number(itemIdMatch[1]));
      if (found) return String(found.id);
    }
    const idxMatch = filename.match(/^0*(\d+)[-_.\s]/);
    if (idxMatch) {
      const idx = Number(idxMatch[1]) - 1;
      if (idx >= 0 && idx < order.items.length && order.items[idx].acc_admin_id) {
        return String(order.items[idx].id);
      }
    }
    const lower = filename.toLowerCase();
    const byName = pool.find((i) => {
      const label = (i.nama_item || i.product_name || '').toLowerCase().trim();
      return label.length >= 3 && (lower.includes(label.replace(/\s+/g, '_')) || lower.includes(label));
    });
    return byName ? String(byName.id) : '';
  };

  const handleSelectBulkFiles = (order: Order, fileList: FileList | null) => {
    const picked = Array.from(fileList ?? []);
    setBulkTiffFiles(picked);
    const initialMap: Record<string, string> = {};
    for (const f of picked) {
      initialMap[f.name] = suggestItemForFile(order, f.name);
    }
    setBulkTiffMap(initialMap);
  };

  const handleSubmitBulkTiff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkTiffOrder || bulkTiffFiles.length === 0) return;
    const peta = bulkTiffFiles.map((f) => ({
      filename: f.name,
      item_id: Number(bulkTiffMap[f.name] || 0),
    }));
    if (peta.some((p) => !(p.item_id > 0))) {
      onNotify('error', 'Setiap file TIFF wajib dipasangkan ke item yang sesuai.');
      return;
    }
    setBusyKey(`tiff-massal-${bulkTiffOrder.id}`);
    try {
      const fd = new FormData();
      for (const f of bulkTiffFiles) {
        fd.append('files', f);
      }
      fd.append('peta', JSON.stringify(peta));
      fd.append('preflight_dpi_ok', preflightDpiOk ? 'true' : 'false');
      fd.append('preflight_cmyk_ok', preflightCmykOk ? 'true' : 'false');
      fd.append('preflight_bleed_ok', preflightBleedOk ? 'true' : 'false');
      if (preflightCatatan.trim()) fd.append('preflight_catatan', preflightCatatan.trim());
      const res = await apiFetch<{ uploaded: number }>(`/api/desainer/orders/${bulkTiffOrder.id}/tiff-massal`, {
        method: 'POST',
        body: fd,
      });
      setBulkTiffOrder(null);
      setBulkTiffFiles([]);
      setBulkTiffMap({});
      await onRefresh();
      onNotify('success', `${res.uploaded} file TIFF berhasil dipasangkan ke item.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal unggah TIFF massal.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">Antrean desain saat ini kosong</p>
        <p className="mt-1 text-xs text-slate-500">
          Nota baru dari Admin akan langsung muncul di papan antrean ini.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {orders.map((order) => {
        const progres = computeProgresDesainNota(order);
        const diterima = Boolean(order.designer_id || order.waktu_terima_desain);
        const hasPendingRevisi = order.design_revisions.some((r) => r.status_revisi === 'menunggu');
        const allApproved = order.items.every((i) => Boolean(i.acc_admin_id));
        const allHaveTiff = order.items.every((i) => Boolean(i.file_cetak_tiff));
        const canUploadPreview =
          diterima &&
          !order.file_master_arsip &&
          order.items.some((i) => ['proses_desain', 'revisi', 'menunggu_acc'].includes(i.status_produksi));

        return (
          <div key={order.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            {/* Header Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-base font-bold text-slate-900">{order.no_nota}</h3>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-sm font-medium text-slate-800">
                    {order.customer?.nama_pelanggan} ({order.customer?.instansi})
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Materi Awal: {STATUS_DESAIN_LABEL[order.status_desain]}
                  {order.deadline ? ` · Deadline: ${formatTanggal(order.deadline)}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInspectOrder(order)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Detail Nota
                </button>
                {!diterima && (
                  <button
                    type="button"
                    disabled={busyKey === `terima-${order.id}`}
                    onClick={() => handleTerimaJob(order)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Terima Job
                  </button>
                )}
                {canUploadPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewOrder(order);
                      setPreviewFile(null);
                      setPreviewNote('');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Preview (JPG/PNG)
                  </button>
                )}
                {order.items.some((i) => Boolean(i.acc_admin_id) && !i.file_cetak_tiff) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkTiffOrder(order);
                      setBulkTiffFiles([]);
                      setBulkTiffMap({});
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload TIFF Massal
                  </button>
                )}
                {allHaveTiff && !order.file_master_arsip && (
                  <button
                    type="button"
                    onClick={() => {
                      setMasterOrder(order);
                      setMasterFile(null);
                      setTtdDesainer(order.designer_name ?? 'Budi');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Finalisasi Master &amp; Kirim Cetak
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-600">Progres Alur Desain</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">{progres}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${progres}%` }}
                />
              </div>
            </div>

            {/* Briefing & Revision Alert */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {order.catatan_desain && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900 mb-1">Briefing Pelanggan</p>
                  <p>{order.catatan_desain}</p>
                  {order.lampiran_briefing && (
                    <a
                      href={order.lampiran_briefing}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      Unduh Lampiran Briefing
                    </a>
                  )}
                </div>
              )}

              {hasPendingRevisi && order.design_revisions[0] && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold mb-1">
                    Permintaan Revisi Admin (#{order.design_revisions[0].revisi_ke})
                  </p>
                  <p>{order.design_revisions[0].catatan_revisi}</p>
                </div>
              )}
            </div>

            {/* Item list with TIFF upload per item */}
            {order.items.some((i) => Boolean(i.acc_admin_id)) && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 space-y-2">
                <p className="font-semibold">Checklist Preflight sebelum unggah TIFF</p>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={preflightDpiOk} onChange={(e) => setPreflightDpiOk(e.target.checked)} />
                    DPI sesuai
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={preflightCmykOk} onChange={(e) => setPreflightCmykOk(e.target.checked)} />
                    CMYK
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={preflightBleedOk} onChange={(e) => setPreflightBleedOk(e.target.checked)} />
                    Bleed aman
                  </label>
                </div>
                <input
                  type="text"
                  value={preflightCatatan}
                  onChange={(e) => setPreflightCatatan(e.target.value)}
                  placeholder="Catatan preflight (opsional)"
                  className="w-full rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
            )}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs sm:text-sm responsive-table">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2.5">Nama Item</th>
                    <th className="text-left px-4 py-2.5">Ukuran &amp; Finishing</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-right px-4 py-2.5">File Siap Cetak (.TIFF)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Item" className="px-4 py-3 font-medium text-slate-900">
                        {item.nama_item || item.product_name}
                        <span className="block text-xs text-slate-500 font-normal">
                          {item.product_name} · x{item.qty}
                        </span>
                      </td>
                      <td data-label="Ukuran" className="px-4 py-3 text-slate-700">
                        <span className="font-mono tabular-nums">{formatDimensiItem(item)}</span>
                        {item.finishing_name && (
                          <span className="block text-xs text-slate-500">{item.finishing_name}</span>
                        )}
                      </td>
                      <td data-label="Status" className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                            item.status_produksi,
                          )}`}
                        >
                          {item.acc_admin_id
                            ? 'ACC Admin'
                            : item.acc_pelanggan_at || order.approval_status === 'disetujui'
                              ? 'ACC Pelanggan (Menunggu Admin)'
                              : STATUS_PRODUKSI_LABEL[item.status_produksi]}
                        </span>
                      </td>
                      <td data-label="File TIFF" className="px-4 py-3 text-right">
                        {item.file_cetak_tiff ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-700 font-semibold">
                            <FileCheck className="h-3.5 w-3.5" />
                            Tersimpan
                          </span>
                        ) : item.acc_admin_id ? (
                          <div className="inline-flex items-center gap-2">
                            <label className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer whitespace-nowrap">
                              <Upload className="h-3.5 w-3.5" />
                              Unggah .TIFF
                              <input
                                type="file"
                                accept=".tif,.tiff,image/tiff"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0] ?? null;
                                  if (f) handleUploadTiff(item.id, f, f.name);
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={busyKey === `tiff-${item.id}`}
                              onClick={() =>
                                handleUploadTiff(item.id, null, `${order.no_nota}-item-${item.id}.tif`)
                              }
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                              title="Simpan referensi file TIFF lokal workshop"
                            >
                              Tandai Siap TIFF
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Menunggu ACC Admin</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {allApproved && !allHaveTiff && (
              <p className="text-xs text-blue-700 font-medium">
                Admin sudah menyetujui preview. Unggah file .TIFF untuk setiap item agar tombol Finalisasi Master terbuka.
              </p>
            )}
          </div>
        );
      })}

      {/* Upload Preview Modal */}
      {previewOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleUploadPreview}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Upload Preview Desain ({previewOrder.no_nota})
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Pilih Gambar Preview (JPG/PNG/WEBP) *
              </label>
              <input
                type="file"
                required
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setPreviewFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Catatan Desainer (Opsional)
              </label>
              <input
                type="text"
                value={previewNote}
                onChange={(e) => setPreviewNote(e.target.value)}
                placeholder="Misal: Ukuran sudah disesuaikan, mohon cek ejaan."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreviewOrder(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={!previewFile || busyKey !== null}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                Kirim untuk ACC Admin
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Finalisasi Master Modal */}
      {masterOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleFinalisasiMaster}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Finalisasi Master Desain ({masterOrder.no_nota})
            </h3>
            <p className="text-xs text-slate-600">
              Seluruh item akan otomatis berpindah ke <strong>Antrean Cetak Operator</strong> setelah master arsip disimpan.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unggah File Master Editable (.AI / .PSD / .CDR) *
              </label>
              <input
                type="file"
                required
                accept=".ai,.psd,.cdr"
                onChange={(e) => setMasterFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Wajib format editable CorelDRAW (.cdr), Illustrator (.ai), atau Photoshop (.psd).
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tanda Tangan / Inisial Desainer *
              </label>
              <input
                type="text"
                required
                value={ttdDesainer}
                onChange={(e) => setTtdDesainer(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMasterOrder(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={!masterFile || busyKey !== null}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                Simpan &amp; Masuk Antrean Cetak
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upload TIFF Massal Modal */}
      {bulkTiffOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSubmitBulkTiff}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Upload File TIFF Massal ({bulkTiffOrder.no_nota})
            </h3>
            <p className="text-xs text-slate-600">
              Pilih beberapa file <code className="rounded bg-slate-100 px-1">.tif / .tiff</code> sekaligus, lalu pastikan setiap file dipasangkan ke item yang benar.
            </p>
            <input
              type="file"
              multiple
              accept=".tif,.tiff,image/tiff"
              onChange={(e) => handleSelectBulkFiles(bulkTiffOrder, e.target.files)}
              className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-blue-700"
            />

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 space-y-2">
              <p className="font-semibold">Checklist Preflight (berlaku untuk semua file upload ini)</p>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={preflightDpiOk} onChange={(e) => setPreflightDpiOk(e.target.checked)} />DPI sesuai</label>
                <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={preflightCmykOk} onChange={(e) => setPreflightCmykOk(e.target.checked)} />CMYK</label>
                <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={preflightBleedOk} onChange={(e) => setPreflightBleedOk(e.target.checked)} />Bleed aman</label>
              </div>
              <input type="text" value={preflightCatatan} onChange={(e) => setPreflightCatatan(e.target.value)} placeholder="Catatan preflight (opsional)" className="w-full rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs" />
            </div>

            {bulkTiffFiles.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">File TIFF</th>
                      <th className="px-3 py-2 text-left">Pasangkan ke Item</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bulkTiffFiles.map((file) => (
                      <tr key={file.name}>
                        <td className="px-3 py-2 font-mono text-slate-800">{file.name}</td>
                        <td className="px-3 py-2">
                          <select
                            required
                            value={bulkTiffMap[file.name] ?? ''}
                            onChange={(e) =>
                              setBulkTiffMap((prev) => ({ ...prev, [file.name]: e.target.value }))
                            }
                            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="">-- Pilih item nota --</option>
                            {bulkTiffOrder.items
                              .filter((i) => Boolean(i.acc_admin_id))
                              .map((it, idx) => (
                                <option key={it.id} value={it.id}>
                                  #{idx + 1} (ID {it.id}) · {it.nama_item || it.product_name} ({formatDimensiItem(it)} x{it.qty})
                                </option>
                              ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBulkTiffOrder(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={bulkTiffFiles.length === 0 || busyKey !== null}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                Unggah Semua TIFF ({bulkTiffFiles.length})
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

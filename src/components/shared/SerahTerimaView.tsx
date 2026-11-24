import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Search, Lock, Upload, Eraser } from 'lucide-react';
import type { Order, UserRole } from '../../types';
import { STATUS_BAYAR_LABEL, formatRupiah, statusBadgeStyle } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface SerahTerimaViewProps {
  orders: Order[];
  role: UserRole;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const SerahTerimaView: React.FC<SerahTerimaViewProps> = ({
  orders,
  role,
  loading,
  onRefresh,
  onNotify,
}) => {
  const [query, setQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [namaPengambil, setNamaPengambil] = useState('');
  const [noWaPengambil, setNoWaPengambil] = useState('');
  const [catatan, setCatatan] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [tandaTangan, setTandaTangan] = useState<string | null>(null);
  const [sedangMenggambar, setSedangMenggambar] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAdvertising = role === 'advertising';

  useEffect(() => {
    setTandaTangan(null);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [selectedOrder?.id]);

  const posisiCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const mulaiGambar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = posisiCanvas(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    setSedangMenggambar(true);
  };

  const gambarTandaTangan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sedangMenggambar) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = posisiCanvas(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const selesaiGambar = () => {
    if (!sedangMenggambar) return;
    setSedangMenggambar(false);
    const canvas = canvasRef.current;
    if (canvas) setTandaTangan(canvas.toDataURL('image/png'));
  };

  const hapusTandaTangan = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setTandaTangan(null);
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    if (!tandaTangan) {
      onNotify('error', 'Tanda tangan pengambil wajib diisi sebelum menyelesaikan serah terima.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('nama_pengambil', namaPengambil.trim());
      fd.append('no_wa_pengambil', noWaPengambil.trim());
      if (catatan.trim()) fd.append('catatan_pengecualian', catatan.trim());
      if (foto) fd.append('foto_serah_terima', foto);
      fd.append('tanda_tangan_pengambil', tandaTangan);

      await apiFetch(`/api/orders/${selectedOrder.id}/serah-terima`, {
        method: 'POST',
        body: fd,
      });
      setSelectedOrder(null);
      setNamaPengambil('');
      setNoWaPengambil('');
      setCatatan('');
      setFoto(null);
      setTandaTangan(null);
      await onRefresh();
      onNotify('success', `Serah terima nota ${selectedOrder.no_nota} berhasil dicatat.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan serah terima.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          Serah terima hanya dapat diproses setelah seluruh item berstatus <strong>Siap Diambil</strong> dan status pembayaran <strong>Lunas</strong>.
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nota siap diambil..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-sm font-semibold text-slate-800">Belum ada nota yang siap diserahkan</p>
          <p className="mt-1 text-xs text-slate-500">
            Nota muncul di daftar ini setelah cetak dan finishing selesai.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">No. Nota</th>
                <th className="text-left px-4 py-3">Pelanggan / Instansi</th>
                <th className="text-left px-4 py-3">Jumlah Item</th>
                {!isAdvertising && <th className="text-right px-4 py-3">Sisa Tagihan</th>}
                <th className="text-left px-4 py-3">Status Bayar</th>
                <th className="text-right px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((order) => {
                const lunas = order.status_bayar === 'lunas';
                return (
                  <tr key={order.id}>
                    <td data-label="No. Nota" className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {order.no_nota}
                    </td>
                    <td data-label="Pelanggan" className="px-4 py-3">
                      <p className="font-medium text-slate-900">{order.customer?.nama_pelanggan}</p>
                      <p className="text-xs text-slate-500">{order.customer?.instansi}</p>
                    </td>
                    <td data-label="Item" className="px-4 py-3 text-slate-700 font-mono tabular-nums">
                      {order.items.length} item
                    </td>
                    {!isAdvertising && (
                      <td
                        data-label="Sisa Tagihan"
                        className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900"
                      >
                        {formatRupiah(order.sisa_tagihan)}
                      </td>
                    )}
                    <td data-label="Status Bayar" className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                          order.status_bayar,
                        )}`}
                      >
                        {STATUS_BAYAR_LABEL[order.status_bayar]}
                      </span>
                    </td>
                    <td data-label="Aksi" className="px-4 py-3 text-right">
                      {lunas ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOrder(order);
                            setNamaPengambil(order.customer?.nama_pelanggan ?? '');
                            setNoWaPengambil(order.customer?.no_wa ?? '');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          Proses Serah Terima
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
                          <Lock className="h-3.5 w-3.5" />
                          Pelunasan wajib sebelum serah terima
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Handover Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Berita Acara Serah Terima ({selectedOrder.no_nota})
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Pengambil *</label>
              <input
                type="text"
                required
                value={namaPengambil}
                onChange={(e) => setNamaPengambil(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                No. WhatsApp Pengambil *
              </label>
              <input
                type="text"
                required
                value={noWaPengambil}
                onChange={(e) => setNoWaPengambil(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700">
                  Tanda Tangan Pengambil <span className="text-rose-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={hapusTandaTangan}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-700 cursor-pointer"
                >
                  <Eraser className="h-3 w-3" />
                  Hapus
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={640}
                height={160}
                onPointerDown={mulaiGambar}
                onPointerMove={gambarTandaTangan}
                onPointerUp={selesaiGambar}
                onPointerCancel={selesaiGambar}
                onPointerLeave={selesaiGambar}
                className="w-full h-28 rounded-lg border border-slate-300 bg-white touch-none cursor-crosshair"
              />
              <p className={`mt-1 text-[11px] ${tandaTangan ? 'text-emerald-700' : 'text-slate-500'}`}>
                {tandaTangan ? 'Tanda tangan tersimpan.' : 'Minta pengambil menandatangani di kotak ini.'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Foto Bukti Serah Terima (Opsional)
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 cursor-pointer">
                <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">{foto ? foto.name : 'Pilih foto penyerahan barang...'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Catatan Audit / Pengecualian (Opsional)
              </label>
              <input
                type="text"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Misal: Diambil kurir ojol atas izin pelanggan"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
              >
                {submitting ? 'Menyimpan...' : 'Selesaikan Serah Terima'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

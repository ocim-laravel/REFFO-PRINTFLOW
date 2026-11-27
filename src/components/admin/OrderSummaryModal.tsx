import React, { useEffect, useState } from 'react';
import {
  X,
  Printer,
  MessageCircle,
  CreditCard,
  Upload,
  CheckCircle2,
  QrCode,
  Link2,
  Copy,
  Ban,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { Order, PaymentMethod, UserRole } from '../../types';
import {
  KATEGORI_PELANGGAN_LABEL,
  STATUS_BAYAR_LABEL,
  STATUS_PRODUKSI_LABEL,
  STATUS_SPK_LABEL,
  buildWhatsAppUrl,
  formatDesimal,
  formatDimensiItem,
  formatRupiah,
  formatTanggal,
  statusBadgeStyle,
} from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface OrderSummaryModalProps {
  order: Order | null;
  role: UserRole;
  onClose: () => void;
  onUpdated: (order: Order) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const OrderSummaryModal: React.FC<OrderSummaryModalProps> = ({
  order,
  role,
  onClose,
  onUpdated,
  onNotify,
}) => {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [nominalBayar, setNominalBayar] = useState('');
  const [metodeBayar, setMetodeBayar] = useState<PaymentMethod>('Transfer');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [keteranganBayar, setKeteranganBayar] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [approvalQrDataUrl, setApprovalQrDataUrl] = useState<string | null>(null);
  const [acting, setActing] = useState<'void' | 'reorder' | null>(null);

  useEffect(() => {
    if (!order) {
      setQrDataUrl(null);
      setApprovalQrDataUrl(null);
      return;
    }
    setNominalBayar(order.sisa_tagihan > 0 ? String(order.sisa_tagihan) : '');
    setBuktiFile(null);
    setKeteranganBayar('');

    const deepLink = `${window.location.origin}/?nota=${encodeURIComponent(order.no_nota)}`;
    QRCode.toDataURL(deepLink, { width: 128, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(null));

    if (order.approval_token) {
      const approvalLink = `${window.location.origin}/acc/${encodeURIComponent(order.approval_token)}`;
      QRCode.toDataURL(approvalLink, {
        width: 128,
        margin: 1,
        color: { dark: '#065f46', light: '#ffffff' },
      })
        .then((url) => setApprovalQrDataUrl(url))
        .catch(() => setApprovalQrDataUrl(null));
    } else {
      setApprovalQrDataUrl(null);
    }
  }, [order]);

  if (!order) return null;

  const isNonBilling = role === 'advertising';
  const isVoid = order.status_nota === 'batal';
  const canVoid = (role === 'admin' || role === 'owner') && !isNonBilling && !isVoid;
  const canReorder = role === 'admin' && !isNonBilling;
  const canRecordPayment =
    role === 'admin' && !isVoid && (order.status_bayar !== 'lunas' || !order.bukti_pelunasan);
  const approvalUrl = order.approval_token
    ? `${window.location.origin}/acc/${encodeURIComponent(order.approval_token)}`
    : null;
  const dpp = Math.round(
    order.total_tagihan - (order.ppn_nominal ?? 0) + (order.pph23_nominal ?? 0),
  );
  const approvalLabel: Record<string, string> = {
    belum: 'Belum dikirim',
    menunggu: 'Menunggu persetujuan pelanggan',
    disetujui: 'Disetujui pelanggan',
    revisi: 'Diminta revisi',
  };

  const handleVoid = async () => {
    const alasan = window.prompt(
      `Batalkan (void) nota ${order.no_nota}?\n\nMasukkan alasan pembatalan untuk audit (wajib):`,
    );
    if (alasan === null) return;
    if (!alasan.trim()) {
      onNotify('error', 'Alasan pembatalan wajib diisi.');
      return;
    }
    setActing('void');
    try {
      const res = await apiFetch<{ order: Order; refund_nominal: number }>(
        `/api/orders/${order.id}/void`,
        {
          method: 'POST',
          body: JSON.stringify({ alasan_batal: alasan.trim() }),
        },
      );
      onUpdated(res.order);
      onNotify(
        'success',
        res.refund_nominal > 0
          ? `Nota ${order.no_nota} dibatalkan. Wajib refund ${formatRupiah(res.refund_nominal)} ke pelanggan.`
          : `Nota ${order.no_nota} berhasil dibatalkan.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membatalkan nota.');
    } finally {
      setActing(null);
    }
  };

  const handleReorder = async () => {
    if (!window.confirm(`Buat nota baru hasil reorder dari ${order.no_nota}?`)) return;
    setActing('reorder');
    try {
      const res = await apiFetch<{ order: Order; source_no_nota: string }>(
        `/api/orders/${order.id}/reorder`,
        { method: 'POST' },
      );
      onUpdated(res.order);
      onNotify('success', `Nota baru ${res.order.no_nota} dibuat dari reorder ${res.source_no_nota}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal melakukan reorder.');
    } finally {
      setActing(null);
    }
  };

  const handleCopyApprovalLink = async () => {
    if (!approvalUrl) return;
    try {
      await navigator.clipboard.writeText(approvalUrl);
      onNotify('success', 'Link Self-ACC disalin. Kirim ke pelanggan via WhatsApp.');
    } catch {
      onNotify('error', 'Browser menolak akses clipboard. Salin link secara manual.');
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // If already lunas (only uploading missing proof), hit pelunasan endpoint
      if (order.status_bayar === 'lunas') {
        const fd = new FormData();
        if (buktiFile) fd.append('bukti_pelunasan', buktiFile);
        if (keteranganBayar.trim()) fd.append('catatan_pengecualian', keteranganBayar.trim());
        fd.append('metode', metodeBayar);
        const res = await apiFetch<{ order: Order }>(`/api/orders/${order.id}/pelunasan`, {
          method: 'POST',
          body: fd,
        });
        onUpdated(res.order);
        setShowPaymentForm(false);
        onNotify('success', `Bukti pelunasan nota ${order.no_nota} berhasil disimpan.`);
        return;
      }

      const nominal = Number(nominalBayar);
      if (!(nominal > 0)) {
        onNotify('error', 'Nominal pembayaran harus lebih dari Rp 0.');
        setSubmitting(false);
        return;
      }

      const fd = new FormData();
      fd.append('nominal', String(nominal));
      fd.append('metode', metodeBayar);
      if (keteranganBayar.trim()) fd.append('keterangan', keteranganBayar.trim());
      if (buktiFile) fd.append('bukti_bayar', buktiFile);

      const res = await apiFetch<{ order: Order }>(`/api/orders/${order.id}/payments`, {
        method: 'POST',
        body: fd,
      });
      onUpdated(res.order);
      setShowPaymentForm(false);
      onNotify(
        'success',
        res.order.status_bayar === 'lunas'
          ? `Nota ${order.no_nota} kini LUNAS.`
          : `Pembayaran termin ${formatRupiah(nominal)} berhasil dicatat.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mencatat pembayaran.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="print-sheet bg-white rounded-xl border border-slate-200 w-full max-w-4xl my-6 overflow-hidden">
        {/* Header Bar */}
        <div className="no-print px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 font-mono">
              {order.no_nota}
            </h2>
            <p className="text-xs text-slate-500">
              Dibuat {formatTanggal(order.created_at)} · Admin: {order.admin_name ?? 'Admin'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isNonBilling && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Cetak Nota / PDF
                </button>
                <a
                  href={buildWhatsAppUrl(order)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Kirim WhatsApp
                </a>
              </>
            )}
            {canRecordPayment && (
              <button
                type="button"
                onClick={() => setShowPaymentForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CreditCard className="h-3.5 w-3.5" />
                {order.status_bayar === 'lunas' ? 'Lengkapi Bukti Lunas' : 'Catat Pembayaran / Termin'}
              </button>
            )}
            {canReorder && (
              <button
                type="button"
                onClick={handleReorder}
                disabled={acting !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {acting === 'reorder' ? 'Memproses...' : 'Reorder'}
              </button>
            )}
            {canVoid && (
              <button
                type="button"
                onClick={handleVoid}
                disabled={acting !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
              >
                <Ban className="h-3.5 w-3.5" />
                {acting === 'void' ? 'Membatalkan...' : 'Void / Batalkan'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer"
              aria-label="Tutup detail nota"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Print Header with Scannable Nota QR Code */}
          <div className="hidden print:flex justify-between items-start border-b border-slate-300 pb-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">REFFO PRINTFLOW</h1>
              <p className="text-xs text-slate-600">Digital Printing &amp; Advertising Workshop</p>
              <p className="font-mono text-sm font-bold text-slate-900 mt-2">{order.no_nota}</p>
              <p className="text-xs text-slate-600">{formatTanggal(order.created_at)}</p>
            </div>
            {qrDataUrl && (
              <div className="flex items-center gap-2.5 text-right">
                <div className="text-[11px] text-slate-600">
                  <p className="font-semibold text-slate-900">Verifikasi Nota</p>
                  <p>Pindai QR untuk cek</p>
                  <p>status produksi</p>
                </div>
                <img
                  src={qrDataUrl}
                  alt={`QR ${order.no_nota}`}
                  className="h-20 w-20 border border-slate-300 rounded p-0.5 bg-white"
                />
              </div>
            )}
          </div>

          {/* Void / Batal Status Banner */}
          {isVoid && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <p className="flex items-center gap-2 font-semibold">
                <Ban className="h-4 w-4" />
                Nota ini DIBATALKAN (VOID)
              </p>
              <p className="mt-1 text-xs">
                Alasan: <strong>{order.alasan_batal || 'Tidak dicatat'}</strong>
              </p>
              <p className="mt-1 text-xs">
                Total sudah dibayar: <strong className="font-mono">{formatRupiah(order.jumlah_dp)}</strong>
                {order.jumlah_dp > 0 ? ' — wajib direfund ke pelanggan.' : ''}
              </p>
            </div>
          )}

          {/* Inline Pembayaran Termin / Pelunasan Form */}
          {showPaymentForm && canRecordPayment && (
            <form
              onSubmit={handleSubmitPayment}
              className="no-print rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  {order.status_bayar === 'lunas'
                    ? 'Lengkapi Bukti Pelunasan'
                    : `Catat Pembayaran Termin / Pelunasan (Sisa: ${formatRupiah(order.sisa_tagihan)})`}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPaymentForm(false)}
                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Batal
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {order.status_bayar !== 'lunas' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Nominal Bayar (Rp) *
                      </label>
                      <button
                        type="button"
                        onClick={() => setNominalBayar(String(order.sisa_tagihan))}
                        className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        Isi Sisa Lunas
                      </button>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={order.sisa_tagihan}
                      required
                      value={nominalBayar}
                      onChange={(e) => setNominalBayar(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Metode Pembayaran
                  </label>
                  <select
                    value={metodeBayar}
                    onChange={(e) => setMetodeBayar(e.target.value as PaymentMethod)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="Transfer">Transfer Bank</option>
                    <option value="Tunai">Tunai Kasir</option>
                    <option value="QRIS">QRIS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bukti Transfer / Struk (Opsional)
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 cursor-pointer">
                    <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="truncate">{buktiFile ? buktiFile.name : 'Pilih foto bukti...'}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setBuktiFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Keterangan / Catatan Termin
                  </label>
                  <input
                    type="text"
                    value={keteranganBayar}
                    onChange={(e) => setKeteranganBayar(e.target.value)}
                    placeholder="Misal: Termin ke-2 instansi / lunas kasir"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {submitting ? 'Memproses...' : 'Simpan Pembayaran'}
                </button>
              </div>
            </form>
          )}

          {/* Customer & Order Meta Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-medium text-slate-500">Pelanggan &amp; Instansi</p>
              <p className="mt-1 font-semibold text-slate-900">{order.customer?.nama_pelanggan ?? '-'}</p>
              <p className="text-xs text-slate-600">
                {order.customer?.instansi ?? 'Perorangan'}
                {!isNonBilling && order.customer?.kategori
                  ? ` · Tier ${KATEGORI_PELANGGAN_LABEL[order.customer.kategori]}`
                  : ''}
              </p>
              {!isNonBilling && <p className="text-xs font-mono text-slate-500 mt-0.5">{order.customer?.no_wa}</p>}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500">Jadwal &amp; Desain</p>
              <p className="mt-1 text-slate-900">
                Deadline: <span className="font-medium">{formatTanggal(order.deadline)}</span>
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Desainer: {order.designer_name ?? 'Belum diambil'}
              </p>
              {order.file_master_arsip && (
                <p className="text-xs font-mono text-slate-600 mt-0.5 truncate">
                  Master: {order.file_master_arsip}
                </p>
              )}
            </div>

            {!isNonBilling && (
              <div className="sm:text-right">
                <p className="text-xs font-medium text-slate-500">Status Pembayaran</p>
                <div className="mt-1 flex sm:justify-end">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusBadgeStyle(
                      order.status_bayar,
                    )}`}
                  >
                    {STATUS_BAYAR_LABEL[order.status_bayar]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-600">
                  Total:{' '}
                  <strong className="font-mono tabular-nums text-slate-900">
                    {formatRupiah(order.total_tagihan)}
                  </strong>
                </p>
                {(order.diskon_nominal ?? 0) > 0 && (
                  <p className="text-xs text-slate-600">
                    Diskon nota ({order.diskon_persen ?? 0}%):{' '}
                    <strong className="font-mono text-rose-700">
                      −{formatRupiah(order.diskon_nominal ?? 0)}
                    </strong>
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  DPP: <span className="font-mono">{formatRupiah(dpp)}</span>
                </p>
                {(order.ppn_nominal ?? 0) > 0 && (
                  <p className="text-xs text-slate-500">
                    PPN ({order.ppn_persen ?? 0}%):{' '}
                    <span className="font-mono">+{formatRupiah(order.ppn_nominal ?? 0)}</span>
                  </p>
                )}
                {(order.pph23_nominal ?? 0) > 0 && (
                  <p className="text-xs text-slate-500">
                    PPh 23 ({order.pph23_persen ?? 0}%):{' '}
                    <span className="font-mono text-rose-700">
                      −{formatRupiah(order.pph23_nominal ?? 0)}
                    </span>
                  </p>
                )}
                <p className="text-xs text-slate-600">
                  Terbayar:{' '}
                  <strong className="font-mono tabular-nums text-emerald-700">
                    {formatRupiah(order.jumlah_dp)}
                  </strong>
                  {' · '}Sisa:{' '}
                  <strong className="font-mono tabular-nums text-slate-900">
                    {formatRupiah(order.sisa_tagihan)}
                  </strong>
                </p>
                {order.jatuh_tempo && (
                  <p className="text-xs text-slate-500">
                    Jatuh tempo: <span className="font-medium">{formatTanggal(order.jatuh_tempo)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Items Table */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Rincian Item Produksi</h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm responsive-table">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2.5">Item &amp; Produk</th>
                    <th className="text-left px-4 py-2.5">Ukuran / Finishing</th>
                    <th className="text-right px-4 py-2.5">Qty</th>
                    {!isNonBilling && <th className="text-right px-4 py-2.5">Subtotal</th>}
                    <th className="text-left px-4 py-2.5">Status Produksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Item" className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{item.nama_item || item.product_name}</p>
                        <p className="text-xs text-slate-500">{item.product_name}</p>
                      </td>
                      <td data-label="Ukuran / Finishing" className="px-4 py-3 text-slate-700">
                        <span className="font-mono tabular-nums">{formatDimensiItem(item)}</span>
                        {item.luas_tagihan_m2 ? (
                          <span className="text-xs text-slate-500"> · {formatDesimal(item.luas_tagihan_m2)} m²</span>
                        ) : null}
                        {item.finishing_name && (
                          <p className="text-xs text-slate-500">Finishing: {item.finishing_name}</p>
                        )}
                      </td>
                      <td data-label="Qty" className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                        {item.qty}
                      </td>
                      {!isNonBilling && (
                        <td
                          data-label="Subtotal"
                          className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900"
                        >
                          {formatRupiah(item.subtotal)}
                        </td>
                      )}
                      <td data-label="Status" className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                            item.status_produksi,
                          )}`}
                        >
                          {STATUS_PRODUKSI_LABEL[item.status_produksi]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment History Ledger (Billing Roles Only) */}
          {!isNonBilling && (order.payments?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Riwayat Pembayaran &amp; Termin
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs responsive-table">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2">Tanggal</th>
                      <th className="text-left px-3 py-2">Metode</th>
                      <th className="text-left px-3 py-2">Kasir / Keterangan</th>
                      <th className="text-right px-3 py-2">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.payments.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Tanggal" className="px-3 py-2 text-slate-700">
                          {formatTanggal(p.created_at)}
                        </td>
                        <td data-label="Metode" className="px-3 py-2 font-medium text-slate-800">
                          {p.metode}
                        </td>
                        <td data-label="Keterangan" className="px-3 py-2 text-slate-600">
                          <span>{p.admin_name ?? 'Admin'}</span>
                          {p.keterangan ? ` · ${p.keterangan}` : ''}
                          {p.bukti_bayar && (
                            <a
                              href={p.bukti_bayar}
                              target="_blank"
                              rel="noreferrer"
                              className="no-print ml-2 text-blue-700 hover:underline font-medium"
                            >
                              Lihat Bukti
                            </a>
                          )}
                        </td>
                        <td
                          data-label="Nominal"
                          className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-emerald-700"
                        >
                          {formatRupiah(p.nominal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SPK Advertising if present */}
          {order.advertising_spks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">SPK Lapangan Advertising</h3>
              <div className="space-y-2">
                {order.advertising_spks.map((spk) => (
                  <div
                    key={spk.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{spk.jenis_pekerjaan}</p>
                      <p className="text-xs text-slate-600">
                        Konstruksi: {spk.ukuran_konstruksi} · Lokasi: {spk.lokasi_pasang}
                      </p>
                      {spk.catatan_teknis && (
                        <p className="text-xs text-slate-500 mt-0.5">Catatan: {spk.catatan_teknis}</p>
                      )}
                    </div>
                    <span
                      className={`inline-block rounded-md border px-2.5 py-1 text-xs font-semibold ${statusBadgeStyle(
                        spk.status_lapangan,
                      )}`}
                    >
                      {STATUS_SPK_LABEL[spk.status_lapangan]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* On-screen QR Verification Strip + Design Notes & Preview Gallery */}
          <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-700">Catatan &amp; Riwayat Desain</h4>
              {order.catatan_desain ? (
                <p className="text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200 p-3">
                  {order.catatan_desain}
                </p>
              ) : (
                <p className="text-xs text-slate-400">Tidak ada catatan desain tambahan.</p>
              )}
              {order.design_revisions.map((rev) => (
                <div key={rev.id} className="text-xs rounded-lg border border-slate-200 p-2.5">
                  <div className="flex justify-between font-medium text-slate-800">
                    <span>Revisi #{rev.revisi_ke}</span>
                    <span className="text-slate-500">{formatTanggal(rev.created_at)}</span>
                  </div>
                  <p className="text-slate-600 mt-1">{rev.catatan_revisi}</p>
                </div>
              ))}
              {qrDataUrl && (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <img
                    src={qrDataUrl}
                    alt={`QR ${order.no_nota}`}
                    className="h-14 w-14 rounded border border-slate-200 bg-white p-0.5 shrink-0"
                  />
                  <div className="text-xs text-slate-600">
                    <p className="font-semibold text-slate-800 flex items-center gap-1">
                      <QrCode className="h-3.5 w-3.5 text-slate-500" />
                      QR Deep-Link Nota
                    </p>
                    <p className="mt-0.5">
                      Otomatis tercetak di pojok kanan atas nota A4 untuk pelacakan cepat divisi.
                    </p>
                  </div>
                </div>
              )}

              {!isNonBilling && order.approval_token && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
                    <Link2 className="h-3.5 w-3.5" />
                    Link Self-ACC Pelanggan
                    <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 border border-emerald-200">
                      {approvalLabel[order.approval_status ?? 'belum'] ?? 'Belum dikirim'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-start gap-3">
                    {approvalQrDataUrl && (
                      <img
                        src={approvalQrDataUrl}
                        alt={`QR Self-ACC ${order.no_nota}`}
                        className="h-20 w-20 rounded border border-emerald-200 bg-white p-0.5 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-[11px] text-emerald-900 leading-snug">
                        Pelanggan dapat membuka link ini tanpa login untuk menyetujui desain atau
                        meminta revisi. ACC internal Admin tetap diperlukan sebelum cetak.
                      </p>
                      <p className="break-all rounded bg-white/70 px-2 py-1 font-mono text-[10px] text-emerald-900 border border-emerald-100">
                        {approvalUrl}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={handleCopyApprovalLink}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                        >
                          <Copy className="h-3 w-3" />
                          Salin Link
                        </button>
                        <a
                          href={approvalUrl ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Buka
                        </a>
                        {order.customer?.no_wa && (
                          <a
                            href={`https://wa.me/${order.customer.no_wa.replace(/[^0-9]/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(
                              `Halo ${order.customer.nama_pelanggan}, mohon tinjau dan setujui desain pesanan ${order.no_nota} melalui link berikut: ${approvalUrl}`,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                          >
                            <MessageCircle className="h-3 w-3" />
                            WhatsApp
                          </a>
                        )}
                      </div>
                      {order.approval_note && (
                        <p className="text-[11px] text-emerald-900">
                          Catatan pelanggan: <em>{order.approval_note}</em>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {order.items[0]?.file_preview_acc && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-1.5">Preview Desain Terakhir</h4>
                  <img
                    src={order.items[0].file_preview_acc}
                    alt={`Preview ${order.no_nota}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-44 object-cover rounded-lg border border-slate-200 bg-slate-100"
                  />
                </div>
              )}
              {order.waktu_serah_terima && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1">
                  <p className="font-semibold">Sudah Diserahkan ke Pelanggan</p>
                  <p>
                    Pengambil: {order.nama_pengambil} ({order.no_wa_pengambil})
                  </p>
                  {(order.kurir_nama || order.resi_pengiriman) && (
                    <p>Kurir/Resi: {order.kurir_nama ?? '-'}{order.resi_pengiriman ? ` / ${order.resi_pengiriman}` : ''}</p>
                  )}
                  <p>Waktu: {formatTanggal(order.waktu_serah_terima)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

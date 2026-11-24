import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  MessageSquareWarning,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  STATUS_BAYAR_LABEL,
  formatDesimal,
  formatRupiah,
  formatTanggalSingkat,
  statusBadgeStyle,
} from '../lib/format';

type ApprovalStatus = 'belum' | 'menunggu' | 'disetujui' | 'revisi';
type PaymentStatus = 'belum_lunas' | 'dp' | 'lunas';

interface PublicApprovalItem {
  id?: number;
  nama_item: string | null;
  product_name?: string;
  product_category?: string;
  qty: number;
  lebar_m: number | null;
  tinggi_m: number | null;
  luas_tagihan_m2?: number | null;
  satuan_hitung?: 'pcs' | 'klik';
  klik_total?: number | null;
  finishing_name?: string | null;
  harga_satuan?: number;
  harga_sebelum_diskon?: number;
  diskon_persen?: number;
  diskon_nominal?: number;
  subtotal?: number;
  file_preview_acc: string | null;
  status_produksi: string;
}

interface PublicApprovalPayment {
  id: number;
  tanggal: string;
  nominal: number;
  metode: string;
  keterangan: string | null;
  bukti_bayar: string | null;
  admin_name?: string | null;
}

interface PublicTagihanLain {
  no_nota: string;
  created_at: string;
  jatuh_tempo: string | null;
  total_tagihan: number;
  jumlah_dp: number;
  sisa_tagihan: number;
  status_bayar: PaymentStatus;
}

interface PublicApprovalOrder {
  no_nota: string;
  instansi: string;
  nama_pelanggan: string;
  status_nota: 'aktif' | 'batal';
  approval_status: ApprovalStatus;
  approval_note: string | null;
  approved_by?: string | null;
  catatan_desain: string | null;
  lampiran_briefing?: string | null;
  created_at: string;
  updated_at: string;
  total_tagihan: number;
  jumlah_dp: number;
  sisa_tagihan: number;
  status_bayar: PaymentStatus;
  diskon_persen: number;
  diskon_nominal: number;
  ppn_persen: number;
  ppn_nominal: number;
  pph23_persen: number;
  pph23_nominal: number;
  dpp: number;
  jatuh_tempo: string | null;
  items: PublicApprovalItem[];
  payments: PublicApprovalPayment[];
  tagihan_lain: PublicTagihanLain[];
  ringkasan_tagihan: {
    total_tagihan: number;
    sudah_dibayar: number;
    sisa_tagihan: number;
    sisa_tagihan_lain: number;
    total_harus_dibayar: number;
  };
}

interface SelfApprovalViewProps {
  token: string;
}

const STATUS_APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  belum: 'Belum dikirim',
  menunggu: 'Menunggu Persetujuan',
  disetujui: 'Disetujui',
  revisi: 'Diminta Revisi',
};

function detailItem(item: PublicApprovalItem): string {
  const bagian: string[] = [];
  if (item.product_category === 'meteran' && item.lebar_m && item.tinggi_m) {
    bagian.push(`${formatDesimal(item.lebar_m)} × ${formatDesimal(item.tinggi_m)} m`);
    if (item.luas_tagihan_m2) bagian.push(`${formatDesimal(item.luas_tagihan_m2)} m²`);
  } else if (item.satuan_hitung === 'klik' && item.klik_total) {
    bagian.push(`${formatDesimal(item.klik_total, 0)} klik`);
  } else {
    bagian.push('Satuan');
  }
  bagian.push(`${formatDesimal(item.qty, 0)} pcs`);
  return bagian.join(' · ');
}

export const SelfApprovalView: React.FC<SelfApprovalViewProps> = ({ token }) => {
  const [order, setOrder] = useState<PublicApprovalOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [nama, setNama] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/approval/${encodeURIComponent(token)}`);
      const data = (await res.json()) as { order?: PublicApprovalOrder; error?: string };
      if (!res.ok || !data.order) throw new Error(data.error ?? 'Link tidak valid.');
      setOrder(data.order);
      if (data.order.approval_status === 'menunggu' || data.order.approval_status === 'belum') {
        setDone(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data persetujuan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submit = async (decision: 'disetujui' | 'revisi') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/approval/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note, nama }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal mengirim keputusan.');
      setDone(data.message ?? 'Keputusan berhasil dikirim.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim keputusan.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Memuat pesanan...
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center">
          <p className="font-semibold text-rose-700">Tidak dapat membuka link</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const disetujui = order.approval_status === 'disetujui';
  const revisi = order.approval_status === 'revisi';
  const decided = disetujui || revisi || Boolean(done);
  const subtotalItem = order.items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);
  const sisaLain = Number(order.ringkasan_tagihan?.sisa_tagihan_lain ?? 0);
  const totalHarusDibayar = Number(
    order.ringkasan_tagihan?.total_harus_dibayar ?? order.sisa_tagihan + sisaLain,
  );
  const payments = order.payments ?? [];
  const tagihanLain = order.tagihan_lain ?? [];

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="rounded-xl bg-slate-900 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold">
                Reffo PrintFlow · Persetujuan &amp; Nota Elektronik
              </h1>
              <p className="text-xs text-slate-400">
                Portal Self-ACC pelanggan — bukti pesanan, konfirmasi desain, dan tagihan.
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">No. Nota</p>
              <p className="font-mono font-semibold">{order.no_nota}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Tanggal</p>
              <p className="font-semibold">{formatTanggalSingkat(order.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Instansi</p>
              <p className="font-semibold">{order.instansi}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Pelanggan</p>
              <p className="font-semibold">{order.nama_pelanggan}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="no-print rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">Bukti Pesanan &amp; Preview Desain</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              Status: {STATUS_APPROVAL_LABEL[order.approval_status]}
            </span>
          </div>

          {order.catatan_desain && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 whitespace-pre-line">
              {order.catatan_desain}
            </p>
          )}
          {order.lampiran_briefing && (
            <p className="mt-2 text-xs text-slate-600">
              Briefing tambahan:{' '}
              <a
                href={order.lampiran_briefing}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-700 underline"
              >
                Lihat lampiran
              </a>
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs sm:text-sm responsive-table">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Ukuran / Qty</th>
                  <th className="px-3 py-2 text-left">Finishing</th>
                  {disetujui && <th className="px-3 py-2 text-right">Harga Satuan</th>}
                  {disetujui && <th className="px-3 py-2 text-right">Subtotal</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items.map((item, idx) => (
                  <tr key={item.id ?? idx}>
                    <td className="px-3 py-2 font-medium text-slate-900" data-label="Item">
                      {item.nama_item || item.product_name || 'Item'}
                    </td>
                    <td className="px-3 py-2 text-slate-600" data-label="Ukuran / Qty">
                      {detailItem(item)}
                    </td>
                    <td className="px-3 py-2 text-slate-600" data-label="Finishing">
                      {item.finishing_name || '-'}
                    </td>
                    {disetujui && (
                      <td className="px-3 py-2 text-right font-mono" data-label="Harga Satuan">
                        {formatRupiah(item.harga_satuan ?? 0)}
                      </td>
                    )}
                    {disetujui && (
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900" data-label="Subtotal">
                        {formatRupiah(item.subtotal ?? 0)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!disetujui && (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Rincian harga dan total pembayaran akan otomatis ditampilkan setelah Anda menyetujui
              pesanan ini.
            </p>
          )}

          <div className="mt-4 space-y-3">
            {order.items.map((item, idx) => (
              <div key={`preview-${item.id ?? idx}`} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {item.nama_item || item.product_name || 'Item'}
                </p>
                {item.file_preview_acc ? (
                  <a href={item.file_preview_acc} target="_blank" rel="noreferrer">
                    <img
                      src={item.file_preview_acc}
                      alt={`Preview ${item.product_name ?? 'desain'}`}
                      className="mt-3 max-h-80 w-full rounded-lg border border-slate-200 object-contain bg-slate-50"
                    />
                  </a>
                ) : (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Preview desain belum diunggah oleh desainer.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {disetujui ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" /> Pesanan &amp; desain sudah disetujui
            </p>
            <p className="mt-1 text-sm">
              Terima kasih{order.approved_by ? `, ${order.approved_by}` : ''}. Nota elektronik di bawah
              ini menjadi bukti pesanan dan tagihan Anda.
            </p>
            {done && <p className="mt-2 text-sm">{done}</p>}
          </div>
        ) : revisi ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <MessageSquareWarning className="h-5 w-5" /> Revisi sedang diproses
            </p>
            <p className="mt-1 text-sm">
              Tim desain akan menghubungi Anda setelah revisi selesai. Setelah preview baru diunggah,
              halaman ini akan kembali membuka form persetujuan.
            </p>
            {order.approval_note && <p className="mt-2 text-sm">Catatan: {order.approval_note}</p>}
          </div>
        ) : decided ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
            {done}
          </div>
        ) : (
          <div className="no-print rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Beri Keputusan</h2>
            <p className="mt-1 text-xs text-slate-500">
              Periksa nama item, ukuran, finishing, dan preview desain sebelum menyetujui. Setelah
              disetujui, rincian harga dan nota elektronik akan ditampilkan otomatis.
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">
                Nama Anda (opsional)
                <input
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Nama PIC / pelanggan"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Catatan revisi (wajib bila revisi)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Contoh: warna logo terlalu gelap"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => submit('disetujui')}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                Setujui &amp; Tampilkan Nota
              </button>
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => submit('revisi')}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 cursor-pointer"
              >
                <MessageSquareWarning className="h-4 w-4" />
                Minta Revisi
              </button>
            </div>
          </div>
        )}

        {disetujui && (
          <>
            <div className="print-sheet rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-700" />
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900">
                      Nota Elektronik
                    </h2>
                    <p className="text-xs text-slate-500">{order.no_nota}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeStyle(order.status_bayar)}`}
                  >
                    {STATUS_BAYAR_LABEL[order.status_bayar]}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Jatuh tempo: {formatTanggalSingkat(order.jatuh_tempo)}
                  </p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs sm:text-sm responsive-table">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Harga Satuan</th>
                      <th className="px-3 py-2 text-right">Diskon</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.items.map((item, idx) => (
                      <tr key={`invoice-${item.id ?? idx}`}>
                        <td className="px-3 py-2" data-label="Item">
                          <p className="font-medium text-slate-900">
                            {item.nama_item || item.product_name || 'Item'}
                          </p>
                          <p className="text-[11px] text-slate-500">{detailItem(item)}</p>
                        </td>
                        <td className="px-3 py-2 text-right font-mono" data-label="Qty">
                          {formatDesimal(item.qty, 0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono" data-label="Harga Satuan">
                          {formatRupiah(item.harga_satuan ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono" data-label="Diskon">
                          {item.diskon_nominal ? formatRupiah(item.diskon_nominal) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold" data-label="Subtotal">
                          {formatRupiah(item.subtotal ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p>
                    Disetujui oleh:{' '}
                    <span className="font-semibold text-slate-900">
                      {order.approved_by || order.nama_pelanggan}
                    </span>
                  </p>
                  <p className="mt-1">Waktu: {formatTanggalSingkat(order.updated_at)}</p>
                  {order.approval_note && <p className="mt-1">Catatan: {order.approval_note}</p>}
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Subtotal item</span>
                    <span className="font-mono">{formatRupiah(subtotalItem)}</span>
                  </div>
                  {order.diskon_nominal > 0 && (
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">
                        Diskon nota ({formatDesimal(order.diskon_persen)}%)
                      </span>
                      <span className="font-mono text-rose-700">
                        −{formatRupiah(order.diskon_nominal)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">DPP</span>
                    <span className="font-mono">{formatRupiah(order.dpp)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">PPN ({formatDesimal(order.ppn_persen)}%)</span>
                    <span className="font-mono">+{formatRupiah(order.ppn_nominal)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">
                      PPh 23 ({formatDesimal(order.pph23_persen)}%)
                    </span>
                    <span className="font-mono text-rose-700">
                      −{formatRupiah(order.pph23_nominal)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold text-slate-900">
                    <span>Total Tagihan</span>
                    <span className="font-mono">{formatRupiah(order.total_tagihan)}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-emerald-700">
                    <span>Sudah dibayar</span>
                    <span className="font-mono">−{formatRupiah(order.jumlah_dp)}</span>
                  </div>
                  <div className="flex justify-between gap-4 rounded-lg bg-blue-50 px-3 py-2 font-semibold text-blue-900">
                    <span>Sisa Tagihan Nota Ini</span>
                    <span className="font-mono">{formatRupiah(order.sisa_tagihan)}</span>
                  </div>
                </div>
              </div>

              {payments.length > 0 && (
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Riwayat Pembayaran</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs responsive-table">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left">Tanggal</th>
                          <th className="px-3 py-2 text-left">Metode</th>
                          <th className="px-3 py-2 text-left">Keterangan</th>
                          <th className="px-3 py-2 text-right">Nominal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="px-3 py-2" data-label="Tanggal">
                              {formatTanggalSingkat(payment.tanggal)}
                            </td>
                            <td className="px-3 py-2" data-label="Metode">
                              {payment.metode}
                            </td>
                            <td className="px-3 py-2 text-slate-500" data-label="Keterangan">
                              {payment.keterangan || payment.admin_name || '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono" data-label="Nominal">
                              {formatRupiah(payment.nominal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="no-print mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">
                  Simpan atau cetak nota ini sebagai bukti pesanan dan tagihan.
                </p>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Cetak / Simpan PDF
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <h2 className="font-semibold text-slate-900">Tagihan Sebelumnya yang Belum Selesai</h2>
                </div>
                <span className="text-xs text-slate-500">
                  {tagihanLain.length} nota · {formatRupiah(sisaLain)}
                </span>
              </div>

              {tagihanLain.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm responsive-table">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">No. Nota</th>
                        <th className="px-3 py-2 text-left">Jatuh Tempo</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Sudah Dibayar</th>
                        <th className="px-3 py-2 text-right">Sisa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tagihanLain.map((row) => (
                        <tr key={row.no_nota}>
                          <td className="px-3 py-2 font-medium text-slate-900" data-label="No. Nota">
                            {row.no_nota}
                          </td>
                          <td className="px-3 py-2 text-slate-600" data-label="Jatuh Tempo">
                            {formatTanggalSingkat(row.jatuh_tempo ?? row.created_at)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono" data-label="Total">
                            {formatRupiah(row.total_tagihan)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700" data-label="Sudah Dibayar">
                            {formatRupiah(row.jumlah_dp)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-rose-700" data-label="Sisa">
                            {formatRupiah(row.sisa_tagihan)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Tidak ada tagihan lain yang belum selesai untuk pelanggan atau instansi ini.
                </p>
              )}

              <div className="mt-4 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span className="font-semibold">Total yang harus dibayar saat ini</span>
                <span className="font-mono font-bold">{formatRupiah(totalHarusDibayar)}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Sudah termasuk sisa nota ini {formatRupiah(order.sisa_tagihan)} dan tagihan lama
                {formatRupiah(sisaLain)}.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

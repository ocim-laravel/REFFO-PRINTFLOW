import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CalendarClock, Download, Play, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import type { WhatsappOutbox, WhatsAppEvent } from '../../types';
import { apiFetch, getApiToken } from '../../lib/api';
import { formatTanggalSingkat } from '../../lib/format';

interface OwnerIntegrationsViewProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

interface TiffHasil {
  order_id: number;
  item_id: number;
  no_nota: string;
  file: string;
  dihapus: boolean;
  alasan: string | null;
}

interface PajakReklameRow {
  instansi_id: number;
  nama_instansi: string;
  pajak_reklame_expired: string | null;
  jatuh_tempo_berikutnya: string;
  tahun: number;
  hari_tersisa: number;
  no_wa: string;
  nama_pelanggan: string | null;
}

interface PajakReklameResponse {
  hari: number;
  items: PajakReklameRow[];
  instansis: PajakReklameRow[];
  total_terdaftar: number;
  gateway_terkonfigurasi: boolean;
}

const EVENT_LABEL: Record<WhatsAppEvent, string> = {
  nota_dibuat: 'Nota dibuat',
  preview_siap_acc: 'Preview siap ACC',
  siap_diambil: 'Siap diambil',
  piutang_jatuh_tempo: 'Pengingat jatuh tempo',
  pajak_reklame_jatuh_tempo: 'Pengingat pajak reklame',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  terkirim: 'Terkirim',
  gagal: 'Gagal',
};

export const OwnerIntegrationsView: React.FC<OwnerIntegrationsViewProps> = ({ onNotify }) => {
  const [outbox, setOutbox] = useState<WhatsappOutbox[]>([]);
  const [gateway, setGateway] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hariPengingat, setHariPengingat] = useState('7');
  const [retensiHari, setRetensiHari] = useState('90');
  const [tiffHasil, setTiffHasil] = useState<TiffHasil[]>([]);
  const [memproses, setMemproses] = useState(false);
  const [pajakData, setPajakData] = useState<PajakReklameResponse | null>(null);
  const [pajakHari, setPajakHari] = useState('30');
  const [pajakInstansiId, setPajakInstansiId] = useState('');
  const [pajakTanggal, setPajakTanggal] = useState('');

  const loadPajak = useCallback(async (hari: string) => {
    try {
      const qs = new URLSearchParams({ hari });
      const res = await apiFetch<PajakReklameResponse>(`/api/owner/pajak-reklame?${qs.toString()}`);
      setPajakData(res);
      const pilihan =
        res.instansis.find((i) => String(i.instansi_id) === pajakInstansiId) ?? res.instansis[0];
      setPajakInstansiId(pilihan ? String(pilihan.instansi_id) : '');
      setPajakTanggal(pilihan?.pajak_reklame_expired ?? '');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat pajak reklame.');
    }
  }, [onNotify, pajakInstansiId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        outbox: WhatsappOutbox[];
        gateway_terkonfigurasi: boolean;
        webhook_url: string | null;
      }>('/api/owner/whatsapp-outbox');
      setOutbox(res.outbox);
      setGateway(res.gateway_terkonfigurasi);
      setWebhookUrl(res.webhook_url);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat outbox WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPajak(pajakHari);
  }, [loadPajak, pajakHari]);

  const kirimPengingat = async () => {
    setMemproses(true);
    try {
      const res = await apiFetch<{ dibuat: number }>('/api/owner/whatsapp/reminder', {
        method: 'POST',
        body: JSON.stringify({ hari: Number(hariPengingat) }),
      });
      onNotify('success', `${res.dibuat} pengingat piutang baru dimasukkan ke antrean.`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membuat pengingat.');
    } finally {
      setMemproses(false);
    }
  };

  const pilihInstansiPajak = (id: string) => {
    setPajakInstansiId(id);
    const dipilih = pajakData?.instansis.find((i) => String(i.instansi_id) === id);
    setPajakTanggal(dipilih?.pajak_reklame_expired ?? '');
  };

  const simpanPajak = async () => {
    if (!pajakInstansiId) {
      onNotify('error', 'Pilih instansi terlebih dahulu.');
      return;
    }
    setMemproses(true);
    try {
      await apiFetch(`/api/owner/pajak-reklame/${pajakInstansiId}`, {
        method: 'PUT',
        body: JSON.stringify({ pajak_reklame_expired: pajakTanggal }),
      });
      onNotify('success', 'Masa berlaku pajak reklame berhasil disimpan.');
      await loadPajak(pajakHari);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan pajak reklame.');
    } finally {
      setMemproses(false);
    }
  };

  const kirimPajak = async () => {
    setMemproses(true);
    try {
      const res = await apiFetch<{ dibuat: number; dilewati: number }>(
        '/api/owner/whatsapp/reminder-reklame',
        {
          method: 'POST',
          body: JSON.stringify({ hari: Number(pajakHari) }),
        },
      );
      onNotify(
        'success',
        `${res.dibuat} pengingat pajak reklame masuk antrean. ${res.dilewati} instansi tanpa nomor WA dilewati.`,
      );
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membuat pengingat pajak reklame.');
    } finally {
      setMemproses(false);
    }
  };

  const retry = async (row: WhatsappOutbox) => {
    try {
      await apiFetch(`/api/owner/whatsapp-outbox/${row.id}/retry`, { method: 'POST', body: JSON.stringify({}) });
      onNotify('success', `Pesan ${EVENT_LABEL[row.event]} diantrekan ulang.`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengantrekan ulang pesan.');
    }
  };

  const previewTiff = async () => {
    setMemproses(true);
    try {
      const qs = new URLSearchParams({ hari: retensiHari });
      const res = await apiFetch<{ kandidat: TiffHasil[] }>(`/api/owner/maintenance/tiff-preview?${qs.toString()}`);
      setTiffHasil(res.kandidat);
      onNotify('success', `${res.kandidat.length} file TIFF memenuhi kriteria pembersihan.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mempreview pembersihan TIFF.');
    } finally {
      setMemproses(false);
    }
  };

  const jalankanTiff = async () => {
    if (!window.confirm(`Hapus TIFF lama (> ${retensiHari} hari) yang terverifikasi? Preview dan file master tidak dihapus.`)) return;
    setMemproses(true);
    try {
      const res = await apiFetch<{ hasil: TiffHasil[]; dihapus: number }>('/api/owner/maintenance/tiff-clean', {
        method: 'POST',
        body: JSON.stringify({ hari: Number(retensiHari) }),
      });
      setTiffHasil(res.hasil);
      onNotify('success', `${res.dihapus} file TIFF berhasil dihapus.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menjalankan pembersihan TIFF.');
    } finally {
      setMemproses(false);
    }
  };

  const unduh = (type: string) => {
    const qs = new URLSearchParams({ type });
    const token = getApiToken();
    if (token) qs.set('token', token);
    window.open(`/api/owner/reports/export?${qs.toString()}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Integrasi & Pemeliharaan</h2>
          <p className="text-sm text-slate-500">Antrean WhatsApp, pengingat piutang &amp; pajak reklame, ekspor data, dan pembersihan TIFF lama.</p>
        </div>
        <button type="button" onClick={() => load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900 text-sm">WhatsApp Gateway</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {gateway ? `Webhook aktif: ${webhookUrl}` : 'Webhook belum dikonfigurasi. Pesan tetap tersimpan sebagai antrean (pending).'}
              </p>
            </div>
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${gateway ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {gateway ? 'Terhubung' : 'Belum Terkonfigurasi'}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-slate-600">
              Pengingat jatuh tempo dalam
              <input type="number" min="0" max="30" value={hariPengingat} onChange={(e) => setHariPengingat(e.target.value)} className="mt-1 block w-24 rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
            </label>
            <span className="pb-2 text-xs text-slate-500">hari</span>
            <button type="button" onClick={kirimPengingat} disabled={memproses} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer">
              <BellRing className="h-3.5 w-3.5" />
              Buat Pengingat
            </button>
          </div>
          <div className="mt-4 overflow-x-auto max-h-80">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Event</th>
                  <th className="px-3 py-2 text-left">No. Tujuan</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Waktu</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {outbox.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700">{EVENT_LABEL[row.event] ?? row.event}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{row.no_wa}</td>
                    <td className="px-3 py-2">
                      <span className={`font-semibold ${row.status === 'terkirim' ? 'text-emerald-700' : row.status === 'gagal' ? 'text-rose-700' : 'text-amber-700'}`}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                      {row.last_error && <span className="mt-0.5 block max-w-[260px] truncate text-[10px] text-slate-400" title={row.last_error}>{row.last_error}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatTanggalSingkat(row.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => retry(row)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                        <Send className="h-3 w-3" />
                        Ulangi
                      </button>
                    </td>
                  </tr>
                ))}
                {outbox.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Belum ada pesan dalam antrean.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 text-sm">Ekspor Data (CSV Excel-Friendly)</h3>
            <p className="mt-0.5 text-xs text-slate-500">File berkode UTF-8 BOM agar langsung terbaca di Excel.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ['po', 'Purchase Order'],
                ['supplier', 'Supplier'],
                ['hutang', 'Hutang'],
                ['audit', 'Audit Log'],
                ['production', 'Produksi'],
                ['stock', 'Stok'],
              ] as const).map(([type, label]) => (
                <button key={type} type="button" onClick={() => unduh(type)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Download className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900 text-sm">Auto-Clean TIFF</h3>
            <p className="mt-0.5 text-xs text-slate-500">Hapus hanya file cetak TIFF terverifikasi pada nota yang sudah diserahkan. Preview & master dipertahankan.</p>
            <div className="mt-3 flex items-end gap-2">
              <label className="text-xs font-medium text-slate-600">
                Retensi (hari)
                <input type="number" min="1" value={retensiHari} onChange={(e) => setRetensiHari(e.target.value)} className="mt-1 block w-24 rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
              </label>
              <button type="button" onClick={previewTiff} disabled={memproses} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer">
                Preview
              </button>
              <button type="button" onClick={jalankanTiff} disabled={memproses} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 cursor-pointer">
                <Play className="h-3 w-3" />
                Jalankan
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-amber-600" />
              <h3 className="font-display text-sm font-semibold text-slate-900">Pajak Reklame Tahunan</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Simpan tanggal berlaku tiap instansi, lalu antrekan pengingat otomatis H-30 (atau sesuai jendela hari).
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-slate-600">
              Jendela (hari)
              <input
                type="number"
                min="0"
                max="365"
                value={pajakHari}
                onChange={(e) => setPajakHari(e.target.value)}
                className="mt-1 block w-24 rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => loadPajak(pajakHari)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Segarkan
            </button>
            <button
              type="button"
              onClick={kirimPajak}
              disabled={memproses}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60 cursor-pointer"
            >
              <BellRing className="h-3.5 w-3.5" />
              Buat Pengingat
            </button>
            <button
              type="button"
              onClick={() => unduh('reklame')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Ekspor CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-1 space-y-3">
            <label className="block text-xs font-medium text-slate-700">
              Instansi
              <select
                value={pajakInstansiId}
                onChange={(e) => pilihInstansiPajak(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
              >
                {(pajakData?.instansis ?? []).map((row) => (
                  <option key={row.instansi_id} value={row.instansi_id}>
                    {row.nama_instansi}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Tanggal Berlaku / Jatuh Tempo
              <input
                type="date"
                value={pajakTanggal}
                onChange={(e) => setPajakTanggal(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={simpanPajak}
              disabled={memproses || !pajakInstansiId}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              Simpan Tanggal
            </button>
            <p className="text-[11px] text-slate-500">
              Koordinat WA diambil dari PIC instansi. Jika belum ada nomor, pesan tidak dibuat dan
              ditampilkan sebagai terlewati.
            </p>
          </div>

          <div className="overflow-x-auto lg:col-span-2">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Instansi</th>
                  <th className="px-3 py-2 text-left">Jatuh Tempo</th>
                  <th className="px-3 py-2 text-right">Sisa</th>
                  <th className="px-3 py-2 text-left">No WA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(pajakData?.items ?? []).map((row) => (
                  <tr key={row.instansi_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">{row.nama_instansi}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {formatTanggalSingkat(row.jatuh_tempo_berikutnya)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">
                      {row.hari_tersisa} hari
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{row.no_wa || '-'}</td>
                  </tr>
                ))}
                {(pajakData?.items.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Tidak ada pajak reklame yang jatuh tempo dalam jendela tersebut.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">
              {pajakData?.total_terdaftar ?? 0} instansi memiliki tanggal pajak reklame tersimpan.
            </p>
          </div>
        </div>
      </div>

      {tiffHasil.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 text-sm">Hasil Pemeriksaan TIFF</h3>
            <button type="button" onClick={() => setTiffHasil([])} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-700 cursor-pointer">
              <Trash2 className="h-3 w-3" />
              Tutup
            </button>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">No Nota</th>
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tiffHasil.map((row, idx) => (
                  <tr key={`${row.item_id}-${idx}`}>
                    <td className="px-3 py-2 font-mono">{row.no_nota}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{row.file}</td>
                    <td className="px-3 py-2">{row.dihapus ? 'Dihapus' : 'Diperiksa'}</td>
                    <td className="px-3 py-2 text-slate-500">{row.alasan ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

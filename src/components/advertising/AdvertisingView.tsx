import React, { useMemo, useState } from 'react';
import { ArrowRight, MapPin } from 'lucide-react';
import type { AdvertisingSpk, SpkFieldStatus } from '../../types';
import { STATUS_SPK_LABEL, formatTanggalSingkat, statusBadgeStyle } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface AdvertisingViewProps {
  spks: AdvertisingSpk[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const NEXT_STATUS: Record<SpkFieldStatus, SpkFieldStatus | null> = {
  antrean: 'perakitan',
  perakitan: 'pemasangan',
  pemasangan: 'selesai',
  selesai: null,
};

const NEXT_LABEL: Record<SpkFieldStatus, string> = {
  antrean: 'Mulai Perakitan',
  perakitan: 'Mulai Pemasangan',
  pemasangan: 'Tandai Selesai Terpasang',
  selesai: 'Selesai',
};

export const AdvertisingView: React.FC<AdvertisingViewProps> = ({
  spks,
  loading,
  onRefresh,
  onNotify,
}) => {
  const [filter, setFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return spks;
    return spks.filter((s) => s.status_lapangan === filter);
  }, [spks, filter]);

  const handleAdvance = async (spk: AdvertisingSpk) => {
    const next = NEXT_STATUS[spk.status_lapangan];
    if (!next) return;
    setBusyId(spk.id);
    try {
      await apiFetch(`/api/advertising/spks/${spk.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status_lapangan: next }),
      });
      await onRefresh();
      onNotify('success', `Progres SPK ${spk.no_nota} diperbarui: ${STATUS_SPK_LABEL[next]}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memperbarui status SPK.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented Status Filter */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              { key: '', label: `Semua (${spks.length})` },
              { key: 'antrean', label: 'Antrean' },
              { key: 'perakitan', label: 'Perakitan' },
              { key: 'pemasangan', label: 'Pemasangan' },
              { key: 'selesai', label: 'Selesai' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Mode Non-Billing: Hanya spesifikasi teknis lapangan &amp; lokasi pemasangan.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-sm font-semibold text-slate-800">Tidak ada SPK pada status ini</p>
          <p className="mt-1 text-xs text-slate-500">
            SPK lapangan muncul otomatis bila Admin mencentang SPK Advertising saat membuat nota.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Nota &amp; Instansi</th>
                <th className="text-left px-4 py-3">Pekerjaan &amp; Konstruksi</th>
                <th className="text-left px-4 py-3">Lokasi Pemasangan</th>
                <th className="text-left px-4 py-3">Status Lapangan</th>
                <th className="text-right px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((spk) => {
                const next = NEXT_STATUS[spk.status_lapangan];
                return (
                  <tr key={spk.id} className="hover:bg-slate-50/70">
                    <td data-label="Nota" className="px-4 py-3">
                      <p className="font-mono font-semibold text-slate-900">{spk.no_nota}</p>
                      <p className="text-xs text-slate-600">
                        {spk.nama_pelanggan} · {spk.instansi}
                      </p>
                      {spk.deadline && (
                        <p className="text-xs text-amber-700 font-medium">
                          Target: {formatTanggalSingkat(spk.deadline)}
                        </p>
                      )}
                    </td>
                    <td data-label="Konstruksi" className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{spk.jenis_pekerjaan}</p>
                      <p className="text-xs text-slate-600 font-mono">{spk.ukuran_konstruksi}</p>
                      {spk.catatan_teknis && (
                        <p className="text-xs text-slate-500 mt-0.5">{spk.catatan_teknis}</p>
                      )}
                    </td>
                    <td data-label="Lokasi" className="px-4 py-3 text-slate-700">
                      <span className="inline-flex items-start gap-1 text-xs">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                        {spk.lokasi_pasang}
                      </span>
                    </td>
                    <td data-label="Status" className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusBadgeStyle(
                          spk.status_lapangan,
                        )}`}
                      >
                        {STATUS_SPK_LABEL[spk.status_lapangan]}
                      </span>
                    </td>
                    <td data-label="Aksi" className="px-4 py-3 text-right">
                      {next ? (
                        <button
                          type="button"
                          disabled={busyId === spk.id}
                          onClick={() => handleAdvance(spk)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {NEXT_LABEL[spk.status_lapangan]}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="text-xs font-medium text-emerald-700">Selesai</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

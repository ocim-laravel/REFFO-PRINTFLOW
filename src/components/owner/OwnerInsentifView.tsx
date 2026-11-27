import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Save, Wallet } from 'lucide-react';
import type { InsentifJenis, InsentifRate, InsentifRole } from '../../types';
import { ROLE_LABEL, formatDesimal, formatRupiah } from '../../lib/format';
import { apiFetch, downloadAuthorized } from '../../lib/api';

interface InsentifStafRow {
  user_id: number;
  nama: string;
  role: InsentifRole;
  total_item: number;
  item_selesai: number;
  job_selesai: number;
  tarif_item: number;
  tarif_job: number;
  insentif_item: number;
  insentif_job: number;
  total_insentif: number;
}

interface InsentifResponse {
  dari: string | null;
  sampai: string | null;
  rates: InsentifRate[];
  staf: InsentifStafRow[];
  ringkasan: {
    jumlah_staf: number;
    total_item: number;
    total_item_selesai: number;
    total_job_selesai: number;
    total_insentif: number;
  };
}

interface OwnerInsentifViewProps {
  dari: string;
  sampai: string;
  onChangeFilter: (dari: string, sampai: string) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const ROLES: InsentifRole[] = ['desainer', 'operator_cetak', 'finishing'];
const JENIS_LABEL: Record<InsentifJenis, string> = {
  per_item: 'Per Item Selesai',
  per_job: 'Per Nota/Job Selesai',
};

const tarifAwal: Record<InsentifRole, Record<InsentifJenis, string>> = {
  desainer: { per_item: '0', per_job: '0' },
  operator_cetak: { per_item: '0', per_job: '0' },
  finishing: { per_item: '0', per_job: '0' },
};

export const OwnerInsentifView: React.FC<OwnerInsentifViewProps> = ({
  dari,
  sampai,
  onChangeFilter,
  onNotify,
}) => {
  const [data, setData] = useState<InsentifResponse | null>(null);
  const [tarif, setTarif] = useState(tarifAwal);
  const [loading, setLoading] = useState(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dari) qs.set('dari', dari);
      if (sampai) qs.set('sampai', sampai);
      const res = await apiFetch<InsentifResponse>(`/api/owner/kpi/insentif?${qs.toString()}`);
      setData(res);
      const next = {
        desainer: { per_item: '0', per_job: '0' },
        operator_cetak: { per_item: '0', per_job: '0' },
        finishing: { per_item: '0', per_job: '0' },
      };
      for (const rate of res.rates) {
        if (next[rate.role] && JENIS_LABEL[rate.jenis]) {
          next[rate.role][rate.jenis] = String(rate.nominal);
        }
      }
      setTarif(next);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat KPI & insentif.');
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const simpanTarif = async () => {
    setMenyimpan(true);
    try {
      const rates = ROLES.flatMap((role) =>
        (Object.keys(JENIS_LABEL) as InsentifJenis[]).map((jenis) => ({
          role,
          jenis,
          nominal: Number(tarif[role][jenis] ?? 0),
        })),
      );
      await apiFetch('/api/owner/kpi/insentif/rates', {
        method: 'PUT',
        body: JSON.stringify({ rates }),
      });
      onNotify('success', 'Tarif insentif berhasil disimpan.');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan tarif insentif.');
    } finally {
      setMenyimpan(false);
    }
  };

  const unduh = async () => {
    const qs = new URLSearchParams({ type: 'insentif' });
    if (dari) qs.set('dari', dari);
    if (sampai) qs.set('sampai', sampai);
    try {
      await downloadAuthorized(`/api/owner/reports/export?${qs.toString()}`, 'reffo-insentif.csv');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengekspor insentif.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">KPI &amp; Insentif Tim</h2>
          <p className="text-sm text-slate-500">
            Insentif dihitung otomatis dari item dan nota yang sudah melewati tahap selesai tiap divisi.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-600">
            Dari
            <input
              type="date"
              value={dari}
              onChange={(e) => onChangeFilter(e.target.value, sampai)}
              className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Sampai
            <input
              type="date"
              value={sampai}
              onChange={(e) => onChangeFilter(dari, e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
            />
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
          <button
            type="button"
            onClick={unduh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Ekspor CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Staf Dinilai', value: formatDesimal(data?.ringkasan.jumlah_staf ?? 0, 0) },
          { label: 'Item Selesai', value: formatDesimal(data?.ringkasan.total_item_selesai ?? 0, 0) },
          { label: 'Nota/Job Selesai', value: formatDesimal(data?.ringkasan.total_job_selesai ?? 0, 0) },
          { label: 'Total Insentif', value: formatRupiah(data?.ringkasan.total_insentif ?? 0) },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{card.label}</p>
            <p className="mt-1 font-display text-xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <Wallet className="h-4 w-4 text-blue-700" />
          <h3 className="font-display text-sm font-semibold text-slate-900">Rekap Insentif per Staf</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Staf</th>
                <th className="px-3 py-3 text-left">Divisi</th>
                <th className="px-3 py-3 text-right">Item</th>
                <th className="px-3 py-3 text-right">Item Selesai</th>
                <th className="px-3 py-3 text-right">Job Selesai</th>
                <th className="px-3 py-3 text-right">Insentif Item</th>
                <th className="px-3 py-3 text-right">Insentif Job</th>
                <th className="px-4 py-3 text-right">Total Insentif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.staf ?? []).map((row) => (
                <tr key={row.user_id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.nama}</td>
                  <td className="px-3 py-2.5 text-slate-600">{ROLE_LABEL[row.role]}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.total_item}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{row.item_selesai}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.job_selesai}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.insentif_item)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatRupiah(row.insentif_job)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700">
                    {formatRupiah(row.total_insentif)}
                  </td>
                </tr>
              ))}
              {(data?.staf.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">
                    Belum ada staf aktif pada divisi yang dinilai.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">Tarif Insentif (Dapat Diubah Owner)</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Tarif berlaku untuk seluruh periode yang sedang dilihat. Perubahan tercatat di audit log.
            </p>
          </div>
          <button
            type="button"
            onClick={simpanTarif}
            disabled={menyimpan}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            Simpan Tarif
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Divisi</th>
                <th className="px-3 py-3 text-right">Tarif per Item (Rp)</th>
                <th className="px-3 py-3 text-right">Tarif per Nota/Job (Rp)</th>
                <th className="px-4 py-3 text-left">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROLES.map((role) => (
                <tr key={role}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{ROLE_LABEL[role]}</td>
                  <td className="px-3 py-2.5 text-right">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={tarif[role].per_item}
                      onChange={(e) =>
                        setTarif((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], per_item: e.target.value },
                        }))
                      }
                      className="ml-auto w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={tarif[role].per_job}
                      onChange={(e) =>
                        setTarif((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], per_job: e.target.value },
                        }))
                      }
                      className="ml-auto w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {JENIS_LABEL.per_item} + {JENIS_LABEL.per_job}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

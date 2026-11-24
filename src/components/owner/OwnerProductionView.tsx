import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import type { PrintBatch, SupplyItem } from '../../types';
import { formatDesimal } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface OperatorStat {
  user_id: number;
  nama: string;
  total_job: number;
  sukses: number;
  luas_sukses_m2: number;
  luas_gagal_m2: number;
  total_klik: number;
  estimasi_tinta_ml: number;
}

interface MachineStat {
  machine_id: number;
  kode_mesin: string;
  nama_mesin: string;
  jenis: string;
  aktif: boolean;
  total_job: number;
  luas_cetak_m2: number;
  luas_gagal_m2: number;
  total_klik: number;
  estimasi_tinta_ml: number;
}

interface LowSupply extends SupplyItem {
  selisih: number;
}

interface ProductionBatch extends PrintBatch {
  machine_name?: string | null;
  operator_name?: string | null;
}

interface KpiResponse {
  operatorStats: OperatorStat[];
  machineStats: MachineStat[];
  lowSupplies: LowSupply[];
  batches: ProductionBatch[];
}

interface OwnerProductionViewProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export const OwnerProductionView: React.FC<OwnerProductionViewProps> = ({ onNotify }) => {
  const [data, setData] = useState<KpiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<KpiResponse>('/api/owner/reports/kpi');
      setData(res);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat KPI produksi.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const totalJob = (data?.machineStats ?? []).reduce((a, m) => a + m.total_job, 0);
  const totalKlik = (data?.operatorStats ?? []).reduce((a, o) => a + o.total_klik, 0);
  const totalTinta = (data?.operatorStats ?? []).reduce((a, o) => a + o.estimasi_tinta_ml, 0);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Total Job Cetak</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900">{totalJob}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Total Klik A3+</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700">{totalKlik}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Estimasi Tinta Terpakai</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900">
            {formatDesimal(totalTinta)} ml
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Stok Menipis</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-600">
            {data?.lowSupplies.length ?? 0}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan KPI
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-700" />
          <h2 className="font-display text-sm font-semibold text-slate-900">KPI Operator Cetak</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Operator</th>
                <th className="text-right px-3 py-3">Job</th>
                <th className="text-right px-3 py-3">Sukses</th>
                <th className="text-right px-3 py-3">Luas Sukses</th>
                <th className="text-right px-3 py-3">Luas Gagal</th>
                <th className="text-right px-3 py-3">Total Klik</th>
                <th className="text-right px-4 py-3">Est. Tinta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.operatorStats ?? []).map((o) => (
                <tr key={o.user_id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{o.nama}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{o.total_job}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{o.sukses}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatDesimal(o.luas_sukses_m2)} m²
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-rose-700">
                    {formatDesimal(o.luas_gagal_m2)} m²
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-blue-700">{o.total_klik}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatDesimal(o.estimasi_tinta_ml)} ml
                  </td>
                </tr>
              ))}
              {(data?.operatorStats.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                    Belum ada operator cetak yang aktif.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="font-display text-sm font-semibold text-slate-900">Kinerja per Mesin</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Mesin</th>
                <th className="text-right px-3 py-3">Job</th>
                <th className="text-right px-3 py-3">Luas Cetak</th>
                <th className="text-right px-3 py-3">Gagal</th>
                <th className="text-right px-3 py-3">Klik</th>
                <th className="text-right px-4 py-3">Est. Tinta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.machineStats ?? []).map((m) => (
                <tr key={m.machine_id}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">
                      {m.kode_mesin} · {m.nama_mesin}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {m.jenis} · {m.aktif ? 'Aktif' : 'Nonaktif'}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{m.total_job}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatDesimal(m.luas_cetak_m2)} m²
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-rose-700">
                    {formatDesimal(m.luas_gagal_m2)} m²
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-blue-700">{m.total_klik}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatDesimal(m.estimasi_tinta_ml)} ml
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Riwayat Batch Nesting
          </h2>
          <div className="mt-3 space-y-2">
            {(data?.batches ?? []).slice(0, 8).map((b) => (
              <div
                key={b.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">{b.kode_batch}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      b.status === 'diproses'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">
                  {b.machine_name ?? `Mesin #${b.machine_id}`} · {b.operator_name ?? '-'} ·{' '}
                  {b.item_ids.length} item
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  Lebar {b.lebar_gabungan_m} m · Tarik {b.panjang_tarik_m} m · Waste{' '}
                  {b.luas_waste_m2} m²
                </p>
              </div>
            ))}
            {(data?.batches.length ?? 0) === 0 && (
              <p className="text-xs text-slate-500">Belum ada batch nesting yang dihitung.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Peringatan Stok Tinta &amp; Bahan
          </h2>
          <div className="mt-3 space-y-2">
            {(data?.lowSupplies ?? []).map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{s.nama}</p>
                  <p className="font-mono text-[11px]">
                    Sisa {s.stok} {s.satuan} · Minimal {s.stok_minimum} {s.satuan} · Selisih{' '}
                    {s.selisih} {s.satuan}
                  </p>
                </div>
              </div>
            ))}
            {(data?.lowSupplies.length ?? 0) === 0 && (
              <p className="text-xs text-slate-500">Semua stok berada di atas batas minimum.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Package } from 'lucide-react';
import type { MaterialRoll, Product } from '../../types';
import { formatDesimal, formatRupiah, formatTanggal } from '../../lib/format';

export interface OwnerDashboardData {
  statistik: {
    desain: number;
    cetak: number;
    finishing: number;
    advertising: number;
    siap_diambil: number;
  };
  deadlines: Array<{
    id: number;
    no_nota: string;
    instansi: string;
    pic: string;
    deadline: string;
    terlambat: boolean;
    sisa_hari: number;
  }>;
  stok_kritis?: {
    rolls: MaterialRoll[];
    products: Product[];
  };
  rekap: Array<{
    instansi: string;
    total_nota: number;
    omzet: number;
    piutang: number;
    pics: Array<{ nama: string; total_nota: number; omzet: number; piutang: number }>;
  }>;
  total_rekap: {
    nota: number;
    omzet: number;
    piutang: number;
  };
}

interface OwnerDashboardViewProps {
  data: OwnerDashboardData | null;
  loading: boolean;
  onInspectOrderId: (id: number) => void;
  onOpenSettings?: () => void;
}

export const OwnerDashboardView: React.FC<OwnerDashboardViewProps> = ({
  data,
  loading,
  onInspectOrderId,
  onOpenSettings,
}) => {
  const [expandedInstansi, setExpandedInstansi] = useState<string | null>(null);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const pipelineCards = [
    { label: 'Antrean & Proses Desain', value: data.statistik.desain },
    { label: 'Antrean & Proses Cetak', value: data.statistik.cetak },
    { label: 'Antrean Finishing', value: data.statistik.finishing },
    { label: 'SPK Advertising Aktif', value: data.statistik.advertising },
    { label: 'Siap Diambil Pelanggan', value: data.statistik.siap_diambil },
  ];

  return (
    <div className="space-y-6">
      {/* 5-Column Pipeline Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {pipelineCards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
            <p className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-slate-900">
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* Main Split: Rekap Omset Instansi & Deadline Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Rekap Omset &amp; Piutang per Instansi
              </h2>
              <p className="text-xs text-slate-500">
                Klik baris instansi untuk melihat rincian per PIC / pemesan.
              </p>
            </div>
            <div className="text-right text-xs">
              <span className="text-slate-500">Total Omset ({data.total_rekap.nota} nota): </span>
              <strong className="font-mono tabular-nums text-slate-900">
                {formatRupiah(data.total_rekap.omzet)}
              </strong>
              <span className="text-slate-300 mx-1.5">|</span>
              <span className="text-slate-500">Piutang: </span>
              <strong className="font-mono tabular-nums text-rose-700">
                {formatRupiah(data.total_rekap.piutang)}
              </strong>
            </div>
          </div>

          <table className="w-full text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Instansi</th>
                <th className="text-right px-4 py-3">Nota</th>
                <th className="text-right px-4 py-3">Omset</th>
                <th className="text-right px-4 py-3">Piutang</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rekap.map((row) => {
                const open = expandedInstansi === row.instansi;
                return (
                  <React.Fragment key={row.instansi}>
                    <tr
                      onClick={() => setExpandedInstansi(open ? null : row.instansi)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td data-label="Instansi" className="px-4 py-3 font-medium text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          {open ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                          {row.instansi}
                        </span>
                      </td>
                      <td
                        data-label="Nota"
                        className="px-4 py-3 text-right font-mono tabular-nums text-slate-700"
                      >
                        {row.total_nota}
                      </td>
                      <td
                        data-label="Omset"
                        className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900"
                      >
                        {formatRupiah(row.omzet)}
                      </td>
                      <td
                        data-label="Piutang"
                        className={`px-4 py-3 text-right font-mono tabular-nums font-medium ${
                          row.piutang > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {formatRupiah(row.piutang)}
                      </td>
                    </tr>
                    {open &&
                      row.pics.map((pic) => (
                        <tr key={`${row.instansi}-${pic.nama}`} className="bg-slate-50/70 text-xs">
                          <td data-label="PIC" className="px-4 py-2 pl-10 text-slate-700">
                            PIC: {pic.nama}
                          </td>
                          <td
                            data-label="Nota"
                            className="px-4 py-2 text-right font-mono tabular-nums text-slate-600"
                          >
                            {pic.total_nota}
                          </td>
                          <td
                            data-label="Omset"
                            className="px-4 py-2 text-right font-mono tabular-nums text-slate-700"
                          >
                            {formatRupiah(pic.omzet)}
                          </td>
                          <td
                            data-label="Piutang"
                            className="px-4 py-2 text-right font-mono tabular-nums text-slate-700"
                          >
                            {formatRupiah(pic.piutang)}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right Column: Deadline & Low Stock Alerts */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Pemantauan Deadline (&le; 3 Hari)
              </h2>
              <p className="text-xs text-slate-500">Order aktif yang mendekati atau melewati batas waktu.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.deadlines.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Seluruh order aktif masih aman dari batas deadline.
                </div>
              ) : (
                data.deadlines.map((dl) => (
                  <button
                    key={dl.id}
                    type="button"
                    onClick={() => onInspectOrderId(dl.id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">{dl.no_nota}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          dl.terlambat
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {dl.terlambat ? 'Terlambat' : `${dl.sisa_hari} hari lagi`}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800 mt-1">
                      {dl.pic} · {dl.instansi}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{formatTanggal(dl.deadline)}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Low Stock Alert Panel */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Peringatan Stok Minimum
                </h2>
                <p className="text-xs text-slate-500">Roll &le; 10 m atau produk satuan &le; 5 pcs.</p>
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Restock
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {(data.stok_kritis?.rolls.length ?? 0) === 0 &&
              (data.stok_kritis?.products.length ?? 0) === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Seluruh roll bahan aktif dan stok satuan masih di atas batas minimum.
                </div>
              ) : (
                <>
                  {data.stok_kritis?.rolls.map((roll) => (
                    <div key={`roll-${roll.id}`} className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 font-mono truncate">
                          {roll.kode_roll}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {roll.jenis_bahan} · Lebar {roll.lebar_m} m
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold font-mono tabular-nums text-amber-800 shrink-0">
                        <AlertTriangle className="h-3 w-3" />
                        {formatDesimal(roll.panjang_sisa_m)} m
                      </span>
                    </div>
                  ))}
                  {data.stok_kritis?.products.map((prod) => (
                    <div key={`prod-${prod.id}`} className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {prod.nama_produk}
                        </p>
                        <p className="text-[11px] text-slate-500">Produk Satuan</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold font-mono tabular-nums text-rose-700 shrink-0">
                        <Package className="h-3 w-3" />
                        {prod.stok_pcs} pcs
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

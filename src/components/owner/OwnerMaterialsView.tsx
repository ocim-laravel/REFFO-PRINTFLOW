import React, { useMemo, useState } from 'react';
import type { MaterialLog, MaterialOffcut, MaterialRoll, Product } from '../../types';
import { formatDesimal, formatRupiah, formatTanggal, statusBadgeStyle } from '../../lib/format';
import { apiFetch } from '../../lib/api';

export interface MaterialReportData {
  rolls: Array<MaterialRoll & { luas_sisa_m2: number; persen_sisa: number }>;
  offcuts: MaterialOffcut[];
  stok_pcs: Product[];
  ringkasan: {
    jumlah_log: number;
    netto: number;
    finishing: number;
    potong: number;
    gagal: number;
    total: number;
  };
  logs: MaterialLog[];
}

interface OwnerMaterialsViewProps {
  data: MaterialReportData | null;
  dari: string;
  sampai: string;
  onChangeFilter: (dari: string, sampai: string) => void;
  loading: boolean;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onRefresh: () => Promise<void>;
}

export const OwnerMaterialsView: React.FC<OwnerMaterialsViewProps> = ({
  data,
  dari,
  sampai,
  onChangeFilter,
  loading,
  onNotify,
  onRefresh,
}) => {
  const [opnameTipe, setOpnameTipe] = useState<'roll' | 'cattoff' | 'product' | 'supply'>('roll');
  const [opnameId, setOpnameId] = useState('');
  const [opnameStok, setOpnameStok] = useState('');
  const [opnameCatatan, setOpnameCatatan] = useState('');
  const [savingOpname, setSavingOpname] = useState(false);

  const opnameOptions = useMemo(() => {
    if (!data) return [];
    if (opnameTipe === 'roll') return data.rolls.map((r) => ({ id: r.id, label: `${r.kode_roll} · ${r.jenis_bahan}`, stok: r.panjang_sisa_m }));
    if (opnameTipe === 'cattoff') return data.offcuts.map((c) => ({ id: c.id, label: `${c.kode_roll ?? 'Cattoff'} · ${c.jenis_bahan}`, stok: c.panjang_m }));
    if (opnameTipe === 'product') return data.stok_pcs.map((p) => ({ id: p.id, label: p.nama_produk, stok: p.stok_pcs ?? 0 }));
    return [];
  }, [data, opnameTipe]);

  const submitOpname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opnameId || !opnameCatatan.trim()) return;
    setSavingOpname(true);
    try {
      await apiFetch('/api/owner/stock-opname', {
        method: 'POST',
        body: JSON.stringify({ tipe: opnameTipe, id: Number(opnameId), stok_fisik: Number(opnameStok), catatan: opnameCatatan.trim() }),
      });
      onNotify('success', 'Stock opname berhasil disimpan dan tercatat di audit log.');
      setOpnameStok('');
      setOpnameCatatan('');
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan stock opname.');
    } finally {
      setSavingOpname(false);
    }
  };
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-36 rounded-xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Audit Summary & Filter */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Audit Pemakaian Bahan Riil
            </h2>
            <p className="text-xs text-slate-500">
              Mencatat luas cetak netto, ekstra finishing (wos finishing), sisa potong, dan gagal cetak.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="date"
              value={dari}
              onChange={(e) => onChangeFilter(e.target.value, sampai)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5"
              aria-label="Dari tanggal"
            />
            <span className="text-slate-400">s/d</span>
            <input
              type="date"
              value={sampai}
              onChange={(e) => onChangeFilter(dari, e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5"
              aria-label="Sampai tanggal"
            />
            {(dari || sampai) && (
              <button
                type="button"
                onClick={() => onChangeFilter('', '')}
                className="text-blue-700 font-medium underline cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Luas Netto</p>
            <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900">
              {formatDesimal(data.ringkasan.netto)} m²
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Wos Finishing</p>
            <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900">
              {formatDesimal(data.ringkasan.finishing)} m²
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Wos Potong</p>
            <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900">
              {formatDesimal(data.ringkasan.potong)} m²
            </p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
            <p className="text-xs text-rose-700">Gagal Cetak</p>
            <p className="mt-1 font-mono tabular-nums text-lg font-bold text-rose-800">
              {formatDesimal(data.ringkasan.gagal)} m²
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
            <p className="text-xs text-blue-700">Total Pemakaian Riil</p>
            <p className="mt-1 font-mono tabular-nums text-lg font-bold text-blue-900">
              {formatDesimal(data.ringkasan.total)} m²
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">Stock Opname</h3>
          <p className="text-xs text-slate-500">Sesuaikan selisih stok fisik dan sistem. Perubahan dicatat ke audit log.</p>
        </div>
        <form onSubmit={submitOpname} className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
          <select value={opnameTipe} onChange={(e) => { setOpnameTipe(e.target.value as 'roll' | 'cattoff' | 'product'); setOpnameId(''); }} className="rounded-lg border border-slate-300 px-2.5 py-2">
            <option value="roll">Roll</option>
            <option value="cattoff">Cattoff/Offcut</option>
            <option value="product">Produk Satuan</option>
          </select>
          <select value={opnameId} onChange={(e) => { setOpnameId(e.target.value); const opt = opnameOptions.find((o) => String(o.id) === e.target.value); if (opt) setOpnameStok(String(opt.stok)); }} className="rounded-lg border border-slate-300 px-2.5 py-2 sm:col-span-2">
            <option value="">Pilih item...</option>
            {opnameOptions.map((o) => <option key={o.id} value={o.id}>{o.label} (sistem: {o.stok})</option>)}
          </select>
          <input type="number" min="0" step="0.01" value={opnameStok} onChange={(e) => setOpnameStok(e.target.value)} placeholder="Stok fisik" className="rounded-lg border border-slate-300 px-2.5 py-2" required />
          <button type="submit" disabled={savingOpname} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50 cursor-pointer">{savingOpname ? 'Menyimpan...' : 'Simpan Opname'}</button>
          <input type="text" value={opnameCatatan} onChange={(e) => setOpnameCatatan(e.target.value)} placeholder="Catatan selisih/waktu opname wajib" className="rounded-lg border border-slate-300 px-2.5 py-2 sm:col-span-5" required />
        </form>
      </div>

      {/* Roll Stock & Offcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Stok Roll Bahan Aktif
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {data.rolls.map((r) => (
              <div key={r.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-slate-900">{r.kode_roll}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-700 font-medium">{r.jenis_bahan}</span>
                    <span className="text-slate-500"> (L {r.lebar_m}m)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-slate-700">
                      {formatDesimal(r.panjang_sisa_m)} / {formatDesimal(r.panjang_awal_m)} m
                    </span>
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeStyle(
                        r.status,
                      )}`}
                    >
                      {r.persen_sisa}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full ${
                      r.persen_sisa > 30 ? 'bg-emerald-600' : r.persen_sisa > 10 ? 'bg-amber-500' : 'bg-rose-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, r.persen_sisa))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Stok Potongan / Offcut Tersedia (&ge; 0.50m)
              </h3>
            </div>
            {data.offcuts.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">Tidak ada potongan sisa yang tersedia.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {data.offcuts.map((o) => (
                  <div key={o.id} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{o.jenis_bahan}</p>
                      <p className="text-slate-500 font-mono">Asal: {o.kode_roll ?? '-'}</p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="font-semibold text-slate-900">
                        {formatDesimal(o.lebar_m)} × {formatDesimal(o.panjang_m)} m
                      </p>
                      <p className="text-slate-500">{formatDesimal(o.luas_m2)} m²</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Stok Produk Satuan (Pcs)
              </h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {data.stok_pcs.map((p) => (
                <div key={p.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{p.nama_produk}</p>
                    <p className="text-slate-500">Modal: {formatRupiah(p.harga_modal)}</p>
                  </div>
                  <span
                    className={`font-mono tabular-nums font-bold ${
                      (p.stok_pcs ?? 0) <= 5 ? 'text-rose-700' : 'text-slate-900'
                    }`}
                  >
                    {p.stok_pcs ?? 0} pcs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Material Audit Log Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Log Pemotongan &amp; Kerusakan Bahan ({data.logs.length})
          </h3>
        </div>
        <table className="w-full text-xs sm:text-sm responsive-table">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Waktu &amp; Nota</th>
              <th className="text-left px-4 py-3">Roll / Keterangan</th>
              <th className="text-right px-4 py-3">Netto</th>
              <th className="text-right px-4 py-3">Wos Fin.</th>
              <th className="text-right px-4 py-3">Wos Pot.</th>
              <th className="text-right px-4 py-3">Gagal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.logs.map((log) => (
              <tr key={log.id}>
                <td data-label="Nota" className="px-4 py-3">
                  <p className="font-mono font-semibold text-slate-900">{log.no_nota}</p>
                  <p className="text-xs text-slate-500">{formatTanggal(log.created_at)}</p>
                </td>
                <td data-label="Keterangan" className="px-4 py-3 text-slate-700">
                  <p className="font-medium text-slate-900">{log.kode_roll ?? 'Offcut'}</p>
                  <p className="text-xs text-slate-500">{log.keterangan}</p>
                </td>
                <td data-label="Netto" className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatDesimal(log.luas_netto_m2)} m²
                </td>
                <td data-label="Wos Fin." className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatDesimal(log.wos_finishing_m2)} m²
                </td>
                <td data-label="Wos Pot." className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatDesimal(log.wos_potong_m2)} m²
                </td>
                <td
                  data-label="Gagal"
                  className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                    log.gagal_cetak_m2 > 0 ? 'text-rose-700' : 'text-slate-400'
                  }`}
                >
                  {formatDesimal(log.gagal_cetak_m2)} m²
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

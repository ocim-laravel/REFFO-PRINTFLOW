import React, { useEffect, useMemo, useState } from 'react';
import { Play, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import type {
  CetakGrup,
  CetakGrupItem,
  MaterialOffcut,
  MaterialRoll,
  OrderItem,
  PrintBatch,
  PrintMachine,
  StokCattoff,
  SupplyItem,
  TintaWarna,
} from '../../types';
import {
  STATUS_PRODUKSI_LABEL,
  formatDesimal,
  formatDimensiItem,
  formatTanggalSingkat,
  statusBadgeStyle,
} from '../../lib/format';
import { apiFetch } from '../../lib/api';

export interface OperatorQueueItem extends OrderItem {
  no_nota: string;
  instansi: string;
  nama_pelanggan: string;
  deadline: string | null;
}

interface OperatorViewProps {
  items: OperatorQueueItem[];
  rolls: MaterialRoll[];
  offcuts: MaterialOffcut[];
  machines: PrintMachine[];
  supplies: SupplyItem[];
  batches: PrintBatch[];
  cattoffs?: StokCattoff[];
  tintaWarna?: TintaWarna[];
  grup?: CetakGrup[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

interface BatchNestingResult {
  batch: PrintBatch;
  stats: {
    lebar_gabungan_m: number;
    panjang_tarik_m: number;
    luas_terpakai_m2: number;
    luas_waste_m2: number;
    penghematan_panjang_m: number;
    penghematan_luas_m2: number;
    lebar_sisa_m: number | null;
  };
  items: Array<{ id: number; no_nota: string }>;
}

export const OperatorView: React.FC<OperatorViewProps> = ({
  items,
  rolls,
  offcuts,
  machines,
  supplies,
  batches,
  cattoffs = [],
  tintaWarna = [],
  grup = [],
  loading,
  onRefresh,
  onNotify,
}) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [finishItem, setFinishItem] = useState<OperatorQueueItem | null>(null);
  const [sumberBahan, setSumberBahan] = useState<'roll' | 'cattoff' | 'offcut'>('roll');
  const [selectedRollId, setSelectedRollId] = useState<string>('');
  const [selectedOffcutId, setSelectedOffcutId] = useState<string>('');
  const [orientasi, setOrientasi] = useState<'panjang' | 'lebar'>('panjang');

  const [failItem, setFailItem] = useState<OperatorQueueItem | null>(null);
  const [failRollId, setFailRollId] = useState<string>('');
  const [panjangRusak, setPanjangRusak] = useState('0.5');
  const [alasanGagal, setAlasanGagal] = useState('');

  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const [batchRollId, setBatchRollId] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchNestingResult | null>(null);

  const [selectedGrupItemIds, setSelectedGrupItemIds] = useState<number[]>([]);
  const [grupCatatan, setGrupCatatan] = useState('');
  const [grupBusy, setGrupBusy] = useState(false);
  const [selectedGrupId, setSelectedGrupId] = useState('');
  const [warnaSelesaiIds, setWarnaSelesaiIds] = useState<number[]>([]);
  const [prnPanjang, setPrnPanjang] = useState('');
  const [prnLebar, setPrnLebar] = useState('');
  const [offcutLebar, setOffcutLebar] = useState('');
  const [offcutPanjang, setOffcutPanjang] = useState('');
  const [selectedCattoffId, setSelectedCattoffId] = useState('');

  const activeRolls = useMemo(() => rolls.filter((r) => r.status === 'aktif'), [rolls]);
  const lowRolls = useMemo(() => activeRolls.filter((r) => r.panjang_sisa_m <= 10), [activeRolls]);
  const availableOffcuts = useMemo(() => offcuts.filter((o) => o.status === 'tersedia'), [offcuts]);
  const activeCattoffs = useMemo(() => cattoffs.filter((c) => c.status === 'aktif'), [cattoffs]);
  const selectedGrup = useMemo(
    () => grup.find((g) => String(g.id) === selectedGrupId) ?? null,
    [grup, selectedGrupId],
  );
  const lowSupplies = useMemo(
    () => supplies.filter((s) => s.aktif && s.stok <= s.stok_minimum),
    [supplies],
  );
  const filteredItems = items;
  const batchCandidates = useMemo(
    () =>
      filteredItems.filter(
        (i) =>
          i.product_category === 'meteran' &&
          ['antrean_cetak', 'proses_cetak'].includes(i.status_produksi) &&
          Boolean(i.ukuran_kotor),
      ),
    [filteredItems],
  );

  const effectiveBatchMachineId = String(machines.find((m) => m.aktif)?.id ?? machines[0]?.id ?? '');
  const effectiveBatchRollId = batchRollId || String(activeRolls[0]?.id ?? '');

  const toggleBatchItem = (item: OperatorQueueItem) => {
    if (selectedBatchIds.includes(item.id)) {
      setSelectedBatchIds((prev) => prev.filter((id) => id !== item.id));
      return;
    }
    const first = items.find((i) => i.id === selectedBatchIds[0]);
    if (first && first.product_id !== item.product_id) {
      onNotify('error', 'Batch nesting hanya untuk item dengan bahan produk yang sama.');
      return;
    }
    if (selectedBatchIds.length >= 4) {
      onNotify('error', 'Maksimal 4 item per batch nesting.');
      return;
    }
    setSelectedBatchIds((prev) => [...prev, item.id]);
  };

  const handleHitungBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBatchIds.length < 2) {
      onNotify('error', 'Pilih minimal 2 item untuk batch nesting.');
      return;
    }
    setBatchBusy(true);
    try {
      const res = await apiFetch<BatchNestingResult>('/api/operator/batch-nesting', {
        method: 'POST',
        body: JSON.stringify({
          item_ids: selectedBatchIds,
          machine_id: Number(effectiveBatchMachineId),
          ...(effectiveBatchRollId ? { material_roll_id: Number(effectiveBatchRollId) } : {}),
          catatan: batchNote,
        }),
      });
      setBatchResult(res);
      setSelectedBatchIds([]);
      setBatchNote('');
      await onRefresh();
      onNotify('success', `Batch ${res.batch.kode_batch} berhasil dihitung dan disimpan.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menghitung batch nesting.');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleProsesBatch = async (batch: PrintBatch) => {
    setBatchBusy(true);
    try {
      await apiFetch(`/api/operator/batches/${batch.id}/proses`, { method: 'POST' });
      await onRefresh();
      onNotify('success', `Batch ${batch.kode_batch} mulai diproses. Antrean tiap item diperbarui.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memproses batch.');
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleGrupItem = (item: OperatorQueueItem) => {
    setSelectedGrupItemIds((prev) =>
      prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
    );
  };

  const handleSiapTata = async (item: OperatorQueueItem) => {
    setBusyId(item.id);
    try {
      await apiFetch(`/api/operator/items/${item.id}/siap-tata`, { method: 'POST' });
      await onRefresh();
      onNotify('success', `${item.nama_item || item.product_name} ditandai siap ditata.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menandai siap tata.');
    } finally {
      setBusyId(null);
    }
  };

  const handleBuatGrup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGrupItemIds.length === 0) {
      onNotify('error', 'Pilih item terlebih dahulu.');
      return;
    }
    setGrupBusy(true);
    try {
      const res = await apiFetch<{ grup: CetakGrup }>('/api/operator/grup', {
        method: 'POST',
        body: JSON.stringify({ item_ids: selectedGrupItemIds, catatan: grupCatatan }),
      });
      setSelectedGrupId(String(res.grup.id));
      setSelectedGrupItemIds([]);
      setGrupCatatan('');
      await onRefresh();
      onNotify('success', `Grup ${res.grup.kode_grup} berhasil dibuat.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal membuat grup cetak.');
    } finally {
      setGrupBusy(false);
    }
  };

  const handleUpdateGrupItem = async (gi: CetakGrupItem, patch: Partial<CetakGrupItem>) => {
    if (!selectedGrup) return;
    setGrupBusy(true);
    try {
      await apiFetch(`/api/operator/grup/${selectedGrup.id}/item/${gi.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await onRefresh();
      onNotify('success', 'Data item grup diperbarui.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memperbarui item grup.');
    } finally {
      setGrupBusy(false);
    }
  };

  const handleSelesaiGrup = async (mode: 'grup' | 'item', gi?: CetakGrupItem) => {
    if (!selectedGrup) return;
    if (mode === 'item' && !gi) return;
    setGrupBusy(true);
    try {
      await apiFetch(`/api/operator/grup/${selectedGrup.id}/selesai${mode === 'item' ? '-item' : ''}`, {
        method: 'POST',
        body: JSON.stringify({
          ...(mode === 'item' ? { cetak_grup_item_id: gi?.id } : {}),
          warna_tinta_ids: warnaSelesaiIds,
        }),
      });
      await onRefresh();
      onNotify('success', mode === 'item' ? 'Item grup selesai dicetak.' : `Grup ${selectedGrup.kode_grup} selesai dicetak.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyelesaikan cetak grup.');
    } finally {
      setGrupBusy(false);
    }
  };

  const computeOrientationStats = (
    item: OperatorQueueItem,
    mode: 'panjang' | 'lebar',
    containerWidth: number | null,
    containerLength: number | null,
  ) => {
    const kotor = item.ukuran_kotor;
    if (!kotor) return null;
    const lebarPakai = Math.round((mode === 'lebar' ? kotor.tinggi : kotor.lebar) * 100) / 100;
    const panjangPakai =
      Math.round((mode === 'lebar' ? kotor.lebar * item.qty : kotor.tinggi * item.qty) * 100) / 100;
    const sisaLebar =
      containerWidth !== null ? Math.round((containerWidth - lebarPakai) * 100) / 100 : null;
    const fitsWidth = containerWidth === null || containerWidth + 0.001 >= lebarPakai;
    const fitsLength = containerLength === null || containerLength + 0.001 >= panjangPakai;
    const feasible = fitsWidth && fitsLength;
    const createsOffcut = sisaLebar !== null && sisaLebar >= 0.5;
    const wosPotongM2 =
      sisaLebar !== null && sisaLebar >= 0 && !createsOffcut
        ? Math.round(sisaLebar * panjangPakai * 100) / 100
        : 0;
    return {
      mode,
      lebarPakai,
      panjangPakai,
      sisaLebar,
      feasible,
      createsOffcut,
      wosPotongM2,
    };
  };

  const openFinishModal = (item: OperatorQueueItem) => {
    setFinishItem(item);
    setSumberBahan('roll');
    setPrnPanjang(item.ukuran_kotor ? String(item.ukuran_kotor.tinggi) : '');
    setPrnLebar(item.ukuran_kotor ? String(item.ukuran_kotor.lebar) : '');
    setOffcutLebar('');
    setOffcutPanjang('');
    setSelectedCattoffId(activeCattoffs[0] ? String(activeCattoffs[0].id) : '');
    setWarnaSelesaiIds([]);
    const matchingRoll =
      activeRolls.find((r) =>
        item.rekomendasi_roll
          ? r.jenis_bahan === item.rekomendasi_roll
          : r.jenis_bahan.toLowerCase().includes((item.product_name ?? '').toLowerCase()),
      ) ?? activeRolls[0];
    setSelectedRollId(matchingRoll ? String(matchingRoll.id) : '');
    setSelectedOffcutId(availableOffcuts[0] ? String(availableOffcuts[0].id) : '');

    if (item.product_category === 'meteran' && item.ukuran_kotor && matchingRoll) {
      const optPanjang = computeOrientationStats(
        item,
        'panjang',
        matchingRoll.lebar_m,
        matchingRoll.panjang_sisa_m,
      );
      const optLebar = computeOrientationStats(
        item,
        'lebar',
        matchingRoll.lebar_m,
        matchingRoll.panjang_sisa_m,
      );
      if (optPanjang && optLebar) {
        if (!optPanjang.feasible && optLebar.feasible) {
          setOrientasi('lebar');
          return;
        }
        if (optPanjang.feasible && optLebar.feasible) {
          // Pick orientation with smaller waste, tie-break shorter roll pull
          if (
            optLebar.wosPotongM2 < optPanjang.wosPotongM2 ||
            (optLebar.wosPotongM2 === optPanjang.wosPotongM2 &&
              optLebar.panjangPakai < optPanjang.panjangPakai)
          ) {
            setOrientasi('lebar');
            return;
          }
        }
      }
    }
    setOrientasi('panjang');
  };

  const openFailModal = (item: OperatorQueueItem) => {
    setFailItem(item);
    setFailRollId(activeRolls[0] ? String(activeRolls[0].id) : '');
    setPanjangRusak('0.5');
    setAlasanGagal('');
  };

  const handleMulai = async (item: OperatorQueueItem) => {
    setBusyId(item.id);
    try {
      await apiFetch(`/api/operator/items/${item.id}/mulai`, { method: 'POST' });
      await onRefresh();
      onNotify('success', `Item ${item.nama_item || item.product_name} mulai dicetak.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memulai cetak.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSelesai = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishItem) return;
    setBusyId(finishItem.id);
    try {
      const detail =
        finishItem.product_category === 'meteran'
          ? {
              sumber_bahan: sumberBahan,
              material_roll_id: sumberBahan === 'roll' ? Number(selectedRollId) : undefined,
              cattoff_id: sumberBahan === 'cattoff' ? Number(selectedCattoffId) : undefined,
              material_offcut_id: sumberBahan === 'offcut' ? Number(selectedOffcutId) : undefined,
              orientasi_potong: orientasi,
              panjang_file_m: Number(prnPanjang) || undefined,
              lebar_file_m: Number(prnLebar) || undefined,
              offcut_lebar_m: Number(offcutLebar) || undefined,
              offcut_panjang_m: Number(offcutPanjang) || undefined,
              warna_tinta_ids: warnaSelesaiIds,
            }
          : {};
      const res = await apiFetch<{
        item: OperatorQueueItem;
        estimasi_tinta_ml: number;
        klik_total: number | null;
        peringatan_stok: string | null;
      }>(`/api/operator/items/${finishItem.id}/selesai`, {
        method: 'POST',
        body: JSON.stringify(detail),
      });
      setFinishItem(null);
      await onRefresh();
      const ringkasan = [
        res.klik_total !== null ? `${res.klik_total} klik` : null,
        res.estimasi_tinta_ml > 0 ? `${res.estimasi_tinta_ml} ml tinta` : null,
      ].filter(Boolean).join(' · ');
      onNotify(
        'success',
        `Cetak selesai${ringkasan ? ` (${ringkasan})` : ''}. Stok bahan & status produksi telah diperbarui.`,
      );
      if (res.peringatan_stok) {
        onNotify('error', res.peringatan_stok);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyelesaikan cetak.');
    } finally {
      setBusyId(null);
    }
  };

  const handleLaporGagal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!failItem) return;
    setBusyId(failItem.id);
    try {
      await apiFetch(`/api/operator/items/${failItem.id}/gagal-cetak`, {
        method: 'POST',
        body: JSON.stringify({
          material_roll_id: Number(failRollId),
          panjang_rusak_m: Number(panjangRusak),
          alasan: alasanGagal.trim(),
        }),
      });
      setFailItem(null);
      await onRefresh();
      onNotify('success', 'Gagal cetak tercatat pada audit bahan tanpa mengubah tagihan pelanggan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mencatat laporan.');
    } finally {
      setBusyId(null);
    }
  };

  // Live calculation & Smart Cut Orientation Advisor for Selesai Cetak modal
  const cutAdvisor = useMemo(() => {
    if (!finishItem || finishItem.product_category !== 'meteran' || !finishItem.ukuran_kotor) {
      return null;
    }
    const roll = sumberBahan === 'roll' ? activeRolls.find((r) => r.id === Number(selectedRollId)) : null;
    const offcut =
      sumberBahan === 'offcut'
        ? availableOffcuts.find((o) => o.id === Number(selectedOffcutId))
        : null;
    const width = sumberBahan === 'roll' ? (roll?.lebar_m ?? null) : (offcut?.lebar_m ?? null);
    const length =
      sumberBahan === 'roll' ? (roll?.panjang_sisa_m ?? null) : (offcut?.panjang_m ?? null);

    const normal = computeOrientationStats(finishItem, 'panjang', width, length);
    const rotated = computeOrientationStats(finishItem, 'lebar', width, length);
    if (!normal || !rotated) return null;

    let recommended: 'panjang' | 'lebar' = 'panjang';
    if (!normal.feasible && rotated.feasible) {
      recommended = 'lebar';
    } else if (normal.feasible && rotated.feasible) {
      if (
        rotated.wosPotongM2 < normal.wosPotongM2 ||
        (rotated.wosPotongM2 === normal.wosPotongM2 && rotated.panjangPakai < normal.panjangPakai)
      ) {
        recommended = 'lebar';
      }
    }

    const active = orientasi === 'lebar' ? rotated : normal;
    return { normal, rotated, recommended, active };
  }, [finishItem, orientasi, sumberBahan, activeRolls, selectedRollId, availableOffcuts, selectedOffcutId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-sm font-semibold text-slate-800">Antrean cetak kosong</p>
        <p className="mt-1 text-xs text-slate-500">
          Item akan masuk otomatis setelah Desainer menyelesaikan Master Desain dan .TIFF.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {lowRolls.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Peringatan Stok Roll Menipis (&le; 10 m):</strong>{' '}
              {lowRolls.map((r) => `${r.kode_roll} (${formatDesimal(r.panjang_sisa_m)} m)`).join(', ')}
            </span>
          </div>
          <span className="text-amber-700 font-medium">Segera lapor Owner untuk penambahan roll baru</span>
        </div>
      )}
      {lowSupplies.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          <strong>Stok tinta/bahan pembantu menipis:</strong>{' '}
          {lowSupplies.map((s) => `${s.nama} (${s.stok} ${s.satuan})`).join(', ')}
        </div>
      )}

      {(selectedBatchIds.length > 0 || batches.length > 0 || batchResult) && (
        <form
          onSubmit={handleHitungBatch}
          className="bg-white rounded-xl border border-blue-200 p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-700" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Batch Nesting Multi-Order
              </h2>
            </div>
            <span className="text-xs font-semibold text-blue-700">
              {selectedBatchIds.length} item dipilih
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mesin Otomatis</label>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                {machines.find((m) => String(m.id) === effectiveBatchMachineId)?.nama_mesin ?? 'Mesin aktif pertama'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roll Bahan</label>
              <select
                value={effectiveBatchRollId}
                onChange={(e) => setBatchRollId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
              >
                <option value="">Tanpa validasi roll</option>
                {activeRolls.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.kode_roll} · {r.jenis_bahan} (sisa {r.panjang_sisa_m} m)
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Batch</label>
              <input
                value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder="Misal: gabungan spanduk-zero waste"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={batchBusy || selectedBatchIds.length < 2}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5" />
              Hitung &amp; Simpan Batch
            </button>
          </div>

          {batchResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1">
              <p className="font-semibold">
                Hasil {batchResult.batch.kode_batch} — {batchResult.items.map((i) => i.no_nota).join(', ')}
              </p>
              <p className="font-mono tabular-nums">
                Lebar gabungan {batchResult.stats.lebar_gabungan_m} m · Panjang tarik{' '}
                {batchResult.stats.panjang_tarik_m} m · Luas terpakai{' '}
                {batchResult.stats.luas_terpakai_m2} m²
              </p>
              <p className="font-mono tabular-nums">
                Waste {batchResult.stats.luas_waste_m2} m² · Hemat tarik{' '}
                {batchResult.stats.penghematan_panjang_m} m (
                {batchResult.stats.penghematan_luas_m2} m²)
              </p>
            </div>
          )}

          {batches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs responsive-table">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Kode Batch</th>
                    <th className="text-left px-3 py-2">Mesin / Operator</th>
                    <th className="text-right px-3 py-2">Lebar</th>
                    <th className="text-right px-3 py-2">Tarik</th>
                    <th className="text-right px-3 py-2">Waste</th>
                    <th className="text-right px-3 py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.slice(0, 8).map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2 font-mono font-semibold">{b.kode_batch}</td>
                      <td className="px-3 py-2">
                        {b.machine_name ?? `Mesin #${b.machine_id}`} · {b.operator_name ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{b.lebar_gabungan_m} m</td>
                      <td className="px-3 py-2 text-right font-mono">{b.panjang_tarik_m} m</td>
                      <td className="px-3 py-2 text-right font-mono">{b.luas_waste_m2} m²</td>
                      <td className="px-3 py-2 text-right">
                        {b.status === 'dihitung' ? (
                          <button
                            type="button"
                            disabled={batchBusy}
                            onClick={() => handleProsesBatch(b)}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                          >
                            Proses Batch
                          </button>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-500">Diproses</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      )}

      <form
        onSubmit={handleBuatGrup}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">Grup Cetak</h2>
            <p className="text-xs text-slate-500">
              Centang item di tabel, lalu buat grup. Mesin dipilih otomatis.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-700">
            {selectedGrupItemIds.length} item dipilih
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Grup</label>
            <input
              value={grupCatatan}
              onChange={(e) => setGrupCatatan(e.target.value)}
              placeholder="Misal: gabungan a,b,n,v"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={grupBusy || selectedGrupItemIds.length === 0}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 cursor-pointer"
          >
            Buat Grup
          </button>
          <select
            value={selectedGrupId}
            onChange={(e) => setSelectedGrupId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
          >
            <option value="">Pilih grup aktif…</option>
            {grup.map((g) => (
              <option key={g.id} value={g.id}>
                {g.kode_grup} · {g.status}
              </option>
            ))}
          </select>
        </div>

        {selectedGrup && (
          <div className="space-y-3 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-slate-800">{selectedGrup.kode_grup}</span>
              <span className="text-xs text-slate-500">
                Mesin: {selectedGrup.machine_name ?? `#${selectedGrup.machine_id}`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {tintaWarna.map((w) => (
                  <label key={w.id} className="flex items-center gap-1 text-[11px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={warnaSelesaiIds.includes(w.id)}
                      onChange={() =>
                        setWarnaSelesaiIds((prev) =>
                          prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id],
                        )
                      }
                      className="h-3.5 w-3.5 accent-blue-700"
                    />
                    {w.kode} ({w.konsumsi_ml_per_m2} ml/m²)
                  </label>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-left">Qty</th>
                    <th className="px-2 py-2 text-left">Panjang File (m)</th>
                    <th className="px-2 py-2 text-left">Lebar File (m)</th>
                    <th className="px-2 py-2 text-left">Bahan</th>
                    <th className="px-2 py-2 text-left">Sisa Offcut</th>
                    <th className="px-2 py-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedGrup.items ?? []).map((gi) => (
                    <tr key={gi.id}>
                      <td className="px-2 py-2">
                        <p className="font-medium text-slate-900">{gi.no_nota} · {gi.nama_item}</p>
                        <p className="text-[10px] text-slate-500">{gi.qty_cetak}/{gi.qty_order} cetakan · {gi.status}</p>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="1"
                          defaultValue={gi.qty_cetak}
                          onBlur={(e) =>
                            handleUpdateGrupItem(gi, { qty_cetak: Number(e.target.value) })
                          }
                          className="w-16 rounded border border-slate-300 px-1.5 py-1 font-mono"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={gi.panjang_file_m ?? ''}
                          onBlur={(e) =>
                            handleUpdateGrupItem(gi, { panjang_file_m: Number(e.target.value) })
                          }
                          className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={gi.lebar_file_m ?? ''}
                          onBlur={(e) =>
                            handleUpdateGrupItem(gi, { lebar_file_m: Number(e.target.value) })
                          }
                          className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono"
                        />
                      </td>
                      <td className="px-2 py-2 space-y-1">
                        <select
                          value={gi.sumber_bahan}
                          onChange={(e) =>
                            handleUpdateGrupItem(gi, {
                              sumber_bahan: e.target.value as CetakGrupItem['sumber_bahan'],
                            })
                          }
                          className="w-full rounded border border-slate-300 px-1.5 py-1"
                        >
                          <option value="roll">Roll</option>
                          <option value="cattoff">Cattoff</option>
                          <option value="offcut">Offcut</option>
                        </select>
                        {gi.sumber_bahan === 'cattoff' && (
                          <select
                            value={gi.cattoff_id ?? ''}
                            onChange={(e) =>
                              handleUpdateGrupItem(gi, { cattoff_id: Number(e.target.value) })
                            }
                            className="w-full rounded border border-slate-300 px-1.5 py-1"
                          >
                            {activeCattoffs.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.kode} ({c.panjang_sisa_m}m)
                              </option>
                            ))}
                          </select>
                        )}
                        {gi.sumber_bahan === 'offcut' && (
                          <select
                            value={gi.offcut_id ?? ''}
                            onChange={(e) =>
                              handleUpdateGrupItem(gi, { offcut_id: Number(e.target.value) })
                            }
                            className="w-full rounded border border-slate-300 px-1.5 py-1"
                          >
                            {availableOffcuts.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.jenis_bahan} ({o.lebar_m}×{o.panjang_m}m)
                              </option>
                            ))}
                          </select>
                        )}
                        {gi.sumber_bahan === 'roll' && (
                          <select
                            value={gi.roll_id ?? ''}
                            onChange={(e) =>
                              handleUpdateGrupItem(gi, { roll_id: Number(e.target.value) })
                            }
                            className="w-full rounded border border-slate-300 px-1.5 py-1"
                          >
                            <option value="">Otomatis</option>
                            {activeRolls.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.kode_roll} ({r.panjang_sisa_m}m)
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Lebar"
                            defaultValue={gi.offcut_lebar_m ?? ''}
                            onBlur={(e) =>
                              handleUpdateGrupItem(gi, { offcut_lebar_m: Number(e.target.value) })
                            }
                            className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono"
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Panjang"
                            defaultValue={gi.offcut_panjang_m ?? ''}
                            onBlur={(e) =>
                              handleUpdateGrupItem(gi, { offcut_panjang_m: Number(e.target.value) })
                            }
                            className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          disabled={grupBusy || gi.status === 'selesai'}
                          onClick={() => handleSelesaiGrup('item', gi)}
                          className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50 cursor-pointer"
                        >
                          {gi.status === 'selesai' ? 'Selesai' : 'Selesai Item'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              disabled={grupBusy || selectedGrup.status === 'selesai'}
              onClick={() => handleSelesaiGrup('grup')}
              className="rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              Konfirmasi Seluruh Grup
            </button>
          </div>
        )}
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm responsive-table">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="text-center px-3 py-3">Batch</th>
              <th className="text-left px-4 py-3">Nota &amp; Pelanggan</th>
              <th className="text-left px-4 py-3">Item &amp; Bahan</th>
              <th className="text-left px-4 py-3">Mesin</th>
              <th className="text-left px-4 py-3">Ukuran Netto / Kotor</th>
              <th className="text-left px-4 py-3">Klik / Tinta</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Aksi Produksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/70">
                <td data-label="Batch" className="px-3 py-3 text-center">
                  {item.product_category === 'meteran' &&
                  ['antrean_cetak', 'proses_cetak'].includes(item.status_produksi) &&
                  item.ukuran_kotor ? (
                    <input
                      type="checkbox"
                      checked={selectedBatchIds.includes(item.id)}
                      onChange={() => toggleBatchItem(item)}
                      className="h-4 w-4 accent-blue-700"
                      title="Pilih untuk batch nesting"
                    />
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                  {item.product_category === 'meteran' && (
                    <label className="mt-1 flex items-center justify-center gap-1 text-[10px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={selectedGrupItemIds.includes(item.id)}
                        onChange={() => toggleGrupItem(item)}
                        className="h-3.5 w-3.5 accent-slate-800"
                        title="Pilih untuk grup cetak"
                      />
                      Grup
                    </label>
                  )}
                </td>
                <td data-label="Nota" className="px-4 py-3">
                  <p className="font-mono font-semibold text-slate-900">{item.no_nota}</p>
                  <p className="text-xs text-slate-500">
                    {item.nama_pelanggan} · {item.instansi}
                  </p>
                  {item.deadline && (
                    <p className="text-xs text-amber-700 font-medium">
                      DL {formatTanggalSingkat(item.deadline)}
                    </p>
                  )}
                </td>
                <td data-label="Item & Bahan" className="px-4 py-3">
                  <p className="font-medium text-slate-900">{item.nama_item || item.product_name}</p>
                  <p className="text-xs text-slate-500">
                    {item.product_name} · Qty <strong className="font-mono">{item.qty}</strong>
                    {item.finishing_name ? ` · Finishing: ${item.finishing_name}` : ''}
                  </p>
                  {item.rekomendasi_roll && (
                    <p className="text-xs font-medium text-blue-700 mt-0.5">
                      Rekomendasi: {item.rekomendasi_roll}
                    </p>
                  )}
                  {item.batch_id && (
                    <p className="text-xs font-medium text-indigo-700 mt-0.5">
                      Batch #{item.batch_id}
                    </p>
                  )}
                </td>
                <td data-label="Mesin" className="px-4 py-3">
                  <p className="text-xs font-medium text-slate-800">
                    {item.machine_name ?? `Mesin #${item.machine_id ?? '-'}`}
                  </p>
                  {item.operator_name && (
                    <p className="text-[11px] text-slate-500">Oleh {item.operator_name}</p>
                  )}
                </td>
                <td data-label="Ukuran Produksi" className="px-4 py-3">
                  <p className="font-mono tabular-nums text-slate-900">{formatDimensiItem(item)}</p>
                  {item.ukuran_kotor && (
                    <p className="text-xs font-mono tabular-nums text-slate-600">
                      Kotor: {formatDesimal(item.ukuran_kotor.lebar)} ×{' '}
                      {formatDesimal(item.ukuran_kotor.tinggi)} m ({formatDesimal(item.ukuran_kotor.luas)} m²)
                    </p>
                  )}
                </td>
                <td data-label="Klik / Tinta" className="px-4 py-3">
                  {item.satuan_hitung === 'klik' ? (
                    <>
                      <p className="font-mono font-semibold text-slate-900">
                        {item.klik_total ?? item.qty * (item.klik_per_lembar ?? 1)} klik
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {item.klik_per_lembar ?? 1} klik/lembar · {item.ukuran_lembar ?? 'A3+'}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Satuan (pcs)</p>
                  )}
                  {item.estimasi_tinta_ml !== null && item.estimasi_tinta_ml !== undefined && (
                    <p className="text-[11px] font-mono text-blue-700">
                      Est. {formatDesimal(item.estimasi_tinta_ml)} ml
                    </p>
                  )}
                </td>
                <td data-label="Status" className="px-4 py-3">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeStyle(
                      item.status_produksi,
                    )}`}
                  >
                    {STATUS_PRODUKSI_LABEL[item.status_produksi]}
                  </span>
                </td>
                <td data-label="Aksi" className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    {item.status_produksi === 'antrean_cetak' && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleSiapTata(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Siap Tata
                      </button>
                    )}
                    {['antrean_cetak', 'siap_tata', 'gagal_cetak', 'cetak_ulang'].includes(item.status_produksi) && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleMulai(item)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Mulai Cetak
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openFinishModal(item)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Selesai Cetak
                    </button>
                    {item.product_category === 'meteran' && (
                      <button
                        type="button"
                        onClick={() => openFailModal(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Gagal Cetak
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Selesai Cetak */}
      {finishItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSelesai}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Konfirmasi Selesai Cetak — {finishItem.no_nota}
            </h3>
            <p className="text-xs text-slate-600">
              Item: <strong>{finishItem.nama_item || finishItem.product_name}</strong> ({finishItem.product_name} ×{finishItem.qty})
            </p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Mesin dipilih otomatis dari mesin aktif. Tinta per warna dicatat sesuai pilihan di bawah.
            </p>

            {finishItem.product_category === 'meteran' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSumberBahan('roll')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                      sumberBahan === 'roll'
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Potong dari Roll Aktif
                  </button>
                  <button
                    type="button"
                    disabled={activeCattoffs.length === 0}
                    onClick={() => setSumberBahan('cattoff')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer ${
                      sumberBahan === 'cattoff'
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Pakai Cattoff ({activeCattoffs.length})
                  </button>
                  <button
                    type="button"
                    disabled={availableOffcuts.length === 0}
                    onClick={() => setSumberBahan('offcut')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer ${
                      sumberBahan === 'offcut'
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Pakai Potongan / Offcut ({availableOffcuts.length})
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Panjang File .prn (m)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prnPanjang}
                      onChange={(e) => setPrnPanjang(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Lebar File .prn (m)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prnLebar}
                      onChange={(e) => setPrnLebar(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>

                {sumberBahan === 'roll' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Pilih Roll Bahan Aktif *
                    </label>
                    <select
                      required
                      value={selectedRollId}
                      onChange={(e) => setSelectedRollId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      {activeRolls.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.kode_roll} ({r.jenis_bahan}) · Lebar {r.lebar_m}m · Sisa {r.panjang_sisa_m}m
                          {r.panjang_sisa_m <= 10 ? ' [STOK MENIPIS]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : sumberBahan === 'cattoff' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Pilih Stok Cattoff *
                    </label>
                    <select
                      required
                      value={selectedCattoffId}
                      onChange={(e) => setSelectedCattoffId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      {activeCattoffs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.kode} · {c.jenis_bahan} · Lebar {c.lebar_m}m · Sisa {c.panjang_sisa_m}m
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Pilih Stok Potongan (Offcut) *
                    </label>
                    <select
                      required
                      value={selectedOffcutId}
                      onChange={(e) => setSelectedOffcutId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    >
                      {availableOffcuts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.jenis_bahan} · {o.lebar_m}m × {o.panjang_m}m ({o.luas_m2} m²)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Sisa Offcut: Lebar (m)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={offcutLebar}
                      onChange={(e) => setOffcutLebar(e.target.value)}
                      placeholder="Kosong = masuk WOS"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Sisa Offcut: Panjang (m)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={offcutPanjang}
                      onChange={(e) => setOffcutPanjang(e.target.value)}
                      placeholder="Kosong = panjang tarik"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Warna Tinta Dipakai</label>
                  <div className="flex flex-wrap gap-2">
                    {tintaWarna.map((w) => (
                      <label key={w.id} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={warnaSelesaiIds.includes(w.id)}
                          onChange={() =>
                            setWarnaSelesaiIds((prev) =>
                              prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id],
                            )
                          }
                          className="h-3.5 w-3.5 accent-blue-700"
                        />
                        {w.kode} · {w.warna} ({w.stok_ml} ml)
                      </label>
                    ))}
                  </div>
                </div>

                {cutAdvisor && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Smart Cut Orientation Advisor
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[cutAdvisor.normal, cutAdvisor.rotated].map((opt) => {
                        const isSelected = orientasi === opt.mode;
                        const isRecommended = cutAdvisor.recommended === opt.mode && opt.feasible;
                        return (
                          <button
                            key={opt.mode}
                            type="button"
                            onClick={() => setOrientasi(opt.mode)}
                            className={`rounded-lg border p-2.5 text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50 text-slate-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            } ${!opt.feasible ? 'opacity-55' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-semibold">
                                {opt.mode === 'panjang' ? 'Normal (0°)' : 'Diputar 90°'}
                              </span>
                              {isRecommended && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  Hemat Bahan
                                </span>
                              )}
                            </div>
                            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-700">
                              L {formatDesimal(opt.lebarPakai)}m × Tarik {formatDesimal(opt.panjangPakai)}m
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {!opt.feasible
                                ? 'Melebihi lebar/sisa bahan'
                                : opt.createsOffcut
                                  ? `Sisa ${formatDesimal(opt.sisaLebar ?? 0)}m → Jadi Offcut`
                                  : `Wos potong: ${formatDesimal(opt.wosPotongM2)} m²`}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                      <p className="font-semibold text-slate-800">Simulasi Pemakaian Bahan Kotor:</p>
                      <p className="font-mono tabular-nums text-slate-700">
                        Lebar dipakai: {formatDesimal(cutAdvisor.active.lebarPakai)} m · Panjang tarik:{' '}
                        {formatDesimal(cutAdvisor.active.panjangPakai)} m
                      </p>
                      {sumberBahan === 'roll' && cutAdvisor.active.sisaLebar !== null && (
                        <p className="text-slate-600">
                          Sisa lebar samping:{' '}
                          <strong className="font-mono">
                            {formatDesimal(cutAdvisor.active.sisaLebar)} m
                          </strong>{' '}
                          {cutAdvisor.active.createsOffcut
                            ? '→ Otomatis disimpan sebagai Stok Potongan (Offcut >= 0.50m)'
                            : '→ Dicatat sebagai Wos Potong (< 0.50m)'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                <p>
                  Produk kategori satuan: Stok <strong>{finishItem.product_name}</strong> akan berkurang{' '}
                  <strong className="font-mono">{finishItem.qty} pcs</strong> (tersedia saat ini:{' '}
                  <strong className="font-mono">{finishItem.stok_pcs ?? '-'} pcs</strong>).
                </p>
                {finishItem.satuan_hitung === 'klik' && (
                  <p className="font-medium text-blue-700">
                    Satuan hitung klik: {finishItem.qty} × {finishItem.klik_per_lembar ?? 1} ={' '}
                    {finishItem.klik_total ?? finishItem.qty * (finishItem.klik_per_lembar ?? 1)} klik.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFinishItem(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busyId !== null}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
              >
                Konfirmasi Selesai Cetak
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Lapor Gagal Cetak */}
      {failItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleLaporGagal}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-rose-800">
              Lapor Gagal Cetak — {failItem.no_nota}
            </h3>
            <p className="text-xs text-slate-600">
              Pencatatan ini memotong stok roll dan masuk audit HPP Owner, tanpa mengubah tagihan pelanggan atau memindahkan item keluar antrean cetak.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roll yang Terpakai *</label>
              <select
                required
                value={failRollId}
                onChange={(e) => setFailRollId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {activeRolls.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.kode_roll} ({r.jenis_bahan}) · Sisa {r.panjang_sisa_m}m
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Panjang Bahan Rusak (meter) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={panjangRusak}
                onChange={(e) => setPanjangRusak(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Kerusakan</label>
              <input
                type="text"
                value={alasanGagal}
                onChange={(e) => setAlasanGagal(e.target.value)}
                placeholder="Misal: Nozzle head bergaris / bahan terlipat"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFailItem(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busyId !== null}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
              >
                Simpan Laporan Gagal Cetak
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

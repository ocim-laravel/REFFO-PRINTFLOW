export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function clampPercent(value: unknown): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(round2(num), 0), 100);
}

/**
 * Validasi ID numerik integer positif dari parameter URL/payload.
 * Mengembalikan null bila bukan bilangan bulat positif.
 */
export function parsePositiveId(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  return Number.isInteger(num) && Number.isSafeInteger(num) && num > 0 ? num : null;
}

/**
 * Validasi input tanggal (YYYY-MM-DD atau ISO datetime) secara ketat.
 * Input kosong mengembalikan { valid: true, iso: null }.
 * Input tidak valid mengembalikan { valid: false, iso: null }.
 */
export function parseTanggalInput(
  raw: unknown,
): { valid: boolean; iso: string | null } {
  if (raw === undefined || raw === null) return { valid: true, iso: null };
  const text = String(raw).trim();
  if (!text) return { valid: true, iso: null };

  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const tahun = Number(dateOnlyMatch[1]);
    const bulan = Number(dateOnlyMatch[2]);
    const tanggal = Number(dateOnlyMatch[3]);
    if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) {
      return { valid: false, iso: null };
    }
    const d = new Date(Date.UTC(tahun, bulan - 1, tanggal));
    if (
      d.getUTCFullYear() !== tahun ||
      d.getUTCMonth() !== bulan - 1 ||
      d.getUTCDate() !== tanggal
    ) {
      return { valid: false, iso: null };
    }
    return { valid: true, iso: d.toISOString() };
  }

  // ISO datetime full format with explicit year-month-day prefix
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return { valid: false, iso: null };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, iso: null };
  }
  return { valid: true, iso: parsed.toISOString() };
}

export type TaxPriceMode = 'belum_termasuk_ppn' | 'sudah_termasuk_ppn';

export interface TaxSettings {
  id: number;
  ppn_persen_default: number;
  pph23_persen_default: number;
  mode_harga: TaxPriceMode;
  ppn_termasuk_diskon: boolean;
  potong_pph23_otomatis: boolean;
  updated_at: string | null;
  updated_by: number | null;
}

export function buildDefaultTaxSettings(): TaxSettings {
  return {
    id: 1,
    ppn_persen_default: 11,
    pph23_persen_default: 2,
    mode_harga: 'belum_termasuk_ppn',
    ppn_termasuk_diskon: true,
    potong_pph23_otomatis: false,
    updated_at: null,
    updated_by: null,
  };
}

export function computeEffectiveTaxRates(params: {
  payloadPpn?: unknown;
  payloadPph23?: unknown;
  instansi?: {
    is_pkp?: boolean;
    npwp?: string | null;
    ppn_persen?: number;
    pph23_persen?: number;
  } | null;
  taxSettings?: TaxSettings | null;
}): { ppnPersen: number; pph23Persen: number } {
  const globalTax = params.taxSettings ?? buildDefaultTaxSettings();
  const inst = params.instansi;

  // Tarif PPN instansi hanya menimpa global bila > 0. Nilai 0 / kosong berarti
  // "ikut pengaturan global" supaya data seed lama (ppn_persen = 0) tidak
  // mematikan PPN untuk seluruh nota. Pengecualian 0% per nota tetap bisa
  // lewat payload.ppn_persen = 0.
  const instansiPpn = Number(inst?.ppn_persen);
  let defaultPpn = instansiPpn > 0 ? instansiPpn : globalTax.ppn_persen_default;

  let defaultPph23 = 0;
  if (inst) {
    if (inst.pph23_persen !== undefined && Number(inst.pph23_persen) > 0) {
      defaultPph23 = Number(inst.pph23_persen);
    } else if (globalTax.potong_pph23_otomatis && inst.npwp) {
      defaultPph23 = globalTax.pph23_persen_default;
    }
  } else if (globalTax.potong_pph23_otomatis) {
    defaultPph23 = globalTax.pph23_persen_default;
  }

  const hasPayloadPpn =
    params.payloadPpn !== undefined && params.payloadPpn !== null && String(params.payloadPpn).trim() !== '';
  const hasPayloadPph23 =
    params.payloadPph23 !== undefined && params.payloadPph23 !== null && String(params.payloadPph23).trim() !== '';

  return {
    ppnPersen: clampPercent(hasPayloadPpn ? params.payloadPpn : defaultPpn),
    pph23Persen: clampPercent(hasPayloadPph23 ? params.payloadPph23 : defaultPph23),
  };
}

export function hitungPajakNota(params: {
  totalSebelumDiskonNota: number;
  diskonNotaPersen: number;
  ppnPersen: number;
  pph23Persen: number;
  modeHarga: TaxPriceMode;
  ppnTermasukDiskon?: boolean;
}): {
  diskonNominal: number;
  dpp: number;
  ppnNominal: number;
  pph23Nominal: number;
  totalTagihan: number;
} {
  const subtotalItems = Math.max(0, round2(params.totalSebelumDiskonNota));
  const diskonPersen = clampPercent(params.diskonNotaPersen);
  const diskonNominal = round2((subtotalItems * diskonPersen) / 100);
  const ppnPersen = clampPercent(params.ppnPersen);
  const pph23Persen = clampPercent(params.pph23Persen);
  const basisSetelahDiskon = Math.max(0, round2(subtotalItems - diskonNominal));
  const basisPajak = params.ppnTermasukDiskon !== false ? basisSetelahDiskon : subtotalItems;

  if (params.modeHarga === 'sudah_termasuk_ppn' && ppnPersen > 0) {
    const dpp = round2(basisPajak / (1 + ppnPersen / 100));
    const ppnNominal = round2(basisPajak - dpp);
    const pph23Nominal = round2((dpp * pph23Persen) / 100);
    const totalTagihan = round2(Math.max(0, basisSetelahDiskon - pph23Nominal));
    return { diskonNominal, dpp, ppnNominal, pph23Nominal, totalTagihan };
  }

  const dpp = basisPajak;
  const ppnNominal = round2((dpp * ppnPersen) / 100);
  const pph23Nominal = round2((dpp * pph23Persen) / 100);
  const totalTagihan = round2(Math.max(0, basisSetelahDiskon + ppnNominal - pph23Nominal));
  return { diskonNominal, dpp, ppnNominal, pph23Nominal, totalTagihan };
}

export const EDITABLE_MASTER_EXTENSIONS = ['.ai', '.psd', '.cdr'] as const;

export function isEditableMasterFilename(filename: string): boolean {
  const lower = String(filename ?? '').trim().toLowerCase();
  return EDITABLE_MASTER_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isTiffFilename(filename: string): boolean {
  const lower = String(filename ?? '').trim().toLowerCase();
  return lower.endsWith('.tif') || lower.endsWith('.tiff');
}

export interface BulkTiffMapEntry {
  filename: string;
  item_id: number;
}

export function resolveBulkTiffMapping(params: {
  filenames: string[];
  items: Array<{ id: number; nama_item?: string | null; product_name?: string; acc_admin_id: number | null }>;
  explicitMap?: BulkTiffMapEntry[];
}): {
  ok: boolean;
  mappings: Array<{ filename: string; itemId: number }>;
  unmapped: string[];
  errors: string[];
} {
  const { filenames, items, explicitMap } = params;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const mappings: Array<{ filename: string; itemId: number }> = [];
  const unmapped: string[] = [];
  const errors: string[] = [];
  const usedItemIds = new Set<number>();

  if (explicitMap && explicitMap.length > 0) {
    const mapByFile = new Map<string, number>();
    for (const entry of explicitMap) {
      const key = String(entry.filename ?? '').trim();
      const itemId = parsePositiveId(entry.item_id);
      if (key && itemId) mapByFile.set(key, itemId);
    }

    for (const filename of filenames) {
      if (!isTiffFilename(filename)) {
        errors.push(`File "${filename}" bukan format .tif/.tiff.`);
        continue;
      }
      const itemId = mapByFile.get(filename);
      if (!itemId) {
        unmapped.push(filename);
        continue;
      }
      const target = itemById.get(itemId);
      if (!target) {
        errors.push(`Item ID ${itemId} untuk file "${filename}" tidak termasuk pada nota ini.`);
        continue;
      }
      if (!target.acc_admin_id) {
        errors.push(`Item #${itemId} (${target.nama_item || target.product_name || 'Item'}) belum di-ACC Admin.`);
        continue;
      }
      if (usedItemIds.has(itemId)) {
        errors.push(`Item #${itemId} dipetakan ke lebih dari satu file TIFF.`);
        continue;
      }
      usedItemIds.add(itemId);
      mappings.push({ filename, itemId });
    }
  } else {
    for (const filename of filenames) {
      if (!isTiffFilename(filename)) {
        errors.push(`File "${filename}" bukan format .tif/.tiff.`);
        continue;
      }
      let matchedId: number | null = null;
      const itemIdMatch = filename.match(/(?:^|[^a-z0-9])item[-_]?(\d+)(?:[^0-9]|$)/i);
      if (itemIdMatch) {
        const candidateId = Number(itemIdMatch[1]);
        if (itemById.has(candidateId)) matchedId = candidateId;
      }
      if (!matchedId) {
        const prefixIdxMatch = filename.match(/^0*(\d+)[-_.\s]/);
        if (prefixIdxMatch) {
          const idx = Number(prefixIdxMatch[1]) - 1;
          if (idx >= 0 && idx < items.length) {
            matchedId = items[idx].id;
          }
        }
      }
      if (!matchedId) {
        unmapped.push(filename);
        continue;
      }
      const target = itemById.get(matchedId)!;
      if (!target.acc_admin_id) {
        errors.push(`Item #${matchedId} belum di-ACC Admin.`);
        continue;
      }
      if (usedItemIds.has(matchedId)) {
        errors.push(`Item #${matchedId} cocok ke lebih dari satu file ("${filename}").`);
        continue;
      }
      usedItemIds.add(matchedId);
      mappings.push({ filename, itemId: matchedId });
    }
  }

  return {
    ok: unmapped.length === 0 && errors.length === 0 && mappings.length === filenames.length,
    mappings,
    unmapped,
    errors,
  };
}

export const DEFAULT_TINTA_GALON_ML = 5000;
export const DEFAULT_ROLL_PER_GALON = 6;
export const DEFAULT_ROLL_AREA_M2 = round2(3.2 * 70); // 224 m²

/**
 * Konversi 1 galon tinta (5000 ml) untuk 6 roll bahan 3.2m x 70m (1344 m²)
 * menghasilkan ~3.72 ml/m² per warna.
 */
export function hitungTintaMlPerM2(
  kapasitasGalonMl = DEFAULT_TINTA_GALON_ML,
  rollPerGalon = DEFAULT_ROLL_PER_GALON,
  luasPerRollM2 = DEFAULT_ROLL_AREA_M2,
): number {
  const totalLuas = Number(rollPerGalon) * Number(luasPerRollM2);
  if (!(kapasitasGalonMl > 0) || !(totalLuas > 0)) return 0;
  return round2(kapasitasGalonMl / totalLuas);
}

export function hitungPemakaianTintaPerWarna(
  luasCetakM2: number,
  warnaList: Array<{ id: number; warna: string; konsumsi_ml_per_m2: number }>,
): {
  rincian: Array<{ tinta_warna_id: number; warna: string; jumlah_ml: number }>;
  totalMl: number;
} {
  const luas = Math.max(0, round2(luasCetakM2));
  const rincian = warnaList.map((w) => ({
    tinta_warna_id: w.id,
    warna: w.warna,
    jumlah_ml: round2(luas * Math.max(0, Number(w.konsumsi_ml_per_m2 ?? 0))),
  }));
  const totalMl = round2(rincian.reduce((sum, r) => sum + r.jumlah_ml, 0));
  return { rincian, totalMl };
}

export function hitungPemakaianBahanPrn(params: {
  panjangFileM: number;
  lebarFileM: number;
  containerWidthM: number;
  manualOffcutLebarM?: number | null;
  manualOffcutPanjangM?: number | null;
}): {
  luasFileM2: number;
  luasContainerM2: number;
  offcutLuasM2: number;
  wosPotongM2: number;
  createsManualOffcut: boolean;
} {
  const panjang = Math.max(0, round2(params.panjangFileM));
  const lebar = Math.max(0, round2(params.lebarFileM));
  const containerW = Math.max(lebar, round2(params.containerWidthM));
  const luasFileM2 = round2(panjang * lebar);
  const luasContainerM2 = round2(containerW * panjang);

  const offL = round2(Number(params.manualOffcutLebarM ?? 0));
  const offP = round2(Number(params.manualOffcutPanjangM ?? 0));
  const createsManualOffcut = offL > 0 && offP > 0;
  const offcutLuasM2 = createsManualOffcut ? round2(offL * offP) : 0;
  const wosPotongM2 = round2(Math.max(luasContainerM2 - luasFileM2 - offcutLuasM2, 0));

  return { luasFileM2, luasContainerM2, offcutLuasM2, wosPotongM2, createsManualOffcut };
}

export function statusSetelahCetak(qtyOrder: number, totalQtyTercetak: number): 'selesai' | 'antrean_cetak' {
  return Number(totalQtyTercetak) + 0.001 >= Number(qtyOrder) ? 'selesai' : 'antrean_cetak';
}

export function resolveQcStatus(hasil: unknown): 'proses_finishing' | 'cetak_ulang' | null {
  if (hasil === 'lolos') return 'proses_finishing';
  if (hasil === 'cacat') return 'cetak_ulang';
  return null;
}

export function isSameOperationalDay(tanggalStr: unknown, referenceDate: Date = new Date()): boolean {
  const text = String(tanggalStr ?? '').trim();
  if (!text) return true;
  const parsed = parseTanggalInput(text);
  if (!parsed.valid || !parsed.iso) return false;
  const targetDay = text.slice(0, 10);
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const d = String(referenceDate.getDate()).padStart(2, '0');
  return targetDay === `${y}-${m}-${d}`;
}

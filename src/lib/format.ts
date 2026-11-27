import type {
  CustomerCategory,
  DesignStatus,
  Order,
  OrderItem,
  PaymentStatus,
  ProductionStatus,
  SpkFieldStatus,
  UserRole,
} from '../types';

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin / Kasir',
  desainer: 'Desainer Grafis',
  operator_cetak: 'Operator Cetak',
  finishing: 'Divisi Finishing',
  advertising: 'Tim Advertising',
  owner: 'Owner / Direktur',
};

export const KATEGORI_PELANGGAN_LABEL: Record<CustomerCategory, string> = {
  umum: 'Umum',
  reseller: 'Reseller',
  prioritas: 'Prioritas',
  pegawai: 'Pegawai',
};

export const STATUS_BAYAR_LABEL: Record<PaymentStatus, string> = {
  belum_lunas: 'Belum Lunas',
  dp: 'DP',
  lunas: 'Lunas',
};

export const STATUS_DESAIN_LABEL: Record<DesignStatus, string> = {
  belum_ada_file: 'Belum Punya Desain / Materi Teks',
  file_mentah: 'File Desain Mentah',
  coretan_kertas: 'Foto Coretan Kertas',
  siap_cetak_tiff: 'File Siap Cetak .TIFF',
};

export const STATUS_PRODUKSI_LABEL: Record<ProductionStatus, string> = {
  menunggu_desain: 'Menunggu Desain',
  proses_desain: 'Proses Desain',
  menunggu_acc: 'Menunggu ACC Admin',
  revisi: 'Revisi Desain',
  antrean_cetak: 'Antrean Cetak',
  siap_tata: 'Sudah Ditata (Maintop)',
  proses_cetak: 'Proses Cetak',
  gagal_cetak: 'Gagal Cetak (Ulang)',
  cetak_ulang: 'Cetak Ulang (QC)',
  antrean_finishing: 'Antrean Finishing',
  proses_finishing: 'Proses Finishing',
  siap_diambil: 'Siap Diambil',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

export const STATUS_SPK_LABEL: Record<SpkFieldStatus, string> = {
  antrean: 'Antrean Lapangan',
  perakitan: 'Perakitan Konstruksi',
  pemasangan: 'Pemasangan Lokasi',
  selesai: 'Selesai Terpasang',
};

export function formatRupiah(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  return `Rp ${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)}`;
}

export function formatDesimal(value: number | string | null | undefined, digits = 2): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(num);
}

export function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTanggalSingkat(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDimensiItem(item: OrderItem): string {
  if (item.product_category === 'meteran' && item.lebar_m && item.tinggi_m) {
    return `${formatDesimal(item.lebar_m)} × ${formatDesimal(item.tinggi_m)} m`;
  }
  return 'Satuan';
}

export function computeProgresDesainNota(order: Order): number {
  if (order.items.length === 0) return 0;
  if (order.file_master_arsip && order.items.every((i) => Boolean(i.file_cetak_tiff))) {
    return 100;
  }
  const sum = order.items.reduce((acc, item) => {
    if (item.file_cetak_tiff) return acc + 90;
    switch (item.status_produksi) {
      case 'menunggu_desain':
        return acc + 0;
      case 'proses_desain':
        return acc + 25;
      case 'revisi':
        return acc + 45;
      case 'menunggu_acc':
        return acc + (item.acc_admin_id ? 75 : 65);
      default:
        return acc + 100;
    }
  }, 0);
  return Math.round(sum / order.items.length);
}

export function buildWhatsAppUrl(order: Order): string {
  let digits = (order.customer?.no_wa ?? '').replace(/\D+/g, '');
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`;
  }

  const lines = [
    `*RINGKASAN NOTA ${order.no_nota}*`,
    `Instansi: ${order.customer?.instansi ?? 'Perorangan'}`,
    `Pelanggan: ${order.customer?.nama_pelanggan ?? '-'}`,
    `Tanggal: ${formatTanggal(order.created_at)}`,
    '',
    '*Rincian Digital Printing*',
  ];

  order.items.forEach((item, idx) => {
    const dim =
      item.product_category === 'meteran' && item.lebar_m && item.tinggi_m
        ? `${formatDesimal(item.lebar_m)} x ${formatDesimal(item.tinggi_m)} m`
        : 'satuan';
    lines.push(
      `${idx + 1}. ${item.product_name ?? 'Item'} (${dim}) x${item.qty} = ${formatRupiah(item.subtotal)}`,
    );
  });

  lines.push('');
  lines.push(`Total Tagihan: ${formatRupiah(order.total_tagihan)}`);
  lines.push(`DP / Dibayar: ${formatRupiah(order.jumlah_dp)}`);
  lines.push(`Sisa Tagihan: ${formatRupiah(order.sisa_tagihan)}`);
  lines.push(`Status Bayar: ${STATUS_BAYAR_LABEL[order.status_bayar]}`);

  if (order.advertising_spks.length > 0) {
    lines.push('');
    lines.push('*SPK Advertising (Non-Billing)*');
    order.advertising_spks.forEach((spk) => {
      lines.push(`- ${spk.jenis_pekerjaan} | ${spk.ukuran_konstruksi} | ${spk.lokasi_pasang}`);
    });
  }

  lines.push('');
  lines.push('Terima kasih atas kepercayaan Anda.');

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

export function statusBadgeStyle(status: string): string {
  switch (status) {
    case 'lunas':
    case 'selesai':
    case 'siap_diambil':
    case 'aktif':
    case 'tersedia':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'dp':
    case 'menunggu_acc':
    case 'revisi':
    case 'proses_desain':
    case 'siap_tata':
    case 'proses_cetak':
    case 'proses_finishing':
    case 'perakitan':
    case 'pemasangan':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'belum_lunas':
    case 'habis':
    case 'terpakai':
    case 'gagal_cetak':
    case 'cetak_ulang':
    case 'dibatalkan':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

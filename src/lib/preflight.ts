import type { TiffPreflightRule } from '../types';

export function validateDpi(resolution: number, isLargeFormat = false): boolean {
  const min = isLargeFormat ? 150 : 300;
  return resolution >= min;
}

export function validateCmyk(colorSpace: string): boolean {
  const normalized = colorSpace.trim().toLowerCase().replace(/[_\s]/g, '');
  return normalized === 'cmyk';
}

export function validateBleed(widthMm: number, heightMm: number, bleedMm: number): boolean {
  const minBleed = 3; // 3mm minimum bleed
  return bleedMm >= minBleed && widthMm > bleedMm && heightMm > bleedMm;
}

export function validateTiffFile(filename: string, isLargeFormat = false): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ext = filename.toLowerCase().replace(/\?.+/, '').split('.').pop() ?? '';
  if (ext !== 'tif' && ext !== 'tiff') {
    errors.push(`Format file harus .TIFF, bukan .${ext}.`);
  }

  // Extract resolution from filename (e.g., "file_300dpi.tif" or "file_300.jpg")
  const dpiMatch = filename.match(/(\d{2,4})\s*dpi/i);
  if (dpiMatch) {
    const dpi = Number(dpiMatch[1]);
    if (!validateDpi(dpi, isLargeFormat)) {
      errors.push(`Resolusi minimal ${isLargeFormat ? '150' : '300'} DPI. Terdeteksi ${dpi} DPI.`);
    }
  } else {
    warnings.push('Tidak ada resolusi DPI dalam nama file. Pastikan file memiliki resolusi yang sesuai.');
  }

  // Extract color space from filename (e.g., "file_cmyk.tif" or "file_rgb.jpg")
  const colorMatch = filename.match(/(cmyk|rgb)/i);
  if (colorMatch && colorMatch[1]) {
    const color = colorMatch[1].toLowerCase();
    if (!validateCmyk(color)) {
      warnings.push('File tidak menggunakan space warna CMYK. Untuk cetak, gunakan space warna CMYK.');
    }
  }

  // Extract dimensions from filename (e.g., "file_100x150mm.tif")
  const dimMatch = filename.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (dimMatch && dimMatch[1] && dimMatch[2]) {
    const width = Number(dimMatch[1]);
    const height = Number(dimMatch[2]);
    if (!validateBleed(width, height, 3)) {
      errors.push('Dimensi kertas kurang sesuai. Pastikan ada bleed minimal 3mm di setiap sisi.');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function resolveBulkTiffMapping(
  files: string[],
  explicitMap: TiffPreflightRule[],
): TiffPreflightRule[] {
  const results: TiffPreflightRule[] = [];

  // First pass: explicit rules
  for (const rule of explicitMap) {
    results.push(rule);
  }

  // Second pass: auto-map files without explicit rules
  const mappedFilenames = new Set(
    explicitMap.map((r) => (r.file_name ?? '').toLowerCase()),
  );
  const unmapped = files.filter((f) => !mappedFilenames.has(f.toLowerCase()));

  for (const filename of unmapped) {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    if (ext !== 'tif' && ext !== 'tiff') continue;

    let itemId: number | null = null;
    const itemIdMatch = filename.match(/item-(\d+)/i);
    if (itemIdMatch && itemIdMatch[1]) {
      itemId = parseInt(itemIdMatch[1], 10);
    } else {
      for (const rule of explicitMap) {
        if (rule.file_name?.toLowerCase() === filename.toLowerCase()) {
          itemId = rule.order_item_id;
          break;
        }
      }
    }

    if (itemId !== null) {
      results.push({
        order_item_id: itemId,
        file_name: filename,
        status: 'valid' as const,
        notes: 'Otomatis dipetakan dari file TIFF tanpa aturan eksplisit.',
      });
    }
  }

  return results;
}

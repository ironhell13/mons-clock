import * as XLSX from 'xlsx';
import { cleanText, normalizePlate } from './validators';

export type MasterEntityKey =
  | 'karyawan'
  | 'pengawal'
  | 'area'
  | 'nopol'
  | 'bengkel'
  | 'jabatan'
  | 'vendor';

export interface ParsedMasterPreview {
  sheetUsed: string;
  totalRawRows: number;
  duplicatesRemoved: number;
  invalidRows: number;
  rows: Record<string, string>[];
}

export function exportRowsToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
  orderedHeaders?: string[]
) {
  const worksheet = orderedHeaders
    ? XLSX.utils.json_to_sheet(rows, { header: orderedHeaders })
    : XLSX.utils.json_to_sheet(rows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[cleanText(k).toUpperCase()] = v;
  }
  return out;
}

const TARGET_SHEET_NAMES: Record<MasterEntityKey, string> = {
  karyawan: 'Master Karyawan',
  pengawal: 'Master Pengawal',
  area: 'Master Area',
  nopol: 'Master Nopol',
  bengkel: 'Master Bengkel',
  jabatan: 'Master Jabatan',
  vendor: 'Master Vendor',
};

export async function parseMasterExcelFile(
  file: File,
  entity: MasterEntityKey
): Promise<ParsedMasterPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const preferred = TARGET_SHEET_NAMES[entity];
  const matchedSheet =
    workbook.SheetNames.find(
      (s) => s.trim().toLowerCase() === preferred.toLowerCase()
    ) ?? workbook.SheetNames[0];

  if (!matchedSheet) {
    throw new Error('File tidak memiliki sheet yang dapat dibaca.');
  }

  const rawRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(workbook.Sheets[matchedSheet], { defval: '' })
    .map(normalizeRowKeys);

  let invalidRows = 0;
  let duplicatesRemoved = 0;

  if (entity === 'karyawan') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const employee_no = cleanText(String(r['NO ID'] ?? r['EMPLOYEE_NO'] ?? ''));
      const name = cleanText(String(r['NAMA'] ?? r['NAME'] ?? ''));
      const position = cleanText(String(r['JABATAN'] ?? r['POSITION'] ?? ''));
      const rfid_no = cleanText(String(r['NO RFID'] ?? r['RFID_NO'] ?? ''));
      if (!employee_no || !name) {
        invalidRows++;
        continue;
      }
      if (map.has(employee_no)) duplicatesRemoved++;
      map.set(employee_no, {
        rfid_no,
        name,
        position: position || '-',
        employee_no,
      });
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  if (entity === 'pengawal') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const name = cleanText(String(r['NAMA'] ?? r['NAME'] ?? ''));
      const vendor = cleanText(String(r['VENDOR'] ?? ''));
      if (!name || !vendor) {
        invalidRows++;
        continue;
      }
      const key = `${name.toLowerCase()}|||${vendor.toLowerCase()}`;
      if (map.has(key)) {
        duplicatesRemoved++;
      } else {
        map.set(key, { name, vendor });
      }
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  if (entity === 'area') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const name = cleanText(String(r['AREA'] ?? r['NAMA'] ?? r['NAME'] ?? ''));
      if (!name) {
        invalidRows++;
        continue;
      }
      const key = name.toLowerCase();
      if (map.has(key)) {
        duplicatesRemoved++;
      } else {
        map.set(key, { name });
      }
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  if (entity === 'nopol') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const plate = normalizePlate(String(r['NOPOL'] ?? r['PLATE'] ?? r['NOMOR POLISI'] ?? ''));
      if (!plate) {
        invalidRows++;
        continue;
      }
      if (map.has(plate)) {
        duplicatesRemoved++;
      } else {
        map.set(plate, { plate });
      }
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  if (entity === 'jabatan') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const name = cleanText(String(r['JABATAN'] ?? r['NAMA JABATAN'] ?? r['POSITION'] ?? r['NAME'] ?? ''));
      if (!name) {
        invalidRows++;
        continue;
      }
      const key = name.toLowerCase();
      if (map.has(key)) duplicatesRemoved++;
      else map.set(key, { name });
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  if (entity === 'vendor') {
    const map = new Map<string, Record<string, string>>();
    for (const r of rawRows) {
      const name = cleanText(String(r['VENDOR'] ?? r['NAMA VENDOR'] ?? r['NAME'] ?? ''));
      if (!name) {
        invalidRows++;
        continue;
      }
      const key = name.toLowerCase();
      if (map.has(key)) duplicatesRemoved++;
      else map.set(key, { name });
    }
    return {
      sheetUsed: matchedSheet,
      totalRawRows: rawRows.length,
      duplicatesRemoved,
      invalidRows,
      rows: Array.from(map.values()),
    };
  }

  // bengkel
  const map = new Map<string, Record<string, string>>();
  for (const r of rawRows) {
    const name = cleanText(String(r['NAMA BENGKEL'] ?? r['BENGKEL'] ?? r['NAME'] ?? ''));
    if (!name) {
      invalidRows++;
      continue;
    }
    const key = name.toLowerCase();
    if (map.has(key)) {
      duplicatesRemoved++;
    } else {
      map.set(key, { name });
    }
  }
  return {
    sheetUsed: matchedSheet,
    totalRawRows: rawRows.length,
    duplicatesRemoved,
    invalidRows,
    rows: Array.from(map.values()),
  };
}


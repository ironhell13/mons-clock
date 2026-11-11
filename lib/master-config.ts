import type { MasterEntityKey } from './excel';

export interface MasterFieldMeta {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  uppercase?: boolean;
}

export interface MasterEntityMeta {
  entity: MasterEntityKey;
  table: 'employees' | 'escorts' | 'areas' | 'vehicles' | 'workshops';
  title: string;
  singular: string;
  description: string;
  sheetName: string;
  exportFilename: string;
  exportHeaders: string[];
  previewColumns: { key: string; label: string }[];
  defaultSortKey: string;
  hasFaceStatus: boolean;
}

export const MASTER_CONFIG: Record<MasterEntityKey, MasterEntityMeta> = {
  karyawan: {
    entity: 'karyawan',
    table: 'employees',
    title: 'Master Karyawan',
    singular: 'Karyawan',
    description: 'Kelola data karyawan pos security, nomor RFID, jabatan, dan status pendaftaran wajah.',
    sheetName: 'Master Karyawan',
    exportFilename: 'Master_Karyawan.xlsx',
    exportHeaders: ['NO RFID', 'NAMA', 'JABATAN', 'NO ID'],
    previewColumns: [
      { key: 'rfid_no', label: 'No RFID' },
      { key: 'name', label: 'Nama' },
      { key: 'position', label: 'Jabatan' },
      { key: 'employee_no', label: 'No ID' },
    ],
    defaultSortKey: 'name',
    hasFaceStatus: true,
  },
  pengawal: {
    entity: 'pengawal',
    table: 'escorts',
    title: 'Master Pengawal',
    singular: 'Pengawal',
    description: 'Kelola daftar personel pengawal beserta vendor dan status template wajah.',
    sheetName: 'Master Pengawal',
    exportFilename: 'Master_Pengawal.xlsx',
    exportHeaders: ['NAMA', 'VENDOR'],
    previewColumns: [
      { key: 'name', label: 'Nama Pengawal' },
      { key: 'vendor', label: 'Vendor' },
    ],
    defaultSortKey: 'name',
    hasFaceStatus: true,
  },
  area: {
    entity: 'area',
    table: 'areas',
    title: 'Master Area',
    singular: 'Area',
    description: 'Kelola daftar area layanan FLM yang muncul sebagai pilihan autocomplete di kiosk.',
    sheetName: 'Master Area',
    exportFilename: 'Master_Area.xlsx',
    exportHeaders: ['AREA'],
    previewColumns: [{ key: 'name', label: 'Nama Area' }],
    defaultSortKey: 'name',
    hasFaceStatus: false,
  },
  nopol: {
    entity: 'nopol',
    table: 'vehicles',
    title: 'Master Nopol',
    singular: 'Nomor Polisi',
    description: 'Kelola nomor polisi kendaraan operasional untuk FLM, RPL, CIT, dan Mutasi Bengkel.',
    sheetName: 'Master Nopol',
    exportFilename: 'Master_Nopol.xlsx',
    exportHeaders: ['NOPOL'],
    previewColumns: [{ key: 'plate', label: 'Nomor Polisi' }],
    defaultSortKey: 'plate',
    hasFaceStatus: false,
  },
  bengkel: {
    entity: 'bengkel',
    table: 'workshops',
    title: 'Master Bengkel',
    singular: 'Bengkel',
    description: 'Kelola daftar bengkel rekanan untuk suggestion di form Mutasi Bengkel.',
    sheetName: 'Master Bengkel',
    exportFilename: 'Master_Bengkel.xlsx',
    exportHeaders: ['NAMA BENGKEL'],
    previewColumns: [{ key: 'name', label: 'Nama Bengkel' }],
    defaultSortKey: 'name',
    hasFaceStatus: false,
  },
};

export function isValidMasterEntity(entity: string): entity is MasterEntityKey {
  return entity in MASTER_CONFIG;
}


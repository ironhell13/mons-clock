import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

function cleanText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePlate(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function findExcelPath(): string {
  const candidates = [
    path.join(process.cwd(), 'Master Data Absen Security.xlsx'),
    path.join(process.cwd(), 'Master_Data_Absen_Security.xlsx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'File Master Data Absen Security.xlsx atau Master_Data_Absen_Security.xlsx tidak ditemukan di root workspace.'
  );
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[cleanText(k).toUpperCase()] = v;
  }
  return out;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isDryRun && (!url || !serviceKey)) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di environment.');
  }

  const supabase = !isDryRun && url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  const filePath = findExcelPath();
  console.log(`Membaca file master: ${filePath}`);
  const workbook = XLSX.readFile(filePath);

  // 1. Master Karyawan
  const karyawanSheet = workbook.Sheets['Master Karyawan'];
  if (!karyawanSheet) throw new Error('Sheet "Master Karyawan" tidak ditemukan.');
  const karyawanRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(karyawanSheet, { defval: '' })
    .map(normalizeRowKeys);

  const employeeMap = new Map<
    string,
    { rfid_no: string | null; name: string; position: string; employee_no: string; is_active: boolean }
  >();
  for (const row of karyawanRows) {
    const employeeNo = cleanText(row['NO ID']);
    const name = cleanText(row['NAMA']);
    const position = cleanText(row['JABATAN']);
    const rfidNo = cleanText(row['NO RFID']) || null;
    if (!employeeNo || !name) continue;
    employeeMap.set(employeeNo, {
      rfid_no: rfidNo,
      name,
      position: position || '-',
      employee_no: employeeNo,
      is_active: true,
    });
  }
  const employees = Array.from(employeeMap.values());
  if (supabase) {
    const { error: empErr } = await supabase
      .from('employees')
      .upsert(employees, { onConflict: 'employee_no' });
    if (empErr) throw empErr;
  }
  console.log(`Master Karyawan: ${employees.length} baris siap/di-upsert.`);

  // 2. Master Pengawal
  const pengawalSheet = workbook.Sheets['Master Pengawal'];
  if (!pengawalSheet) throw new Error('Sheet "Master Pengawal" tidak ditemukan.');
  const pengawalRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(pengawalSheet, { defval: '' })
    .map(normalizeRowKeys);

  const escortMap = new Map<string, { name: string; vendor: string; is_active: boolean }>();
  for (const row of pengawalRows) {
    const name = cleanText(row['NAMA']);
    const vendor = cleanText(row['VENDOR']);
    if (!name || !vendor) continue;
    const dedupKey = `${name.toLowerCase()}|||${vendor.toLowerCase()}`;
    if (!escortMap.has(dedupKey)) {
      escortMap.set(dedupKey, { name, vendor, is_active: true });
    }
  }
  const escorts = Array.from(escortMap.values());
  if (supabase) {
    const { error: escErr } = await supabase
      .from('escorts')
      .upsert(escorts, { onConflict: 'name,vendor' });
    if (escErr) throw escErr;
  }
  console.log(`Master Pengawal: ${escorts.length} baris siap/di-upsert.`);

  // 3. Master Area
  const areaSheet = workbook.Sheets['Master Area'];
  if (!areaSheet) throw new Error('Sheet "Master Area" tidak ditemukan.');
  const areaRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(areaSheet, { defval: '' })
    .map(normalizeRowKeys);

  const areaMap = new Map<string, { name: string; is_active: boolean }>();
  for (const row of areaRows) {
    const name = cleanText(row['AREA']);
    if (!name) continue;
    const dedupKey = name.toLowerCase();
    if (!areaMap.has(dedupKey)) {
      areaMap.set(dedupKey, { name, is_active: true });
    }
  }
  const areas = Array.from(areaMap.values());
  if (supabase) {
    const { error: areaErr } = await supabase
      .from('areas')
      .upsert(areas, { onConflict: 'name' });
    if (areaErr) throw areaErr;
  }
  console.log(`Master Area: ${areas.length} baris siap/di-upsert.`);

  // 4. Master Nopol
  const nopolSheet = workbook.Sheets['Master Nopol'];
  if (!nopolSheet) throw new Error('Sheet "Master Nopol" tidak ditemukan.');
  const nopolRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(nopolSheet, { defval: '' })
    .map(normalizeRowKeys);

  const vehicleMap = new Map<string, { plate: string; is_active: boolean }>();
  for (const row of nopolRows) {
    const plate = normalizePlate(row['NOPOL']);
    if (!plate) continue;
    vehicleMap.set(plate, { plate, is_active: true });
  }
  const vehicles = Array.from(vehicleMap.values());
  if (supabase) {
    const { error: vehErr } = await supabase
      .from('vehicles')
      .upsert(vehicles, { onConflict: 'plate' });
    if (vehErr) throw vehErr;
  }
  console.log(`Master Nopol: ${vehicles.length} baris siap/di-upsert.`);

  // 5. Master Bengkel
  const bengkelSheet = workbook.Sheets['Master Bengkel'];
  if (!bengkelSheet) throw new Error('Sheet "Master Bengkel" tidak ditemukan.');
  const bengkelRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(bengkelSheet, { defval: '' })
    .map(normalizeRowKeys);

  const workshopMap = new Map<string, { name: string; is_active: boolean }>();
  for (const row of bengkelRows) {
    const name = cleanText(row['NAMA BENGKEL']);
    if (!name) continue;
    const dedupKey = name.toLowerCase();
    if (!workshopMap.has(dedupKey)) {
      workshopMap.set(dedupKey, { name, is_active: true });
    }
  }
  const workshops = Array.from(workshopMap.values());
  if (supabase) {
    const { error: wsErr } = await supabase
      .from('workshops')
      .upsert(workshops, { onConflict: 'name' });
    if (wsErr) throw wsErr;
  }
  console.log(`Master Bengkel: ${workshops.length} baris siap/di-upsert.`);

  console.log('Seed 5 data master selesai tanpa error!');
}

main().catch((err) => {
  console.error('Gagal seed master:', err);
  process.exit(1);
});

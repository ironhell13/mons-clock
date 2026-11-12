import { z } from 'zod';

export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizePlate(value: string): string {
  return cleanText(value).toUpperCase();
}

export const plateRegex = /^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}$/;

export const loginSchema = z.object({
  email: z.string().trim().email('Format email tidak valid.'),
  password: z.string().min(6, 'Password minimal 6 karakter.'),
});

export const employeeSchema = z.object({
  rfid_no: z.string().trim().optional().nullable(),
  name: z.string().trim().min(2, 'Nama karyawan minimal 2 karakter.'),
  position: z.string().trim().min(2, 'Jabatan wajib diisi.'),
  employee_no: z.string().trim().min(1, 'No ID karyawan wajib diisi.'),
  is_active: z.boolean().optional().default(true),
});

export const escortSchema = z.object({
  name: z.string().trim().min(2, 'Nama pengawal minimal 2 karakter.'),
  vendor: z.string().trim().min(2, 'Nama vendor wajib diisi.'),
  is_active: z.boolean().optional().default(true),
});

export const areaSchema = z.object({
  name: z.string().trim().min(2, 'Nama area wajib diisi.'),
  is_active: z.boolean().optional().default(true),
});

export const vehicleSchema = z.object({
  plate: z
    .string()
    .transform((v) => normalizePlate(v))
    .refine((v) => v.length >= 3, 'Nomor polisi minimal 3 karakter.')
    .refine((v) => plateRegex.test(v), 'Format nopol tidak valid (contoh: B 1549 SZV).'),
  is_active: z.boolean().optional().default(true),
});

export const workshopSchema = z.object({
  name: z.string().trim().min(2, 'Nama bengkel wajib diisi.'),
  is_active: z.boolean().optional().default(true),
});

export const positionSchema = z.object({
  name: z.string().trim().min(2, 'Nama jabatan minimal 2 karakter.'),
  is_active: z.boolean().optional().default(true),
});

export const vendorSchema = z.object({
  name: z.string().trim().min(2, 'Nama vendor minimal 2 karakter.'),
  is_active: z.boolean().optional().default(true),
});

export const guestLogSchema = z.object({
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal wajib diisi.'),
  time_in: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Jam masuk wajib diisi.'),
  time_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam keluar tidak valid.')
    .optional()
    .nullable()
    .or(z.literal('')),
  name: z.string().trim().min(2, 'Nama tamu wajib diisi.'),
  vehicle_plate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? normalizePlate(v) : null)),
  origin: z.string().trim().min(2, 'Asal / instansi tamu wajib diisi.'),
  notes: z.string().trim().optional().nullable(),
});

export const workshopLogSchema = z
  .object({
    vehicle_plate: z
      .string()
      .transform((v) => normalizePlate(v))
      .refine((v) => v.length >= 3, 'Nomor polisi wajib diisi.'),
    out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal keluar wajib diisi.'),
    km_out: z.coerce.number().int().min(0, 'KM keluar minimal 0.'),
    finish_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal selesai tidak valid.')
      .optional()
      .nullable()
      .or(z.literal('')),
    km_back: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
      z.number().int().min(0, 'KM kembali minimal 0.').nullable().optional()
    ),
    workshop_name: z.string().trim().min(2, 'Nama bengkel wajib diisi.'),
    insurance_type: z.enum(['non_asuransi', 'asuransi']),
    notes: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.finish_date && data.finish_date < data.out_date) {
        return false;
      }
      return true;
    },
    {
      message: 'Tanggal selesai tidak boleh lebih awal dari tanggal keluar.',
      path: ['finish_date'],
    }
  )
  .refine(
    (data) => {
      if (data.km_back !== null && data.km_back !== undefined && data.km_back < data.km_out) {
        return false;
      }
      return true;
    },
    {
      message: 'KM kembali tidak boleh lebih kecil dari KM keluar.',
      path: ['km_back'],
    }
  );

export const goodsLogSchema = z.object({
  direction: z.enum(['masuk', 'keluar']),
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal wajib diisi.'),
  time_in: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam masuk tidak valid.')
    .optional()
    .nullable()
    .or(z.literal('')),
  time_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format jam keluar tidak valid.')
    .optional()
    .nullable()
    .or(z.literal('')),
  name: z.string().trim().min(2, 'Nama pengirim/penerima wajib diisi.'),
  vehicle_plate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? normalizePlate(v) : null)),
  item_name: z.string().trim().min(2, 'Nama barang wajib diisi.'),
  item_qty: z.coerce.number().int().min(1, 'Jumlah barang minimal 1.'),
  notes: z.string().trim().optional().nullable(),
});

export const attendanceScanSchema = z.object({
  employee_id: z.string().uuid('ID karyawan tidak valid.'),
  mode: z.enum(['masuk', 'istirahat', 'pulang']),
  match_distance: z.number().min(0).max(2),
});

export const tripDepartSchema = z
  .object({
    trip_type: z.enum(['FLM', 'RPL', 'CIT']),
    staff1_id: z.string().uuid('ID Staff 1 tidak valid.'),
    staff2_id: z.string().uuid('ID Staff 2 tidak valid.').optional().nullable(),
    escort_id: z.string().uuid('ID Pengawal tidak valid.').optional().nullable(),
    plate: z
      .string()
      .transform((v) => normalizePlate(v))
      .refine((v) => v.length >= 2, 'Nomor polisi wajib diisi.'),
    km_start: z.coerce.number().int().min(0, 'KM awal minimal 0.'),
    area_id: z.string().uuid('Area wajib dipilih dari master.').optional().nullable(),
    run_code: z.string().trim().optional().nullable(),
    depart_at_token: z.string().datetime().optional(),
  })
  .refine((d) => !d.staff2_id || d.staff2_id !== d.staff1_id, {
    message: 'Staff 2 tidak boleh sama dengan Staff 1.',
    path: ['staff2_id'],
  })
  .refine(
    (d) => {
      if (d.trip_type === 'FLM') return Boolean(d.area_id);
      return Boolean(d.run_code && d.run_code.trim().length > 0);
    },
    {
      message: 'Area (FLM) atau kode RUN (RPL/CIT) wajib diisi.',
      path: ['area_id'],
    }
  );

export const tripReturnSchema = z.object({
  trip_id: z.string().uuid('ID trip tidak valid.'),
  scanned_employee_id: z.string().uuid('ID karyawan tidak valid.'),
  km_end: z.coerce.number().int().min(0, 'KM akhir minimal 0.'),
});

export const faceEnrollSchema = z.object({
  subject_type: z.enum(['employee', 'escort']),
  subject_id: z.string().uuid('ID subjek tidak valid.'),
  pin: z.string().optional(),
  samples: z
    .array(
      z.object({
        descriptor: z.array(z.number()).length(128, 'Descriptor harus 128 dimensi.'),
        sample_label: z.string().trim().min(1),
      })
    )
    .min(1, 'Minimal 1 sampel wajah diperlukan.')
    .max(10, 'Maksimal 10 sampel sekali simpan.'),
});

export const createUserSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama lengkap minimal 2 karakter.'),
  email: z.string().trim().email('Email tidak valid.'),
  password: z.string().min(6, 'Password minimal 6 karakter.'),
  role: z.enum(['admin', 'absen']),
});

export const updateUserSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['admin', 'absen', 'superadmin']).optional(),
  is_active: z.boolean().optional(),
  new_password: z.string().min(6, 'Password baru minimal 6 karakter.').optional(),
});


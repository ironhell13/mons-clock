export type UserRole = 'superadmin' | 'admin' | 'absen';

export type TripType = 'FLM' | 'RPL' | 'CIT';

export type AttendanceEventType = 'masuk' | 'istirahat' | 'pulang';

export type InsuranceType = 'non_asuransi' | 'asuransi';

export type GoodsDirection = 'masuk' | 'keluar';

export type SubjectType = 'employee' | 'escort';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  rfid_no: string | null;
  name: string;
  position: string;
  employee_no: string;
  is_active: boolean;
  created_at: string;
}

export interface Escort {
  id: string;
  name: string;
  vendor: string;
  is_active: boolean;
  created_at: string;
}

export interface Area {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  is_active: boolean;
  created_at: string;
}

export interface Workshop {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Position {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface FaceTemplate {
  id: string;
  subject_type: SubjectType;
  employee_id: string | null;
  escort_id: string | null;
  descriptor: number[];
  sample_label: string;
  created_at: string;
}

export interface Attendance {
  id: string;
  employee_id: string;
  work_date: string;
  masuk_at: string | null;
  istirahat_at: string | null;
  pulang_at: string | null;
  created_at: string;
  employee?: Pick<Employee, 'id' | 'name' | 'position' | 'employee_no'>;
}

export interface AttendanceEvent {
  id: string;
  employee_id: string;
  attendance_id: string | null;
  event_type: AttendanceEventType;
  occurred_at: string;
  match_distance: number | null;
  created_at: string;
}

export interface Trip {
  id: string;
  trip_type: TripType;
  depart_at: string;
  return_at: string | null;
  staff1_id: string;
  staff2_id: string | null;
  escort_id: string | null;
  plate: string;
  km_start: number;
  km_end: number | null;
  area_id: string | null;
  run_code: string | null;
  duration_minutes: number | null;
  total_km: number | null;
  created_at: string;
  staff1?: Pick<Employee, 'id' | 'name' | 'position' | 'employee_no'> | null;
  staff2?: Pick<Employee, 'id' | 'name' | 'position' | 'employee_no'> | null;
  escort?: Pick<Escort, 'id' | 'name' | 'vendor'> | null;
  area?: Pick<Area, 'id' | 'name'> | null;
}

export interface GuestLog {
  id: string;
  log_date: string;
  time_in: string;
  time_out: string | null;
  name: string;
  vehicle_plate: string | null;
  origin: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WorkshopLog {
  id: string;
  vehicle_plate: string;
  out_date: string;
  km_out: number;
  finish_date: string | null;
  km_back: number | null;
  total_km: number | null;
  repair_days: number | null;
  workshop_name: string;
  insurance_type: InsuranceType;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface GoodsLog {
  id: string;
  direction: GoodsDirection;
  log_date: string;
  time_in: string | null;
  time_out: string | null;
  name: string;
  vehicle_plate: string | null;
  item_name: string;
  item_qty: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}


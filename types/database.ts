export type UserRole = 'superadmin' | 'admin' | 'hrd' | 'absen';

export type TripType = 'FLM' | 'RPL' | 'CIT';

export type AttendanceEventType = 'masuk' | 'istirahat' | 'istirahat_kembali' | 'pulang';

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
  nig?: string | null;
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

export type DecisionZone = 'accept' | 'confirm' | 'reject' | 'manual';

export type VerificationPurpose =
  | 'absen'
  | 'trip_staff1'
  | 'trip_staff2'
  | 'trip_escort';

export interface FaceVerificationCandidate {
  id: string;
  name: string;
  subtitle: string;
  code?: string;
  score?: number;
}

export interface FaceVerification {
  id: string;
  kiosk_user_id: string;
  purpose: VerificationPurpose;
  subject_type: SubjectType;
  subject_id: string | null;
  zone: 'accept' | 'confirm' | 'reject';
  score: number | null;
  second_subject_id: string | null;
  second_score: number | null;
  margin: number | null;
  frames_used: number | null;
  candidates: FaceVerificationCandidate[] | null;
  confirm_attempts: number;
  confirmed_method: 'no_id_last4' | 'rfid' | 'manual_select' | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface FaceLookalikeFlag {
  id: string;
  subject_type: SubjectType;
  subject_a: string;
  subject_b: string;
  created_by: string | null;
  created_at: string;
  subject_a_name?: string;
  subject_b_name?: string;
}

export interface FaceTemplate {
  id: string;
  subject_type: SubjectType;
  employee_id: string | null;
  escort_id: string | null;
  descriptor: number[];
  embedding?: number[] | null;
  pipeline_version?: number;
  quality?: Record<string, unknown> | null;
  sample_label: string;
  created_at: string;
}

export type CorrectionStatus = 'pending_hrd' | 'approved_hrd' | 'rejected_hrd';

export interface Attendance {
  id: string;
  employee_id: string | null;
  escort_id?: string | null;
  subject_type?: SubjectType;
  work_date: string;
  masuk_at: string | null;
  istirahat_at: string | null;
  istirahat_kembali_at: string | null;
  pulang_at: string | null;
  created_at: string;
  employee?: Pick<Employee, 'id' | 'name' | 'position' | 'employee_no'>;
  escort?: Pick<Escort, 'id' | 'name' | 'vendor' | 'nig'>;
  correction_status?: CorrectionStatus | null;
  correction_by?: string | null;
  correction_reason?: string | null;
  correction_at?: string | null;
  validated_by?: string | null;
  validated_at?: string | null;
  validation_notes?: string | null;
  previous_data?: Record<string, unknown> | null;
}

export interface AttendanceEvent {
  id: string;
  employee_id: string | null;
  escort_id?: string | null;
  subject_type?: SubjectType;
  attendance_id: string | null;
  event_type: AttendanceEventType;
  occurred_at: string;
  match_distance: number | null;
  created_at: string;
  employee?: Pick<Employee, 'id' | 'name' | 'position' | 'employee_no'>;
  escort?: Pick<Escort, 'id' | 'name' | 'vendor' | 'nig'>;
  verification_id?: string | null;
  second_subject_id?: string | null;
  second_distance?: number | null;
  margin?: number | null;
  decision_zone?: DecisionZone | null;
  frames_used?: number | null;
  before_state?: Record<string, unknown> | null;
  voided_at?: string | null;
  void_reason?: string | null;
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


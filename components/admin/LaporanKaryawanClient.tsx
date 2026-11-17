'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Edit3,
  History,
  Loader2,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMinutesHuman,
  formatWibDateTime,
  formatWibDateTimeExcel,
  fromWibDatetimeLocal,
  getWibDateString,
  toWibDatetimeLocal,
} from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import {
  AuditLogsModal,
  DeleteLaporanModal,
  type LaporanAuditItem,
} from '@/components/admin/LaporanActionModals';
import type { CorrectionStatus, SubjectType, UserRole } from '@/types/database';

interface AttendanceRow {
  id: string;
  employee_id: string | null;
  escort_id?: string | null;
  subject_type: SubjectType;
  work_date: string;
  masuk_at: string | null;
  istirahat_at: string | null;
  istirahat_kembali_at: string | null;
  pulang_at: string | null;
  correction_status?: CorrectionStatus | null;
  correction_by?: string | null;
  correction_reason?: string | null;
  correction_at?: string | null;
  validated_by?: string | null;
  validated_at?: string | null;
  validation_notes?: string | null;
  employee: { id: string; name: string; position: string; employee_no: string } | null;
  escort?: { id: string; name: string; vendor: string; nig?: string | null } | null;
}

interface EmployeeOption {
  id: string;
  name: string;
  position: string;
  employee_no: string;
}

interface EscortOption {
  id: string;
  name: string;
  vendor: string;
  nig?: string | null;
}

export function LaporanKaryawanClient() {
  const [items, setItems] = useState<AttendanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [escorts, setEscorts] = useState<EscortOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<LaporanAuditItem[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>('admin');
  const [loading, setLoading] = useState(true);

  // Tab filter: 'all' | 'employee' | 'escort' | 'pending'
  const [activeTab, setActiveTab] = useState<'all' | 'employee' | 'escort' | 'pending'>('all');

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [auditOpen, setAuditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Koreksi modal
  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [corrSubjectType, setCorrSubjectType] = useState<SubjectType>('employee');
  const [corrSubjectId, setCorrSubjectId] = useState('');
  const [corrWorkDate, setCorrWorkDate] = useState(getWibDateString());
  const [corrMasuk, setCorrMasuk] = useState('');
  const [corrIstirahat, setCorrIstirahat] = useState('');
  const [corrIstirahatKembali, setCorrIstirahatKembali] = useState('');
  const [corrPulang, setCorrPulang] = useState('');
  const [corrReason, setCorrReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Validasi HRD Modal
  const [validatingRow, setValidatingRow] = useState<AttendanceRow | null>(null);
  const [validateAction, setValidateAction] = useState<'approve' | 'reject'>('approve');
  const [validateNotes, setValidateNotes] = useState('');
  const [validating, setValidating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind: 'karyawan' });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (subjectFilter) params.set('employee_id', subjectFilter);
      const res = await fetch(`/api/laporan?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: AttendanceRow[];
        employees?: EmployeeOption[];
        escorts?: EscortOption[];
        currentUserRole?: UserRole;
        auditLogs?: LaporanAuditItem[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat laporan absensi.');
        return;
      }
      setItems(json.items ?? []);
      setEmployees(json.employees ?? []);
      setEscorts(json.escorts ?? []);
      if (json.currentUserRole) {
        setCurrentUserRole(json.currentUserRole);
      }
      setAuditLogs(json.auditLogs ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, subjectFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const subjectOptions = useMemo(() => {
    const empOpts = employees.map((e) => ({
      value: e.id,
      label: `${e.name} (Karyawan)`,
      sublabel: `${e.position} • No ID: ${e.employee_no}`,
    }));
    const escOpts = escorts.map((esc) => ({
      value: esc.id,
      label: `${esc.name} (Pengawal)`,
      sublabel: `Vendor: ${esc.vendor}${esc.nig ? ` • NIG: ${esc.nig}` : ''}`,
    }));
    return [...empOpts, ...escOpts];
  }, [employees, escorts]);

  const pendingCount = useMemo(
    () => items.filter((r) => r.correction_status === 'pending_hrd').length,
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
      // Filter tab
      if (activeTab === 'employee' && item.subject_type !== 'employee') return false;
      if (activeTab === 'escort' && item.subject_type !== 'escort') return false;
      if (activeTab === 'pending' && item.correction_status !== 'pending_hrd') return false;

      if (!q) return true;
      const empName = item.employee?.name?.toLowerCase() ?? '';
      const empPos = item.employee?.position?.toLowerCase() ?? '';
      const empNo = item.employee?.employee_no?.toLowerCase() ?? '';
      const escName = item.escort?.name?.toLowerCase() ?? '';
      const escVendor = item.escort?.vendor?.toLowerCase() ?? '';
      const escNig = item.escort?.nig?.toLowerCase() ?? '';
      const reason = item.correction_reason?.toLowerCase() ?? '';

      return (
        empName.includes(q) ||
        empPos.includes(q) ||
        empNo.includes(q) ||
        escName.includes(q) ||
        escVendor.includes(q) ||
        escNig.includes(q) ||
        reason.includes(q) ||
        item.work_date.includes(q)
      );
    });

    return [...list].sort((a, b) =>
      sortAsc ? a.work_date.localeCompare(b.work_date) : b.work_date.localeCompare(a.work_date)
    );
  }, [items, activeTab, search, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate, subjectFilter, activeTab]);

  const openCorrection = (row: AttendanceRow) => {
    setIsCreating(false);
    setEditing(row);
    setCorrSubjectType(row.subject_type);
    setCorrSubjectId(row.employee_id || row.escort_id || '');
    setCorrWorkDate(row.work_date);
    setCorrMasuk(toWibDatetimeLocal(row.masuk_at));
    setCorrIstirahat(toWibDatetimeLocal(row.istirahat_at));
    setCorrIstirahatKembali(toWibDatetimeLocal(row.istirahat_kembali_at));
    setCorrPulang(toWibDatetimeLocal(row.pulang_at));
    setCorrReason('');
  };

  const openNewCorrection = () => {
    const today = getWibDateString();
    setIsCreating(true);
    setEditing(null);
    setCorrSubjectType('employee');
    setCorrSubjectId(employees[0]?.id ?? '');
    setCorrWorkDate(today);
    setCorrMasuk(`${today}T08:00`);
    setCorrIstirahat('');
    setCorrIstirahatKembali('');
    setCorrPulang('');
    setCorrReason('');
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (corrReason.trim().length < 5) {
      toast.error('Alasan koreksi wajib diisi minimal 5 karakter.');
      return;
    }
    if (isCreating && !corrSubjectId) {
      toast.error(`Pilih ${corrSubjectType === 'escort' ? 'pengawal' : 'karyawan'} terlebih dahulu.`);
      return;
    }
    if (corrMasuk && corrPulang) {
      const m = fromWibDatetimeLocal(corrMasuk);
      const p = fromWibDatetimeLocal(corrPulang);
      if (m && p && new Date(p) < new Date(m)) {
        toast.error('Jam pulang tidak boleh lebih awal dari jam masuk.');
        return;
      }
    }
    if (corrIstirahat && corrIstirahatKembali) {
      const iStart = fromWibDatetimeLocal(corrIstirahat);
      const iEnd = fromWibDatetimeLocal(corrIstirahatKembali);
      if (iStart && iEnd && new Date(iEnd) < new Date(iStart)) {
        toast.error('Jam kembali istirahat tidak boleh lebih awal dari jam mulai istirahat.');
        return;
      }
    }

    setSaving(true);
    try {
      const isEscort = corrSubjectType === 'escort';
      const res = await fetch('/api/laporan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'attendance',
          id: isCreating ? 'NEW' : editing?.id,
          subject_type: corrSubjectType,
          employee_id: isEscort ? null : corrSubjectId,
          escort_id: isEscort ? corrSubjectId : null,
          work_date: corrWorkDate,
          masuk_local: corrMasuk || null,
          istirahat_local: corrIstirahat || null,
          istirahat_kembali_local: corrIstirahatKembali || null,
          pulang_local: corrPulang || null,
          reason: corrReason.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menyimpan koreksi.');
        return;
      }

      if (currentUserRole === 'admin') {
        toast.success(
          'Koreksi absensi disimpan. Data berstatus "Menunggu Validasi HRD".'
        );
      } else {
        toast.success('Koreksi absensi berhasil disimpan dan disetujui.');
      }

      setEditing(null);
      setIsCreating(false);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const openValidateModal = (row: AttendanceRow, action: 'approve' | 'reject') => {
    setValidatingRow(row);
    setValidateAction(action);
    setValidateNotes(action === 'approve' ? 'Disetujui oleh HRD' : '');
  };

  const handleConfirmValidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatingRow) return;

    if (validateAction === 'reject' && !validateNotes.trim()) {
      toast.error('Catatan penolakan wajib diisi agar admin mengetahui alasannya.');
      return;
    }

    setValidating(true);
    try {
      const res = await fetch('/api/laporan/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_id: validatingRow.id,
          action: validateAction,
          notes: validateNotes.trim(),
        }),
      });

      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memproses validasi.');
        return;
      }

      toast.success(json.message ?? (validateAction === 'approve' ? 'Koreksi disetujui.' : 'Koreksi ditolak.'));
      setValidatingRow(null);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server saat validasi.');
    } finally {
      setValidating(false);
    }
  };

  const handleExport = () => {
    const headers = [
      'TIPE',
      'NO ID / NIG',
      'NAMA LENGKAP',
      'JABATAN / VENDOR',
      'MASUK',
      'MULAI ISTIRAHAT',
      'KEMBALI ISTIRAHAT',
      'DURASI ISTIRAHAT',
      'PULANG',
      'STATUS VALIDASI HRD',
      'ALASAN KOREKSI',
    ];

    const rows = filtered.map((r) => {
      let durationStr = '-';
      if (r.istirahat_at && r.istirahat_kembali_at) {
        const diffMins =
          (new Date(r.istirahat_kembali_at).getTime() - new Date(r.istirahat_at).getTime()) / 60000;
        durationStr = formatMinutesHuman(diffMins);
      }

      const isEsc = r.subject_type === 'escort';
      const staffName = isEsc ? r.escort?.name ?? '-' : r.employee?.name ?? '-';
      const staffCode = isEsc ? r.escort?.nig ?? '-' : r.employee?.employee_no ?? '-';
      const staffRole = isEsc ? r.escort?.vendor ?? '-' : r.employee?.position ?? '-';

      let statusHrd = 'Normal';
      if (r.correction_status === 'pending_hrd') statusHrd = 'Menunggu Validasi HRD';
      else if (r.correction_status === 'approved_hrd') statusHrd = 'Divalidasi HRD';
      else if (r.correction_status === 'rejected_hrd') statusHrd = 'Ditolak HRD';

      return {
        TIPE: isEsc ? 'Pengawal' : 'Karyawan',
        'NO ID / NIG': staffCode,
        'NAMA LENGKAP': staffName,
        'JABATAN / VENDOR': staffRole,
        MASUK: formatWibDateTimeExcel(r.masuk_at),
        'MULAI ISTIRAHAT': formatWibDateTimeExcel(r.istirahat_at),
        'KEMBALI ISTIRAHAT': formatWibDateTimeExcel(r.istirahat_kembali_at),
        'DURASI ISTIRAHAT': durationStr,
        PULANG: formatWibDateTimeExcel(r.pulang_at),
        'STATUS VALIDASI HRD': statusHrd,
        'ALASAN KOREKSI': r.correction_reason ?? '-',
      };
    });

    exportRowsToExcel('Laporan_Absensi_Mutasi.xlsx', 'Absensi & Mutasi', rows, headers);
    toast.success('Export Laporan Absensi berhasil.');
  };

  const isSupervisor = currentUserRole === 'hrd' || currentUserRole === 'superadmin';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold text-ink">Laporan Mutasi & Absensi</h1>
            {isSupervisor ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 text-indigo-800 px-2.5 py-0.5 text-xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5" />
                {currentUserRole === 'superadmin' ? 'Superadmin' : 'Supervisor HRD'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary-100 text-primary-800 px-2.5 py-0.5 text-xs font-bold">
                <Shield className="w-3.5 h-3.5" />
                Admin
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted mt-0.5">
            Riwayat absensi karyawan & pengawal (WIB) dengan audit validasi koreksi oleh HRD.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <History className="w-4 h-4 text-primary-600" />
            <span>Audit Koreksi ({auditLogs.length})</span>
          </button>
          <button
            type="button"
            onClick={openNewCorrection}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <Plus className="w-4 h-4 text-primary-600" />
            <span>Koreksi Susulan</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold shadow-soft transition"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Informasi Alur Validasi untuk Role Admin */}
      {currentUserRole === 'admin' && pendingCount > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 shadow-sm">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Informasi Validasi Koreksi HRD:</span>
            <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
              Terdapat <strong>{pendingCount} data absensi</strong> yang telah Anda ubah/koreksi dan saat ini sedang menunggu validasi serta persetujuan dari Supervisor HRD.
            </p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border-sky pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'all'
              ? 'bg-primary-600 text-white shadow-soft'
              : 'text-ink-muted hover:bg-page hover:text-ink'
          }`}
        >
          Semua ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('employee')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'employee'
              ? 'bg-primary-600 text-white shadow-soft'
              : 'text-ink-muted hover:bg-page hover:text-ink'
          }`}
        >
          Karyawan ({items.filter((i) => i.subject_type === 'employee').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('escort')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'escort'
              ? 'bg-primary-600 text-white shadow-soft'
              : 'text-ink-muted hover:bg-page hover:text-ink'
          }`}
        >
          Pengawal ({items.filter((i) => i.subject_type === 'escort').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
            activeTab === 'pending'
              ? 'bg-amber-500 text-white shadow-soft'
              : 'text-amber-700 bg-amber-50 hover:bg-amber-100'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Menunggu Validasi HRD</span>
          {pendingCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                activeTab === 'pending' ? 'bg-white text-amber-700' : 'bg-amber-500 text-white'
              }`}
            >
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama karyawan, pengawal, jabatan, NIG, alasan..."
              className="w-full rounded-xl border border-border-sky bg-page/50 pl-10 pr-4 py-2.5 text-sm focus:border-primary-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="w-full sm:w-72">
            <AutocompleteInput
              options={subjectOptions}
              value={subjectFilter}
              onChange={(val) => setSubjectFilter(val)}
              placeholder="Filter nama orang..."
              allowFreeText={false}
              clearable
              compact
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-ink-muted" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs focus:border-primary-600 focus:outline-none"
            />
            <span className="text-ink-muted">s/d</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs focus:border-primary-600 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Belum ada data absensi"
            description="Data absensi dari kiosk tablet atau koreksi admin akan tampil di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSortAsc((p) => !p)}
                      className="inline-flex items-center gap-1 hover:text-primary-700"
                    >
                      <span>Masuk</span>
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Mulai Istirahat</th>
                  <th className="px-4 py-3">Kembali Istirahat</th>
                  <th className="px-4 py-3">Pulang</th>
                  <th className="px-4 py-3">Staff / Personel</th>
                  <th className="px-4 py-3">Divisi / Vendor</th>
                  <th className="px-4 py-3">Status Validasi HRD</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((row) => {
                  const isEsc = row.subject_type === 'escort';
                  const staffName = isEsc ? row.escort?.name ?? '-' : row.employee?.name ?? '-';
                  const staffRole = isEsc
                    ? `Vendor: ${row.escort?.vendor ?? '-'}`
                    : row.employee?.position ?? '-';
                  const staffCode = isEsc
                    ? row.escort?.nig ? `NIG: ${row.escort.nig}` : null
                    : row.employee?.employee_no ? `ID: ${row.employee.employee_no}` : null;

                  const hasBreakStart = Boolean(row.istirahat_at);
                  const hasBreakEnd = Boolean(row.istirahat_kembali_at);
                  let breakDurationLabel: string | null = null;
                  if (row.istirahat_at && row.istirahat_kembali_at) {
                    const diffM =
                      (new Date(row.istirahat_kembali_at).getTime() -
                        new Date(row.istirahat_at).getTime()) /
                      60000;
                    breakDurationLabel = formatMinutesHuman(diffM);
                  }

                  const isPending = row.correction_status === 'pending_hrd';
                  const isApproved = row.correction_status === 'approved_hrd';
                  const isRejected = row.correction_status === 'rejected_hrd';

                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-page/50 transition ${
                        isPending ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium text-ink">
                        {formatWibDateTime(row.masuk_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-ink-muted">
                        {formatWibDateTime(row.istirahat_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium">
                        {hasBreakEnd ? (
                          <div>
                            <span className="text-ink-muted">
                              {formatWibDateTime(row.istirahat_kembali_at)}
                            </span>
                            {breakDurationLabel && (
                              <span className="block text-xs font-bold text-primary-700">
                                {breakDurationLabel}
                              </span>
                            )}
                          </div>
                        ) : hasBreakStart && !row.pulang_at ? (
                          <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                            Sedang istirahat
                          </span>
                        ) : (
                          <span className="text-ink-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium">
                        {row.pulang_at ? (
                          formatWibDateTime(row.pulang_at)
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                            Belum pulang
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-ink">{staffName}</span>
                          {isEsc && (
                            <span className="rounded bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[10px] font-bold">
                              Pengawal
                            </span>
                          )}
                        </div>
                        {staffCode && (
                          <span className="text-xs text-ink-muted font-mono block">
                            {staffCode}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted">{staffRole}</td>
                      <td className="px-4 py-3">
                        {isPending ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-bold animate-pulse">
                              <Clock className="w-3.5 h-3.5" />
                              Menunggu Validasi HRD
                            </span>
                            {row.correction_reason && (
                              <span className="block text-[11px] text-ink-muted truncate max-w-[180px] mt-0.5" title={row.correction_reason}>
                                Koreksi: {row.correction_reason}
                              </span>
                            )}
                          </div>
                        ) : isApproved ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Divalidasi HRD
                            </span>
                            {row.validation_notes && (
                              <span className="block text-[11px] text-emerald-700/80 truncate max-w-[180px] mt-0.5" title={row.validation_notes}>
                                {row.validation_notes}
                              </span>
                            )}
                          </div>
                        ) : isRejected ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2.5 py-0.5 text-xs font-semibold">
                              <XCircle className="w-3.5 h-3.5" />
                              Ditolak HRD
                            </span>
                            {row.validation_notes && (
                              <span className="block text-[11px] text-rose-700/80 truncate max-w-[180px] mt-0.5" title={row.validation_notes}>
                                {row.validation_notes}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-ink-muted font-mono">Normal</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Tombol Validasi untuk Supervisor HRD / Superadmin */}
                          {isSupervisor && isPending && (
                            <>
                              <button
                                type="button"
                                onClick={() => openValidateModal(row, 'approve')}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2.5 py-1.5 text-xs font-bold transition shadow-sm"
                                title="Setujui koreksi admin"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Setujui</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openValidateModal(row, 'reject')}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 px-2.5 py-1.5 text-xs font-bold transition shadow-sm"
                                title="Tolak & kembalikan data semula"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Tolak</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => openCorrection(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-primary-50 hover:text-primary-700 px-2.5 py-1.5 text-xs font-semibold transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Koreksi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-danger/10 hover:border-danger/30 hover:text-danger px-2.5 py-1.5 text-xs font-semibold transition"
                            title="Hapus data absensi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DataTablePagination
          totalItems={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Modal Validasi Koreksi (Khusus HRD / Superadmin) */}
      <Modal
        open={Boolean(validatingRow)}
        onClose={() => setValidatingRow(null)}
        title={
          validateAction === 'approve'
            ? 'Setujui Koreksi Absensi (Validasi HRD)'
            : 'Tolak Koreksi Absensi (Validasi HRD)'
        }
        description={
          validateAction === 'approve'
            ? 'Persetujuan ini akan mengesahkan perubahan data absensi yang diajukan oleh Admin.'
            : 'Penolakan akan mengembalikan jam absensi ke kondisi sebelum diedit oleh Admin.'
        }
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleConfirmValidation} className="space-y-4">
          <div className="rounded-xl border border-border-sky bg-page/60 p-3.5 space-y-2 text-xs">
            <div>
              <span className="text-ink-muted">Personel:</span>{' '}
              <span className="font-bold text-ink">
                {validatingRow?.subject_type === 'escort'
                  ? validatingRow.escort?.name
                  : validatingRow?.employee?.name}
              </span>{' '}
              ({validatingRow?.subject_type === 'escort' ? 'Pengawal' : 'Karyawan'})
            </div>
            <div>
              <span className="text-ink-muted">Tanggal Shift:</span>{' '}
              <span className="font-semibold text-ink">{validatingRow?.work_date}</span>
            </div>
            <div>
              <span className="text-ink-muted">Alasan Pengajuan Admin:</span>
              <p className="font-medium text-ink bg-white p-2 rounded-lg border border-border-sky mt-1">
                {validatingRow?.correction_reason || '-'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">
              {validateAction === 'approve' ? 'Catatan Persetujuan (Opsional)' : 'Alasan Penolakan *'}
            </label>
            <textarea
              rows={2}
              required={validateAction === 'reject'}
              value={validateNotes}
              onChange={(e) => setValidateNotes(e.target.value)}
              placeholder={
                validateAction === 'approve'
                  ? 'Contoh: Disetujui sesuai konfirmasi surat tugas'
                  : 'Contoh: Bukti kehadiran tidak sinkron dengan log pos'
              }
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setValidatingRow(null)}
              className="rounded-xl border border-border-sky px-4 py-2.5 text-sm font-semibold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={validating}
              className={`rounded-xl text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2 ${
                validateAction === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {validating && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{validateAction === 'approve' ? 'Konfirmasi Setujui' : 'Konfirmasi Tolak'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Koreksi / Tambah Baru */}
      <Modal
        open={Boolean(editing) || isCreating}
        onClose={() => {
          setEditing(null);
          setIsCreating(false);
        }}
        title={
          isCreating
            ? 'Tambah Koreksi Absensi Susulan'
            : `Koreksi Absensi: ${
                editing?.subject_type === 'escort'
                  ? editing?.escort?.name
                  : editing?.employee?.name ?? ''
              }`
        }
        description={
          currentUserRole === 'admin'
            ? 'Perhatian: Koreksi yang dibuat Admin akan berstatus "Menunggu Validasi HRD".'
            : 'Setiap koreksi wajib disertai alasan dan tersimpan permanen di Audit Log.'
        }
      >
        <form onSubmit={handleSaveCorrection} className="space-y-4">
          {isCreating && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Jenis Personel *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCorrSubjectType('employee');
                      setCorrSubjectId(employees[0]?.id ?? '');
                    }}
                    className={`rounded-xl py-2 text-xs font-bold border transition ${
                      corrSubjectType === 'employee'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-border-sky bg-white text-ink-muted'
                    }`}
                  >
                    Karyawan
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCorrSubjectType('escort');
                      setCorrSubjectId(escorts[0]?.id ?? '');
                    }}
                    className={`rounded-xl py-2 text-xs font-bold border transition ${
                      corrSubjectType === 'escort'
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-border-sky bg-white text-ink-muted'
                    }`}
                  >
                    Pengawal
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-ink mb-1">
                    {corrSubjectType === 'escort' ? 'Pilih Pengawal *' : 'Pilih Karyawan *'}
                  </label>
                  <AutocompleteInput
                    options={
                      corrSubjectType === 'escort'
                        ? escorts.map((esc) => ({
                            value: esc.id,
                            label: esc.name,
                            sublabel: `Vendor: ${esc.vendor}${esc.nig ? ` • NIG: ${esc.nig}` : ''}`,
                          }))
                        : employees.map((e) => ({
                            value: e.id,
                            label: e.name,
                            sublabel: `${e.position} • No ID: ${e.employee_no}`,
                          }))
                    }
                    value={corrSubjectId}
                    onChange={(val) => setCorrSubjectId(val)}
                    placeholder={`Ketik nama ${corrSubjectType === 'escort' ? 'pengawal' : 'karyawan'}...`}
                    allowFreeText={false}
                    clearable
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-ink mb-1">Tanggal Shift *</label>
                  <input
                    type="date"
                    value={corrWorkDate}
                    onChange={(e) => setCorrWorkDate(e.target.value)}
                    className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Jam Masuk (WIB)</label>
            <input
              type="datetime-local"
              value={corrMasuk}
              onChange={(e) => setCorrMasuk(e.target.value)}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Mulai Istirahat (WIB)</label>
              <input
                type="datetime-local"
                value={corrIstirahat}
                onChange={(e) => setCorrIstirahat(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Kembali Istirahat (WIB)</label>
              <input
                type="datetime-local"
                value={corrIstirahatKembali}
                onChange={(e) => setCorrIstirahatKembali(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Jam Pulang (WIB)</label>
            <input
              type="datetime-local"
              value={corrPulang}
              onChange={(e) => setCorrPulang(e.target.value)}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Alasan Koreksi *</label>
            <textarea
              rows={2}
              required
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder="Contoh: Karyawan/pengawal lupa scan wajah saat pulang shift malam"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setIsCreating(false);
              }}
              className="rounded-xl border border-border-sky px-4 py-2.5 text-sm font-semibold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Simpan Koreksi</span>
            </button>
          </div>
        </form>
      </Modal>

      <DeleteLaporanModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Data Absensi"
        summary={
          deleteTarget?.subject_type === 'escort'
            ? `Absensi Pengawal: ${deleteTarget.escort?.name ?? ''} (${deleteTarget.work_date})`
            : `Absensi Karyawan: ${deleteTarget?.employee?.name ?? ''} (${deleteTarget?.work_date ?? ''})`
        }
        loading={deleting}
        onConfirm={async (reason) => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            const res = await fetch('/api/laporan', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: 'attendance',
                id: deleteTarget.id,
                reason,
              }),
            });
            const json = (await res.json()) as { error?: string };
            if (!res.ok) {
              toast.error(json.error ?? 'Gagal menghapus data absensi.');
              return;
            }
            toast.success('Data absensi berhasil dihapus.');
            setDeleteTarget(null);
            await loadData();
          } catch {
            toast.error('Gagal terhubung ke server.');
          } finally {
            setDeleting(false);
          }
        }}
      />

      <AuditLogsModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Audit Log Koreksi Absensi"
        auditLogs={auditLogs}
      />
    </div>
  );
}

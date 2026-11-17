'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Flag,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface AuditSummary {
  total_people: number;
  safe_count: number;
  vulnerable_count: number;
  needs_re_enroll_count: number;
  min_distance: number | null;
  histogram: {
    under_040: number;
    range_040_045: number;
    range_045_050: number;
    range_050_055: number;
    range_055_060: number;
    over_060: number;
  };
  threshold_advice: {
    alert: boolean;
    message: string;
    recommended_accept_max: number;
  };
}

interface PairItem {
  personA: { id: string; name: string; subject_type: string; subtitle: string };
  personB: { id: string; name: string; subject_type: string; subtitle: string };
  distance: number;
  is_flagged: boolean;
  flag_id?: string;
}

interface PersonStatItem {
  id: string;
  name: string;
  subtitle: string;
  code: string;
  subject_type: 'employee' | 'escort';
  sample_count: number;
  internal_spread: number;
  nearest_name: string;
  nearest_distance: number | null;
  status: 'Aman' | 'Rawan' | 'Perlu daftar ulang';
  status_reason: string;
}

export function FaceAuditClient() {
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'employee' | 'escort'>('all');
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [topPairs, setTopPairs] = useState<PairItem[]>([]);
  const [personStats, setPersonStats] = useState<PersonStatItem[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/face/audit?subject_type=${filterType}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menjalankan audit kemiripan wajah.');
        return;
      }
      setSummary(json.summary);
      setTopPairs(json.top_pairs);
      setPersonStats(json.person_stats);
      toast.success('Audit kemiripan wajah selesai dijalankan.');
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    runAudit();
  }, [runAudit]);

  const handleToggleFlag = async (pair: PairItem) => {
    const pairKey = `${pair.personA.id}-${pair.personB.id}`;
    setActionLoading(pairKey);
    try {
      if (pair.is_flagged) {
        // Hapus tanda
        const res = await fetch(
          `/api/face/lookalike-flags?subject_a=${pair.personA.id}&subject_b=${pair.personB.id}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error ?? 'Gagal menghapus tanda.');
          return;
        }
        toast.success(`Tanda wajah mirip antara ${pair.personA.name} & ${pair.personB.name} dihapus.`);
      } else {
        // Tandai
        const res = await fetch('/api/face/lookalike-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_type: pair.personA.subject_type,
            subject_a: pair.personA.id,
            subject_b: pair.personB.id,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error ?? 'Gagal menandai pasangan wajah mirip.');
          return;
        }
        toast.success(
          `Pasangan ${pair.personA.name} & ${pair.personB.name} ditandai sebagai wajah mirip. Keduanya akan selalu masuk zona konfirmasi saat scan.`
        );
      }
      await runAudit();
    } catch {
      toast.error('Terjadi kesalahan jaringan.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Audit Kemiripan Wajah</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Analisis jarak antar-wajah, evaluasi kualitas template, dan mitigasi risiko salah absen.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | 'employee' | 'escort')}
            className="rounded-xl border border-border-sky bg-surface px-3 py-2 text-xs font-bold text-ink"
          >
            <option value="all">Semua Subjek</option>
            <option value="employee">Karyawan Saja</option>
            <option value="escort">Pengawal Saja</option>
          </select>

          <button
            type="button"
            onClick={runAudit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2.5 text-xs font-bold shadow-soft transition"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>{loading ? 'Menganalisis...' : 'Jalankan Audit'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-2xl bg-surface border border-border-sky p-4 shadow-soft">
            <span className="text-xs font-bold text-ink-muted">Total Terdaftar</span>
            <div className="text-2xl font-black text-ink mt-1">{summary.total_people}</div>
            <span className="text-[11px] text-ink-muted">Orang memiliki template</span>
          </div>

          <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-4">
            <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Aman
            </span>
            <div className="text-2xl font-black text-emerald-900 mt-1">{summary.safe_count}</div>
            <span className="text-[11px] text-emerald-700">Margin memadai</span>
          </div>

          <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4">
            <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Rawan
            </span>
            <div className="text-2xl font-black text-amber-900 mt-1">{summary.vulnerable_count}</div>
            <span className="text-[11px] text-amber-700">Mirip orang lain (&lt; 0.50)</span>
          </div>

          <div className="rounded-2xl bg-rose-50/70 border border-rose-200 p-4">
            <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Perlu Daftar Ulang
            </span>
            <div className="text-2xl font-black text-rose-900 mt-1">
              {summary.needs_re_enroll_count}
            </div>
            <span className="text-[11px] text-rose-700">&lt; 3 sampel / sebaran tinggi</span>
          </div>

          <div className="rounded-2xl bg-sky-50/70 border border-sky-200 p-4">
            <span className="text-xs font-bold text-sky-800">Jarak Terkecil</span>
            <div className="text-2xl font-black text-sky-900 mt-1">
              {summary.min_distance !== null ? summary.min_distance.toFixed(3) : '-'}
            </div>
            <span className="text-[11px] text-sky-700">Antar 2 orang berbeda</span>
          </div>
        </div>
      )}

      {/* Banner Saran Ambang Batas (Threshold Advice) */}
      {summary?.threshold_advice && (
        <div
          className={`rounded-2xl border p-4 flex items-start gap-3 ${
            summary.threshold_advice.alert
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          {summary.threshold_advice.alert ? (
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          )}
          <div className="text-xs leading-relaxed flex-1">
            <p className="font-bold mb-0.5">
              {summary.threshold_advice.alert
                ? 'Perhatian: Kalibrasi Ambang Batas Disarankan'
                : 'Status Ambang Batas Optimal'}
            </p>
            <p>{summary.threshold_advice.message}</p>
          </div>
        </div>
      )}

      {/* Histogram Distribusi Jarak Antar-Wajah */}
      {summary?.histogram && summary.total_people >= 2 && (
        <div className="rounded-2xl bg-surface border border-border-sky p-5 shadow-soft">
          <h2 className="text-sm font-bold text-ink mb-1">Distribusi Jarak Kemiripan Antar-Orang</h2>
          <p className="text-xs text-ink-muted mb-4">
            Semakin banyak pasangan dengan jarak &gt; 0.50, semakin mudah sistem membedakan wajah antar-karyawan.
          </p>

          <div className="space-y-2">
            {[
              { label: '< 0.40 (Sangat Mirip/Rawan)', count: summary.histogram.under_040, color: 'bg-rose-500' },
              { label: '0.40 - 0.45 (Cukup Mirip)', count: summary.histogram.range_040_045, color: 'bg-amber-500' },
              { label: '0.45 - 0.50 (Batas Waspada)', count: summary.histogram.range_045_050, color: 'bg-yellow-500' },
              { label: '0.50 - 0.55 (Aman)', count: summary.histogram.range_050_055, color: 'bg-sky-500' },
              { label: '0.55 - 0.60 (Sangat Berbeda)', count: summary.histogram.range_055_060, color: 'bg-emerald-500' },
              { label: '>= 0.60 (Beda Total)', count: summary.histogram.over_060, color: 'bg-emerald-600' },
            ].map((bucket) => {
              const maxCount = Math.max(
                1,
                summary.histogram.under_040,
                summary.histogram.range_040_045,
                summary.histogram.range_045_050,
                summary.histogram.range_050_055,
                summary.histogram.range_055_060,
                summary.histogram.over_060
              );
              const pct = (bucket.count / maxCount) * 100;

              return (
                <div key={bucket.label} className="flex items-center gap-3 text-xs">
                  <span className="w-48 font-medium text-ink-muted truncate">{bucket.label}</span>
                  <div className="flex-1 bg-page rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${bucket.color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-bold text-ink">{bucket.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabel 1: Top 20 Pasangan Paling Mirip */}
      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky">
          <h2 className="text-sm font-bold text-ink">Top 20 Pasangan Wajah Paling Mirip</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Pasangan dengan jarak terendah paling berpotensi salah absen. Tandai sebagai &ldquo;Wajah Mirip&rdquo; agar sistem selalu meminta konfirmasi No ID pada kedua orang ini.
          </p>
        </div>

        {topPairs.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-muted">
            Tidak ada pasangan wajah untuk dianalisis (perlu minimal 2 orang terdaftar).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-primary-50 text-ink font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Orang A</th>
                  <th className="px-4 py-3">Orang B</th>
                  <th className="px-4 py-3">Jarak Kemiripan</th>
                  <th className="px-4 py-3">Status Kemiripan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {topPairs.map((pair) => {
                  const pairKey = `${pair.personA.id}-${pair.personB.id}`;
                  const isUnderGuard = pair.distance < 0.50;
                  const isOperating = actionLoading === pairKey;

                  return (
                    <tr key={pairKey} className="hover:bg-page/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink">{pair.personA.name}</div>
                        <div className="text-[11px] text-ink-muted">{pair.personA.subtitle}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink">{pair.personB.name}</div>
                        <div className="text-[11px] text-ink-muted">{pair.personB.subtitle}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded ${
                            pair.distance < 0.38
                              ? 'bg-rose-100 text-rose-800'
                              : pair.distance < 0.46
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-ink'
                          }`}
                        >
                          {pair.distance.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pair.is_flagged ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-800 px-2.5 py-0.5 font-bold">
                            <Flag className="w-3 h-3 fill-purple-700" /> Ditandai Wajah Mirip
                          </span>
                        ) : isUnderGuard ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2.5 py-0.5 font-bold">
                            <AlertTriangle className="w-3 h-3" /> Sangat Rawan Tertukar
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 text-ink-muted px-2.5 py-0.5 font-semibold">
                            Toleransi Normal
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleFlag(pair)}
                          disabled={isOperating}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                            pair.is_flagged
                              ? 'border border-border-sky bg-white hover:bg-page text-ink-muted'
                              : 'bg-purple-600 hover:bg-purple-700 text-white shadow-soft'
                          }`}
                        >
                          {isOperating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Flag className="w-3.5 h-3.5" />
                          )}
                          <span>{pair.is_flagged ? 'Hapus Tanda' : 'Tandai Wajah Mirip'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabel 2: Status Kemiripan Per Orang */}
      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky">
          <h2 className="text-sm font-bold text-ink">Status Kualitas & Keamanan Per Orang</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Daftar seluruh orang yang terdaftar, kestabilan template, dan orang terdekatnya.
          </p>
        </div>

        {personStats.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-muted">Belum ada template wajah terdaftar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-primary-50 text-ink font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Tipe / Info</th>
                  <th className="px-4 py-3">Jml Sampel</th>
                  <th className="px-4 py-3">Sebaran Internal</th>
                  <th className="px-4 py-3">Orang Terdekat & Jarak</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Analisis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {personStats.map((item) => (
                  <tr key={item.id} className="hover:bg-page/50">
                    <td className="px-4 py-3 font-bold text-ink">{item.name}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {item.subtitle} {item.code !== '-' ? `(${item.code})` : ''}
                    </td>
                    <td className="px-4 py-3 font-semibold">{item.sample_count} sampel</td>
                    <td className="px-4 py-3 font-mono">
                      <span className={item.internal_spread > 0.35 ? 'text-rose-600 font-bold' : 'text-ink'}>
                        {item.internal_spread.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {item.nearest_name !== '-' ? (
                        <div>
                          <span className="font-semibold text-ink">{item.nearest_name}</span>{' '}
                          <span className="font-mono text-ink-muted text-[11px]">
                            ({item.nearest_distance?.toFixed(3)})
                          </span>
                        </div>
                      ) : (
                        <span className="text-ink-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-bold ${
                          item.status === 'Aman'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.status === 'Rawan'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {item.status === 'Aman' && <CheckCircle2 className="w-3 h-3" />}
                        {item.status === 'Rawan' && <AlertTriangle className="w-3 h-3" />}
                        {item.status === 'Perlu daftar ulang' && <ShieldAlert className="w-3 h-3" />}
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted max-w-xs">{item.status_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

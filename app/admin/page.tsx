import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatWibDateFull, formatWibDateTime, getWibDateString } from '@/lib/time';
import { Car, ClipboardCheck, Coffee, LogOut, Truck, UserCheck, Wrench } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default async function AdminSummaryPage() {
  const supabase = await createClient();
  const todayWib = getWibDateString();

  const [
    attendanceRes,
    openTripsRes,
    guestsRes,
    workshopRes,
  ] = await Promise.all([
    supabase
      .from('attendance')
      .select('id, masuk_at, istirahat_at, pulang_at')
      .eq('work_date', todayWib),
    supabase
      .from('trips')
      .select(`
        id,
        trip_type,
        depart_at,
        plate,
        km_start,
        run_code,
        staff1:employees!trips_staff1_id_fkey(name),
        staff2:employees!trips_staff2_id_fkey(name),
        escort:escorts(name, vendor),
        area:areas(name)
      `)
      .is('return_at', null)
      .order('depart_at', { ascending: false }),
    supabase.from('guest_logs').select('id', { count: 'exact', head: true }).eq('log_date', todayWib),
    supabase.from('workshop_logs').select('id', { count: 'exact', head: true }).is('finish_date', null),
  ]);

  const attRows = attendanceRes.data ?? [];
  const masukCount = attRows.filter((r) => Boolean(r.masuk_at)).length;
  const istirahatCount = attRows.filter((r) => Boolean(r.istirahat_at) && !r.pulang_at).length;
  const pulangCount = attRows.filter((r) => Boolean(r.pulang_at)).length;
  const openTrips = (openTripsRes.data ?? []) as unknown as {
    id: string;
    trip_type: 'FLM' | 'RPL' | 'CIT';
    depart_at: string;
    plate: string;
    km_start: number;
    run_code: string | null;
    staff1: { name: string } | null;
    staff2: { name: string } | null;
    escort: { name: string; vendor: string } | null;
    area: { name: string } | null;
  }[];
  const guestTodayCount = guestsRes.count ?? 0;
  const inWorkshopCount = workshopRes.count ?? 0;

  const statCards = [
    {
      label: 'Karyawan Masuk',
      value: masukCount,
      icon: ClipboardCheck,
      accent: 'bg-primary-100 text-primary-700',
      href: '/admin/laporan/karyawan',
    },
    {
      label: 'Sedang Istirahat',
      value: istirahatCount,
      icon: Coffee,
      accent: 'bg-amber-100 text-amber-700',
      href: '/admin/laporan/karyawan',
    },
    {
      label: 'Sudah Pulang',
      value: pulangCount,
      icon: LogOut,
      accent: 'bg-emerald-100 text-emerald-700',
      href: '/admin/laporan/karyawan',
    },
    {
      label: 'Trip Berjalan',
      value: openTrips.length,
      icon: Truck,
      accent: 'bg-sky-100 text-sky-700',
      href: '/admin/laporan/flm',
    },
    {
      label: 'Tamu Hari Ini',
      value: guestTodayCount,
      icon: UserCheck,
      accent: 'bg-indigo-100 text-indigo-700',
      href: '/admin/mutasi/tamu',
    },
    {
      label: 'Unit di Bengkel',
      value: inWorkshopCount,
      icon: Wrench,
      accent: 'bg-rose-100 text-rose-700',
      href: '/admin/mutasi/bengkel',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Ringkasan Operasional</h1>
          <p className="text-sm text-ink-muted mt-0.5">{formatWibDateFull(new Date())}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-2xl bg-surface border border-border-sky p-5 shadow-soft hover:border-primary-400 transition group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-muted">{card.label}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.accent}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 text-3xl font-extrabold text-ink tabular-nums group-hover:text-primary-700 transition">
                {card.value}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-border-sky flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Car className="w-5 h-5 text-primary-600" />
            <h2 className="text-base font-bold text-ink">Trip yang Belum Kembali (FLM / RPL / CIT)</h2>
          </div>
          <span className="rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-bold">
            {openTrips.length} aktif
          </span>
        </div>

        {openTrips.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Semua armada sudah kembali"
            description="Saat ini tidak ada trip FLM, RPL, atau CIT yang masih berada di luar kantor."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tipe</th>
                  <th className="px-4 py-3">Waktu Keluar</th>
                  <th className="px-4 py-3">Staff 1</th>
                  <th className="px-4 py-3">Staff 2</th>
                  <th className="px-4 py-3">Pengawal</th>
                  <th className="px-4 py-3">Nopol</th>
                  <th className="px-4 py-3">KM Awal</th>
                  <th className="px-4 py-3">Area / Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {openTrips.map((trip) => (
                  <tr key={trip.id} className="hover:bg-page/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-lg bg-primary-100 text-primary-700 px-2.5 py-1 text-xs font-bold">
                        {trip.trip_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {formatWibDateTime(trip.depart_at)} WIB
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">{trip.staff1?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-ink-muted">{trip.staff2?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {trip.escort ? `${trip.escort.name} (${trip.escort.vendor})` : '-'}
                    </td>
                    <td className="px-4 py-3 font-bold text-ink">{trip.plate}</td>
                    <td className="px-4 py-3 tabular-nums">{trip.km_start.toLocaleString('id-ID')}</td>
                    <td className="px-4 py-3">
                      {trip.trip_type === 'FLM' ? trip.area?.name ?? '-' : trip.run_code ?? '-'}
                    </td>
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


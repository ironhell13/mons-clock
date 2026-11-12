import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Car,
  MapPin,
  Settings2,
  Shield,
  Tag,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function MasterSettingPage() {
  const supabase = await createClient();

  const [empRes, escRes, posRes, venRes, areaRes, vehRes, wsRes] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true }),
    supabase.from('escorts').select('id', { count: 'exact', head: true }),
    supabase.from('positions').select('id', { count: 'exact', head: true }),
    supabase.from('vendors').select('id', { count: 'exact', head: true }),
    supabase.from('areas').select('id', { count: 'exact', head: true }),
    supabase.from('vehicles').select('id', { count: 'exact', head: true }),
    supabase.from('workshops').select('id', { count: 'exact', head: true }),
  ]);

  const refCards = [
    {
      title: 'Master Jabatan (Untuk Karyawan)',
      description:
        'Kelola daftar jabatan resmi (CRUD, aktif/nonaktif, import/export). Pilihan jabatan muncul otomatis saat tambah/edit Karyawan.',
      href: '/admin/master/jabatan',
      count: posRes.error ? null : posRes.count ?? 0,
      unit: 'jabatan',
      icon: Briefcase,
      needsMigration: Boolean(posRes.error),
    },
    {
      title: 'Master Vendor (Untuk Pengawal)',
      description:
        'Kelola daftar vendor pengawal (CRUD, aktif/nonaktif, import/export). Pilihan vendor muncul otomatis saat tambah/edit Pengawal.',
      href: '/admin/master/vendor',
      count: venRes.error ? null : venRes.count ?? 0,
      unit: 'vendor',
      icon: Tag,
      needsMigration: Boolean(venRes.error),
    },
  ];

  const coreCards = [
    {
      title: 'Master Karyawan',
      desc: 'Data karyawan, No RFID, No ID, dan Jabatan.',
      href: '/admin/master/karyawan',
      count: empRes.count ?? 0,
      icon: Users,
    },
    {
      title: 'Master Pengawal',
      desc: 'Data personel pengawal beserta Vendor.',
      href: '/admin/master/pengawal',
      count: escRes.count ?? 0,
      icon: Shield,
    },
    {
      title: 'Master Area',
      desc: 'Daftar area autocomplete untuk mutasi FLM.',
      href: '/admin/master/area',
      count: areaRes.count ?? 0,
      icon: MapPin,
    },
    {
      title: 'Master Nopol',
      desc: 'Daftar nopol operasional (RPL, CIT, dan Bengkel).',
      href: '/admin/master/nopol',
      count: vehRes.count ?? 0,
      icon: Car,
    },
    {
      title: 'Master Bengkel',
      desc: 'Daftar bengkel rekanan untuk Mutasi Bengkel.',
      href: '/admin/master/bengkel',
      count: wsRes.count ?? 0,
      icon: Building2,
    },
  ];

  const showMigrationNotice = refCards.some((c) => c.needsMigration);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
          <Settings2 className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Setting Data Master</h1>
          <p className="text-sm text-ink-muted">
            Pengaturan terpusat untuk data referensi Jabatan, Vendor, dan seluruh Master operasional.
          </p>
        </div>
      </div>

      {showMigrationNotice && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          <strong>Perhatian:</strong> Tabel <code>positions</code> dan <code>vendors</code> belum
          dibuat di Supabase. Jalankan SQL dari file{' '}
          <code>supabase/migrations/0002_master_positions_vendors.sql</code> di Supabase SQL Editor.
        </div>
      )}

      <div>
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-muted mb-3">
          Referensi Karyawan & Pengawal
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {refCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-2xl bg-surface border-2 border-border-sky hover:border-primary-400 shadow-soft p-6 flex flex-col justify-between gap-4 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                    <Icon className="w-6 h-6" />
                  </div>
                  {card.count !== null && (
                    <span className="rounded-full bg-primary-50 border border-border-sky px-3 py-1 text-xs font-extrabold text-primary-700">
                      {card.count} {card.unit}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-ink group-hover:text-primary-700 transition">
                    {card.title}
                  </h3>
                  <p className="text-sm text-ink-muted mt-1 leading-relaxed">{card.description}</p>
                </div>
                <div className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-700">
                  <span>Kelola sekarang</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink-muted mb-3">
          Data Master Utama
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {coreCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-2xl bg-surface border border-border-sky hover:border-primary-400 shadow-soft p-5 flex items-start gap-4 transition"
              >
                <div className="w-10 h-10 rounded-xl bg-page border border-border-sky text-primary-700 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-ink group-hover:text-primary-700 truncate">
                      {card.title}
                    </h3>
                    <span className="text-xs font-bold text-primary-700 tabular-nums">
                      {card.count}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted mt-1">{card.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { Coffee, LogIn, LogOut, ShieldAlert, Truck, Wallet } from 'lucide-react';

const CARDS = [
  {
    title: 'MASUK',
    subtitle: 'Absen kedatangan shift',
    href: '/absen/masuk',
    icon: LogIn,
    gradient: 'from-sky-400 to-sky-600',
    borderHover: 'hover:border-sky-400',
  },
  {
    title: 'ISTIRAHAT',
    subtitle: 'Catat jam istirahat',
    href: '/absen/istirahat',
    icon: Coffee,
    gradient: 'from-sky-500 to-blue-600',
    borderHover: 'hover:border-blue-400',
  },
  {
    title: 'PULANG',
    subtitle: 'Absen selesai kerja',
    href: '/absen/pulang',
    icon: LogOut,
    gradient: 'from-cyan-500 to-sky-700',
    borderHover: 'hover:border-cyan-400',
  },
  {
    title: 'FLM',
    subtitle: 'Keberangkatan & Kembali FLM',
    href: '/absen/trip/flm',
    icon: ShieldAlert,
    gradient: 'from-blue-500 to-indigo-600',
    borderHover: 'hover:border-indigo-400',
  },
  {
    title: 'RPL',
    subtitle: 'Keberangkatan & Kembali RPL',
    href: '/absen/trip/rpl',
    icon: Truck,
    gradient: 'from-sky-600 to-blue-700',
    borderHover: 'hover:border-sky-500',
  },
  {
    title: 'CIT',
    subtitle: 'Keberangkatan & Kembali CIT',
    href: '/absen/trip/cit',
    icon: Wallet,
    gradient: 'from-blue-600 to-cyan-700',
    borderHover: 'hover:border-cyan-500',
  },
];

export default function AbsenHomePage() {
  return (
    <div className="flex-1 flex flex-col justify-center px-6 lg:px-10 py-4 max-w-7xl w-full mx-auto overflow-hidden">
      <div className="grid grid-cols-3 grid-rows-2 gap-4 lg:gap-6 flex-1 max-h-[560px]">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              href={card.href}
              className={`group relative rounded-2xl bg-surface border-2 border-border-sky ${card.borderHover} shadow-card p-5 lg:p-7 flex flex-col items-center justify-center text-center transition duration-200 hover:-translate-y-1 active:scale-[0.98] min-h-[160px]`}
            >
              <div
                className={`w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-gradient-to-br ${card.gradient} text-white flex items-center justify-center shadow-soft mb-3.5 group-hover:scale-105 transition`}
              >
                <Icon className="w-8 h-8 lg:w-10 lg:h-10" />
              </div>
              <h2 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-ink">
                {card.title}
              </h2>
              <p className="text-xs lg:text-sm font-medium text-ink-muted mt-1">
                {card.subtitle}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

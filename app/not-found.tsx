import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="max-w-md w-full rounded-2xl bg-surface border border-border-sky shadow-card p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mx-auto">
          <SearchX className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold text-ink">Halaman Tidak Ditemukan</h1>
        <p className="text-sm text-ink-muted">
          Halaman yang Anda tuju tidak tersedia atau Anda tidak memiliki akses.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-5 py-3 text-sm font-bold transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Beranda</span>
        </Link>
      </div>
    </div>
  );
}


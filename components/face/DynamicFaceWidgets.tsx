'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

export const DynamicFaceScanner = dynamic(
  () => import('@/components/face/FaceScanner').then((mod) => mod.FaceScanner),
  {
    ssr: false,
    loading: () => (
      <div className="w-full max-w-4xl mx-auto rounded-2xl bg-surface border border-border-sky p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <span className="text-sm font-semibold text-ink-muted">Memuat modul kamera...</span>
      </div>
    ),
  }
);

export const DynamicFaceEnrollView = dynamic(
  () => import('@/components/face/FaceEnrollView').then((mod) => mod.FaceEnrollView),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl bg-page p-10 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <span className="text-sm font-semibold text-ink-muted">Menyiapkan kamera pendaftaran...</span>
      </div>
    ),
  }
);


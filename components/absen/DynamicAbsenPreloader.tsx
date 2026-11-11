'use client';

import dynamic from 'next/dynamic';

export const DynamicAbsenPreloader = dynamic(
  () => import('@/components/absen/AbsenPreloader').then((mod) => mod.AbsenPreloader),
  { ssr: false }
);

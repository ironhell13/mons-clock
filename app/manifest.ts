import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MonsClock — Sistem Absensi Wajah Pos Security',
    short_name: 'MonsClock',
    description: 'Sistem absensi pengenalan wajah dan mutasi operasional pos security.',
    start_url: '/absen',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#F0F9FF',
    theme_color: '#0EA5E9',
    icons: [
      {
        src: '/images/logo.jpeg',
        sizes: '512x512',
        type: 'image/jpeg',
      },
    ],
  };
}

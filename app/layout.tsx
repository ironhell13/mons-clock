import type { Metadata } from 'next';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'MonsClock — Sistem Absensi Wajah Pos Security',
  description:
    'Aplikasi absensi berbasis pengenalan wajah dan manajemen mutasi operasional pos security.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        {children}
        <Toaster
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            className: 'rounded-xl font-sans',
          }}
        />
      </body>
    </html>
  );
}

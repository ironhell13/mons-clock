import { requirePageRole } from '@/lib/auth';
import { AbsenHeader } from '@/components/absen/AbsenHeader';
import { DynamicAbsenPreloader } from '@/components/absen/DynamicAbsenPreloader';

export default async function AbsenLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requirePageRole(['absen']);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-page via-white to-primary-50">
      <DynamicAbsenPreloader />
      <AbsenHeader />
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}


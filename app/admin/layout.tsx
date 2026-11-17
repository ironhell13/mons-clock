import { requirePageRole } from '@/lib/auth';
import { AdminShell } from '@/components/admin/AdminShell';

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { profile } = await requirePageRole(['admin', 'hrd', 'superadmin']);
  return <AdminShell profile={profile}>{children}</AdminShell>;
}


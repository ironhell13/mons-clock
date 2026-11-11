import { requirePageRole } from '@/lib/auth';
import { UsersManagerClient } from '@/components/admin/UsersManagerClient';

export default async function AdminUsersPage() {
  await requirePageRole(['superadmin']);
  return <UsersManagerClient />;
}


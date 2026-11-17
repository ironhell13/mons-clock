import { requirePageRole } from '@/lib/auth';
import { FaceAuditClient } from '@/components/admin/FaceAuditClient';

export const metadata = {
  title: 'Audit Kemiripan Wajah - MonsClock Admin',
};

export default async function FaceAuditPage() {
  await requirePageRole(['superadmin']);
  return <FaceAuditClient />;
}


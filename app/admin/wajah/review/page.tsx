import { requirePageRole } from '@/lib/auth';
import { FaceReviewClient } from '@/components/admin/FaceReviewClient';

export const metadata = {
  title: 'Review Absensi Wajah - MonsClock Admin',
};

export default async function FaceReviewPage() {
  await requirePageRole(['superadmin']);
  return <FaceReviewClient />;
}


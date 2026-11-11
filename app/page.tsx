import { redirect } from 'next/navigation';
import { getCurrentSessionProfile } from '@/lib/auth';

export default async function HomePage() {
  const session = await getCurrentSessionProfile();
  if (!session) {
    redirect('/login');
  }
  if (session.profile.role === 'absen') {
    redirect('/absen');
  }
  redirect('/admin');
}

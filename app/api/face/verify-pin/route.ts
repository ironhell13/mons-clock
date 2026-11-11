import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (auth.session.profile.role !== 'absen') {
    return NextResponse.json({ valid: true });
  }

  const expectedPin = process.env.FACE_ENROLL_PIN?.trim();
  if (!expectedPin) {
    return NextResponse.json(
      { error: 'FACE_ENROLL_PIN belum diatur pada server. Hubungi administrator.' },
      { status: 500 }
    );
  }

  const body = (await req.json()) as { pin?: string };
  const inputPin = String(body.pin ?? '').trim();

  if (!inputPin || inputPin !== expectedPin) {
    return NextResponse.json({ error: 'PIN admin tidak sesuai.' }, { status: 403 });
  }

  return NextResponse.json({ valid: true });
}


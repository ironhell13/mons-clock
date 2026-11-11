import crypto from 'crypto';

interface ScanTokenPayload {
  employeeId: string;
  tripType: string;
  scannedAtIso: string;
  expMs: number;
}

function getSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FACE_ENROLL_PIN || 'monsclock-fallback';
  return secret;
}

export function signScanTimestampToken(employeeId: string, tripType: string, scannedAt = new Date()): string {
  const payload: ScanTokenPayload = {
    employeeId,
    tripType,
    scannedAtIso: scannedAt.toISOString(),
    expMs: Date.now() + 10 * 60 * 1000, // Berlaku 10 menit untuk pengisian form
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyScanTimestampToken(
  token: string | undefined,
  expectedEmployeeId: string,
  expectedTripType: string
): Date {
  const serverNow = new Date();
  if (!token) return serverNow;

  const parts = token.split('.');
  if (parts.length !== 2) return serverNow;
  const [encoded, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  if (sig !== expectedSig) return serverNow;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ScanTokenPayload;
    if (
      parsed.employeeId !== expectedEmployeeId ||
      parsed.tripType !== expectedTripType ||
      Date.now() > parsed.expMs
    ) {
      return serverNow;
    }
    const dt = new Date(parsed.scannedAtIso);
    return Number.isNaN(dt.getTime()) ? serverNow : dt;
  } catch {
    return serverNow;
  }
}


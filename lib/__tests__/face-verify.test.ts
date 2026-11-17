import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consumeVerification } from '../face-verify';
import type { FaceVerification } from '@/types/database';

describe('Server-Side Verification Consumer (consumeVerification)', () => {
  const kioskA = 'kiosk-user-aaa';
  const kioskB = 'kiosk-user-bbb';
  const verificationId = 'verif-123';
  const employeeId = 'emp-888';

  function mockSupabase(row: Partial<FaceVerification> | null, updateSuccess = true) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'face_verifications') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: updateSuccess ? { id: verificationId } : null,
                      error: null,
                    }),
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: updateSuccess ? { id: verificationId } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: employeeId,
                name: 'Budi Santoso',
                employee_no: 'EMP001',
                position: 'Staff Operasional',
                is_active: true,
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: employeeId,
                name: 'Budi Santoso',
                employee_no: 'EMP001',
                position: 'Staff Operasional',
                is_active: true,
              },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as SupabaseClient;
  }

  it('menolak token yang tidak ditemukan di database (404)', async () => {
    const client = mockSupabase(null);
    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskA,
      purpose: 'absen',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(404);
      expect(res.error).toContain('tidak ditemukan');
    }
  });

  it('menolak token jika kiosk_user_id berbeda / tidak sah (403)', async () => {
    const client = mockSupabase({
      id: verificationId,
      kiosk_user_id: kioskA,
      purpose: 'absen',
      subject_type: 'employee',
      subject_id: employeeId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      consumed_at: null,
    });

    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskB, // Kiosk penyerang berbeda
      purpose: 'absen',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toContain('pos yang sama');
    }
  });

  it('menolak token yang tujuannya tidak sesuai (purpose mismatch 400)', async () => {
    const client = mockSupabase({
      id: verificationId,
      kiosk_user_id: kioskA,
      purpose: 'trip_staff1', // Di-verify untuk trip
      subject_type: 'employee',
      subject_id: employeeId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      consumed_at: null,
    });

    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskA,
      purpose: 'absen', // Tapi mau dipakai untuk absen
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toContain('tidak sesuai');
    }
  });

  it('menolak token yang telah kedaluwarsa (410)', async () => {
    const client = mockSupabase({
      id: verificationId,
      kiosk_user_id: kioskA,
      purpose: 'absen',
      subject_type: 'employee',
      subject_id: employeeId,
      expires_at: new Date(Date.now() - 5000).toISOString(), // Lewat 5 detik lalu
      consumed_at: null,
    });

    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskA,
      purpose: 'absen',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(410);
      expect(res.error).toContain('kedaluwarsa');
    }
  });

  it('menolak token yang telah digunakan sebelumnya (single-use replay attack 409)', async () => {
    const client = mockSupabase({
      id: verificationId,
      kiosk_user_id: kioskA,
      purpose: 'absen',
      subject_type: 'employee',
      subject_id: employeeId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      consumed_at: new Date(Date.now() - 1000).toISOString(), // Sudah pernah dikonsumsi
    });

    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskA,
      purpose: 'absen',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.error).toContain('telah digunakan');
    }
  });

  it('menerima token yang valid dan mengonsumsinya secara atomik', async () => {
    const client = mockSupabase({
      id: verificationId,
      kiosk_user_id: kioskA,
      purpose: 'absen',
      subject_type: 'employee',
      subject_id: employeeId,
      zone: 'accept',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      consumed_at: null,
    });

    const res = await consumeVerification(client, {
      verificationId,
      kioskUserId: kioskA,
      purpose: 'absen',
      consume: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.subject.id).toBe(employeeId);
      expect(res.subject.name).toBe('Budi Santoso');
    }
  });
});

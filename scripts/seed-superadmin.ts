import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di environment.');
  }
  if (!email || !password) {
    throw new Error('SEED_SUPERADMIN_EMAIL dan SEED_SUPERADMIN_PASSWORD wajib diisi di environment.');
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const normalizedEmail = email.trim().toLowerCase();

  // Cari user yang sudah ada berdasarkan email
  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw listErr;

  let userId = listed.users.find(
    (u) => u.email?.toLowerCase() === normalizedEmail
  )?.id;

  if (!userId) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Superadmin MonsClock' },
    });
    if (createErr) throw createErr;
    userId = created.user.id;
    console.log(`Akun superadmin dibuat: ${normalizedEmail} (${userId})`);
  } else {
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;
    console.log(`Akun superadmin sudah ada, diperbarui: ${normalizedEmail} (${userId})`);
  }

  const { error: profileErr } = await supabase.from('profiles').upsert(
    {
      id: userId,
      email: normalizedEmail,
      full_name: 'Superadmin MonsClock',
      role: 'superadmin',
      is_active: true,
    },
    { onConflict: 'id' }
  );

  if (profileErr) throw profileErr;
  console.log('Profil superadmin berhasil disimpan ke tabel profiles.');
}

main().catch((err) => {
  console.error('Gagal seed superadmin:', err);
  process.exit(1);
});


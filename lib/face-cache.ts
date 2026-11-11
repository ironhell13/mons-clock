'use client';

import type { SubjectType } from '@/types/database';

export interface CachedFaceTemplate {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  name: string;
  subtitle: string;
  descriptor: number[];
}

const CACHE_TTL_MS = 3 * 60 * 1000;

const templateCache = new Map<
  SubjectType,
  { loadedAt: number; templates: CachedFaceTemplate[] }
>();

export async function getCachedFaceTemplates(
  subjectType: SubjectType,
  forceRefresh = false
): Promise<CachedFaceTemplate[]> {
  const existing = templateCache.get(subjectType);
  if (!forceRefresh && existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) {
    return existing.templates;
  }

  const res = await fetch(`/api/face/templates?subject_type=${subjectType}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Gagal memuat template wajah dari server.');
  }
  const json = (await res.json()) as { templates?: CachedFaceTemplate[] };
  const list = json.templates ?? [];
  templateCache.set(subjectType, { loadedAt: Date.now(), templates: list });
  return list;
}

export function invalidateFaceTemplatesCache(subjectType?: SubjectType) {
  if (subjectType) {
    templateCache.delete(subjectType);
  } else {
    templateCache.clear();
  }
}


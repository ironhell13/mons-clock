'use client';

import { useEffect } from 'react';
import { ensureFaceModelsLoaded, getCachedFaceTemplates } from '@/lib/face';
import { getFaceLandmarker } from '@/lib/mediapipe';

export function AbsenPreloader() {
  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      Promise.allSettled([
        getFaceLandmarker(),
        ensureFaceModelsLoaded(),
        getCachedFaceTemplates('employee'),
        getCachedFaceTemplates('escort'),
      ]);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return null;
}

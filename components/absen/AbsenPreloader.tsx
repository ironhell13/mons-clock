'use client';

import { useEffect } from 'react';
import { ensureFaceModelsLoaded } from '@/lib/face';
import { getFaceLandmarker } from '@/lib/mediapipe';

export function AbsenPreloader() {
  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      // Memanaskan model MediaPipe dan face-api di background tanpa mengunduh data vektor biometrik
      Promise.allSettled([
        getFaceLandmarker(),
        ensureFaceModelsLoaded(),
      ]);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return null;
}

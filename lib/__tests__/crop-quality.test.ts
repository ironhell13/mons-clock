import { describe, it, expect } from 'vitest';
import { evaluateCropPixels } from '../mediapipe';

describe('Gate Kualitas Gambar Wajah (evaluateCropPixels)', () => {
  const W = 160;
  const H = 160;

  function createSyntheticImage(
    fillPixel: (x: number, y: number) => { r: number; g: number; b: number }
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const { r, g, b } = fillPixel(x, y);
        const idx = (y * W + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    return data;
  }

  it('harus menerima gambar dengan pencahayaan seimbang dan kontras/ketajaman cukup', () => {
    // Pola checkerboard/gradien tajam untuk menghasilkan Laplacian variance > 60
    const img = createSyntheticImage((x, y) => {
      const isGrid = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      const v = isGrid ? 140 : 100;
      return { r: v, g: v, b: v };
    });

    const res = evaluateCropPixels(img, W, H);
    expect(res.ok).toBe(true);
    expect(res.metrics.brightness).toBeGreaterThanOrEqual(70);
    expect(res.metrics.brightness).toBeLessThanOrEqual(190);
    expect(res.metrics.lrRatio).toBeGreaterThanOrEqual(0.6);
    expect(res.metrics.lrRatio).toBeLessThanOrEqual(1.6);
    expect(res.metrics.sharpness).toBeGreaterThanOrEqual(60);
  });

  it('harus menolak gambar yang terlalu gelap (brightness < 70)', () => {
    const darkImg = createSyntheticImage(() => ({ r: 35, g: 35, b: 35 }));
    const res = evaluateCropPixels(darkImg, W, H);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('gelap');
  });

  it('harus menolak gambar yang terlalu terang / silau (brightness > 190)', () => {
    const brightImg = createSyntheticImage(() => ({ r: 215, g: 215, b: 215 }));
    const res = evaluateCropPixels(brightImg, W, H);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('silau');
  });

  it('harus menolak cahaya tidak merata / backlight samping (rasio L/R di luar [0.6, 1.6])', () => {
    // Sisi kiri sangat terang, sisi kanan sangat gelap
    const sideLightImg = createSyntheticImage((x) => {
      if (x < W / 2) {
        return { r: 170, g: 170, b: 170 };
      }
      return { r: 75, g: 75, b: 75 };
    });

    const res = evaluateCropPixels(sideLightImg, W, H);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('merata');
  });

  it('harus menolak gambar buram tanpa tepi tajam (Laplacian variance < 60)', () => {
    // Gradien sangat halus / warna seragam (ketajaman 0)
    const blurryImg = createSyntheticImage(() => ({ r: 120, g: 120, b: 120 }));
    const res = evaluateCropPixels(blurryImg, W, H);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('buram');
    expect(res.metrics.sharpness).toBe(0);
  });

  it('harus menolak gambar dengan pixel jenuh (clipped pixels > 8%)', () => {
    // 20% pixel jenuh > 250
    const clippedImg = createSyntheticImage((x, y) => {
      const isClipped = y < H * 0.20;
      const v = isClipped ? 255 : 120;
      return { r: v, g: v, b: v };
    });

    const res = evaluateCropPixels(clippedImg, W, H);
    expect(res.ok).toBe(false);
    expect(res.metrics.clippedPct).toBeGreaterThan(8);
  });
});


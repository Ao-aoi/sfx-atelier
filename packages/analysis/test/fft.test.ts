import { describe, expect, it } from "vitest";
import { fft, hann, magnitudeSpectrum } from "../src/fft";
import { rng } from "./signals";

// 期待値は DFT の定義式 X[k] = Σ x[n] e^{-2πikn/N} から
function naiveDft(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re: number[] = [], im: number[] = [];
  for (let k = 0; k < n; k++) {
    let r = 0, i = 0;
    for (let j = 0; j < n; j++) {
      r += x[j]! * Math.cos((-2 * Math.PI * k * j) / n);
      i += x[j]! * Math.sin((-2 * Math.PI * k * j) / n);
    }
    re.push(r); im.push(i);
  }
  return { re, im };
}

describe("fft", () => {
  it("定義どおりの DFT と一致する", () => {
    const r = rng(7);
    const x = Array.from({ length: 64 }, () => r() * 2 - 1);
    const re = Float64Array.from(x), im = new Float64Array(64);
    fft(re, im);
    const want = naiveDft(x);
    for (let k = 0; k < 64; k++) {
      expect(re[k]).toBeCloseTo(want.re[k]!, 9);
      expect(im[k]).toBeCloseTo(want.im[k]!, 9);
    }
  });

  it("k 本目にちょうど乗る余弦波は、k と N-k に N/2 が立つ", () => {
    const n = 256, k = 10;
    const re = Float64Array.from({ length: n }, (_, j) => Math.cos((2 * Math.PI * k * j) / n));
    const im = new Float64Array(n);
    fft(re, im);
    expect(Math.hypot(re[k]!, im[k]!)).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[n - k]!, im[n - k]!)).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[k + 3]!, im[k + 3]!)).toBeLessThan(1e-9);
  });

  it("パーセバルの等式：Σ|x|² = Σ|X|² / N", () => {
    const r = rng(3);
    const x = Array.from({ length: 128 }, () => r() - 0.5);
    const re = Float64Array.from(x), im = new Float64Array(128);
    fft(re, im);
    const time = x.reduce((s, v) => s + v * v, 0);
    let freq = 0;
    for (let k = 0; k < 128; k++) freq += re[k]! ** 2 + im[k]! ** 2;
    expect(freq / 128).toBeCloseTo(time, 9);
  });

  it("2 の累乗でない長さは拒否する", () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow();
  });
});

describe("hann", () => {
  it("両端が 0、真ん中が 1", () => {
    const w = hann(9);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[8]).toBeCloseTo(0, 12);
    expect(w[4]).toBeCloseTo(1, 12);
  });
});

describe("magnitudeSpectrum", () => {
  it("長さ N から N/2 本。k 本目に乗る正弦波は、ハン窓の利得 1/2 で約 N/4 になる", () => {
    const n = 2048, k = 40;
    const x = Float32Array.from({ length: n }, (_, j) => Math.sin((2 * Math.PI * k * j) / n));
    const mag = magnitudeSpectrum(x);
    expect(mag.length).toBe(n / 2);
    let best = 0;
    for (let i = 1; i < mag.length; i++) if (mag[i]! > mag[best]!) best = i;
    expect(best).toBe(k);
    expect(mag[k]! / (n / 4)).toBeCloseTo(1, 2);
  });

  it("短い入力は 0 で埋めて N 点で計算する", () => {
    expect(magnitudeSpectrum(new Float32Array(100), 512).length).toBe(256);
  });
});

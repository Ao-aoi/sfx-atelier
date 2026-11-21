import { describe, expect, it } from "vitest";
import { envelope, sfxMetrics } from "../src/sfx";
import { decaying, make, mono, SR, sine, white } from "./signals";

describe("envelope", () => {
  it("1ms ごとの RMS。振幅 1 の正弦波（1kHz、1ms にちょうど 1 周期）は 1/√2", () => {
    const env = envelope(sine(1000, 0.01), SR);
    expect(env.length).toBe(10);
    for (const v of env) expect(v).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe("sfxMetrics", () => {
  it("インパルスは立ち上がりが最速（0 秒）", () => {
    const x = new Float32Array(SR * 0.1);
    x[480] = 1;
    const m = sfxMetrics(mono(x));
    expect(m.attack).toBe(0);
    expect(m.peakDb).toBe(0);
    expect(m.start).toBeCloseTo(0.01, 6);
    expect(m.peakTime).toBeCloseTo(0.01, 6);
  });

  it("50ms で直線に立ち上がる音：10% → 90% は 40ms", () => {
    const x = make(0.3, (t) => Math.min(1, t / 0.05) * Math.sin(2 * Math.PI * 1000 * t));
    const m = sfxMetrics(mono(x));
    expect(Math.abs(m.attack - 0.04)).toBeLessThanOrEqual(0.002);
  });

  it("指数減衰（τ = 0.1 秒）：-40dB までは τ ln 100 ≒ 0.461 秒、-60dB までは τ ln 1000 ≒ 0.691 秒", () => {
    const m = sfxMetrics(mono(decaying(1000, 0.1, 1.2)));
    expect(Math.abs(m.tail - 0.1 * Math.log(100))).toBeLessThan(0.003);
    expect(Math.abs(m.length - 0.1 * Math.log(1000))).toBeLessThan(0.003);
    expect(m.attack).toBeLessThanOrEqual(0.001);
  });

  it("振幅 0.5 の正弦波：山は -6.02dBFS、RMS の山は -9.03dBFS", () => {
    const m = sfxMetrics(mono(sine(1000, 0.2, 0.5)));
    expect(m.peakDb).toBeCloseTo(20 * Math.log10(0.5), 2);
    expect(m.peakRmsDb).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 2);
    expect(m.length).toBeCloseTo(0.2, 3);
  });

  it("硬さ：440Hz の重心は 440Hz 付近で高域 0、8kHz は高域ほぼ 1、白色雑音は高域 (24k-4k)/24k ≒ 0.83", () => {
    const low = sfxMetrics(mono(sine(440, 0.2)));
    expect(Math.abs(low.centroid - 440) / 440).toBeLessThan(0.02);
    expect(low.highRatio).toBeLessThan(1e-3);
    expect(sfxMetrics(mono(sine(8000, 0.2))).highRatio).toBeGreaterThan(0.999);
    const n = sfxMetrics(mono(white(0.5)));
    expect(Math.abs(n.highRatio - 20000 / 24000)).toBeLessThan(0.02);
    expect(Math.abs(n.centroid - 12000) / 12000).toBeLessThan(0.03);
  });

  it("フレームより短い音（30ms）でも重心が出る", () => {
    const m = sfxMetrics(mono(sine(2000, 0.03)));
    expect(Math.abs(m.centroid - 2000) / 2000).toBeLessThan(0.03);
  });

  it("無音はすべて 0（音量は -Infinity）", () => {
    const m = sfxMetrics(mono(new Float32Array(1000)));
    expect(m.length).toBe(0);
    expect(m.peakDb).toBe(-Infinity);
  });
});

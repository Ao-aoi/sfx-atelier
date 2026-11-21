import { describe, expect, it } from "vitest";
import { distance } from "../src/distance";
import { frameTime, peakToAmplitude, stft } from "../src/stft";
import { decaying, SR, sine, white } from "./signals";

describe("stft", () => {
  it("最後のサンプルまで覆い、短い信号でも 1 フレーム", () => {
    expect(stft(new Float32Array(100), SR, 2048).frames.length).toBe(1);
    // 長さ 4096、窓 2048、hop 512 → 開始 0, 512, …, 2048 の 5 フレーム
    const s = stft(new Float32Array(4096), SR, 2048);
    expect(s.frames.length).toBe(5);
    expect(frameTime(s, 0)).toBeCloseTo(1024 / SR, 12);
  });

  it("振幅 0.3 の正弦波（ビンにちょうど乗る）の山から振幅 0.3 が戻る", () => {
    const k = 50, size = 2048;
    const s = stft(sine((k * SR) / size, 0.2, 0.3), SR, size);
    expect(peakToAmplitude(s.frames[2]![k]!, size)).toBeCloseTo(0.3, 3);
  });
});

describe("distance", () => {
  it("同じ音は 0", () => {
    const x = decaying(1000, 0.05, 0.3);
    const d = distance(x, x, SR);
    expect(d.spectral).toBe(0);
    expect(d.total).toBe(0);
  });

  it("音量を半分（-6.02dB）にすると、スペクトルの差もほぼ 6dB、山の差は -6.02dB", () => {
    const x = decaying(1000, 0.05, 0.3);
    const d = distance(x, x.map((v) => v / 2), SR);
    expect(d.peak).toBeCloseTo(-6.02, 1);
    // 下限で切った点の分だけ 6dB より小さくなる
    expect(d.spectral).toBeGreaterThan(5);
    expect(d.spectral).toBeLessThanOrEqual(6.03);
  });

  it("周波数がずれるほど遠い（1000Hz に対し 1010Hz < 1100Hz < 2000Hz）", () => {
    const x = decaying(1000, 0.05, 0.3);
    const d = (hz: number) => distance(x, decaying(hz, 0.05, 0.3), SR).spectral;
    expect(d(1010)).toBeLessThan(d(1100));
    expect(d(1100)).toBeLessThan(d(2000));
  });

  it("減衰の長さの差が長さの差に出る（τ ln 1000 の差）", () => {
    const d = distance(decaying(1000, 0.05, 0.6), decaying(1000, 0.08, 0.6), SR);
    expect(d.length).toBeCloseTo(0.03 * Math.log(1000), 2);
  });

  it("雑音どうしは、波形が違っても正弦波より近い", () => {
    const a = white(0.3, 0.3, 1), b = white(0.3, 0.3, 2);
    expect(distance(a, b, SR).spectral).toBeLessThan(distance(a, sine(3000, 0.3, 0.3), SR).spectral);
  });
});

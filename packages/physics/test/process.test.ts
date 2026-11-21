import { describe, expect, it } from "vitest";
import { fade, filter, normalize, peak, pitchShift, removeSilence, resample, stretch, trim } from "../src/process";

// 期待値は既知の信号（正弦波・無音）と式（dB、フィルタの -3dB 点、速さの比）から
const sr = 48000;
const sine = (hz: number, seconds: number, amp = 1) => ({
  sampleRate: sr,
  channels: [Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr))],
});
const ch = (s: { channels: Float32Array[] }) => s.channels[0]!;
const zeroUps = (x: Float32Array) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++;
  return n;
};
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! ** 2;
  return Math.sqrt(s / (to - from));
};

describe("切り出し・無音・正規化・フェード", () => {
  it("trim：0.1〜0.3 秒で 9600 サンプル", () => {
    expect(ch(trim(sine(100, 1), 0.1, 0.3)).length).toBe(9600);
  });

  it("removeSilence：前後 0.2 秒の無音を除き、前 2ms・後ろ 10ms を残す", () => {
    const body = ch(sine(1000, 0.1));
    const x = new Float32Array(0.5 * sr);
    x.set(body, 0.2 * sr);
    const r = ch(removeSilence({ sampleRate: sr, channels: [x] }));
    // 正弦の最初のサンプルは 0 なので、最初に閾値を超えるのは 1 サンプル目
    expect(Math.abs(r.length - (0.1 + 0.002 + 0.01) * sr)).toBeLessThanOrEqual(3);
  });

  it("removeSilence：全部無音なら空", () => {
    expect(ch(removeSilence({ sampleRate: sr, channels: [new Float32Array(100)] })).length).toBe(0);
  });

  it("normalize：山を -6dB（≒ 0.501）に", () => {
    expect(peak(normalize(sine(440, 0.1, 0.2), -6))).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });

  it("fade：頭は 0、真ん中はそのまま、尻は 0", () => {
    const one = { sampleRate: sr, channels: [new Float32Array(1000).fill(1)] };
    const f = ch(fade(one, 0.001, 0.001));
    expect(f[0]).toBe(0);
    expect(f[24]).toBeCloseTo(0.5, 6);
    expect(f[500]).toBe(1);
    expect(f[999]).toBe(0);
  });
});

describe("フィルタ", () => {
  it("低域通過 1kHz：100Hz はほぼ通し、1kHz は -3dB、10kHz は -40dB 近く落とす（2 次は 1 桁で -40dB）", () => {
    const gain = (hz: number) => rms(ch(filter(sine(hz, 0.2), "lowpass", 1000)), 0.1 * sr) / rms(ch(sine(hz, 0.2)), 0.1 * sr);
    expect(20 * Math.log10(gain(100))).toBeGreaterThan(-0.1);
    expect(20 * Math.log10(gain(1000))).toBeCloseTo(-3.01, 1);
    expect(20 * Math.log10(gain(10000))).toBeLessThan(-38);
  });

  it("高域通過 1kHz：100Hz を -40dB 近く落とす", () => {
    const g = rms(ch(filter(sine(100, 0.3), "highpass", 1000)), 0.15 * sr) / rms(ch(sine(100, 0.3)), 0.15 * sr);
    expect(20 * Math.log10(g)).toBeLessThan(-38);
  });

  it("帯域通過：中心の周波数はそのまま通す（ピークの利得 0dB）", () => {
    const g = rms(ch(filter(sine(2000, 0.2), "bandpass", 2000, 2)), 0.1 * sr) / rms(ch(sine(2000, 0.2)), 0.1 * sr);
    expect(20 * Math.log10(g)).toBeCloseTo(0, 1);
  });
});

describe("ピッチと長さ", () => {
  it("resample 2：周波数 2 倍・長さ半分", () => {
    const r = ch(resample(sine(500, 1), 2));
    expect(Math.abs(r.length - sr / 2)).toBeLessThanOrEqual(1);
    // 0.5 秒で 1000Hz → 500 回
    expect(Math.abs(zeroUps(r) - 500)).toBeLessThanOrEqual(1);
  });

  it("resample 0.5：周波数半分・長さ 2 倍、振幅はほぼ保つ", () => {
    const r = ch(resample(sine(1000, 0.5), 0.5));
    expect(Math.abs(r.length - sr)).toBeLessThanOrEqual(1);
    expect(Math.abs(zeroUps(r) - 500)).toBeLessThanOrEqual(1);
    expect(rms(r, 1000, r.length - 1000)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("stretch 2：長さ 2 倍、高さはそのまま（1 秒あたりのゼロ交差が同じ）", () => {
    const r = ch(stretch(sine(800, 0.5), 2));
    expect(r.length).toBe(sr);
    expect(Math.abs(zeroUps(r) - 800) / 800).toBeLessThan(0.02);
  });

  it("pitchShift +1200 セント：長さはそのまま、周波数 2 倍", () => {
    const r = ch(pitchShift(sine(400, 0.5), 1200));
    expect(r.length).toBe(sr / 2);
    // 端の窓の分を除いて数える：0.4 秒で 800Hz → 320 回
    const mid = r.subarray(0.05 * sr, 0.45 * sr);
    expect(Math.abs(zeroUps(mid) - 320) / 320).toBeLessThan(0.03);
  });
});

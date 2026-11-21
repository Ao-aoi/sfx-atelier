import { describe, expect, it } from "vitest";
import { analyze } from "../src/features";
import { make, mono, SR, sine, white } from "./signals";

describe("analyze（デモの特徴量）", () => {
  it("440Hz の正弦波：重心とロールオフは 440Hz 付近、エネルギーは中域", () => {
    const r = analyze(mono(sine(440, 1, 0.5)));
    expect(r.duration).toBe(1);
    expect(r.channels).toBe(1);
    expect(Math.abs(r.centroidMean - 440) / 440).toBeLessThan(0.03);
    expect(Math.abs(r.rolloffMean - 440)).toBeLessThan(2 * (SR / 2048));
    expect(r.bandRatios[1]).toBeGreaterThan(0.99);
    // 正弦波の RMS は振幅 / √2
    expect(r.rmsMean).toBeCloseTo(0.5 / Math.SQRT2, 2);
    // 1 周期で 2 回 0 を横切る
    expect(r.zcrMean).toBeCloseTo((2 * 440) / SR, 3);
  });

  it("100Hz は低域、8kHz は高域", () => {
    expect(analyze(mono(sine(100, 0.5))).bandRatios[0]).toBeGreaterThan(0.95);
    expect(analyze(mono(sine(8000, 0.5))).bandRatios[2]).toBeGreaterThan(0.99);
  });

  it("白色雑音の重心はナイキストの半分（12kHz）付近", () => {
    const r = analyze(mono(white(1)));
    expect(Math.abs(r.centroidMean - 12000) / 12000).toBeLessThan(0.05);
  });

  it("左右が同じなら相関 1・幅 0、逆位相なら相関 -1", () => {
    const s = sine(300, 0.5);
    expect(analyze({ sampleRate: SR, channels: [s, s] }).stereo).toEqual({ correlation: 1, width: 0 });
    const inv = s.map((v) => -v);
    expect(analyze({ sampleRate: SR, channels: [s, inv] }).stereo.correlation).toBeCloseTo(-1, 6);
  });

  it("24 フレーム（24 × 1024 サンプル = 0.512 秒）ごとのクリックは 60 / 0.512 ≒ 117.2 BPM・周期 0.512 秒", () => {
    // 間隔をフレームの整数倍にして、自己相関の山がずれないようにする
    const clicks = make(8, (_, i) => (i % (24 * 1024) < 48 ? 1 : 0));
    const r = analyze(mono(clicks));
    expect(r.bpm).toBeCloseTo(60 / 0.512, 6);
    expect(r.periodicity).toBeCloseTo(0.512, 6);
  });

  it("フレームより短い音はフレームなし（デモと同じ）", () => {
    const r = analyze(mono(sine(440, 0.03)));
    expect(r.frames.length).toBe(0);
    expect(r.frameCount).toBe(1);
  });
});

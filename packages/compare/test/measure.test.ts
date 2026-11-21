import { describe, expect, it } from "vitest";
import { audibleLength, rmsEnvelope, spectralCentroid } from "../src/measure";

// 期待値は既知の信号から書く
const RATE = 48000;
const sine = (hz: number, sec: number, amp = 1) =>
  new Float32Array(Math.round(sec * RATE)).map((_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

describe("測定", () => {
  it("1000Hz の正弦波の重心はおよそ 1000Hz、3000Hz なら 3000Hz", () => {
    expect(spectralCentroid(sine(1000, 0.5), RATE)).toBeGreaterThan(980);
    expect(spectralCentroid(sine(1000, 0.5), RATE)).toBeLessThan(1020);
    expect(Math.abs(spectralCentroid(sine(3000, 0.5), RATE) / 3000 - 1)).toBeLessThan(0.01);
  });

  it("振幅 a の正弦波の RMS は a ÷ √2（5ms の窓に 1000Hz なら 5 周期ちょうど）", () => {
    const env = rmsEnvelope(sine(1000, 0.1, 0.5), RATE);
    expect(env).toHaveLength(20);
    for (const v of env) expect(v).toBeCloseTo(0.5 / Math.SQRT2, 4);
  });

  it("長さ：0.2 秒鳴って無音になる音は 0.2 秒", () => {
    const x = new Float32Array(RATE);
    x.set(sine(440, 0.2));
    expect(audibleLength(x, RATE)).toBeGreaterThan(0.199);
    expect(audibleLength(x, RATE)).toBeLessThanOrEqual(0.2);
  });
});

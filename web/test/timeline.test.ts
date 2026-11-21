import { describe, expect, it } from "vitest";
import { formatBeat, formatSeconds, gridStep, rulerTicks, snap, unitSeconds } from "../src/model/timeline";

describe("時間の単位", () => {
  it("bpm 120 で 1 拍 0.5 秒、bpm 90 で 2/3 秒", () => {
    expect(unitSeconds({ unit: "beat", bpm: 120 })).toBe(0.5);
    expect(unitSeconds({ unit: "beat", bpm: 90 })).toBeCloseTo(2 / 3, 12);
    expect(unitSeconds({ unit: "sec" })).toBe(1);
    expect(unitSeconds(undefined)).toBe(1);
  });
});

describe("格子", () => {
  it("秒：1 秒 1000px なら 10px 以上離れる最小は 10ms", () => {
    expect(gridStep(1000, { unit: "sec" }, 10)).toBe(0.01);
    // 1 秒 400px：5ms は 2px、10ms は 4px、20ms は 8px、50ms は 20px
    expect(gridStep(400, undefined, 10)).toBe(0.05);
  });
  it("拍：bpm 120・1 秒 400px なら 1 拍 200px、1/16 拍は 12.5px", () => {
    expect(gridStep(400, { unit: "beat", bpm: 120 }, 10)).toBe(1 / 16);
    expect(gridStep(400, { unit: "beat", bpm: 120 }, 60)).toBe(1 / 2);
  });
  it("拍：1 拍より粗いときは小節（4/4 なら 4 拍）の倍数", () => {
    // bpm 120・1 秒 20px：1 拍 10px、1 小節 40px、2 小節 80px
    expect(gridStep(20, { unit: "beat", bpm: 120 }, 30)).toBe(4);
    expect(gridStep(20, { unit: "beat", bpm: 120 }, 60)).toBe(8);
    expect(gridStep(20, { unit: "beat", bpm: 120, sig: [3, 4] }, 30)).toBe(3);
  });
  it("寄せる：小数の誤差を残さない", () => {
    expect(snap(0.123, 0.01)).toBe(0.12);
    expect(snap(0.3000001, 0.1)).toBe(0.3);
    expect(snap(0.37, 0.25)).toBe(0.25);
  });
});

describe("目盛り", () => {
  it("1 秒未満はミリ秒、それ以上は秒", () => {
    expect(formatSeconds(0.055)).toBe("55ms");
    expect(formatSeconds(0)).toBe("0ms");
    expect(formatSeconds(1.5)).toBe("1.5s");
  });
  it("拍は 小節.拍（1 から）", () => {
    expect(formatBeat(0, undefined)).toBe("1.1");
    expect(formatBeat(5, undefined)).toBe("2.2");
    expect(formatBeat(3.5, [3, 4])).toBe("2.1.5");
  });
  it("0〜0.3 秒、1 秒 1000px、ラベル 56px 以上：100ms ごと", () => {
    expect(rulerTicks(0, 0.3, 1000, undefined, 56).map((t) => t.label)).toEqual(["0ms", "100ms", "200ms", "300ms"]);
  });
  it("途中から始まる目盛りは間隔の倍数から", () => {
    expect(rulerTicks(0.13, 0.45, 1000, undefined, 56).map((t) => t.t)).toEqual([0.2, 0.3, 0.4]);
  });
});

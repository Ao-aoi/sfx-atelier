import { describe, expect, it } from "vitest";
import { simulate } from "@sfx-atelier/physics";
import { decodeWav } from "@sfx-atelier/physics";
import { PRESETS } from "../src/model/presets";
import { discardScene, dryFromBank, recordDiscard, wavBytes } from "../src/model/physics";

// 期待値は自由落下の式から：底の高さ h、下向きの初速 0.3 m/s で h = 0.3t + 4.9t²
const fallTime = (h: number) => (-0.3 + Math.sqrt(0.09 + 2 * 9.8 * h)) / 9.8;

describe("物理から作る（計算）", () => {
  it("高さ 6cm：最初の接触は ≒ 0.084 秒", () => {
    const e = simulate(discardScene({ height: 0.06, variant: 0 })).events[0]!;
    expect(Math.abs(e.t - fallTime(0.06))).toBeLessThan(0.002);
  });

  it("高さ 20cm：最初の接触は ≒ 0.172 秒、速さ √(0.09 + 2g × 0.2)", () => {
    const e = simulate(discardScene({ height: 0.2, variant: 0 })).events[0]!;
    expect(Math.abs(e.t - fallTime(0.2))).toBeLessThan(0.002);
    expect(e.speed / Math.sqrt(0.09 + 2 * 9.8 * 0.2)).toBeCloseTo(1, 1);
  });

  it("揺らぎ 0 は元のまま、種が同じなら同じシーン", () => {
    expect(discardScene({ height: 0.06, variant: 3 })).toEqual(discardScene({ height: 0.06, variant: 3 }));
    expect(discardScene({ height: 0.06, variant: 3 })).not.toEqual(discardScene({ height: 0.06, variant: 0 }));
  });

  it("録音は山 -1dB、wav にして読むと同じ長さ", () => {
    const r = recordDiscard({ height: 0.06, variant: 0 });
    const x = r.signal.channels[0]!;
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(Math.pow(10, -1 / 20), 4);
    expect(decodeWav(wavBytes(r.signal)).channels[0]!.length).toBe(x.length);
    expect(r.contacts).toBeGreaterThan(0);
  });

  it("基準：バンクの discard から送りを外した score", () => {
    const s = dryFromBank(PRESETS[0]!.bank, "discard")!;
    expect(s.format).toBe("sfx-score/1");
    expect(s.tracks.every((t) => !t.send)).toBe(true);
    expect(Object.keys(s.instruments!)).toEqual([...new Set(s.tracks.map((t) => t.instrument))]);
    expect(dryFromBank(PRESETS[0]!.bank, "nothing")).toBeNull();
  });
});

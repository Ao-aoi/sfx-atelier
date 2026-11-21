import { describe, expect, it } from "vitest";
import { midiToName, noteMidi, symbolic } from "../src/symbolic";

// 期待値は音名と和声の決まり（C4 = 60、長三和音 = 根音・長 3 度・完全 5 度）から
describe("noteMidi・midiToName", () => {
  it("音名・Hz・tune", () => {
    expect(noteMidi({ t: 0, pitch: "A4" })).toBe(69);
    expect(noteMidi({ t: 0, pitch: 880 })).toBeCloseTo(81, 9);
    expect(noteMidi({ t: 0, pitch: "C4", tune: 50 })).toBe(60.5);
    expect(noteMidi({ t: 0 })).toBeNull();
    expect(midiToName(60)).toBe("C4");
    expect(midiToName(70)).toBe("Bb4");
    expect(midiToName(0)).toBe("C-1");
  });
});

describe("symbolic", () => {
  it("win（C6 E6 G6 C7 の分散和音）：音域 12 半音、和音 C、音階の第一候補は C major", () => {
    const s = symbolic({
      tracks: [{ instrument: "bell", notes: [
        { t: 0, pitch: "C6" }, { t: 0.085, pitch: "E6" }, { t: 0.17, pitch: "G6" }, { t: 0.255, pitch: "C7" },
      ] }],
    });
    expect(s.range).toEqual({ low: "C6", high: "C7", semitones: 12 });
    expect(s.span).toBeCloseTo(0.255, 9);
    expect(s.density).toBeCloseTo(4 / 0.255, 9);
    expect(s.chords).toEqual([{ t: 0, name: "C", fit: 1 }]);
    expect(s.scales[0]).toEqual({ name: "C major", fit: 1 });
  });

  it("高さの無い音（discard）は音域・音階・和音なし", () => {
    const s = symbolic({ tracks: [{ instrument: "clack", notes: [{ t: 0 }] }] });
    expect(s).toMatchObject({ notes: 1, pitchedNotes: 0, range: null, scales: [], chords: [], density: null });
  });

  it("拍の score は 1 小節ごとに和音を出す（120BPM・4/4 で 1 小節 2 秒）", () => {
    const s = symbolic({
      time: { unit: "beat", bpm: 120 },
      tracks: [{ instrument: "p", notes: [
        { t: 0, pitch: "A3" }, { t: 1, pitch: "C4" }, { t: 2, pitch: "E4" },
        { t: 4, pitch: "G3" }, { t: 5, pitch: "B3" }, { t: 6, pitch: "D4" }, { t: 7, pitch: "F4" },
      ] }],
    });
    expect(s.chords.map((c) => [c.t, c.name])).toEqual([[0, "Am"], [2, "G7"]]);
    expect(s.span).toBe(3.5);
  });
});

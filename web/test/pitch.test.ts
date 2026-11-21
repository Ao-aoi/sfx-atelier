import { describe, expect, it } from "vitest";
import { hzToMidi, isPitched, midiToName, noteAtRow, noteRow, pitchMidi, shiftNote } from "../src/model/pitch";

describe("音名と MIDI", () => {
  it("C4 = 60、A4 = 69、C-1 = 0、G9 = 127", () => {
    expect(midiToName(60)).toBe("C4");
    expect(midiToName(69)).toBe("A4");
    expect(midiToName(0)).toBe("C-1");
    expect(midiToName(127)).toBe("G9");
    expect(midiToName(61)).toBe("C#4");
  });
  it("880Hz は A4 の 1 オクターブ上（81）", () => {
    expect(hzToMidi(880)).toBeCloseTo(81, 9);
    expect(pitchMidi(440)).toBeCloseTo(69, 9);
  });
  it("高さの無い・読めない音符は A4（ランタイムの既定 440Hz と同じ）", () => {
    expect(pitchMidi(undefined)).toBe(69);
    expect(pitchMidi("H2")).toBe(69);
  });
});

describe("ピアノロールの行", () => {
  const pitched = { layers: [{ osc: "sine" as const, ratio: 1 }] };
  const fixed = { layers: [{ osc: "sine" as const, freq: 1180 }, { noise: "white" as const }] };

  it("ratio の発振器があれば高さに従う楽器", () => {
    expect(isPitched(pitched)).toBe(true);
    expect(isPitched(fixed)).toBe(false);
    expect(isPitched(undefined)).toBe(false);
  });
  it("高さに従う楽器は 音名 ＋ tune/100、従わない楽器は A4 ＋ tune/100", () => {
    expect(noteRow({ t: 0, pitch: "C6", tune: 50 }, true)).toBeCloseTo(84.5, 9);
    expect(noteRow({ t: 0, pitch: "C6", tune: -144 }, false)).toBeCloseTo(69 - 1.44, 9);
  });
  it("行を動かす：高さに従う楽器は音名、Hz は Hz、従わない楽器は tune を 100 セントずつ", () => {
    expect(shiftNote({ t: 0, pitch: "G6" }, 5, true).pitch).toBe("C7");
    expect(shiftNote({ t: 0, pitch: 440 }, 12, true).pitch).toBe(880);
    expect(shiftNote({ t: 0, tune: -89 }, 2, false).tune).toBe(111);
    expect(shiftNote({ t: 0 }, -3, true).pitch).toBe("F#4");
  });
  it("置く音符の高さ", () => {
    expect(noteAtRow(72.4, true)).toEqual({ pitch: "C5", tune: 0 });
    expect(noteAtRow(67, false)).toEqual({ tune: -200 });
  });
});

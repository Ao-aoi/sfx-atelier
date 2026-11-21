import { describe, expect, it } from "vitest";
import { noteNameToMidi } from "../src/pitch";

// 期待値は MIDI の規格（中央の C = C4 = 60、A4 = 69、範囲 0〜127）から
describe("noteNameToMidi", () => {
  it("基準の音", () => {
    expect(noteNameToMidi("C4")).toBe(60);
    expect(noteNameToMidi("A4")).toBe(69);
    expect(noteNameToMidi("C-1")).toBe(0);
    expect(noteNameToMidi("G9")).toBe(127);
  });

  it("臨時記号", () => {
    expect(noteNameToMidi("C#5")).toBe(73);
    expect(noteNameToMidi("Eb3")).toBe(51);
    // B#3 と C4、Cb4 と B3 は同じ高さ
    expect(noteNameToMidi("B#3")).toBe(60);
    expect(noteNameToMidi("Cb4")).toBe(59);
  });

  it("読めない名前・範囲外は null", () => {
    for (const name of ["H4", "c4", "A", "A10", "A#b4", "", "Ab9"]) expect(noteNameToMidi(name)).toBeNull();
    // G#9 = 128、Cb-1 = -1
    expect(noteNameToMidi("G#9")).toBeNull();
    expect(noteNameToMidi("Cb-1")).toBeNull();
  });
});

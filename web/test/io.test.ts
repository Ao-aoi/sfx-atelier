import { describe, expect, it } from "vitest";
import { bankJson, mergeIntoBank, parseJson, scoreFromBank, scoreJson } from "../src/model/io";
import { PRESETS } from "../src/model/presets";

const bank = PRESETS[0]!.bank;

describe("読み込み", () => {
  it("壊れた JSON・format の違うもの・検証に通らないものはエラー", () => {
    expect(parseJson("{").kind).toBe("error");
    expect(parseJson('{"format":"x"}').kind).toBe("error");
    const r = parseJson('{"format":"sfx-score/1","tracks":[{"instrument":"none","notes":[]}]}');
    expect(r.kind).toBe("error");
  });
  it("score は正規化して読む（id と既定値が入る）", () => {
    const r = parseJson('{"format":"sfx-score/1","instruments":{"a":{"layers":[{"osc":"sine","ratio":1}]}},"tracks":[{"instrument":"a","notes":[{"t":0}]}]}');
    expect(r.kind).toBe("score");
    if (r.kind !== "score") return;
    expect(r.score.tracks[0]!.id).toBe("t1");
    expect(r.score.tracks[0]!.notes[0]).toEqual({ id: "n1", t: 0, tune: 0, vel: 1 });
  });
  it("バンクを読む", () => {
    const r = parseJson(JSON.stringify(bank));
    expect(r.kind).toBe("bank");
  });
});

describe("バンクの 1 音を score にする", () => {
  it("riichi：使う楽器（stick・bell）と残響だけ持つ", () => {
    const s = scoreFromBank(bank, "riichi");
    expect(s.format).toBe("sfx-score/1");
    expect(Object.keys(s.instruments!).sort()).toEqual(["bell", "stick"]);
    expect(Object.keys(s.reverb!)).toEqual(["room"]);
    expect(s.master?.compressor?.threshold).toBe(-10);
    expect(s.tracks).toHaveLength(2);
  });
  it("書き出すと縮めた形になり、もう一度読むと同じ score に戻る", () => {
    const s = scoreFromBank(bank, "win");
    const text = scoreJson(s);
    expect(text).not.toContain('"id"');
    const again = parseJson(text);
    expect(again.kind).toBe("score");
    if (again.kind === "score") expect(again.score).toEqual(s);
  });
});

describe("バンクに戻す", () => {
  it("その音だけ置き換わり、ほかの音はそのまま", () => {
    const s = scoreFromBank(bank, "discard");
    const edited = { ...s, gain: 0.8 };
    const out = mergeIntoBank(bank, "discard", edited);
    expect(out.sounds.discard!.gain).toBe(0.8);
    expect(out.sounds.kan).toBe(bank.sounds.kan);
    const r = parseJson(bankJson(out));
    expect(r.kind).toBe("bank");
  });
});

describe("MIDI", () => {
  it("MIDI で書いて読み直すと音符が戻る。MIDI でないバイト列は MIDI と見なさない", async () => {
    const { isMidi, midiBytes, parseMidi } = await import("../src/model/io");
    const r = parseJson(
      '{"format":"sfx-score/1","time":{"unit":"beat","bpm":120},"instruments":{"ピアノ":{"layers":[{"osc":"triangle","ratio":1}]}},"tracks":[{"instrument":"ピアノ","notes":[{"t":0,"dur":1,"pitch":"C4"},{"t":1,"dur":0.5,"pitch":"E4","vel":0.504}]}]}',
    );
    if (r.kind !== "score") throw new Error("読めない");
    const { bytes } = midiBytes(r.score);
    expect(isMidi(bytes)).toBe(true);
    expect(isMidi(new TextEncoder().encode("{}"))).toBe(false);
    const back = parseMidi(bytes);
    if (back.kind !== "score") throw new Error(back.errors.join());
    expect(back.score.tracks[0]!.notes.map((n) => [n.t, n.dur, n.pitch, n.vel])).toEqual([
      [0, 1, "C4", 1],
      [1, 0.5, "E4", 0.504],
    ]);
    expect(parseMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0])).kind).toBe("error");
  });
});

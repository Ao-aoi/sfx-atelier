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

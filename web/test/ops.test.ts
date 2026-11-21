import { normalizeScore, type Score } from "@sfx-atelier/format";
import { describe, expect, it } from "vitest";
import {
  addNote,
  addTrack,
  contentSeconds,
  deleteNotes,
  findNote,
  forkInstrument,
  moveNotes,
  naturalSeconds,
  removeReverb,
  renameInstrument,
  setNoteDur,
  setTime,
} from "../src/model/ops";

const base = (): Score =>
  normalizeScore({
    format: "sfx-score/1",
    reverb: { room: { seconds: 0.7, decay: 3 } },
    instruments: {
      bell: { layers: [{ osc: "sine", ratio: 1, env: { a: 0.004, d: 1 } }] },
      clack: { layers: [{ osc: "sine", freq: 1180, env: { d: 0.055 } }, { noise: "white", env: { a: 0.001, d: 0.035 } }] },
      pad: { layers: [{ osc: "sine", ratio: 1, env: { a: 0.1, d: 0.2, s: 0.5, r: 0.3 } }] },
    },
    tracks: [
      { id: "t1", instrument: "bell", send: { room: 1 }, notes: [{ id: "n1", t: 0, pitch: "C6" }, { id: "n2", t: 0.1, pitch: "E6" }] },
      { id: "t2", instrument: "clack", notes: [{ id: "n3", t: 0.05, tune: -144 }] },
    ],
  });

describe("音符", () => {
  it("足すと新しい id が振られ、t の順に並ぶ", () => {
    const { score, ref } = addNote(base(), "t1", { t: 0.05, pitch: "D6" });
    expect(ref).toEqual({ track: "t1", note: "n4" });
    expect(score.tracks[0]!.notes.map((n) => n.id)).toEqual(["n1", "n4", "n2"]);
  });
  it("元の score は書き換えない", () => {
    const s = base();
    const before = JSON.stringify(s);
    addNote(s, "t1", { t: 1 });
    moveNotes(s, [{ track: "t1", note: "n1" }], 0.5, 2);
    deleteNotes(s, [{ track: "t2", note: "n3" }]);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("消す", () => {
    const s = deleteNotes(base(), [{ track: "t1", note: "n1" }, { track: "t2", note: "n3" }]);
    expect(s.tracks.map((t) => t.notes.length)).toEqual([1, 0]);
  });
  it("動かす：高さに従う楽器は音名、従わない楽器は tune が動く", () => {
    const s = moveNotes(base(), [{ track: "t1", note: "n2" }, { track: "t2", note: "n3" }], 0.02, 3);
    expect(findNote(s, { track: "t1", note: "n2" })).toMatchObject({ t: 0.12, pitch: "G6" });
    expect(findNote(s, { track: "t2", note: "n3" })).toMatchObject({ t: 0.07, tune: 156 });
  });
  it("前に動かしすぎても、選んだ中で一番早い音符が 0 で止まり、間隔は保つ", () => {
    const s = moveNotes(base(), [{ track: "t1", note: "n2" }, { track: "t2", note: "n3" }], -1, 0);
    expect(findNote(s, { track: "t2", note: "n3" })!.t).toBe(0);
    expect(findNote(s, { track: "t1", note: "n2" })!.t).toBe(0.05);
  });
  it("長さ：下限で止まり、undefined で楽器任せに戻る", () => {
    const ref = { track: "t1", note: "n1" };
    expect(findNote(setNoteDur(base(), ref, -1, 0.01), ref)!.dur).toBe(0.01);
    const s = setNoteDur(setNoteDur(base(), ref, 1.5), ref, undefined);
    expect("dur" in findNote(s, ref)!).toBe(false);
  });
});

describe("長さ", () => {
  it("AD 型は a + d、サステインのある層は a + d + r、いちばん長い層", () => {
    expect(naturalSeconds({ layers: [{ osc: "sine", env: { a: 0.004, d: 1 } }] })).toBeCloseTo(1.004, 12);
    expect(naturalSeconds({ layers: [{ osc: "sine", env: { a: 0.1, d: 0.2, s: 0.5, r: 0.3 } }] })).toBeCloseTo(0.6, 12);
    // 既定のエンベロープは a 0.002・d 0.25
    expect(naturalSeconds({ layers: [{ noise: "white" }, { osc: "sine", env: { d: 0.1 } }] })).toBeCloseTo(0.252, 12);
  });
  it("中身の長さ：最後に終わる音符（n2 の 0.1 + 1.004 秒）", () => {
    expect(contentSeconds(base())).toBeCloseTo(1.104, 12);
  });
});

describe("時間の単位", () => {
  it("秒 → bpm 120 の拍：鳴る時刻が変わらないように 2 倍になる", () => {
    const s = setNoteDur(base(), { track: "t1", note: "n2" }, 0.75);
    const b = setTime(s, { unit: "beat", bpm: 120 });
    expect(b.time).toEqual({ unit: "beat", bpm: 120 });
    expect(findNote(b, { track: "t1", note: "n2" })).toMatchObject({ t: 0.2, dur: 1.5 });
    expect(findNote(b, { track: "t2", note: "n3" })!.t).toBe(0.1);
  });
  it("bpm 120 → bpm 60：拍の数は半分", () => {
    const b = setTime(setTime(base(), { unit: "beat", bpm: 120 }), { unit: "beat", bpm: 60 });
    expect(findNote(b, { track: "t1", note: "n2" })!.t).toBe(0.1);
  });
});

describe("トラックと楽器", () => {
  it("楽器を指定しないと、新しい楽器を作ってトラックを足す", () => {
    const { score, id } = addTrack(base());
    expect(id).toBe("t3");
    const t = score.tracks[2]!;
    expect(t.instrument).toBe("楽器");
    expect(score.instruments!["楽器"]!.layers).toHaveLength(1);
  });
  it("複製した楽器に付け替えると、元の楽器は変わらない", () => {
    const s = forkInstrument(base(), "t1");
    expect(s.tracks[0]!.instrument).toBe("bell 2");
    expect(s.instruments!["bell 2"]).toEqual(s.instruments!.bell);
    expect(s.instruments!["bell 2"]).not.toBe(s.instruments!.bell);
  });
  it("名前を変えるとトラックの参照も変わる。既にある名前には変えない", () => {
    const s = renameInstrument(base(), "clack", "click");
    expect(s.tracks[1]!.instrument).toBe("click");
    expect(Object.keys(s.instruments!)).toEqual(["bell", "click", "pad"]);
    expect(renameInstrument(base(), "clack", "bell")).toEqual(base());
  });
  it("残響を消すと送りも消える", () => {
    const s = removeReverb(base(), "room");
    expect(s.reverb).toEqual({});
    expect(s.tracks[0]!.send).toEqual({});
  });
});

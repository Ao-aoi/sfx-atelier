import { describe, expect, it } from "vitest";
import { applyPatch, type Patch } from "../src/patch";
import type { Bank, Score } from "../src/types";

const score: Score = {
  format: "sfx-score/1",
  instruments: {
    clack: {
      layers: [
        { noise: "white", gain: 0.5, env: { a: 0.001, d: 0.035 } },
        { osc: "sine", freq: 1180, gain: 0.22, env: { d: 0.055 } },
      ],
    },
  },
  tracks: [
    { id: "t1", instrument: "clack", notes: [{ id: "n1", t: 0 }, { id: "n2", t: 0.05, vel: 0.8 }] },
  ],
};
const frozen = structuredClone(score);
const patch = (ops: Patch["ops"]): Patch => ({ format: "sfx-patch/1", ops });

describe("applyPatch", () => {
  it("set：id と番号で辿って値を置き換え、取り消しで元に戻る", () => {
    const r = applyPatch(score, patch([
      { op: "set", path: ["tracks", "t1", "notes", "n2", "vel"], value: 0.5 },
      { op: "set", path: ["instruments", "clack", "layers", 1, "env", "d"], value: 0.08 },
    ]));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.tracks[0]!.notes[1]!.vel).toBe(0.5);
    expect(r.value.instruments!.clack!.layers[1]!.env!.d).toBe(0.08);
    expect(score).toEqual(frozen); // 入力は書き換えない
    const back = applyPatch(r.value, r.inverse);
    expect(back.ok && back.value).toEqual(score);
  });

  it("set：無いキーを足したものは、取り消すと消える", () => {
    const r = applyPatch(score, patch([{ op: "set", path: ["tracks", "t1", "notes", "n1", "tune"], value: 100 }]));
    if (!r.ok) throw new Error();
    expect(r.value.tracks[0]!.notes[0]).toEqual({ id: "n1", t: 0, tune: 100 });
    const back = applyPatch(r.value, r.inverse);
    expect(back.ok && back.value).toEqual(score);
  });

  it("add と remove：音符を足す・消す。取り消しは元の位置に戻す", () => {
    const r = applyPatch(score, patch([
      { op: "add", path: ["tracks", "t1", "notes"], value: { id: "n3", t: 0.1 } },
      { op: "remove", path: ["tracks", "t1", "notes", "n1"] },
      { op: "add", path: ["instruments", "clack", "layers"], value: { osc: "sine", freq: 190 }, at: 0 },
    ]));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.tracks[0]!.notes.map((n) => n.id)).toEqual(["n2", "n3"]);
    expect(r.value.instruments!.clack!.layers.length).toBe(3);
    const back = applyPatch(r.value, r.inverse);
    expect(back.ok && back.value).toEqual(score);
  });

  it("無い場所を指したら全体を適用しない", () => {
    const r = applyPatch(score, patch([
      { op: "set", path: ["tracks", "t1", "notes", "n1", "vel"], value: 0.3 },
      { op: "set", path: ["tracks", "t9", "gain"], value: 1 },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe("tracks.t9.gain");
    expect(score).toEqual(frozen);
  });

  it("id の重複・範囲外の at・根の削除は拒否する", () => {
    expect(applyPatch(score, patch([{ op: "add", path: ["tracks", "t1", "notes"], value: { id: "n1", t: 1 } }])).ok).toBe(false);
    expect(applyPatch(score, patch([{ op: "add", path: ["tracks", "t1", "notes"], value: { id: "n9", t: 1 }, at: 5 }])).ok).toBe(false);
    expect(applyPatch(score, patch([{ op: "remove", path: [] }])).ok).toBe(false);
  });

  it("結果が形式に合わなければ拒否する（vel は 0〜1）", () => {
    const r = applyPatch(score, patch([{ op: "set", path: ["tracks", "t1", "notes", "n1", "vel"], value: 3 }]));
    expect(r.ok).toBe(false);
  });

  it("壊れた差分は拒否する", () => {
    expect(applyPatch(score, { format: "sfx-patch/1", ops: [{ op: "move", path: [] }] } as unknown as Patch).ok).toBe(false);
    expect(applyPatch(score, { format: "x", ops: [] } as unknown as Patch).ok).toBe(false);
  });

  it("バンクにも使える（sounds の名前から辿る）", () => {
    const bank: Bank = { format: "sfx-bank/1", instruments: score.instruments, sounds: { discard: { tracks: score.tracks } } };
    const r = applyPatch(bank, patch([{ op: "set", path: ["sounds", "discard", "gain"], value: 0.9 }]));
    expect(r.ok && r.value.sounds.discard!.gain).toBe(0.9);
  });
});

import { normalizeScore, SCORE_FORMAT, type Score } from "@sfx-atelier/format";
import { describe, expect, it } from "vitest";
import { changeText, diffDocs } from "../src/model/diff";

const base = (): Score =>
  normalizeScore({
    format: SCORE_FORMAT,
    instruments: { a: { layers: [{ osc: "sine", ratio: 1, env: { d: 0.3 } }] } },
    tracks: [{ instrument: "a", notes: [{ t: 0, pitch: "A4" }, { t: 0.1, pitch: "E5" }] }],
  });

describe("diffDocs", () => {
  it("同じなら空。既定値の書き方の違い（vel: 1 の有無）は差分にしない", () => {
    const a = base();
    const b = structuredClone(a);
    b.tracks[0]!.notes[0]!.vel = 1;
    expect(diffDocs(a, b)).toEqual([]);
  });

  it("音符は id で対応させる：先頭に足しても、ほかの音符は変わらない扱い", () => {
    const a = base();
    const b = structuredClone(a);
    b.tracks[0]!.notes.unshift({ id: "n9", t: 0, pitch: "C4" });
    b.tracks[0]!.notes[2]!.pitch = "D5";
    expect(diffDocs(a, b).map(changeText)).toEqual(['+ tracks.t1.notes.n9 {"id":"n9","t":0,"pitch":"C4"}', 'tracks.t1.notes.n2.pitch "E5" → "D5"']);
  });

  it("層は番号で対応させ、値の変更・キーの追加と削除を出す", () => {
    const a = base();
    const b = structuredClone(a);
    b.instruments!.a!.layers[0]!.env = { ...b.instruments!.a!.layers[0]!.env, d: 0.1 };
    b.instruments!.a!.layers.push({ noise: "white" });
    b.tracks[0]!.notes.pop();
    expect(diffDocs(a, b).map(changeText)).toEqual([
      "instruments.a.layers.0.env.d 0.3 → 0.1",
      '+ instruments.a.layers.1 {"noise":"white"}',
      "− tracks.t1.notes.n2",
    ]);
  });
});

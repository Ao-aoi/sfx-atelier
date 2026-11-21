// ランタイムで描画した既知の層から、元の層が戻るか（提案書 6.4 の 1：周波数 ±1%、減衰 ±10%）
import { describe, expect, it } from "vitest";
import type { OscLayer, Score } from "@sfx-atelier/format/types";
import { fit } from "../src/fit";
import { renderScore } from "./browser";

function check(want: { hz: number; d: number }[], got: OscLayer[]) {
  for (const w of want) {
    const g = got.find((x) => Math.abs(x.freq! / w.hz - 1) < 0.01);
    expect(g, `${w.hz}Hz が見つからない（${got.map((x) => x.freq).join(", ")}）`).toBeDefined();
    expect(Math.abs(g!.env!.d! / w.d - 1), `${w.hz}Hz の d ${g!.env!.d} / ${w.d}`).toBeLessThan(0.1);
  }
}
const oscs = (s: Score) => Object.values(s.instruments ?? {}).flatMap((i) => i.layers).filter((l): l is OscLayer => "osc" in l);

describe("ランタイムで描画した音から層が戻る", () => {
  it("clack の正弦波の層", async () => {
    const score: Score = {
      format: "sfx-score/1",
      instruments: { clack: { layers: [
        { osc: "sine", freq: 1180, gain: 0.22, env: { d: 0.055 } },
        { osc: "sine", freq: 2730, gain: 0.1, env: { d: 0.028 } },
        { osc: "sine", freq: 190, gain: 0.5, env: { d: 0.09 }, pitchEnv: { toHz: 95, time: "decay" } },
      ] } },
      tracks: [{ instrument: "clack", notes: [{ t: 0.01 }] }],
    };
    const r = fit(await renderScore(score), { noise: false });
    check([{ hz: 1180, d: 0.055 }, { hz: 2730, d: 0.028 }, { hz: 190, d: 0.09 }], oscs(r.score));
    const low = oscs(r.score).find((l) => Math.abs(l.freq! - 190) < 2)!;
    expect(Math.abs(low.pitchEnv!.toHz! / 95 - 1)).toBeLessThan(0.05);
  });

  it("bell（C6、ratio 1・2.76・5.4）", async () => {
    const score: Score = {
      format: "sfx-score/1",
      instruments: { bell: { layers: [
        { osc: "sine", ratio: 1, env: { a: 0.004, d: 1 } },
        { osc: "sine", ratio: 2.76, gain: 0.25, env: { d: 0.4 } },
        { osc: "sine", ratio: 5.4, gain: 0.08, env: { a: 0.001, d: 0.15 } },
      ] } },
      tracks: [{ instrument: "bell", notes: [{ t: 0, pitch: "C6", vel: 0.2 }] }],
    };
    const r = fit(await renderScore(score));
    const c6 = 1046.502;
    check([{ hz: c6, d: 1 }, { hz: c6 * 2.76, d: 0.4 }, { hz: c6 * 5.4, d: 0.15 }], oscs(r.score));
  });
});

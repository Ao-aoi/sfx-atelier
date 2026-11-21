import { describe, expect, it } from "vitest";
import type { Score } from "@sfx-atelier/format/types";
import { applyPatch, validatePatch } from "@sfx-atelier/format";
import { findings, MAX_LINES, report, voiceCount } from "../src/report";
import type { SfxMetrics } from "../src/sfx";

const clack: Score = {
  format: "sfx-score/1",
  reverb: { room: { seconds: 0.7, decay: 3.2 } },
  instruments: {
    clack: {
      layers: [
        { noise: "white", filter: { type: "bandpass", freq: 3400, q: 1.4 }, gain: 0.55, env: { a: 0.001, d: 0.035 } },
        { osc: "sine", freq: 190, gain: 0.5, env: { d: 0.09 }, pitchEnv: { toHz: 95, time: "decay" } },
      ],
    },
  },
  tracks: [{ id: "t1", instrument: "clack", send: { room: 1 }, notes: [{ id: "n1", t: 0 }, { id: "n2", t: 0.05 }] }],
};

const quiet: SfxMetrics = {
  start: 0, length: 0.12, attack: 0.001, tail: 0.09, peakDb: -3, peakRmsDb: -12, peakTime: 0.002, centroid: 2800, highRatio: 0.18,
};

describe("report", () => {
  it("見出しと測定・構成が入る", () => {
    const text = report({ name: "discard", score: clack, metrics: quiet, features: { bandRatios: [0.12, 0.7, 0.18] } });
    const lines = text.split("\n");
    expect(lines[0]).toBe("analysis-report/1");
    expect(text).toContain("立ち上がり 1ms");
    expect(text).toContain("重心 2800Hz · 4kHz 以上 18%");
    expect(text).toContain("帯域: 低(<250Hz) 12% · 中 70% · 高(≥4kHz) 18%");
    expect(text).toContain("  1: osc sine · 190Hz · gain 0.5 · env d0.09 · pitchEnv →95Hz decay");
    expect(text).toContain("声の数 4");
    expect(text).not.toContain("## 指摘");
  });

  it("層が多くても 80 行以内", () => {
    const layers = Array.from({ length: 200 }, (_, i) => ({ osc: "sine" as const, freq: 100 + i }));
    const big: Score = { ...clack, instruments: { a: { layers }, b: { layers } }, tracks: [{ instrument: "a", notes: [{ t: 0 }] }] };
    const text = report({ name: "big", score: big, metrics: quiet });
    expect(text.split("\n").length).toBeLessThanOrEqual(MAX_LINES);
    expect(text).toContain("## 変更案の返し方");
  });

  it("書いてある path の例で、本当に差分が当たる", () => {
    const p = { format: "sfx-patch/1", ops: [{ op: "set", path: ["instruments", "clack", "layers", 1, "env", "d"], value: 0.12 }] };
    expect(validatePatch(p).ok).toBe(true);
    const r = applyPatch(clack, p as never);
    expect(r.ok && r.value.instruments!.clack!.layers[1]!.env!.d).toBe(0.12);
  });
});

describe("findings", () => {
  it("割れ・頭の無音・使われていない楽器を重みの順に出す", () => {
    const score: Score = { ...clack, instruments: { ...clack.instruments, spare: { layers: [] } } };
    const f = findings({ name: "x", score, metrics: { ...quiet, peakDb: 0, start: 0.03 } });
    expect(f.map((x) => x.text.split("：")[0])).toEqual(["割れの恐れ", "頭に無音が 30ms（遅れて聞こえる）", "使われていない楽器"]);
  });

  it("声の数 = 音符 × 層", () => {
    expect(voiceCount(clack)).toBe(4);
  });
});

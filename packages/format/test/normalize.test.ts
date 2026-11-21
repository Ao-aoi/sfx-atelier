import { describe, expect, it } from "vitest";
import example from "./fixtures/proposal-example.sfxbank.json";
import { normalizeBank, normalizeScore, shrinkBank, shrinkScore } from "../src/normalize";
import { validateBank, validateScore } from "../src/validate";
import type { Bank, Score } from "../src/types";

const bank = example as Bank;

/** id を全部消す（縮小で id が落ちることを比較から外すため） */
function stripIds<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => (k === "id" ? undefined : x)));
}

describe("normalizeBank", () => {
  const n = normalizeBank(bank);

  it("既定値を埋める（期待値は defaults.ts の表から手で書いたもの）", () => {
    const discard = n.sounds.discard!;
    expect(discard.gain).toBe(1);
    expect(discard.variation).toEqual({ tune: 68, gain: 0, time: 0 });
    const t = discard.tracks[0]!;
    expect(t).toMatchObject({ gain: 1, pan: 0, send: { room: 1 } });
    expect(t.notes[0]).toEqual({ id: "n1", t: 0, vel: 1, tune: 0 });

    const layer = n.instruments!.clack!.layers[0]!;
    expect(layer).toMatchObject({ gain: 0.55, pan: 0, filter: { type: "bandpass", freq: 3400, q: 1.4, gain: 0 } });
    expect(layer.env).toEqual({ a: 0.001, d: 0.035, s: 0, r: 0, curve: "exp" });
    expect(n.instruments!.clack!.layers[4]!.pitchEnv).toEqual({ toHz: 95, time: "decay", curve: "exp" });
    expect(n.reverb!.room).toEqual({ seconds: 0.7, decay: 3.2, wet: 0.16 });
    // DynamicsCompressorNode の既定 knee 30・attack 0.003・release 0.25 で埋まる
    expect(n.master).toEqual({ gain: 1, compressor: { threshold: -10, ratio: 4, knee: 30, attack: 0.003, release: 0.25 } });
  });

  it("id の無いトラック・音符に、使われていない id を振る", () => {
    const b: Bank = {
      format: "sfx-bank/1",
      instruments: { x: { layers: [{ osc: "sine", freq: 440 }] } },
      sounds: {
        s: {
          tracks: [
            { instrument: "x", notes: [{ t: 0 }, { id: "n1", t: 0.1 }, { t: 0.2 }] },
            { id: "t1", instrument: "x", notes: [] },
          ],
        },
      },
    };
    const s = normalizeBank(b).sounds.s!;
    expect(s.tracks.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(s.tracks[0]!.notes.map((x) => x.id)).toEqual(["n2", "n1", "n3"]);
    expect(validateBank(normalizeBank(b)).ok).toBe(true);
  });

  it("入力を書き換えない", () => {
    const before = JSON.stringify(bank);
    normalizeBank(bank);
    shrinkBank(normalizeBank(bank));
    expect(JSON.stringify(bank)).toBe(before);
  });

  it("正規化した結果も検証を通る", () => {
    const r = validateBank(n);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});

describe("shrinkBank", () => {
  it("既定値・空のオブジェクト・id・秒の単位を落とす", () => {
    const s = shrinkBank(normalizeBank(bank));
    expect(s.sounds.discard).toEqual({
      tracks: [{ instrument: "clack", send: { room: 1 }, notes: [{ t: 0 }] }],
      variation: { tune: 68 },
    });
    expect(s.instruments!.bell!.layers[0]).toEqual({ osc: "sine", ratio: 1, env: { a: 0.004, d: 1 } });
    expect(s.master).toEqual({ compressor: { threshold: -10, ratio: 4 } });
  });

  it("縮小 → 正規化で元の正規化に戻る（id を除く）", () => {
    const n = normalizeBank(bank);
    expect(stripIds(normalizeBank(shrinkBank(n)))).toEqual(stripIds(n));
  });

  it("縮小した結果は検証を通り、元の JSON より小さい", () => {
    const s = shrinkBank(normalizeBank(bank));
    expect(validateBank(s).ok).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(bank).length);
  });

  it("拍の時間は残す", () => {
    const b = structuredClone(bank);
    b.sounds.win!.time = { unit: "beat", bpm: 120 };
    expect(shrinkBank(b).sounds.win!.time).toEqual({ unit: "beat", bpm: 120 });
  });

  it("master・reverb などが全部既定なら、キーごと消える", () => {
    const b: Bank = { format: "sfx-bank/1", sounds: {} };
    expect(shrinkBank(normalizeBank(b))).toEqual({ format: "sfx-bank/1", sounds: {} });
  });
});

describe("score", () => {
  const score: Score = {
    format: "sfx-score/1",
    instruments: bank.instruments,
    reverb: bank.reverb,
    ...bank.sounds.kan!,
  };

  it("正規化・縮小しても検証を通り、往復で戻る", () => {
    const n = normalizeScore(score);
    expect(n.instruments!.clack!.layers[0]!.env!.curve).toBe("exp");
    expect(n.tracks[0]!.gain).toBe(1);
    const s = shrinkScore(n);
    expect(validateScore(n).ok).toBe(true);
    expect(validateScore(s).ok).toBe(true);
    expect(s.tracks[0]!.notes[0]).toEqual({ t: 0, tune: -144, vel: 0.75 });
    expect(stripIds(normalizeScore(s))).toEqual(stripIds(n));
  });
});

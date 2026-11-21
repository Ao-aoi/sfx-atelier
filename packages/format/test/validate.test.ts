import { describe, expect, it } from "vitest";
import example from "./fixtures/proposal-example.sfxbank.json";
import { validateBank, validateScore } from "../src/validate";

const clone = <T>(v: T): T => structuredClone(v);

/** 壊したバンクを検証して、エラーの path の一覧を返す */
function errorPaths(mutate: (b: any) => void): string[] {
  const b: any = clone(example);
  mutate(b);
  const r = validateBank(b);
  return r.ok ? [] : r.errors.map((e) => e.path);
}

describe("validateBank：正しい入力", () => {
  it("提案書 4.1 の例（discard・kan・win）を通す", () => {
    const r = validateBank(example);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("最小のバンク（音が 0 個）を通す", () => {
    expect(validateBank({ format: "sfx-bank/1", sounds: {} }).ok).toBe(true);
  });

  it("録音（sample 層）を通す", () => {
    const r = validateBank({
      format: "sfx-bank/1",
      samples: { drop: { url: "drop.wav" } },
      instruments: { drop: { layers: [{ sample: "drop", ratio: 1.5, gain: 0.8 }] } },
      sounds: { drop: { tracks: [{ instrument: "drop", notes: [{ t: 0 }] }] } },
    });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("拍の時間（bpm・拍子）を通す", () => {
    expect(
      errorPaths((b) => {
        b.sounds.win.time = { unit: "beat", bpm: 120, sig: [3, 4] };
      }),
    ).toEqual([]);
  });
});

describe("validateBank：壊れた入力を拒否する", () => {
  it("オブジェクトでない・format が違う・sounds が無い", () => {
    for (const v of [null, 1, "x", [], undefined]) expect(validateBank(v).ok).toBe(false);
    expect(errorPaths((b) => (b.format = "sfx-bank/2"))).toEqual(["format"]);
    expect(errorPaths((b) => delete b.sounds)).toEqual(["sounds"]);
  });

  it("知らないキー（書き間違い）", () => {
    expect(errorPaths((b) => (b.sounds.kan.tracks[0].notes[0].velo = 1))).toEqual(["sounds.kan.tracks[0].notes[0].velo"]);
    expect(errorPaths((b) => (b.instruments.clack.layers[0].env.sustain = 1))).toEqual([
      "instruments.clack.layers[0].env.sustain",
    ]);
  });

  it("存在しない楽器・残響・録音を指す", () => {
    expect(errorPaths((b) => (b.sounds.discard.tracks[0].instrument = "klack"))).toEqual([
      "sounds.discard.tracks[0].instrument",
    ]);
    expect(errorPaths((b) => (b.sounds.discard.tracks[0].send = { hall: 1 }))).toEqual(["sounds.discard.tracks[0].send.hall"]);
    expect(errorPaths((b) => b.instruments.bell.layers.push({ sample: "nothing" }))).toEqual([
      "instruments.bell.layers[3].sample",
    ]);
  });

  it("範囲外の値", () => {
    expect(errorPaths((b) => (b.sounds.kan.tracks[0].notes[1].vel = 1.2))).toEqual(["sounds.kan.tracks[0].notes[1].vel"]);
    expect(errorPaths((b) => (b.sounds.kan.tracks[0].notes[1].t = -0.01))).toEqual(["sounds.kan.tracks[0].notes[1].t"]);
    expect(errorPaths((b) => (b.instruments.clack.layers[2].freq = 0))).toEqual(["instruments.clack.layers[2].freq"]);
    expect(errorPaths((b) => (b.instruments.clack.layers[0].filter.q = 0))).toEqual(["instruments.clack.layers[0].filter.q"]);
    expect(errorPaths((b) => (b.instruments.clack.layers[0].env.s = 2))).toEqual(["instruments.clack.layers[0].env.s"]);
    expect(errorPaths((b) => (b.reverb.room.wet = -0.1))).toEqual(["reverb.room.wet"]);
    expect(errorPaths((b) => (b.master.compressor.ratio = 0.5))).toEqual(["master.compressor.ratio"]);
  });

  it("数でない・有限でない数", () => {
    expect(errorPaths((b) => (b.sounds.kan.gain = "1"))).toEqual(["sounds.kan.gain"]);
    expect(errorPaths((b) => (b.sounds.kan.gain = Number.NaN))).toEqual(["sounds.kan.gain"]);
    expect(errorPaths((b) => (b.sounds.kan.gain = Infinity))).toEqual(["sounds.kan.gain"]);
  });

  it("層の音源は 1 つだけ、高さは freq か ratio の一方だけ", () => {
    expect(errorPaths((b) => (b.instruments.clack.layers[0].osc = "sine"))).toEqual(["instruments.clack.layers[0]"]);
    expect(errorPaths((b) => (b.instruments.bell.layers[0] = { gain: 1 }))).toEqual(["instruments.bell.layers[0]"]);
    expect(errorPaths((b) => (b.instruments.bell.layers[0].freq = 440))).toEqual(["instruments.bell.layers[0]"]);
    expect(errorPaths((b) => delete b.instruments.bell.layers[0].ratio)).toEqual(["instruments.bell.layers[0]"]);
    expect(errorPaths((b) => (b.instruments.bell.layers[0].osc = "saw"))).toEqual(["instruments.bell.layers[0].osc"]);
  });

  it("楽器に層が無い", () => {
    expect(errorPaths((b) => (b.instruments.bell.layers = []))).toEqual(["instruments.bell.layers"]);
  });

  it("ピッチ変化は toHz か cents の一方だけ、time は必須", () => {
    const p = "instruments.clack.layers[4].pitchEnv";
    expect(errorPaths((b) => (b.instruments.clack.layers[4].pitchEnv.cents = -1200))).toEqual([p]);
    expect(errorPaths((b) => delete b.instruments.clack.layers[4].pitchEnv.time)).toEqual([`${p}.time`]);
    expect(errorPaths((b) => (b.instruments.clack.layers[4].pitchEnv.time = "attack"))).toEqual([`${p}.time`]);
  });

  it("時間の単位：beat は bpm が必須、sec に bpm は書けない、拍子の形", () => {
    expect(errorPaths((b) => (b.sounds.win.time = { unit: "beat" }))).toEqual(["sounds.win.time.bpm"]);
    expect(errorPaths((b) => (b.sounds.win.time = { unit: "sec", bpm: 120 }))).toEqual(["sounds.win.time.bpm"]);
    expect(errorPaths((b) => (b.sounds.win.time = { unit: "ms" }))).toEqual(["sounds.win.time.unit"]);
    expect(errorPaths((b) => (b.sounds.win.time = { unit: "beat", bpm: 120, sig: [4, 3] }))).toEqual(["sounds.win.time.sig"]);
  });

  it("音名が読めない", () => {
    expect(errorPaths((b) => (b.sounds.win.tracks[0].notes[0].pitch = "H6"))).toEqual(["sounds.win.tracks[0].notes[0].pitch"]);
  });

  it("1 つの音の中で id が重複する（トラックどうし・音符どうし）", () => {
    expect(errorPaths((b) => (b.sounds.kan.tracks[0].notes[3].id = "n1"))).toEqual(["sounds.kan.tracks[0].notes[3].id"]);
    expect(
      errorPaths((b) => b.sounds.kan.tracks.push({ id: "t1", instrument: "clack", notes: [{ id: "n9", t: 0 }] })),
    ).toEqual(["sounds.kan.tracks[1].id"]);
    // 別の音なら同じ id でよい（discard と kan はどちらも t1・n1 を持つ）
    expect(errorPaths(() => {})).toEqual([]);
  });

  it("エラーをまとめて返す", () => {
    const paths = errorPaths((b) => {
      b.sounds.kan.tracks[0].notes[0].vel = 2;
      b.sounds.kan.tracks[0].notes[1].vel = -1;
    });
    expect(paths).toHaveLength(2);
  });
});

describe("validateScore", () => {
  const score = {
    format: "sfx-score/1",
    instruments: example.instruments,
    reverb: example.reverb,
    ...example.sounds.kan,
  };

  it("単体の score を通す", () => {
    const r = validateScore(score);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("format が違う・知らないキー・楽器が無い", () => {
    expect(validateScore({ ...score, format: "sfx-bank/1" }).ok).toBe(false);
    expect(validateScore({ ...score, sounds: {} }).ok).toBe(false);
    expect(validateScore({ ...score, instruments: {} }).ok).toBe(false);
  });
});

describe("トラックの jitter と早期反射", () => {
  it("通す", () => {
    expect(
      errorPaths((b) => {
        b.sounds.kan.tracks[0].jitter = { tune: 34 };
        b.reverb.room.early = [[0.01, 0.5], [0.02, -0.3]];
      }),
    ).toEqual([]);
  });

  it("早期反射：時刻は 0 以上 seconds 未満、強さは -1〜1、形は [時刻, 強さ]、32 個まで", () => {
    expect(errorPaths((b) => (b.reverb.room.early = [[0.7, 0.5]]))).toEqual(["reverb.room.early[0]"]);
    expect(errorPaths((b) => (b.reverb.room.early = [[0.1, 1.5]]))).toEqual(["reverb.room.early[0]"]);
    expect(errorPaths((b) => (b.reverb.room.early = [[0.1]]))).toEqual(["reverb.room.early[0]"]);
    expect(errorPaths((b) => (b.reverb.room.early = Array.from({ length: 33 }, () => [0.1, 0.1])))).toEqual(["reverb.room.early"]);
  });

  it("トラックの jitter に知らないキー", () => {
    expect(errorPaths((b) => (b.sounds.kan.tracks[0].jitter = { pitch: 1 }))).toEqual(["sounds.kan.tracks[0].jitter.pitch"]);
  });
});

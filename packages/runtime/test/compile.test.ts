import { describe, expect, it } from "vitest";
import type { Bank, Instrument, Sound } from "@sfx-atelier/format/types";
import example from "../../format/test/fixtures/proposal-example.sfxbank.json";
import { FLOOR, MIN_RELEASE, STOP_MARGIN, compile, envelope, midiToHz, seeded } from "../src/compile";

// 期待値は手計算から書く（CLAUDE.md）。乱数を使わない場面では random が呼ばれたら落とす
const noRandom = () => {
  throw new Error("乱数を引かないはず");
};
const fixed = (x: number) => () => x;

const bank = example as Bank;
const parts = { instruments: bank.instruments, reverb: bank.reverb };

const sine: Instrument = { layers: [{ osc: "sine", freq: 1000, env: { a: 0.01, d: 0.1 } }] };
const one = (notes: Sound["tracks"][0]["notes"], extra: Partial<Sound> = {}): Sound => ({
  tracks: [{ instrument: "x", notes }],
  ...extra,
});
const firstFreq = (p: ReturnType<typeof compile>, i = 0) => {
  const s = p.voices[i]!.source;
  if (s.kind !== "osc") throw new Error("osc ではない");
  return s.freq;
};

describe("音の高さ", () => {
  it("midiToHz：A4 = 440Hz、1 オクターブで 2 倍、C4 ≒ 261.63Hz", () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it("tune: 1200 で freq の層は 2 倍、-1200 で半分", () => {
    const up = compile(one([{ t: 0, tune: 1200 }]), { instruments: { x: sine } }, noRandom);
    expect(firstFreq(up)).toEqual([["set", 0, 2000]]);
    const down = compile(one([{ t: 0, tune: -1200 }]), { instruments: { x: sine } }, noRandom);
    expect(firstFreq(down)[0]![2]).toBeCloseTo(500, 9);
  });

  it("ratio の層は音符の pitch × ratio（A4・ratio 2 で 880Hz、Hz の数値も読む、無ければ A4）", () => {
    const ins = { x: { layers: [{ osc: "sine" as const, ratio: 2 }] } };
    expect(firstFreq(compile(one([{ t: 0, pitch: "A4" }]), { instruments: ins }, noRandom))[0]![2]).toBeCloseTo(880, 9);
    expect(firstFreq(compile(one([{ t: 0, pitch: 300 }]), { instruments: ins }, noRandom))[0]![2]).toBe(600);
    expect(firstFreq(compile(one([{ t: 0 }]), { instruments: ins }, noRandom))[0]![2]).toBe(880);
  });

  it("フィルタも tune で一緒に上下する", () => {
    const ins = { x: { layers: [{ noise: "white" as const, filter: { type: "bandpass" as const, freq: 3400 } }] } };
    const p = compile(one([{ t: 0, tune: 1200 }]), { instruments: ins }, fixed(0));
    expect(p.voices[0]!.filter).toEqual({ type: "bandpass", freq: 6800, q: 1, gain: 0 });
  });

  it("pitchEnv：toHz へ d 秒（time: decay）で指数カーブ", () => {
    // 提案書の clack の 5 層目：190Hz → 95Hz、a 2ms・d 90ms。音の始まり（0 秒）から 0.09 秒で 95Hz
    const p = compile(bank.sounds.discard!, parts, fixed(0.5));
    const low = p.voices[4]!;
    expect(firstFreq(p, 4)).toEqual([
      ["set", 0, 190],
      ["exp", 0.09, 95],
    ]);
    expect(low.stop).toBeCloseTo(0.002 + 0.09 + STOP_MARGIN, 12);
  });

  it("pitchEnv：cents は開始の高さからの相対（-1200 で半分）、lin も書ける", () => {
    const ins = { x: { layers: [{ osc: "sine" as const, freq: 800, pitchEnv: { cents: -1200, time: 0.05, curve: "lin" as const } }] } };
    expect(firstFreq(compile(one([{ t: 0.1 }]), { instruments: ins }, noRandom))).toEqual([
      ["set", 0.1, 800],
      ["lin", 0.15000000000000002, 400],
    ]);
  });
});

describe("時間", () => {
  it("unit: beat・bpm 120 で 1 拍 0.5 秒（t: 2 拍 → 1 秒、dur: 1 拍 → 0.5 秒）", () => {
    const ins = { x: { layers: [{ osc: "sine" as const, freq: 440, env: { a: 0, d: 0.1, s: 0.5, r: 0.2 } }] } };
    const p = compile(one([{ t: 2, dur: 1 }], { time: { unit: "beat", bpm: 120 } }), { instruments: ins }, noRandom);
    const v = p.voices[0]!;
    expect(v.start).toBe(1);
    // 離す時刻 = 1 + 0.5、無音 = 1.5 + r 0.2
    expect(v.gain.at(-2)).toEqual(["set", 1.5, 0.5]);
    expect(v.gain.at(-1)![1]).toBeCloseTo(1.7, 12);
  });

  it("unit: sec（既定）はそのまま秒", () => {
    expect(compile(one([{ t: 0.25 }]), { instruments: { x: sine } }, noRandom).voices[0]!.start).toBe(0.25);
  });
});

describe("エンベロープ", () => {
  it("exp の AD 型：0.0001 から a で peak、d で 0.0001（-80dB）に戻る", () => {
    const e = envelope({ a: 0.01, d: 0.1 }, 0, 0.5, undefined);
    expect(e.gain).toEqual([
      ["set", 0, FLOOR],
      ["exp", 0.01, 0.5],
      ["exp", 0.11, FLOOR],
    ]);
    expect(FLOOR).toBe(0.0001);
    expect(e.end).toBeCloseTo(0.11, 12);
  });

  it("AD 型は dur を無視する", () => {
    expect(envelope({ a: 0.01, d: 0.1 }, 0, 1, 5).end).toBeCloseTo(0.11, 12);
  });

  it("lin は 0 から 0 へ", () => {
    expect(envelope({ a: 0.01, d: 0.1, curve: "lin" }, 0, 1, undefined).gain).toEqual([
      ["set", 0, 0],
      ["lin", 0.01, 1],
      ["lin", 0.11, 0],
    ]);
  });

  it("a = 0 はいきなり peak", () => {
    expect(envelope({ a: 0, d: 0.1 }, 0.2, 1, undefined).gain[0]).toEqual(["set", 0.2, 1]);
  });

  it("ADSR：dur の間 peak × s を保ち、r で消える。dur が無ければ a + d で離す。r = 0 でも最短 5ms", () => {
    const e = envelope({ a: 0.01, d: 0.1, s: 0.5, r: 0.3 }, 0, 0.8, 1);
    expect(e.gain).toEqual([
      ["set", 0, FLOOR],
      ["exp", 0.01, 0.8],
      ["exp", 0.11, 0.4],
      ["set", 1, 0.4],
      ["exp", 1.3, FLOOR],
    ]);
    expect(envelope({ a: 0.01, d: 0.1, s: 0.5, r: 0.3 }, 0, 0.8, undefined).end).toBeCloseTo(0.41, 12);
    expect(envelope({ a: 0.01, d: 0.1, s: 0.5 }, 0, 0.8, 1).end).toBe(1 + MIN_RELEASE);
  });

  it("音量 = 層の gain × vel", () => {
    // 提案書の kan の 1 打目：clack の 1 層目 gain 0.55 × vel 0.75 = 0.4125
    const p = compile(bank.sounds.kan!, parts, fixed(0.5));
    expect(p.voices[0]!.gain[1]![2]).toBeCloseTo(0.4125, 12);
  });
});

describe("揺らぎと乱数", () => {
  it("variation.tune：乱数 0.75 なら +0.5 × 幅（discard の 68 セントなら +34 セント）", () => {
    // 1 本目の乱数で tune を決める。2730Hz の層（3 層目、2 本目以降の乱数は雑音の位置に使う）
    const p = compile(bank.sounds.discard!, parts, fixed(0.75));
    expect(firstFreq(p, 3)[0]![2]).toBeCloseTo(2730 * Math.pow(2, 34 / 1200), 9);
  });

  it("variation.gain は音全体の音量に掛かる（乱数 1 に近いとき +幅）", () => {
    const p = compile(one([{ t: 0 }], { gain: 0.5, variation: { gain: 0.2 } }), { instruments: { x: sine } }, fixed(1 - 1e-12), {
      gain: 0.5,
    });
    expect(p.gain).toBeCloseTo(0.5 * 0.5 * 1.2, 9);
  });

  it("層の jitter：tune → gain → time の順に引く", () => {
    const ins = { x: { layers: [{ osc: "sine" as const, freq: 1000, jitter: { tune: 100, gain: 0.5, time: 0.01 } }] } };
    const seq = [1, 0, 0.5].map((x) => (x === 1 ? 1 - 1e-12 : x));
    let i = 0;
    const p = compile(one([{ t: 0.1 }]), { instruments: ins }, () => seq[i++]!);
    const v = p.voices[0]!;
    expect(firstFreq(p)[0]![2]).toBeCloseTo(1000 * Math.pow(2, 100 / 1200), 6);
    expect(v.gain[1]![2]).toBeCloseTo(0.5, 9);
    expect(v.start).toBe(0.1);
    expect(i).toBe(3);
  });

  it("開始が負にならない", () => {
    const p = compile(one([{ t: 0 }], { variation: { time: 0.05 } }), { instruments: { x: sine } }, fixed(0));
    expect(p.voices[0]!.start).toBe(0);
  });

  it("同じ種なら同じ予定表、違う種なら違う", () => {
    const a = compile(bank.sounds.kan!, parts, seeded(42));
    const b = compile(bank.sounds.kan!, parts, seeded(42));
    const c = compile(bank.sounds.kan!, parts, seeded(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("seeded は 0 以上 1 未満で、平均がおよそ 0.5", () => {
    const r = seeded(1);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
});

describe("組み立て", () => {
  it("kan：4 打 × clack の 5 層 = 20 声、送りは room、尾は残響 0.7 秒ぶん長い", () => {
    const p = compile(bank.sounds.kan!, parts, seeded(1));
    expect(p.voices).toHaveLength(20);
    expect(p.buses).toEqual([{ gain: 1, pan: 0, sends: [["room", 1]] }]);
    expect(p.gain).toBe(1.05);
    // 最後の打は 0.165 秒、いちばん長い層は a 2ms + d 90ms
    expect(p.end).toBeCloseTo(0.165 + 0.002 + 0.09 + STOP_MARGIN, 12);
    expect(p.tail).toBeCloseTo(p.end + 0.7, 12);
  });

  it("呼び出しの pan はトラックの pan に足し、-1〜1 に収める", () => {
    const s: Sound = { tracks: [{ instrument: "x", pan: 0.8, notes: [{ t: 0 }] }] };
    expect(compile(s, { instruments: { x: sine } }, noRandom, { pan: 0.5 }).buses[0]!.pan).toBe(1);
  });

  it("win：鈴の 3 層 × 4 音、C6 の基音は 1046.5Hz、dur は AD 型なので効かない", () => {
    const p = compile(bank.sounds.win!, parts, noRandom);
    expect(p.voices).toHaveLength(12);
    expect(firstFreq(p, 0)[0]![2]).toBeCloseTo(1046.502, 3);
    expect(firstFreq(p, 1)[0]![2]).toBeCloseTo(1046.502 * 2.76, 2);
    // 最後の音 0.255 秒 + 基音の a 4ms + d 1 秒
    expect(p.end).toBeCloseTo(0.255 + 0.004 + 1 + STOP_MARGIN, 12);
  });

  it("録音の層：再生速度 = ratio × tune", () => {
    const ins = { x: { layers: [{ sample: "drop", ratio: 1.5 }] } };
    const p = compile(one([{ t: 0, tune: 1200 }]), { instruments: ins }, noRandom);
    expect(p.voices[0]!.source).toEqual({ kind: "sample", sample: "drop", rate: [["set", 0, 3]] });
  });

  it("雑音の層：読み出し位置は乱数 × 0.5 秒", () => {
    const ins = { x: { layers: [{ noise: "pink" as const }] } };
    expect(compile(one([{ t: 0 }]), { instruments: ins }, fixed(0.5)).voices[0]!.source).toEqual({
      kind: "noise",
      type: "pink",
      offset: 0.25,
    });
  });

  it("送り先の残響が無い・送り量 0 は送らない、楽器の無いトラックは飛ばす", () => {
    const s: Sound = {
      tracks: [
        { instrument: "x", send: { room: 0, hall: 1 }, notes: [{ t: 0 }] },
        { instrument: "missing", notes: [{ t: 0 }] },
      ],
    };
    const p = compile(s, { instruments: { x: sine }, reverb: bank.reverb }, noRandom);
    expect(p.buses).toEqual([{ gain: 1, pan: 0, sends: [] }]);
    expect(p.tail).toBe(p.end);
  });
});

describe("録音の層の長さ", () => {
  it("dur が無ければ 録音の長さ ÷ 再生速度 で離し、既定の r 5ms で消える", () => {
    const ins = { x: { layers: [{ sample: "drop", ratio: 2 }] } };
    const p = compile(one([{ t: 0.1 }]), { instruments: ins, sampleSeconds: { drop: 0.5 } }, noRandom);
    // 0.1 + 0.5 ÷ 2 = 0.35 秒で離し、0.355 秒で無音
    expect(p.voices[0]!.gain).toEqual([
      ["set", 0.1, 1],
      ["set", 0.1, 1],
      ["set", 0.35, 1],
      ["lin", 0.355, 0],
    ]);
  });
});

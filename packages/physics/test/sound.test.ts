import { describe, expect, it } from "vitest";
import { validateScore } from "@sfx-atelier/format";
import { FLOOR } from "../../runtime/src/compile";
import { simulate, type Scene } from "../src/engine";
import {
  contactTime, ENV_FLOOR, hitLayers, hitOf, hitsOf, modeDecay, pulseSpectrum, renderHits, toScore,
  type Hit, type SoundMaterial,
} from "../src/sound";

// 期待値は式（T60 = ln1000/(πfη)、ヘルツの接触の 1/5 乗、半波の正弦のスペクトル）と既知の信号から書く
const plain: SoundMaterial = { base: 1000, modes: [[1, 1], [3, 0.5]], loss: 0.01, contact: 1e-4, noise: { gain: 0, decay: 0.01, q: 1 } };

describe("式", () => {
  it("T60 = ln(1000) ÷ (π f η)：1000Hz・η 0.01 で ≒ 0.22 秒、周波数が 2 倍なら半分", () => {
    expect(modeDecay(1000, 0.01)).toBeCloseTo(Math.log(1000) / (Math.PI * 10), 12);
    expect(modeDecay(1000, 0.01)).toBeCloseTo(0.2199, 4);
    expect(modeDecay(2000, 0.01)).toBeCloseTo(modeDecay(1000, 0.01) / 2, 12);
  });

  it("接触の時間は速さの 1/5 乗に反比例：32 倍の速さで半分", () => {
    expect(contactTime(1e-4, 1)).toBeCloseTo(1e-4, 15);
    expect(contactTime(1e-4, 32)).toBeCloseTo(0.5e-4, 15);
  });

  it("半波の正弦のスペクトル：f = 0 で 1、f = 1/(2τ) で π/4、f = 1.5/τ で 0", () => {
    const tau = 1e-3;
    expect(pulseSpectrum(0, tau)).toBe(1);
    expect(pulseSpectrum(500, tau)).toBeCloseTo(Math.PI / 4, 9);
    expect(pulseSpectrum(1500, tau)).toBeCloseTo(0, 12);
    // f = 1/τ：|cos π| / |1 − 4| = 1/3
    expect(pulseSpectrum(1000, tau)).toBeCloseTo(1 / 3, 12);
  });

  it("エンベロープの無音の閾値はランタイムと同じ", () => {
    expect(ENV_FLOOR).toBe(FLOOR);
  });
});

describe("当たり", () => {
  it("大きさが半分なら周波数は 2 倍（基準 3cm で 1000Hz → 1.5cm で 2000Hz）", () => {
    expect(hitOf(0, "x", plain, 0.03, 1, 1, 1e-9).modes[0]!.freq).toBeCloseTo(1000, 9);
    expect(hitOf(0, "x", plain, 0.015, 1, 1, 1e-9).modes[0]!.freq).toBeCloseTo(2000, 9);
  });

  it("振幅は 力積 ÷ 質量 に比例", () => {
    const a = hitOf(0, "x", plain, 0.03, 1, 1, 1e-9).modes[0]!.gain;
    expect(hitOf(0, "x", plain, 0.03, 1, 2, 1e-9).modes[0]!.gain).toBeCloseTo(2 * a, 12);
    expect(hitOf(0, "x", plain, 0.03, 4, 2, 1e-9).modes[0]!.gain).toBeCloseTo(a / 2, 12);
  });

  it("強く当たるほど明るい（高いモードの比が上がる）", () => {
    const ratio = (speed: number) => {
      const h = hitOf(0, "x", { ...plain, contact: 3e-4 }, 0.03, 1, 1, contactTime(3e-4, speed));
      return h.modes[1]!.gain / h.modes[0]!.gain;
    };
    expect(ratio(4)).toBeGreaterThan(ratio(0.5));
  });

  it("maxFreq より高いモードは捨てる", () => {
    expect(hitOf(0, "x", plain, 0.03, 1, 1, 1e-9, 2000).modes).toHaveLength(1);
  });
});

describe("物理から", () => {
  const scene: Scene = {
    duration: 1,
    planes: [{ id: "table", shape: "plane", material: "felt", normal: [0, 0, 1], offset: 0 }],
    bodies: [{ id: "tile", shape: "box", size: [0.026, 0.035, 0.02], mass: 0.012, material: "resin", pos: [0, 0, 0.1] }],
  };
  const events = simulate(scene).events;

  it("1 つの出来事で、牌と卓の両方が鳴る", () => {
    const hits = hitsOf(scene, events);
    expect(hits).toHaveLength(2 * events.length);
    expect(hits[0]!.source).toBe("tile");
    expect(hits[1]!.source).toBe("table");
    // 牌のいちばん低いモード：2000Hz × 3cm ÷ 3.5cm
    expect(hits[0]!.modes[0]!.freq).toBeCloseTo((2000 * 0.03) / 0.035, 9);
  });

  it("sfx-score にすると形式の検査を通り、物体ごとのトラックと当たりの音符になる", () => {
    const score = toScore(hitsOf(scene, events));
    const res = validateScore(score);
    expect(res).toMatchObject({ ok: true });
    expect(score.tracks.map((t) => t.id)).toEqual(["tile", "table"]);
    expect(score.tracks[0]!.notes.map((n) => n.t)).toEqual(events.map((e) => e.t));
    // いちばん強い当たりは vel 1
    expect(Math.max(...score.tracks[0]!.notes.map((n) => n.vel!))).toBe(1);
  });

  it("知らない材質の音は投げる", () => {
    expect(() => hitsOf({ ...scene, materials: { clay: { restitution: 0, friction: 0.5 } }, bodies: [{ ...scene.bodies[0]!, material: "clay" }] }, events.map((e) => ({ ...e, materials: ["clay", "felt"] as [string, string] })))).toThrow();
  });
});

describe("層", () => {
  const hit: Hit = { t: 0, source: "x", modes: [{ freq: 1000, gain: 0.5, decay: 0.2 }], noise: { freq: 3000, q: 1, gain: 0.25, decay: 0.01 } };

  it("d は -80dB までの時間：T60 × log(10⁴) ÷ log(10³) = T60 × 4/3", () => {
    const [osc, noise] = hitLayers(hit);
    expect(osc).toMatchObject({ osc: "sine", freq: 1000, gain: 0.5 });
    expect(osc!.env!.d).toBeCloseTo((0.2 * 4) / 3, 12);
    expect(noise).toMatchObject({ noise: "white", filter: { type: "bandpass", freq: 3000, q: 1 }, gain: 0.25 });
    expect(noise!.env!.d).toBeCloseTo((0.01 * 4) / 3, 12);
  });

  it("toScore はいちばん強い当たりの層の強さの合計を 1 に揃える", () => {
    const score = toScore([hit, { ...hit, t: 0.3, modes: [{ ...hit.modes[0]!, gain: 0.25 }], noise: { ...hit.noise!, gain: 0.125 } }]);
    const layers = score.instruments!.x!.layers;
    expect(layers.reduce((s, l) => s + l.gain!, 0)).toBeCloseTo(1, 12);
    expect(score.tracks[0]!.notes.map((n) => n.vel)).toEqual([1, 0.5]);
  });
});

describe("サンプルの列", () => {
  const sr = 48000;
  const mode = { freq: 1000, gain: 0.5, decay: 0.3 };
  const one: Hit = { t: 0.1, source: "x", modes: [mode], noise: null };

  it("当たりの時刻までは無音、そこから鳴る", () => {
    const s = renderHits([one], { sampleRate: sr, seconds: 0.5 });
    expect(s.length).toBe(0.5 * sr);
    expect(s.subarray(0, 0.1 * sr).every((x) => x === 0)).toBe(true);
    expect(Math.max(...s.subarray(0.1 * sr, 0.11 * sr).map(Math.abs))).toBeGreaterThan(0.4);
  });

  it("周波数：0.1 秒の間に、上向きのゼロ交差が 100 回", () => {
    const s = renderHits([{ ...one, t: 0 }], { sampleRate: sr, seconds: 0.1 });
    let ups = 0;
    for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 && s[i]! >= 0) ups++;
    expect(Math.abs(ups - 100)).toBeLessThanOrEqual(1);
  });

  it("減衰：T60 の時刻の包絡は始めの 1/1000（-60dB）", () => {
    const s = renderHits([{ ...one, t: 0 }], { sampleRate: sr, seconds: 0.4 });
    const peak = (at: number) => Math.max(...s.subarray(Math.round(at * sr), Math.round((at + 0.002) * sr)).map(Math.abs));
    const ratio = peak(0.3 - 0.001) / peak(0);
    expect(20 * Math.log10(ratio)).toBeGreaterThan(-61);
    expect(20 * Math.log10(ratio)).toBeLessThan(-59);
  });

  it("線形：2 つの当たりの音は、1 つずつの音の和", () => {
    const a = renderHits([one], { sampleRate: sr, seconds: 0.5 });
    const b = renderHits([{ ...one, t: 0.2, modes: [{ ...mode, freq: 1500 }] }], { sampleRate: sr, seconds: 0.5 });
    const ab = renderHits([one, { ...one, t: 0.2, modes: [{ ...mode, freq: 1500 }] }], { sampleRate: sr, seconds: 0.5 });
    for (let i = 0; i < ab.length; i += 37) expect(ab[i]!).toBeCloseTo(a[i]! + b[i]!, 6);
  });

  it("雑音は種で決まる", () => {
    const noisy: Hit = { ...one, modes: [], noise: { freq: 3000, q: 1, gain: 1, decay: 0.05 } };
    const x = renderHits([noisy], { seed: 5 });
    expect(renderHits([noisy], { seed: 5 })).toEqual(x);
    expect(renderHits([noisy], { seed: 6 })).not.toEqual(x);
    expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(0);
  });

  it("長さの既定は、最後の当たり ＋ いちばん長い T60", () => {
    expect(renderHits([one], { sampleRate: sr }).length).toBe(Math.ceil(0.4 * sr));
  });
});

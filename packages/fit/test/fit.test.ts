import { describe, expect, it } from "vitest";
import { distance } from "@sfx-atelier/analysis";
import type { Layer, OscLayer } from "@sfx-atelier/format/types";
import { fit } from "../src/fit";
import { mono, play, rng, SR } from "./synth";

// 期待値は元の層のパラメータ（提案書 6.4：周波数 ±1%、減衰 ±10%）
const oscs = (layers: Layer[]) => layers.filter((l): l is OscLayer => "osc" in l);

function expectRecovered(want: OscLayer[], got: OscLayer[]) {
  for (const w of want) {
    const g = got.find((x) => Math.abs(x.freq! / w.freq! - 1) < 0.01);
    expect(g, `${w.freq}Hz が見つからない（得たもの: ${got.map((x) => x.freq).join(", ")}）`).toBeDefined();
    expect(Math.abs(g!.env!.d! / w.env!.d! - 1), `${w.freq}Hz の d: ${g!.env!.d} / ${w.env!.d}`).toBeLessThan(0.1);
    if (w.pitchEnv?.toHz) expect(Math.abs(g!.pitchEnv!.toHz! / w.pitchEnv.toHz - 1)).toBeLessThan(0.05);
  }
}

describe("fit：既知の層から作った音で元の層が戻る", () => {
  it("440Hz の減衰する正弦波（gain 0.5、d 0.6）", () => {
    const want: OscLayer = { osc: "sine", freq: 440, gain: 0.5, env: { a: 0.002, d: 0.6 } };
    const r = fit(mono(play([want], 0, 0.8)));
    const got = r.score.instruments!.p1!.layers;
    expect(oscs(got)).toHaveLength(1);
    expectRecovered([want], oscs(got));
    expect(Math.abs(got[0]!.gain! / 0.5 - 1)).toBeLessThan(0.1);
  });

  it("clack の正弦波の層（1180Hz・2730Hz・190→95Hz の下降）", () => {
    const want: OscLayer[] = [
      { osc: "sine", freq: 1180, gain: 0.22, env: { a: 0.002, d: 0.055 } },
      { osc: "sine", freq: 2730, gain: 0.1, env: { a: 0.002, d: 0.028 } },
      { osc: "sine", freq: 190, gain: 0.5, env: { a: 0.002, d: 0.09 }, pitchEnv: { toHz: 95, time: "decay" } },
    ];
    const r = fit(mono(play(want, 0.01, 0.2)), { noise: false });
    expectRecovered(want, oscs(r.score.instruments!.p1!.layers));
  });

  it("bell（C6 の 1・2.76・5.4 倍、d 1・0.4・0.15）", () => {
    const c6 = 1046.5;
    const want: OscLayer[] = [
      { osc: "sine", freq: c6, gain: 0.2, env: { a: 0.004, d: 1 } },
      { osc: "sine", freq: c6 * 2.76, gain: 0.05, env: { a: 0.002, d: 0.4 } },
      { osc: "sine", freq: c6 * 5.4, gain: 0.016, env: { a: 0.001, d: 0.15 } },
    ];
    const r = fit(mono(play(want, 0, 1.2)));
    expectRecovered(want, oscs(r.score.instruments!.p1!.layers));
  });

  it("時刻をずらした 2 つの音は、始まりごとに楽器とトラックに分かれる", () => {
    const x = play([{ osc: "sine", freq: 880, gain: 0.3, env: { a: 0.002, d: 0.2 } }], 0, 0.5);
    play([{ osc: "sine", freq: 1320, gain: 0.3, env: { a: 0.002, d: 0.2 } }], 0.15, 0.5, x);
    const r = fit(mono(x), { noise: false });
    expect(r.onsets.length).toBe(2);
    expect(r.onsets[1]).toBeCloseTo(0.15, 2);
    expectRecovered([{ osc: "sine", freq: 880, env: { d: 0.2 } }], oscs(r.score.instruments!.p1!.layers));
    expectRecovered([{ osc: "sine", freq: 1320, env: { d: 0.2 } }], oscs(r.score.instruments!.p2!.layers));
    expect(r.score.instruments!.p1!.layers).toHaveLength(1);
    expect(r.score.instruments!.p2!.layers).toHaveLength(1);
  });
});

describe("fit：雑音", () => {
  it("白色雑音はピークを作らず、帯域雑音だけになる", () => {
    const r1 = rng(5);
    const x = Float32Array.from({ length: SR * 0.3 }, (_, i) => 0.3 * Math.exp(-i / SR / 0.05) * (r1() * 2 - 1));
    const r = fit(mono(x));
    const layers = r.score.instruments!.p1!.layers;
    expect(oscs(layers)).toHaveLength(0);
    expect(layers.length).toBeGreaterThan(3);
  });

  it("帯域雑音の層（3400Hz・q 1.4）は、その付近の帯域で一番大きく、音量の山が ±3dB で合う", () => {
    const want: Layer = { noise: "white", filter: { type: "bandpass", freq: 3400, q: 1.4 }, gain: 0.55, env: { a: 0.001, d: 0.1 } };
    const x = play([want], 0, 0.3);
    const r = fit(mono(x));
    const layers = r.score.instruments!.p1!.layers;
    expect(oscs(layers)).toHaveLength(0);
    const loudest = layers.reduce((a, b) => (a.gain! > b.gain! ? a : b));
    const f = (loudest as { filter: { freq: number } }).filter.freq;
    expect(f).toBeGreaterThan(2000);
    expect(f).toBeLessThan(5000);
    const y = play(layers, 0, 0.3, undefined, 9);
    expect(Math.abs(distance(x, y, SR).peak)).toBeLessThan(3);
  });
});

describe("fit：予算", () => {
  const want: Layer[] = [
    ...[1, 2.76, 5.4, 8.9, 13.3].map((k, i): Layer => ({ osc: "sine", freq: 500 * k, gain: 0.3 / (i + 1), env: { a: 0.002, d: 0.5 / (i + 1) } })),
    { noise: "white", filter: { type: "bandpass", freq: 6000, q: 2 }, gain: 0.2, env: { a: 0.001, d: 0.05 } },
  ];
  const x = play(want, 0, 0.7);

  it("既定の予算で縮めた JSON は 3KB 以下", () => {
    expect(fit(mono(x)).bytes).toBeLessThanOrEqual(3072);
  });

  it("層の数を減らすと層が減り、距離は悪くなる（単調）", () => {
    const run = (layers: number) => {
      const r = fit(mono(x), { budget: { layers } });
      const n = r.score.instruments!.p1!.layers.length;
      return { n, d: distance(x, play(r.score.instruments!.p1!.layers, 0, 0.7, undefined, 9), SR).spectral };
    };
    const full = run(24), half = run(4), one = run(1);
    expect(half.n).toBe(4);
    expect(one.n).toBe(1);
    expect(full.n).toBeGreaterThan(half.n);
    expect(full.d).toBeLessThan(half.d);
    expect(half.d).toBeLessThan(one.d);
  });

  it("バイト数を半分にすると層が減る", () => {
    const full = fit(mono(x));
    const half = fit(mono(x), { budget: { bytes: Math.floor(full.bytes / 2) } });
    expect(half.bytes).toBeLessThanOrEqual(full.bytes / 2);
    expect(half.components.length).toBeLessThan(full.components.length);
  });
});

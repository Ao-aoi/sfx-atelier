// テスト用の小さな合成器：ランタイム（runtime/compile・render）と同じ決まりで層を鳴らす。
//   exp エンベロープ：a 秒で FLOOR → gain、d 秒で gain → FLOOR（指数）
//   pitchEnv（toHz, decay）：d 秒で freq → toHz（指数）
//   雑音：-1〜1 の一様乱数を RBJ の bandpass（山 0dB）に通す
import type { Layer } from "@sfx-atelier/format/types";

export const SR = 48000;
const FLOOR = 0.0001;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function envAt(t: number, gain: number, a: number, d: number): number {
  if (t < 0) return 0;
  if (t < a) return FLOOR * Math.pow(gain / FLOOR, t / a);
  const u = t - a;
  return u >= d ? 0 : gain * Math.pow(FLOOR / gain, u / d);
}

function bandpass(x: Float32Array, f0: number, q: number): Float32Array {
  const w = (2 * Math.PI * f0) / SR, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** 層の並びを start 秒に鳴らし、seconds 秒の波形にする（out に足す） */
export function play(layers: Layer[], start: number, seconds: number, out: Float32Array = new Float32Array(Math.round(seconds * SR)), seed = 1): Float32Array {
  const r = rng(seed);
  for (const l of layers) {
    const gain = l.gain ?? 1, a = l.env?.a ?? 0.002, d = l.env?.d ?? 0.25;
    if ("osc" in l) {
      const f0 = l.freq!, to = l.pitchEnv?.toHz;
      let phase = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / SR - start;
        if (t < 0) continue;
        const f = to === undefined ? f0 : f0 * Math.pow(to / f0, Math.min(1, t / d));
        out[i]! += envAt(t, gain, a, d) * Math.sin(phase);
        phase += (2 * Math.PI * f) / SR;
      }
    } else if ("noise" in l) {
      const raw = Float32Array.from({ length: out.length }, () => r() * 2 - 1);
      const y = l.filter ? bandpass(raw, l.filter.freq, l.filter.q ?? 1) : raw;
      for (let i = 0; i < out.length; i++) out[i]! += envAt(i / SR - start, gain, a, d) * y[i]!;
    }
  }
  return out;
}

export const mono = (x: Float32Array) => ({ sampleRate: SR, channels: [x] });

// 聞こえ方の距離：マルチ解像度の対数スペクトルの差＋立ち上がり・長さ・音量の山の差。
// 位相は聞こえないので波形の一致は見ない。数字は目安で、最後は耳で決める。
import { sfxMetrics } from "./sfx";
import { toMono, type Signal } from "./signal";
import { stft } from "./stft";

/** 窓の長さ。短い窓で時間の変化を、長い窓で周波数を見る */
export const DISTANCE_SIZES = [256, 512, 1024, 2048] as const;
/** これより小さい成分は比べない（元の音の最大から -dB） */
export const DISTANCE_FLOOR_DB = 70;

export interface Distance {
  /** 対数スペクトルの平均の差（dB）。窓の長さごとの平均 */
  spectral: number;
  /** 窓の長さごとの値 */
  bySize: number[];
  /** 立ち上がりの差（秒） */
  attack: number;
  /** 長さの差（秒） */
  length: number;
  /** 音量の山（RMS）の差（dB） */
  peak: number;
  /** まとめた値（目安）：spectral ＋ |peak| × 0.5 ＋ |attack|（ms）× 0.2 ＋ |length| ÷ 長い方 × 10 */
  total: number;
}

function mono(s: Signal | Float32Array): Float32Array {
  return s instanceof Float32Array ? s : toMono(s);
}

/**
 * 1 つの窓の長さでの対数スペクトルの差（dB の平均）。
 * 両方の信号を同じ長さに 0 で埋め、どちらかが下限より大きい点だけで平均する。
 */
export function logSpectralDistance(a: Float32Array, b: Float32Array, sampleRate: number, size: number): number {
  const n = Math.max(a.length, b.length);
  const pad = (x: Float32Array) => (x.length === n ? x : (() => { const y = new Float32Array(n); y.set(x); return y; })());
  const A = stft(pad(a), sampleRate, size), B = stft(pad(b), sampleRate, size);
  let max = 0;
  for (const f of A.frames) for (const v of f) if (v > max) max = v;
  if (max === 0) for (const f of B.frames) for (const v of f) if (v > max) max = v;
  if (max === 0) return 0;
  const floor = 20 * Math.log10(max) - DISTANCE_FLOOR_DB;
  const db = (v: number) => Math.max(floor, v > 0 ? 20 * Math.log10(v) : floor);
  let sum = 0, count = 0;
  for (let f = 0; f < A.frames.length; f++) {
    const fa = A.frames[f]!, fb = B.frames[f]!;
    for (let k = 1; k < fa.length; k++) {
      const da = db(fa[k]!), dbb = db(fb[k]!);
      if (da === floor && dbb === floor) continue;
      sum += Math.abs(da - dbb);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** 元の音 a と変換後の音 b の距離 */
export function distance(a: Signal | Float32Array, b: Signal | Float32Array, sampleRate: number): Distance {
  const ma = mono(a), mb = mono(b);
  const bySize = DISTANCE_SIZES.map((size) => logSpectralDistance(ma, mb, sampleRate, size));
  const spectral = bySize.reduce((s, v) => s + v, 0) / bySize.length;
  const xa = sfxMetrics({ sampleRate, channels: [ma] }), xb = sfxMetrics({ sampleRate, channels: [mb] });
  const peak = Number.isFinite(xa.peakRmsDb) && Number.isFinite(xb.peakRmsDb) ? xb.peakRmsDb - xa.peakRmsDb : xa.peakRmsDb === xb.peakRmsDb ? 0 : Infinity;
  const attack = xb.attack - xa.attack;
  const length = xb.length - xa.length;
  const longer = Math.max(xa.length, xb.length) || 1;
  return {
    spectral,
    bySize,
    attack,
    length,
    peak,
    total: spectral + Math.abs(peak) * 0.5 + Math.abs(attack) * 1000 * 0.2 + (Math.abs(length) / longer) * 10,
  };
}

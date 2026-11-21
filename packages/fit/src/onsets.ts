// 音の始まり（オンセット）と、始まりごとの立ち上がりを音量の推移から探す。
import { envelope, ENVELOPE_STEP } from "@sfx-atelier/analysis";

/** 始まりの検出に使う、なめらかな音量の窓（秒）。低い音の 1 周期のうねりを拾わないように長めにする */
const SMOOTH = 0.01;
/** なめらかな音量が、直前 SMOOTH 秒の最小からこの倍率以上に上がったら始まり（+6dB） */
const RISE = 2;
/** 山からこの比より小さいところでは探さない（-40dB） */
const MIN_LEVEL = 0.01;
/** 始まりどうしの最短の間隔（秒） */
export const MIN_GAP = 0.02;
/** 立ち上がりを測る音量の刻み（秒）となめらかにする幅（刻みの数、中心から前後） */
const ATTACK_STEP = 0.0005;
const ATTACK_SMOOTH = 2;
/** 立ち上がりを探す長さの上限（秒） */
const ATTACK_MAX = 0.3;

/** 直前 n 個の窓のパワーの平均の平方根 */
function trailingRms(env: Float64Array, n: number): Float64Array {
  const out = new Float64Array(env.length);
  let sum = 0;
  for (let w = 0; w < env.length; w++) {
    sum += env[w]! * env[w]!;
    if (w >= n) sum -= env[w - n]! * env[w - n]!;
    out[w] = Math.sqrt(Math.max(0, sum) / Math.min(n, w + 1));
  }
  return out;
}

/**
 * 始まりの時刻（秒）の並び。最初の 1 つは、山から -60dB を最初に超えた時刻。
 * 2 つ目からは、なめらかな音量が短い間に 2 倍以上になったところで、
 * 1ms ごとの音量が上がる前の 2 倍を最初に超えた時刻を始まりにする。
 */
export function findOnsets(mono: Float32Array, sampleRate: number): number[] {
  const env = envelope(mono, sampleRate);
  let top = 0;
  for (const v of env) top = Math.max(top, v);
  if (top === 0) return [];
  const step = Math.max(1, Math.round(sampleRate * ENVELOPE_STEP)) / sampleRate;
  const n = Math.max(1, Math.round(SMOOTH / step));
  const smooth = trailingRms(env, n);
  const gap = Math.round(MIN_GAP / step);
  const first = env.findIndex((v) => v >= top * 1e-3);
  const out = [first * step];
  let last = first;
  for (let w = first + n; w < env.length; w++) {
    if (w - last < gap || smooth[w]! < top * MIN_LEVEL) continue;
    let lo = Infinity;
    for (let j = w - n; j < w; j++) lo = Math.min(lo, smooth[j]!);
    if (smooth[w]! < lo * RISE) continue;
    const before = smooth[w - n]!;
    let at = w - n;
    while (at < w && env[at]! < before * RISE) at++;
    out.push(at * step);
    last = w;
  }
  return out;
}

/**
 * 始まりごとの立ち上がり（秒）：始まりから、次の始まりまで（長くても ATTACK_MAX 秒）の山の 90% に
 * 達するまで。0.5ms ごとの音量を前後 1ms でなめらかにして測る。最短 1ms。
 */
export function findAttacks(mono: Float32Array, sampleRate: number, onsets: number[]): number[] {
  const env = envelope(mono, sampleRate, ATTACK_STEP);
  const step = Math.max(1, Math.round(sampleRate * ATTACK_STEP)) / sampleRate;
  const smooth = Float64Array.from(env, (_, w) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, w - ATTACK_SMOOTH); j <= Math.min(env.length - 1, w + ATTACK_SMOOTH); j++) { s += env[j]! ** 2; c++; }
    return Math.sqrt(s / c);
  });
  return onsets.map((t0, i) => {
    const w0 = Math.round(t0 / step);
    const w1 = Math.min(smooth.length, Math.round(Math.min(onsets[i + 1] ?? Infinity, t0 + ATTACK_MAX) / step));
    let top = 0;
    for (let w = w0; w < w1; w++) top = Math.max(top, smooth[w]!);
    let w = w0;
    while (w < w1 && smooth[w]! < top * 0.9) w++;
    return Math.max(0.001, (w - w0) * step);
  });
}

/**
 * 音量から見つけた始まりに、ほかの手がかり（新しく現れた音程のある成分の始まり）を足す。
 * MIN_GAP より近いものは早い方にまとめる。最初の始まりより前のものは捨てる
 */
export function mergeOnsets(fromEnvelope: number[], extra: number[]): number[] {
  if (!fromEnvelope.length) return [];
  const all = [...fromEnvelope, ...extra.filter((t) => t > fromEnvelope[0]!)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (!out.length || t - out.at(-1)! >= MIN_GAP) out.push(t);
  return out;
}

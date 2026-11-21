// 効果音向けの指標：立ち上がり・余韻・硬さ・音量の山・長さ。
// 短い音を前提にするので、調・テンポ・和音は出さない。
import { magnitudeSpectrum } from "./fft";
import { BAND_EDGES } from "./features";
import { toMono, type Signal } from "./signal";

export interface SfxMetrics {
  /** 秒。最初に山から -60dB を超えた時刻 */
  start: number;
  /** 秒。山から -60dB を超えている区間の長さ */
  length: number;
  /** 立ち上がり（秒）。音量の推移が山の 10% から 90% に達するまで */
  attack: number;
  /** 余韻（秒）。音量の推移の山から、-40dB を最後に下回るまで */
  tail: number;
  /** サンプルの絶対値の最大（dBFS） */
  peakDb: number;
  /** 音量の推移（RMS）の最大（dBFS） */
  peakRmsDb: number;
  /** 音量の推移の山の時刻（秒） */
  peakTime: number;
  /** スペクトル重心（Hz、パワーの重み） */
  centroid: number;
  /** 4kHz 以上のパワーの割合（0〜1）。重心と合わせて「硬さ」の目安 */
  highRatio: number;
}

/** 音量の推移の窓（秒） */
export const ENVELOPE_STEP = 0.001;

/** 音量の推移：ENVELOPE_STEP ごとの RMS */
export function envelope(mono: ArrayLike<number>, sampleRate: number, step = ENVELOPE_STEP): Float64Array {
  const size = Math.max(1, Math.round(sampleRate * step));
  const out = new Float64Array(Math.ceil(mono.length / size));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    const end = Math.min(mono.length, (w + 1) * size);
    for (let i = w * size; i < end; i++) sum += mono[i]! * mono[i]!;
    out[w] = Math.sqrt(sum / size);
  }
  return out;
}

const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** 長さ全体の平均パワースペクトル（size 点、hop は size/4。短い音は後ろを 0 で埋める） */
export function averagePowerSpectrum(mono: ArrayLike<number>, size = 2048): Float64Array {
  const hop = size / 4;
  const sum = new Float64Array(size / 2);
  const frame = new Float64Array(size);
  let count = 0;
  for (let start = 0; count === 0 || start + size / 2 < mono.length; start += hop) {
    frame.fill(0);
    for (let i = 0; i < size && start + i < mono.length; i++) frame[i] = mono[start + i]!;
    const mag = magnitudeSpectrum(frame);
    for (let k = 0; k < sum.length; k++) sum[k] = sum[k]! + mag[k]! * mag[k]!;
    count++;
  }
  for (let k = 0; k < sum.length; k++) sum[k] = sum[k]! / count;
  return sum;
}

export function sfxMetrics(signal: Signal): SfxMetrics {
  const mono = toMono(signal);
  const { sampleRate } = signal;
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]!));

  const env = envelope(mono, sampleRate);
  let top = 0, topAt = 0;
  for (let w = 0; w < env.length; w++) if (env[w]! > top) { top = env[w]!; topAt = w; }

  const firstAbove = (level: number, from = 0) => {
    for (let w = from; w < env.length; w++) if (env[w]! >= level) return w;
    return -1;
  };
  const lastAbove = (level: number) => {
    for (let w = env.length - 1; w >= 0; w--) if (env[w]! >= level) return w;
    return -1;
  };

  const power = averagePowerSpectrum(mono);
  const binHz = sampleRate / (power.length * 2);
  let total = 0, weighted = 0, high = 0;
  for (let k = 1; k < power.length; k++) {
    const hz = k * binHz;
    total += power[k]!;
    weighted += power[k]! * hz;
    if (hz >= BAND_EDGES[1]) high += power[k]!;
  }

  if (top === 0) {
    return { start: 0, length: 0, attack: 0, tail: 0, peakDb: -Infinity, peakRmsDb: -Infinity, peakTime: 0, centroid: 0, highRatio: 0 };
  }
  const step = Math.max(1, Math.round(sampleRate * ENVELOPE_STEP)) / sampleRate;
  const startW = firstAbove(top * 1e-3);
  const endW = lastAbove(top * 1e-3);
  const t10 = firstAbove(top * 0.1);
  const t90 = firstAbove(top * 0.9, t10);
  const tailEnd = lastAbove(top * 1e-2);
  return {
    start: startW * step,
    length: (endW - startW + 1) * step,
    attack: (t90 - t10) * step,
    tail: (tailEnd - topAt) * step,
    peakDb: toDb(peak),
    peakRmsDb: toDb(top),
    peakTime: topAt * step,
    centroid: total ? weighted / total : 0,
    highRatio: total ? high / total : 0,
  };
}

// 短時間フーリエ変換（STFT）。ハン窓、振幅スペクトルの並び。
import { magnitudeSpectrum } from "./fft";

export interface Stft {
  sampleRate: number;
  /** 窓の長さ（2 の累乗） */
  size: number;
  hop: number;
  /** フレームごとの振幅スペクトル（size/2 本） */
  frames: Float64Array[];
}

/**
 * フレーム i は [i × hop, i × hop + size) を見る（中心は i × hop + size/2）。
 * 信号の最後のサンプルまで覆うようにフレームを並べ、はみ出した分は 0 で埋める。短い信号でも 1 フレームはある。
 */
export function stft(mono: ArrayLike<number>, sampleRate: number, size = 2048, hop = size / 4): Stft {
  const count = Math.max(1, Math.ceil(Math.max(0, mono.length - size) / hop) + 1);
  const frames: Float64Array[] = [];
  const buf = new Float64Array(size);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    buf.fill(0);
    const end = Math.min(size, mono.length - start);
    for (let i = 0; i < end; i++) buf[i] = mono[start + i]!;
    frames.push(magnitudeSpectrum(buf));
  }
  return { sampleRate, size, hop, frames };
}

/** フレームの中心の時刻（秒） */
export const frameTime = (s: Stft, f: number) => (f * s.hop + s.size / 2) / s.sampleRate;

/** k 本目の周波数（Hz） */
export const binHz = (s: Stft, k: number) => (k * s.sampleRate) / s.size;

/**
 * ハン窓の振幅スペクトルの山の高さ → 正弦波の振幅。
 * 振幅 A の正弦波は、ハン窓（平均 1/2）をかけた N 点の DFT で A × N/4 の山になる
 */
export const peakToAmplitude = (mag: number, size: number) => (4 * mag) / size;

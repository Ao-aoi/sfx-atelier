// 聞き比べの数字：5ms ごとの音量の推移、スペクトル重心、長さ、最大音量。
// M4 の analysis パッケージができたら、そちらに移す。

/** 左右を平均したモノラル */
export function mono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

export const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** 窓ごとの RMS（既定 5ms） */
export function rmsEnvelope(x: Float32Array, rate: number, windowSec = 0.005): number[] {
  const w = Math.max(1, Math.round(rate * windowSec));
  const out: number[] = [];
  for (let i = 0; i < x.length; i += w) {
    let s = 0;
    const end = Math.min(x.length, i + w);
    for (let j = i; j < end; j++) s += x[j]! * x[j]!;
    out.push(Math.sqrt(s / (end - i)));
  }
  return out;
}

/** 実数列の FFT の大きさ（長さは 2 の累乗） */
export function fftMagnitude(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2]!;
        const ai = im[i + k + len / 2]!;
        const tr = ar * wr - ai * wi;
        const ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k]! - tr;
        im[i + k + len / 2] = im[i + k]! - ti;
        re[i + k] = re[i + k]! + tr;
        im[i + k] = im[i + k]! + ti;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

/** スペクトル重心（Hz）。2048 点・ハン窓・512 ずらしのフレームを、フレームのエネルギーで重み付けして平均する */
export function spectralCentroid(x: Float32Array, rate: number, size = 2048, hop = 512): number {
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  let num = 0;
  let den = 0;
  const frame = new Float32Array(size);
  for (let start = 0; start + size <= x.length; start += hop) {
    for (let i = 0; i < size; i++) frame[i] = x[start + i]! * win[i]!;
    const mag = fftMagnitude(frame);
    for (let k = 0; k < mag.length; k++) {
      const p = mag[k]! * mag[k]!;
      num += ((k * rate) / size) * p;
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

/** 最大音量から -60dB を最後に上回る時刻（秒） */
export function audibleLength(x: Float32Array, rate: number, belowPeakDb = 60): number {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const th = peak * Math.pow(10, -belowPeakDb / 20);
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]!) > th) return (i + 1) / rate;
  return 0;
}

export interface Measure {
  peakDb: number;
  length: number;
  centroid: number;
  /** 5ms ごとの RMS（dB） */
  envelopeDb: number[];
}

export function measure(buf: AudioBuffer): Measure {
  const x = mono(buf);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return {
    peakDb: toDb(peak),
    length: audibleLength(x, buf.sampleRate),
    centroid: spectralCentroid(x, buf.sampleRate),
    envelopeDb: rmsEnvelope(x, buf.sampleRate).map(toDb),
  };
}

export interface Diff {
  /** 長さの差（秒、B − A） */
  length: number;
  /** 重心の差（割合、B ÷ A − 1） */
  centroid: number;
  /** 最大音量の差（dB、B − A） */
  peakDb: number;
  /** 5ms ごとの音量の差の平均（dB）。どちらかが -60dB を超えている窓だけで数える */
  envelopeDb: number;
}

export function diff(a: Measure, b: Measure): Diff {
  let sum = 0;
  let n = 0;
  const len = Math.max(a.envelopeDb.length, b.envelopeDb.length);
  for (let i = 0; i < len; i++) {
    const x = Math.max(a.envelopeDb[i] ?? -180, -60);
    const y = Math.max(b.envelopeDb[i] ?? -180, -60);
    if (x <= -60 && y <= -60) continue;
    sum += Math.abs(x - y);
    n++;
  }
  return {
    length: b.length - a.length,
    centroid: a.centroid > 0 ? b.centroid / a.centroid - 1 : 0,
    peakDb: b.peakDb - a.peakDb,
    envelopeDb: n ? sum / n : 0,
  };
}

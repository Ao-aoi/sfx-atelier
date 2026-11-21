// 音全体の特徴量。analysis-demo/app.js の analyzeBuffer を取り出したもの（計算は変えない）。
import { magnitudeSpectrum } from "./fft";
import { toMono, type Signal } from "./signal";

export interface Frame {
  /** 秒 */
  time: number;
  rms: number;
  /** スペクトル重心（Hz） */
  centroid: number;
  /** 85% ロールオフ（Hz） */
  rolloff: number;
  /** ゼロ交差率（1 サンプルあたり） */
  zcr: number;
  /** スペクトル変化（前のフレームから増えた振幅の和） */
  flux: number;
}

export interface Features {
  duration: number;
  sampleRate: number;
  channels: number;
  frameCount: number;
  rmsMean: number;
  centroidMean: number;
  rolloffMean: number;
  zcrMean: number;
  /** フレームの RMS の山と平均の比（dB） */
  dynamicRange: number;
  stereo: { correlation: number; width: number };
  /** 推定テンポ。求まらなければ null */
  bpm: number | null;
  /** 低域（250Hz 未満）・中域（4kHz 未満）・高域のエネルギー比 */
  bandRatios: [number, number, number];
  transientRatio: number;
  tailRatio: number;
  /** スペクトル変化の繰り返しの間隔（秒）。求まらなければ null */
  periodicity: number | null;
  frames: Frame[];
  /** 3 フレームに 1 つのスペクトル（スペクトログラムの表示用） */
  spectrumFrames: Float64Array[];
}

export const FRAME_SIZE = 2048;
export const HOP = 1024;

/** 低域・中域の上端（Hz） */
export const BAND_EDGES = [250, 4000] as const;

export function analyze(signal: Signal): Features {
  const { sampleRate, channels } = signal;
  const mono = toMono(signal);
  const frames: Frame[] = [];
  const spectrumFrames: Float64Array[] = [];
  const bandEnergy: [number, number, number] = [0, 0, 0];
  const binHz = sampleRate / FRAME_SIZE;
  let previous: Float64Array | null = null;
  let rmsSum = 0, centroidSum = 0, rolloffSum = 0, zcrSum = 0, fluxSum = 0;

  for (let start = 0; start + FRAME_SIZE < mono.length; start += HOP) {
    const frame = mono.subarray(start, start + FRAME_SIZE);
    let square = 0, crossings = 0;
    for (let i = 0; i < frame.length; i++) {
      square += frame[i]! * frame[i]!;
      if (i && frame[i]! >= 0 !== frame[i - 1]! >= 0) crossings++;
    }
    const rms = Math.sqrt(square / frame.length);
    const spectrum = magnitudeSpectrum(frame);
    let total = 0, weighted = 0, flux = 0;
    for (let k = 1; k < spectrum.length; k++) {
      const mag = spectrum[k]!;
      const hz = k * binHz;
      total += mag;
      weighted += mag * hz;
      if (previous) flux += Math.max(0, mag - previous[k]!);
      bandEnergy[hz < BAND_EDGES[0] ? 0 : hz < BAND_EDGES[1] ? 1 : 2] += mag * mag;
    }
    let rolloff = sampleRate / 2;
    for (let k = 1, cumulative = 0; k < spectrum.length; k++) {
      cumulative += spectrum[k]!;
      if (cumulative >= total * 0.85) { rolloff = k * binHz; break; }
    }
    const centroid = total ? weighted / total : 0;
    const zcr = crossings / frame.length;
    frames.push({ time: start / sampleRate, rms, centroid, rolloff, zcr, flux });
    rmsSum += rms; centroidSum += centroid; rolloffSum += rolloff; zcrSum += zcr; fluxSum += flux;
    previous = spectrum;
    if (frames.length % 3 === 0) spectrumFrames.push(spectrum);
  }

  const count = Math.max(1, frames.length);
  const rmsMean = rmsSum / count;
  const fluxMean = fluxSum / count;
  const peak = frames.reduce((m, f) => Math.max(m, f.rms), -Infinity);
  const onset = frames.map((f) => f.flux);
  const fps = sampleRate / HOP;
  const bandTotal = bandEnergy[0] + bandEnergy[1] + bandEnergy[2] || 1;
  return {
    duration: mono.length / sampleRate,
    sampleRate,
    channels: channels.length,
    frameCount: count,
    rmsMean,
    centroidMean: centroidSum / count,
    rolloffMean: rolloffSum / count,
    zcrMean: zcrSum / count,
    dynamicRange: peak > 0 && rmsMean > 0 ? 20 * Math.log10(peak / rmsMean) : 0,
    stereo: channels.length > 1 ? stereoStats(channels[0]!, channels[1]!) : { correlation: 1, width: 0 },
    bpm: estimateTempo(onset, fps),
    bandRatios: [bandEnergy[0] / bandTotal, bandEnergy[1] / bandTotal, bandEnergy[2] / bandTotal],
    transientRatio: frames.filter((f) => f.flux > fluxMean * 2.2).length / count,
    tailRatio: estimateTailRatio(frames),
    periodicity: estimateFluxPeriod(onset, fps),
    frames,
    spectrumFrames,
  };
}

/** 左右の相関と、中央に対する左右差の大きさ（長い音は間引いて約 5 万点で測る） */
export function stereoStats(left: ArrayLike<number>, right: ArrayLike<number>): { correlation: number; width: number } {
  const step = Math.max(1, Math.floor(left.length / 50000));
  let lr = 0, ll = 0, rr = 0, side = 0, mid = 0;
  for (let i = 0; i < left.length; i += step) {
    const l = left[i]!, r = right[i]!, m = (l + r) / 2, s = (l - r) / 2;
    lr += l * r; ll += l * l; rr += r * r; side += s * s; mid += m * m;
  }
  return { correlation: lr / Math.sqrt(ll * rr || 1), width: Math.sqrt(side / (mid || 1)) };
}

/** スペクトル変化の自己相関から 55〜180 BPM のテンポを推定する */
export function estimateTempo(onset: number[], fps: number): number | null {
  const minLag = Math.floor((fps * 60) / 180);
  const maxLag = Math.min(onset.length - 2, Math.ceil((fps * 60) / 55));
  let bestLag = 0, best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i]! * onset[i - lag]!;
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return bestLag ? (60 * fps) / bestLag : null;
}

/** 鳴っているフレームのうち、山の 16% 未満の音量のものの割合（余韻の兆候） */
export function estimateTailRatio(frames: Frame[]): number {
  const active = frames.filter((f) => f.rms > 0.0001);
  if (!active.length) return 0;
  const peak = active.reduce((m, f) => Math.max(m, f.rms), 0);
  return active.filter((f) => f.rms < peak * 0.16).length / active.length;
}

/** スペクトル変化の自己相関が最大になる間隔（0.18〜1.2 秒） */
export function estimateFluxPeriod(onset: number[], fps: number): number | null {
  const min = Math.max(2, Math.floor(fps * 0.18));
  const max = Math.min(onset.length / 2, Math.ceil(fps * 1.2));
  let bestLag = 0, best = 0;
  for (let lag = min; lag < max; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i]! * onset[i - lag]!;
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return bestLag ? bestLag / fps : null;
}

// 持続するピーク（音程のある成分）を STFT から拾い、フレームをまたいでつなぐ（提案書 6.2 の A）。
import { binHz, frameTime, type Stft } from "@sfx-atelier/analysis";

export interface Peak {
  frame: number;
  /** 小数のビン位置（放物線で補間） */
  bin: number;
  hz: number;
  /** 補間した山の高さ（振幅スペクトル） */
  mag: number;
}

export interface Track {
  peaks: Peak[];
}

export interface TrackOptions {
  /** 全体の最大からこの dB より小さいピークは拾わない */
  floorDb?: number;
  /** 周りの中央値よりこの dB 以上高いものだけをピークとする */
  prominenceDb?: number;
  /** つながったフレームがこれより少ない成分は捨てる */
  minFrames?: number;
}

const DEFAULTS: Required<TrackOptions> = { floorDb: 60, prominenceDb: 12, minFrames: 4 };
/** 中央値を取る範囲（±ビン） */
const MEDIAN_SPAN = 16;

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

/** 1 フレームのピーク（極大・十分に大きい・周りより十分に高い） */
export function framePeaks(s: Stft, f: number, floor: number, prominence: number): Peak[] {
  const mag = s.frames[f]!;
  const out: Peak[] = [];
  for (let k = 2; k < mag.length - 2; k++) {
    const m = mag[k]!;
    if (m < floor || m <= mag[k - 1]! || m < mag[k + 1]! || m <= mag[k - 2]! || m < mag[k + 2]!) continue;
    const around: number[] = [];
    for (let j = Math.max(1, k - MEDIAN_SPAN); j <= Math.min(mag.length - 1, k + MEDIAN_SPAN); j++) around.push(mag[j]!);
    if (m < median(around) * prominence) continue;
    // 対数振幅の放物線補間（ハン窓で 0.1 ビン程度の誤差）
    const a = Math.log(mag[k - 1]! + 1e-20), b = Math.log(m), c = Math.log(mag[k + 1]! + 1e-20);
    const den = a - 2 * b + c;
    const p = den < 0 ? (0.5 * (a - c)) / den : 0;
    const bin = k + p;
    out.push({ frame: f, bin, hz: binHz(s, bin), mag: Math.exp(b - 0.25 * (a - c) * p) });
  }
  return out;
}

/**
 * ピークをフレームの順につなぐ。次のフレームで、周波数が近い（1.5 ビンか 4% の大きい方）もののうち
 * 最も近いものを続きとする。1 フレームの途切れは許す。
 */
export function findTracks(s: Stft, options: TrackOptions = {}): Track[] {
  const o = { ...DEFAULTS, ...options };
  let max = 0;
  for (const fr of s.frames) for (const v of fr) if (v > max) max = v;
  if (max === 0) return [];
  const floor = max * 10 ** (-o.floorDb / 20);
  const prominence = 10 ** (o.prominenceDb / 20);
  const done: Track[] = [];
  let open: { track: Track; miss: number }[] = [];
  const binWidth = s.sampleRate / s.size;
  for (let f = 0; f < s.frames.length; f++) {
    const peaks = framePeaks(s, f, floor, prominence).sort((a, b) => b.mag - a.mag);
    const used = new Set<Peak>();
    // 大きい成分から順に続きを選ぶ
    open.sort((a, b) => b.track.peaks.at(-1)!.mag - a.track.peaks.at(-1)!.mag);
    const next: typeof open = [];
    for (const t of open) {
      const last = t.track.peaks.at(-1)!;
      const tol = Math.max(1.5 * binWidth, last.hz * 0.04);
      let best: Peak | null = null;
      for (const p of peaks) {
        if (used.has(p) || Math.abs(p.hz - last.hz) > tol) continue;
        if (!best || Math.abs(p.hz - last.hz) < Math.abs(best.hz - last.hz)) best = p;
      }
      if (best) {
        used.add(best);
        t.track.peaks.push(best);
        next.push({ track: t.track, miss: 0 });
      } else if (t.miss < 1) next.push({ track: t.track, miss: t.miss + 1 });
      else done.push(t.track);
    }
    for (const p of peaks) if (!used.has(p)) next.push({ track: { peaks: [p] }, miss: 0 });
    open = next;
  }
  done.push(...open.map((t) => t.track));
  return done.filter((t) => t.peaks.length >= o.minFrames).sort((a, b) => a.peaks[0]!.frame - b.peaks[0]!.frame);
}

export const peakTime = (s: Stft, p: Peak) => frameTime(s, p.frame);

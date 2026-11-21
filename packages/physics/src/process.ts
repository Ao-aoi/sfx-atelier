// 録音の加工（計画 M5c）：切り出し・無音の除去・正規化・フェード・フィルタ・ピッチと長さの変更。
// どれも Signal を受け取り、新しい Signal を返す（元は変えない）。
import type { Signal } from "@sfx-atelier/analysis";

const map = (s: Signal, f: (ch: Float32Array) => Float32Array): Signal => ({ sampleRate: s.sampleRate, channels: s.channels.map(f) });
const length = (s: Signal) => s.channels[0]?.length ?? 0;
const dbToAmp = (db: number) => Math.pow(10, db / 20);

/** start〜end 秒を切り出す */
export function trim(s: Signal, start: number, end = Infinity): Signal {
  const a = Math.max(0, Math.round(start * s.sampleRate));
  const b = Math.min(length(s), Math.round(end * s.sampleRate));
  return map(s, (ch) => ch.slice(a, Math.max(a, b)));
}

/** いちばん大きい振幅 */
export function peak(s: Signal): number {
  let p = 0;
  for (const ch of s.channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]!));
  return p;
}

/**
 * 前後の無音を除く。山から thresholdDb（既定 -60dB）より小さいところを無音とみなし、
 * 前に pre 秒（既定 0.002）、後ろに post 秒（既定 0.01）だけ残す
 */
export function removeSilence(s: Signal, opts: { thresholdDb?: number; pre?: number; post?: number } = {}): Signal {
  const th = peak(s) * dbToAmp(opts.thresholdDb ?? -60);
  const n = length(s);
  const loud = (i: number) => s.channels.some((ch) => Math.abs(ch[i]!) > th);
  let first = 0;
  while (first < n && !loud(first)) first++;
  if (first === n) return trim(s, 0, 0);
  let last = n - 1;
  while (last > first && !loud(last)) last--;
  const sr = s.sampleRate;
  return trim(s, Math.max(0, first / sr - (opts.pre ?? 0.002)), (last + 1) / sr + (opts.post ?? 0.01));
}

/** 山を peakDb（既定 -1dB）に揃える。無音ならそのまま */
export function normalize(s: Signal, peakDb = -1): Signal {
  const p = peak(s);
  if (p === 0) return s;
  const k = dbToAmp(peakDb) / p;
  return map(s, (ch) => ch.map((x) => x * k));
}

/** 頭を fadeIn 秒、尻を fadeOut 秒で直線にフェードする */
export function fade(s: Signal, fadeIn: number, fadeOut: number): Signal {
  const n = length(s);
  const fi = Math.round(fadeIn * s.sampleRate);
  const fo = Math.round(fadeOut * s.sampleRate);
  return map(s, (ch) =>
    ch.map((x, i) => {
      let g = 1;
      if (fi > 0 && i < fi) g *= i / fi;
      if (fo > 0 && i >= n - fo) g *= (n - 1 - i) / fo;
      return x * g;
    }),
  );
}

export type FilterKind = "lowpass" | "highpass" | "bandpass";

/** 2 次の IIR フィルタ（RBJ の式。Web Audio の BiquadFilterNode と同じ形） */
export function filter(s: Signal, kind: FilterKind, freq: number, q = Math.SQRT1_2): Signal {
  const w = (2 * Math.PI * freq) / s.sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (kind === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (kind === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  return map(s, (ch) => {
    const out = new Float32Array(ch.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]!;
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
    return out;
  });
}

/**
 * 再生速度を ratio 倍にする（高さと長さが一緒に変わる。2 で 1 オクターブ上・長さ半分）。
 * 補間は 4 点の 3 次（Catmull-Rom）。上げるときの折り返しは、先に低域通過で抑える
 */
export function resample(s: Signal, ratio: number): Signal {
  if (!(ratio > 0)) throw new Error("ratio は 0 より大きくしてください");
  const src = ratio > 1 ? filter(s, "lowpass", (0.45 * s.sampleRate) / ratio) : s;
  const n = Math.floor((length(s) - 1) / ratio) + 1;
  return map(src, (ch) => {
    const at = (i: number) => ch[Math.max(0, Math.min(ch.length - 1, i))]!;
    const out = new Float32Array(Math.max(0, n));
    for (let j = 0; j < n; j++) {
      const x = j * ratio;
      const i = Math.floor(x);
      const t = x - i;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      out[j] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    }
    return out;
  });
}

/**
 * 高さを変えずに長さを factor 倍にする（WSOLA：ハン窓 1024 点・重なり半分。各窓の読み出し位置を ±256 点の範囲で、
 * 前の窓の続きといちばん似ている所にずらして、位相の打ち消し合いを避ける）。短い衝撃音は立ち上がりが少しにじむ
 */
export function stretch(s: Signal, factor: number, size = 1024, tolerance = 256): Signal {
  if (!(factor > 0)) throw new Error("factor は 0 より大きくしてください");
  const hop = size / 2;
  const inHop = hop / factor;
  const n = length(s);
  const outLen = Math.round(n * factor);
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  // 左右で同じ位置を使う（左右がずれないように）。似ている度合いはモノラルで測る
  const mono = new Float32Array(n);
  for (const ch of s.channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]!;
  const at = (x: Float32Array, i: number) => (i >= 0 && i < x.length ? x[i]! : 0);
  const froms: number[] = [];
  let prev = 0;
  for (let k = 0; k * hop < outLen; k++) {
    const nominal = Math.round(k * inHop);
    if (k === 0) {
      froms.push(0);
      continue;
    }
    const natural = prev + hop;
    let best = nominal;
    let bestScore = -Infinity;
    for (let d = -tolerance; d <= tolerance; d++) {
      const from = nominal + d;
      if (from < 0) continue;
      let score = 0;
      for (let i = 0; i < hop; i++) score += at(mono, from + i) * at(mono, natural + i);
      if (score > bestScore) {
        bestScore = score;
        best = from;
      }
    }
    froms.push(best);
    prev = best;
  }
  return map(s, (ch) => {
    const out = new Float64Array(outLen + size);
    const norm = new Float64Array(outLen + size);
    froms.forEach((from, k) => {
      for (let i = 0; i < size; i++) {
        out[k * hop + i]! += at(ch, from + i) * win[i]!;
        norm[k * hop + i]! += win[i]!;
      }
    });
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i]! > 1e-6 ? out[i]! / norm[i]! : 0;
    return res;
  });
}

/** 長さを変えずに高さを cents だけ変える（stretch してから resample） */
export function pitchShift(s: Signal, cents: number): Signal {
  const ratio = Math.pow(2, cents / 1200);
  const out = resample(stretch(s, ratio), ratio);
  // 丸めで 1 サンプル前後ずれるのを元の長さに揃える
  const n = length(s);
  return map(out, (ch) => {
    const r = new Float32Array(n);
    r.set(ch.subarray(0, n));
    return r;
  });
}

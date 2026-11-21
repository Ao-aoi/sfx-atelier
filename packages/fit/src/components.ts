// 当てはめた成分。減衰する正弦波（osc）と、減衰する帯域雑音（noise）。
// ランタイムの exp エンベロープは「a 秒で top に上がり、d 秒で top → FLOOR（-80dB 絶対）に下がる」ので、
// 減衰の速さ alpha（振幅 ∝ e^(-alpha t)）とは d = ln(top / FLOOR) / alpha の関係にある。

/** runtime/compile の FLOOR と同じ値 */
export const FLOOR = 0.0001;

interface Base {
  /** どの始まりに属するか（findOnsets の番号） */
  onset: number;
  /** 立ち上がり（秒） */
  a: number;
  /** 山の振幅（ランタイムの層の gain） */
  top: number;
  /** 振幅の減衰の速さ（1/秒） */
  alpha: number;
  /** 寄与の目安：振幅の 2 乗の時間積分 */
  energy: number;
}

export interface OscComponent extends Base {
  kind: "osc";
  hz: number;
  /** ピッチ変化の行き先（d 秒かけて） */
  toHz?: number;
}

export interface NoiseComponent extends Base {
  kind: "noise";
  /** 帯域の中心（Hz）と Q（中心 ÷ 帯域幅） */
  hz: number;
  q: number;
}

export type Component = OscComponent | NoiseComponent;

/** 減衰の速さ → ランタイムの d */
export const decayOf = (c: Pick<Base, "top" | "alpha">) => Math.log(c.top / FLOOR) / c.alpha;

/** 正弦波の平均パワーは振幅² / 2、雑音の top は RMS 相当の換算済みとして同じ式で比べる */
export const energyOf = (top: number, alpha: number, kind: Component["kind"]) => (kind === "osc" ? top * top / 2 : top * top) / (2 * alpha);

/** 重みつきの直線の当てはめ y = a + b x。点が 2 つ未満なら null */
export function lineFit(xs: number[], ys: number[], ws?: number[]): { a: number; b: number } | null {
  if (xs.length < 2) return null;
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws?.[i] ?? 1, x = xs[i]!, y = ys[i]!;
    sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y;
  }
  const den = sw * sxx - sx * sx;
  if (Math.abs(den) < 1e-18) return null;
  const b = (sw * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / sw, b };
}

/** ハン窓（分母 n-1）× e^(-alpha t) の和。減衰する成分の窓の利得 */
export function windowGain(size: number, sampleRate: number, alpha: number, power: 1 | 2): number {
  let s = 0;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    s += (power === 1 ? w : w * w) * Math.exp((-power * alpha * i) / sampleRate);
  }
  return s;
}

// 決定論の三角関数。Math.sin・Math.cos は環境（ブラウザ・Node）で最後の桁が違ってよいことになっているので、
// 足し算・掛け算だけ（IEEE 754 で結果が決まる）で計算する。物理の結果を環境に依らず同じにするため。

const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const QUARTER_PI = 0.7853981633974483;

/** -π/4〜π/4 の x の sin（テイラー展開 17 次まで。誤差は 1e-16 程度） */
function sinCore(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k <= 8; k++) {
    term = (-term * x2) / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

/** -π/4〜π/4 の x の cos（テイラー展開 18 次まで） */
function cosCore(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 9; k++) {
    term = (-term * x2) / ((2 * k - 1) * (2 * k));
    sum += term;
  }
  return sum;
}

/** [sin x, cos x]（ラジアン） */
export function sincos(x: number): [number, number] {
  // 0〜2π に寄せてから、π/2 ごとの区間に分ける
  let r = x - TAU * Math.floor(x / TAU);
  let q = Math.floor((r + QUARTER_PI) / HALF_PI);
  r -= q * HALF_PI;
  q &= 3;
  const s = sinCore(r);
  const c = cosCore(r);
  if (q === 0) return [s, c];
  if (q === 1) return [c, -s];
  if (q === 2) return [-s, -c];
  return [-c, s];
}

/** 度 → ラジアン */
export const rad = (deg: number) => (deg * Math.PI) / 180;

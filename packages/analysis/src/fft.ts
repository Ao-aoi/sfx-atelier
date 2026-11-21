// FFT と窓関数。analysis-demo/app.js の magnitudeSpectrum を取り出したもの。

/** 2 の累乗か */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** 基数 2 の反復 FFT（その場で書き換える）。長さは 2 の累乗 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error(`FFT の長さは 2 の累乗で、実部と虚部が同じ長さ: ${n}`);
  // ビット反転の並べ替え
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle), wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vR = re[b]! * cr - im[b]! * ci;
        const vI = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vR; im[b] = im[a]! - vI;
        re[a] = re[a]! + vR; im[a] = im[a]! + vI;
        const next = cr * wR - ci * wI;
        ci = cr * wI + ci * wR;
        cr = next;
      }
    }
  }
}

/** ハン窓。デモと同じく分母は n - 1（両端が 0） */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

const windows = new Map<number, Float64Array>();
function cachedHann(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) windows.set(n, (w = hann(n)));
  return w;
}

/**
 * ハン窓をかけた振幅スペクトル。長さ n の入力から n/2 本（0〜ナイキストの手前）を返す。
 * 入力が n より短ければ後ろを 0 で埋める。k 本目の周波数は k × sampleRate / n
 */
export function magnitudeSpectrum(input: ArrayLike<number>, n = input.length): Float64Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  const w = cachedHann(n);
  const m = Math.min(n, input.length);
  for (let i = 0; i < m; i++) re[i] = input[i]! * w[i]!;
  fft(re, im);
  const out = new Float64Array(n / 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i]!, im[i]!);
  return out;
}

// テスト用の既知の信号。期待値はこれらの式から手で出せる。

export const SR = 48000;

export function make(seconds: number, f: (t: number, i: number) => number, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = f(i / sampleRate, i);
  return out;
}

export const sine = (hz: number, seconds: number, amp = 1) => make(seconds, (t) => amp * Math.sin(2 * Math.PI * hz * t));

/** 指数減衰する正弦波：amp × e^(-t/tau) × sin(2πft) */
export const decaying = (hz: number, tau: number, seconds: number, amp = 1) =>
  make(seconds, (t) => amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * hz * t));

/** 再現できる乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function white(seconds: number, amp = 0.5, seed = 1): Float32Array {
  const r = rng(seed);
  return make(seconds, () => amp * (r() * 2 - 1));
}

export const mono = (samples: Float32Array, sampleRate = SR) => ({ sampleRate, channels: [samples] });

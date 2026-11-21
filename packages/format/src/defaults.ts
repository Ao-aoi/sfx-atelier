// 省略したときの値。正規化（埋める）・縮小（落とす）と、ランタイムの compile が同じものを使う。
// ランタイムからも import されるので、このファイルは何も import しない・小さく保つ。

export const ENV_DEFAULT = { a: 0.002, d: 0.25, s: 0, r: 0, curve: "exp" } as const;
export const LAYER_DEFAULT = { gain: 1, pan: 0 } as const;
/** Web Audio の BiquadFilterNode の既定（Q = 1、gain = 0dB） */
export const FILTER_DEFAULT = { q: 1, gain: 0 } as const;
export const PITCH_ENV_DEFAULT = { curve: "exp" } as const;
export const SAMPLE_DEFAULT = { ratio: 1 } as const;
export const JITTER_DEFAULT = { tune: 0, gain: 0, time: 0 } as const;
export const NOTE_DEFAULT = { tune: 0, vel: 1 } as const;
export const TRACK_DEFAULT = { gain: 1, pan: 0 } as const;
export const SOUND_DEFAULT = { gain: 1 } as const;
export const REVERB_DEFAULT = { wet: 1 } as const;
export const MASTER_DEFAULT = { gain: 1 } as const;
/** Web Audio の DynamicsCompressorNode の既定 */
export const COMPRESSOR_DEFAULT = { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 } as const;

// sfx-bank/1・sfx-score/1 の型（提案書 4.1）。
// 既定値を書かない「縮めた形」を表すので、ほとんどの項目は省略できる。
// ランタイムはこの型だけを import する（型は消えるので容量ゼロ）。

export const BANK_FORMAT = "sfx-bank/1";
export const SCORE_FORMAT = "sfx-score/1";

/** エンベロープ・ピッチ変化のカーブ。既定は exp */
export type Curve = "exp" | "lin";

/** 秒。a・d・r は 0 以上、s は 0〜1（既定 0 = AD 型） */
export interface Envelope {
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  curve?: Curve;
}

/** 層の高さの時間変化。toHz（固定の行き先）か cents（相対）のどちらか一方 */
export interface PitchEnv {
  toHz?: number;
  cents?: number;
  /** 秒。"decay" は層のエンベロープの d と同じ長さ */
  time: number | "decay";
  curve?: Curve;
}

export type FilterType = "lowpass" | "highpass" | "bandpass" | "notch" | "peaking" | "lowshelf" | "highshelf";

export interface Filter {
  type: FilterType;
  freq: number;
  q?: number;
  /** dB。peaking・shelf のときだけ意味がある */
  gain?: number;
}

/** 揺らぎ。tune はセント、gain は割合（0.1 なら ±10%）、time は秒 */
export interface Jitter {
  tune?: number;
  gain?: number;
  time?: number;
}

export type OscType = "sine" | "square" | "sawtooth" | "triangle";
export type NoiseType = "white" | "pink" | "brown";

interface LayerBase {
  gain?: number;
  /** -1（左）〜1（右） */
  pan?: number;
  env?: Envelope;
  filter?: Filter;
  pitchEnv?: PitchEnv;
  jitter?: Jitter;
}

/** 発振器の層。freq（Hz 固定。音符の tune で上下）か ratio（音符の pitch に対する倍率）のどちらか一方 */
export interface OscLayer extends LayerBase {
  osc: OscType;
  freq?: number;
  ratio?: number;
}

/** 雑音の層。共有の雑音バッファを読む（読み出し位置は乱数） */
export interface NoiseLayer extends LayerBase {
  noise: NoiseType;
}

/** 録音（wav）を鳴らす層。sample はバンクの samples のキー。ratio は再生速度の倍率 */
export interface SampleLayer extends LayerBase {
  sample: string;
  ratio?: number;
}

export type Layer = OscLayer | NoiseLayer | SampleLayer;

export interface Instrument {
  layers: Layer[];
}

/** 録音の参照先。url はバンクの JSON からの相対か絶対の URL */
export interface SampleRef {
  url: string;
}

export interface Note {
  id?: string;
  /** 開始。time.unit の単位（秒か拍） */
  t: number;
  /** 長さ。無ければ楽器の減衰で決まる */
  dur?: number;
  /** 音名（"A4"、"C#5"、"Eb3"）か Hz */
  pitch?: string | number;
  /** セント */
  tune?: number;
  /** 0〜1。既定 1 */
  vel?: number;
}

export interface Track {
  id?: string;
  /** instruments のキー */
  instrument: string;
  gain?: number;
  pan?: number;
  /** 残響の名前 → 送り量 */
  send?: Record<string, number>;
  notes: Note[];
}

export type TimeSig = [number, number];

export type Time = { unit: "sec" } | { unit: "beat"; bpm: number; sig?: TimeSig };

export interface Variation {
  tune?: number;
  gain?: number;
  time?: number;
}

export interface Sound {
  time?: Time;
  gain?: number;
  tracks: Track[];
  variation?: Variation;
}

export interface Reverb {
  /** インパルス応答の長さ（秒） */
  seconds: number;
  /** 減衰の速さ（大きいほど早く消える） */
  decay: number;
  /** 0〜1 */
  wet?: number;
}

export interface Compressor {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

export interface Master {
  gain?: number;
  compressor?: Compressor;
}

/** 共有する部品（楽器・残響・録音）。バンクと単体の score の両方が持てる */
interface Shared {
  master?: Master;
  reverb?: Record<string, Reverb>;
  instruments?: Record<string, Instrument>;
  samples?: Record<string, SampleRef>;
}

/** ゲームが読む 1 ファイル */
export interface Bank extends Shared {
  format: typeof BANK_FORMAT;
  sounds: Record<string, Sound>;
}

/** エディタが扱う 1 音 */
export interface Score extends Shared, Sound {
  format: typeof SCORE_FORMAT;
}

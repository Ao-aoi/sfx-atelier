// 分析（M4）と変換（M4.5）の計算。画面から切り離して、ブラウザのテストで確かめる。
import {
  averagePowerSpectrum,
  BAND_EDGES,
  distance,
  fromAudioBuffer,
  report,
  sfxMetrics,
  toMono,
  type Distance,
  type SfxMetrics,
  type Signal,
} from "@sfx-atelier/analysis";
import { fit, type FitResult } from "@sfx-atelier/fit";
import { applyPatch, normalizeScore, type Patch, type Score } from "@sfx-atelier/format";
import { renderOffline } from "@sfx-atelier/runtime";

export const RATE = 48000;
/** 測定に使う乱数の種（同じ score なら同じ数字になるように固定する） */
export const SEED = 1;

export interface Measured {
  signal: Signal;
  metrics: SfxMetrics;
  bandRatios: [number, number, number];
}

/** 低域・中域・高域のパワーの比（長さ全体の平均パワースペクトルから。短い音でも出る） */
export function bandRatios(mono: Float32Array, sampleRate: number): [number, number, number] {
  const p = averagePowerSpectrum(mono);
  const binHz = sampleRate / (p.length * 2);
  const e: [number, number, number] = [0, 0, 0];
  for (let k = 1; k < p.length; k++) {
    const hz = k * binHz;
    e[hz < BAND_EDGES[0] ? 0 : hz < BAND_EDGES[1] ? 1 : 2] += p[k]!;
  }
  const total = e[0] + e[1] + e[2] || 1;
  return [e[0] / total, e[1] / total, e[2] / total];
}

export async function renderSignal(score: Score, seed = SEED): Promise<Signal> {
  return fromAudioBuffer(await renderOffline(score, score, { seed, sampleRate: RATE }));
}

export function measureSignal(signal: Signal): Measured {
  return { signal, metrics: sfxMetrics(signal), bandRatios: bandRatios(toMono(signal), signal.sampleRate) };
}

export async function measure(score: Score): Promise<Measured> {
  return measureSignal(await renderSignal(score));
}

/** Claude に貼る要約（analysis-report/1） */
export function summary(name: string, score: Score, m: Measured): string {
  return report({ name, score, metrics: m.metrics, features: { bandRatios: m.bandRatios } });
}

export type PatchApplied = { ok: true; score: Score; inverse: Patch } | { ok: false; errors: string[] };

/**
 * 貼られた文字列から sfx-patch/1 を読んで当てる。前後の文章やコードブロックの囲みは無視し、
 * 最初の「{」から最後の「}」までを JSON として読む
 */
export function applyPatchText(score: Score, text: string): PatchApplied {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) return { ok: false, errors: ["JSON がありません"] };
  let patch: unknown;
  try {
    patch = JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    return { ok: false, errors: [`JSON として読めません：${(e as Error).message}`] };
  }
  const r = applyPatch(score, patch as Patch);
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => `${e.path}: ${e.message}`) };
  // 足された音符・トラックにも id を振る
  return { ok: true, score: normalizeScore(r.value), inverse: r.inverse };
}

export interface Converted {
  result: FitResult;
  /** エディタで開ける形（正規化済み） */
  score: Score;
  distance: Distance;
  /** 元と変換後の声の数 */
  layers: number;
}

/** 波形を層に変換し、変換後をランタイムで描画して元との距離を測る */
export async function convert(signal: Signal, layers?: number): Promise<Converted> {
  const result = fit(signal, layers ? { budget: { layers } } : {});
  const out = await renderSignal(result.score);
  return {
    result,
    score: normalizeScore(result.score),
    distance: distance(toMono(signal), toMono(out), RATE),
    layers: result.components.length,
  };
}

/**
 * いまの score を変換する。残響の尾まで減衰として当てはめないように、送り（send）を外した乾いた音で変換し、
 * 変換後には元の残響・マスターと、最初に送りを持つトラックの送りを付け直す
 */
export async function convertScore(score: Score, layers?: number): Promise<Converted> {
  const dry: Score = { ...score, tracks: score.tracks.map(({ send: _s, ...t }) => t) };
  const c = await convert(await renderSignal(dry), layers);
  const send = score.tracks.find((t) => t.send && Object.keys(t.send).length)?.send;
  const wet: Score = {
    ...c.score,
    ...(score.master ? { master: score.master } : {}),
    ...(send && score.reverb ? { reverb: score.reverb, tracks: c.score.tracks.map((t) => ({ ...t, send: { ...send } })) } : {}),
  };
  return { ...c, score: normalizeScore(wet) };
}

/** 音声ファイル（wav など）を読み、48kHz にする */
export async function decodeFile(data: ArrayBuffer): Promise<{ buffer: AudioBuffer; signal: Signal }> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buffer = await ctx.decodeAudioData(data);
  return { buffer, signal: fromAudioBuffer(buffer) };
}

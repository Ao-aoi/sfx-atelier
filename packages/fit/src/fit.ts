// 波形 → sfx-score/1（提案書 6.3）。
//   STFT → 持続するピーク → 減衰する正弦波（A）
//        → 残差の帯域包絡 → 減衰する帯域雑音（D）
//   → 予算（バイト数・層の数）に収まるまで寄与の小さい成分から外す（F）→ 量子化・整理（G）
import { stft, toMono, type Signal } from "@sfx-atelier/analysis";
import { shrinkScore } from "@sfx-atelier/format";
import type { Instrument, Layer, Score, Track as ScoreTrack } from "@sfx-atelier/format/types";
import { decayOf, type Component, type OscComponent } from "./components";
import { fitNoise } from "./noise";
import { findAttacks, findOnsets, mergeOnsets } from "./onsets";
import { fitTrack, tonalOnsets } from "./tonal";
import { findTracks, type TrackOptions } from "./tracks";

export interface Budget {
  /** 縮めた JSON（空白なし）のバイト数の上限。gzip 前なので、gzip 後はこれより小さい */
  bytes?: number;
  /** 層の数の上限（1 回鳴らしたときの声の数） */
  layers?: number;
}

export interface FitOptions extends TrackOptions {
  /** STFT の窓の長さ（2 の累乗）。既定 1024 */
  size?: number;
  /** STFT の間隔。既定 size / 8 */
  hop?: number;
  /** 帯域雑音を当てはめるか。既定 true */
  noise?: boolean;
  budget?: Budget;
}

export interface FitResult {
  /** 縮めた形の score（既定値と id を落とした、ゲームに配る形） */
  score: Score;
  /** 予算に入った成分（寄与の大きい順） */
  components: Component[];
  /** 予算で外した成分 */
  dropped: Component[];
  onsets: number[];
  /** 縮めた JSON のバイト数 */
  bytes: number;
}

export const DEFAULT_BUDGET: Required<Budget> = { bytes: 3072, layers: 24 };

/** 有効数字 n 桁に丸める */
export const sig = (v: number, n: number) => (v === 0 ? 0 : Number(v.toPrecision(n)));
/** 秒を 1ms 単位に丸める（0 にはしない） */
const msRound = (v: number) => Math.max(0.001, Math.round(v * 1000) / 1000);

/** 成分 → 層（量子化：周波数は有効数字 4 桁 ≒ 1 セント以内、gain は 3 桁、時間は 1ms） */
export function toLayer(c: Component): Layer {
  const env = { a: msRound(c.a), d: msRound(decayOf(c)) };
  const gain = sig(c.top, 3);
  if (c.kind === "osc") {
    const l: Layer = { osc: "sine", freq: sig(c.hz, 4), gain, env };
    if (c.toHz !== undefined) l.pitchEnv = { toHz: sig(c.toHz, 4), time: "decay" };
    return l;
  }
  return { noise: "white", filter: { type: "bandpass", freq: sig(c.hz, 3), q: sig(c.q, 2) }, gain, env };
}

/** 成分 → score。始まりごとに楽器（p1, p2, …）とトラックを 1 つずつ作る */
export function buildScore(components: Component[], onsets: number[]): Score {
  const instruments: Record<string, Instrument> = {};
  const tracks: ScoreTrack[] = [];
  onsets.forEach((t, i) => {
    const layers = components.filter((c) => c.onset === i).sort((a, b) => b.energy - a.energy).map(toLayer);
    if (!layers.length) return;
    const name = `p${i + 1}`;
    instruments[name] = { layers };
    tracks.push({ instrument: name, notes: [{ t: Math.round(t * 1000) / 1000 }] });
  });
  return shrinkScore({ format: "sfx-score/1", instruments, tracks });
}

export const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** 寄与の大きい順に、予算に入る限り足す */
export function applyBudget(components: Component[], onsets: number[], budget: Budget = {}) {
  const b = { ...DEFAULT_BUDGET, ...budget };
  const sorted = components.slice().sort((x, y) => y.energy - x.energy);
  const kept: Component[] = [], dropped: Component[] = [];
  for (const c of sorted) {
    if (kept.length >= b.layers || jsonBytes(buildScore([...kept, c], onsets)) > b.bytes) dropped.push(c);
    else kept.push(c);
  }
  return { kept, dropped };
}

export function fit(signal: Signal, options: FitOptions = {}): FitResult {
  const mono = toMono(signal);
  const { sampleRate } = signal;
  const size = options.size ?? 1024;
  const hop = options.hop ?? size / 8;
  const s = stft(mono, sampleRate, size, hop);
  const tracks = findTracks(s, options);
  const onsets = mergeOnsets(findOnsets(mono, sampleRate), tonalOnsets(s, tracks));
  if (!onsets.length) {
    const score = shrinkScore({ format: "sfx-score/1", tracks: [] });
    return { score, components: [], dropped: [], onsets, bytes: jsonBytes(score) };
  }
  const attacks = findAttacks(mono, sampleRate, onsets);
  const tonal = tracks.map((t) => fitTrack(s, t, onsets, attacks)).filter((c): c is OscComponent => c !== null);
  const noise = options.noise === false ? [] : fitNoise(s, tracks, onsets, attacks, mono.length / sampleRate);
  // 最も大きい成分から -40dB（エネルギーで 1e-4）より小さいものは、予算の前に捨てる
  const all: Component[] = [...tonal, ...noise];
  const max = all.reduce((v, c) => Math.max(v, c.energy), 0);
  const { kept, dropped } = applyBudget(all.filter((c) => c.energy >= max * 1e-4), onsets, options.budget);
  const score = buildScore(kept, onsets);
  return { score, components: kept, dropped, onsets, bytes: jsonBytes(score) };
}

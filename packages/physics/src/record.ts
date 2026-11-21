// 物理のシーンを「録音」する（計画 M5c）：simulate → 当たり → サンプルの列。
// OfflineAudioContext を使わず純粋な計算で描くので、Node でもブラウザでも同じシーン・種から同じ音になる。
import type { Signal } from "@sfx-atelier/analysis";
import { simulate, type ContactEvent, type Scene } from "./engine";
import { hitsOf, renderHits, type Hit, type SoundOptions } from "./sound";

export interface RecordOptions extends SoundOptions {
  sampleRate?: number;
  /** 雑音の種 */
  seed?: number;
  /** 長さ（秒）。既定は最後の音が消えるまで */
  seconds?: number;
}

export interface Recording {
  signal: Signal;
  events: ContactEvent[];
  hits: Hit[];
}

export function record(scene: Scene, opts: RecordOptions = {}): Recording {
  const { events } = simulate(scene);
  const hits = hitsOf(scene, events, opts);
  const sampleRate = opts.sampleRate ?? 48000;
  const mono = renderHits(hits, { sampleRate, seed: opts.seed, seconds: opts.seconds });
  return { signal: { sampleRate, channels: [mono] }, events, hits };
}

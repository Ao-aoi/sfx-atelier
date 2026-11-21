// ブラウザのテストの共通部分：ランタイムで描画して Signal にする
import { fromAudioBuffer, type Signal } from "@sfx-atelier/analysis";
import type { Score } from "@sfx-atelier/format/types";
import { renderOffline } from "@sfx-atelier/runtime";

export const RATE = 48000;

export async function renderScore(score: Score, seed = 3): Promise<Signal> {
  return fromAudioBuffer(await renderOffline(score, score, { seed, sampleRate: RATE }));
}

export async function gzipBytes(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

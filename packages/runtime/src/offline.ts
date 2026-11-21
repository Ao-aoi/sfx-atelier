// OfflineAudioContext に描画する（テスト・聞き比べ・wav の書き出し用）。
import { compile, seeded, type CompileOptions, type Parts } from "./compile";
import { createShared, render, type SharedSetup } from "./render";
import type { Sound } from "@sfx-atelier/format/types";

export interface OfflineOptions extends CompileOptions {
  seed?: number;
  sampleRate?: number;
  /** 録音の層に使う AudioBuffer（名前 → バッファ） */
  samples?: Record<string, AudioBuffer>;
}

/**
 * 1 つの音を描画する。長さは残響の尾まで含めた plan.tail。
 * 乱数は compile → 共有の部品（雑音・残響）の順に、同じ種から引く。
 */
export async function renderOffline(sound: Sound, parts: Parts & SharedSetup, opts: OfflineOptions = {}): Promise<AudioBuffer> {
  const random = seeded(opts.seed ?? 1);
  const rate = opts.sampleRate ?? 48000;
  const sampleSeconds = Object.fromEntries(Object.entries(opts.samples ?? {}).map(([k, b]) => [k, b.duration]));
  const plan = compile(sound, { ...parts, sampleSeconds: { ...parts.sampleSeconds, ...sampleSeconds } }, random, opts);
  const length = Math.max(1, Math.ceil((plan.tail + 0.05) * rate));
  const ctx = new OfflineAudioContext(2, length, rate);
  const shared = createShared(ctx, parts, random);
  Object.assign(shared.samples, opts.samples);
  render(shared, plan, 0);
  return ctx.startRendering();
}

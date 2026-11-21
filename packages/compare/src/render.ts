// 基準（今の sfx.ts）と新しい形式（runtime）を、同じ長さ・同じ種で OfflineAudioContext に描画する。
import type { Bank } from "@sfx-atelier/format/types";
import { createSfx, seeded } from "@sfx-atelier/runtime";
import { createReference, type ReferenceName } from "./reference";

export const RATE = 48000;
/** どの音も収まる長さ（win は鳴り始めから約 2.5 秒） */
export const SECONDS = 3;

export async function renderReference(name: ReferenceName, seed: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, SECONDS * RATE, RATE);
  createReference(ctx, seeded(seed))(name, {}, 0);
  return ctx.startRendering();
}

export async function renderBank(bank: Bank, name: string, seed: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, SECONDS * RATE, RATE);
  const sfx = createSfx(bank, { context: ctx, random: seeded(seed) });
  sfx.play(name);
  return ctx.startRendering();
}

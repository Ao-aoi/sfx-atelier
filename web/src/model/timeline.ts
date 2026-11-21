// 横軸（時間）。音符の t・dur は score の単位（秒か拍）、画面は秒で並べる。
import type { Time } from "@sfx-atelier/format/types";

/** 1 単位が何秒か（秒なら 1、拍なら 60 / bpm） */
export const unitSeconds = (time: Time | undefined) => (time?.unit === "beat" ? 60 / time.bpm : 1);

/** 秒の目盛りの候補 */
export const SEC_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
/** 拍の目盛りの候補（拍の数） */
export const BEAT_STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];

/** 小数の誤差を落とす（0.1 + 0.2 を 0.3 にする） */
export const tidy = (x: number) => Math.round(x * 1e9) / 1e9;

/**
 * 格子の間隔（単位）。画面で minPx 以上離れる最小の候補。
 * 拍のときは 1/16 拍〜1 拍、その上は小節（sig の分子）の倍数。
 */
export function gridStep(pxPerSec: number, time: Time | undefined, minPx = 10): number {
  if (time?.unit !== "beat") return SEC_STEPS.find((s) => s * pxPerSec >= minPx) ?? SEC_STEPS[SEC_STEPS.length - 1]!;
  const beatPx = (60 / time.bpm) * pxPerSec;
  const fine = BEAT_STEPS.find((s) => s * beatPx >= minPx);
  if (fine !== undefined) return fine;
  const bar = time.sig?.[0] ?? 4;
  let n = bar;
  while (n * beatPx < minPx) n *= 2;
  return n;
}

export const snap = (value: number, step: number) => tidy(Math.round(value / step) * step);

/** 秒の表示：1 秒未満はミリ秒 */
export function formatSeconds(s: number): string {
  const t = tidy(s);
  if (Math.abs(t) < 1) return `${tidy(t * 1000)}ms`;
  return `${tidy(t)}s`;
}

/** 拍の表示：小節.拍（1 から数える）。拍の途中は小数 */
export function formatBeat(beats: number, sig: [number, number] | undefined): string {
  const per = sig?.[0] ?? 4;
  const b = tidy(beats);
  const bar = Math.floor(b / per + 1e-9);
  return `${bar + 1}.${tidy(b - bar * per + 1)}`;
}

export interface Tick {
  /** 単位での位置 */
  t: number;
  label: string;
}

/** 目盛りの数字（ラベルどうしが minPx 以上離れる間隔で） */
export function rulerTicks(from: number, to: number, pxPerSec: number, time: Time | undefined, minPx = 56): Tick[] {
  const step = gridStep(pxPerSec, time, minPx);
  const out: Tick[] = [];
  const first = Math.ceil(tidy(from / step)) * step;
  for (let i = 0; ; i++) {
    const t = tidy(first + i * step);
    if (t > to || i > 10000) break;
    out.push({ t, label: time?.unit === "beat" ? formatBeat(t, time.sig) : formatSeconds(t) });
  }
  return out;
}

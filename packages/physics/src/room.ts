// 部屋の反響の簡易モデル（提案書 5.2、計画 M5e）。波の計算はせず、次の 3 つだけで作る。
// - 残響の長さ：セービンの式 RT60 = 0.161 × V ÷ A（A は 面積 × 吸音率 の合計）
// - 早期反射：鏡像法（箱形の部屋、2 次まで）。時刻は直接音からの遅れ、強さは直接音に対する比
// - 距離：音量は距離に反比例、遅れは距離 ÷ 音速、左右の向きは聞く人の正面からの角度
// 結果はランタイムの reverb（seconds・decay・wet・early）と、トラックの gain・pan・遅れに写す。
import type { Reverb } from "@sfx-atelier/format/types";
import { rad, sincos } from "./trig";

export type Vec3 = [number, number, number];

/** 音速（m/s、20℃） */
export const SPEED_OF_SOUND = 343;

/** セービンの式の係数（秒/m） */
export const SABINE = 0.161;

/**
 * 材質ごとの吸音率の目安（1kHz 付近）。建築音響の一般的な表の値を丸めたもの。
 * 帯域ごとの違いは扱わない（簡易モデル）
 */
export const ABSORPTION: Record<string, number> = {
  concrete: 0.02,
  glass: 0.04,
  tile: 0.02,
  plaster: 0.05,
  wood: 0.1,
  carpet: 0.3,
  curtain: 0.5,
  acoustic: 0.7,
};

/** 6 面の名前。x = 0 が left、x = 幅 が right、y = 0 が back、y = 奥行き が front、z = 0 が floor、z = 高さ が ceiling */
export type Surface = "left" | "right" | "back" | "front" | "floor" | "ceiling";
export const SURFACES: readonly Surface[] = ["left", "right", "back", "front", "floor", "ceiling"];

/** 材質の名前（ABSORPTION のキー）か、吸音率（0 より大きく 1 以下） */
export type SurfaceMaterial = string | number;

export interface Room {
  /** [幅 x, 奥行き y, 高さ z]（m） */
  size: Vec3;
  /** 面ごとの材質。書かなかった面は all を使う */
  surfaces?: Partial<Record<Surface, SurfaceMaterial>>;
  /** 全部の面の材質（既定 plaster） */
  all?: SurfaceMaterial;
  /** 音源の位置（m） */
  source: Vec3;
  /** 聞く位置（m） */
  listener: Vec3;
  /** 聞く人の向き（度）。0 で +y を向き、右手が +x。正で時計回り（上から見て） */
  facing?: number;
}

export interface RoomOptions {
  /** 鏡像の次数（既定 2） */
  order?: number;
  /** 早期反射の本数の上限（既定 32 = 形式の上限） */
  maxEarly?: number;
  /** 音量が 1 になる距離（m、既定 1）。これより近くても 1 で止める */
  refDistance?: number;
}

export interface Reflection {
  /** 直接音からの遅れ（秒） */
  time: number;
  /** 直接音に対する振幅の比 */
  strength: number;
  /** 反射の回数 */
  order: number;
  /** 経路の長さ（m） */
  distance: number;
  /** 鏡像の位置 */
  image: Vec3;
}

export interface Placement {
  /** 距離による音量（refDistance ÷ 距離、1 まで） */
  gain: number;
  /** -1（左）〜1（右） */
  pan: number;
  /** 届くまでの遅れ（秒） */
  delay: number;
}

export interface RoomResult {
  /** 体積（立方 m） */
  volume: number;
  /** 表面積（平方 m） */
  area: number;
  /** 吸音の合計（平方 m、メートルセービン） */
  absorption: number;
  /** 残響時間（秒、セービンの式） */
  rt60: number;
  /** 臨界距離（m）。直接音と残響の強さが等しくなる距離 */
  criticalDistance: number;
  /** 直接音の距離（m） */
  distance: number;
  placement: Placement;
  /** 早期反射（時刻の順） */
  reflections: Reflection[];
  /** ランタイムの reverb に入れる設定 */
  reverb: Reverb;
}

/**
 * インパルス応答 (1 - t/T)^decay の decay。T の半分で -30dB（振幅 1/√1000）になる値にする。
 * 指数の減衰（RT60 で -60dB）と、T の半分の点で一致する
 */
export const REVERB_DECAY = 1.5 / Math.log10(2);

/** 形式が受け付ける seconds の範囲 */
const MIN_SECONDS = 0.05;
const MAX_SECONDS = 10;

export function absorptionOf(m: SurfaceMaterial): number {
  const a = typeof m === "number" ? m : ABSORPTION[m];
  if (a === undefined) throw new Error(`知らない材質です: ${m}`);
  if (!(a > 0 && a <= 1)) throw new Error(`吸音率は 0 より大きく 1 以下にしてください: ${a}`);
  return a;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 面ごとの吸音率 */
export function surfaceAbsorption(room: Room): Record<Surface, number> {
  const all = room.all ?? "plaster";
  const out = {} as Record<Surface, number>;
  for (const s of SURFACES) out[s] = absorptionOf(room.surfaces?.[s] ?? all);
  return out;
}

/** セービンの式：体積・表面積・吸音の合計・RT60 */
export function sabine(room: Room) {
  const [w, d, h] = room.size;
  const a = surfaceAbsorption(room);
  const volume = w * d * h;
  const area = 2 * (w * d + w * h + d * h);
  const absorption = d * h * (a.left + a.right) + w * h * (a.back + a.front) + w * d * (a.floor + a.ceiling);
  return { volume, area, absorption, rt60: (SABINE * volume) / absorption };
}

/**
 * 鏡像法（Allen & Berkley 1979 の添字の付け方）。1 つの軸について、鏡像の座標は (1 - 2p)·s + 2nL、
 * 低い側の面（座標 0）で |n - p| 回、高い側の面（座標 L）で |n| 回反射する
 */
function axisImages(s: number, L: number, order: number) {
  const out: { x: number; low: number; high: number }[] = [];
  for (let n = -order; n <= order; n++)
    for (const p of [0, 1]) {
      const low = Math.abs(n - p);
      const high = Math.abs(n);
      if (low + high <= order) out.push({ x: (1 - 2 * p) * s + 2 * n * L, low, high });
    }
  return out;
}

function inside(p: Vec3, size: Vec3) {
  return p.every((v, i) => v >= 0 && v <= size[i]!);
}

/** 部屋の反響を計算する */
export function roomAcoustics(room: Room, opts: RoomOptions = {}): RoomResult {
  const order = opts.order ?? 2;
  const maxEarly = opts.maxEarly ?? 32;
  const ref = opts.refDistance ?? 1;
  const { size, source, listener } = room;
  if (!size.every((v) => v > 0)) throw new Error("部屋の大きさは 0 より大きくしてください");
  if (!inside(source, size) || !inside(listener, size)) throw new Error("音源と聞く位置は部屋の中に置いてください");

  const { volume, area, absorption, rt60 } = sabine(room);
  const a = surfaceAbsorption(room);
  // 反射 1 回で振幅は √(1 - 吸音率) 倍（エネルギーが 1 - 吸音率 倍）
  const beta = (s: Surface) => Math.sqrt(1 - a[s]);

  const d0 = dist(source, listener);
  if (d0 === 0) throw new Error("音源と聞く位置を離してください");

  const reflections: Reflection[] = [];
  const xs = axisImages(source[0], size[0], order);
  const ys = axisImages(source[1], size[1], order);
  const zs = axisImages(source[2], size[2], order);
  for (const ix of xs)
    for (const iy of ys)
      for (const iz of zs) {
        const k = ix.low + ix.high + iy.low + iy.high + iz.low + iz.high;
        if (k === 0 || k > order) continue;
        const image: Vec3 = [ix.x, iy.x, iz.x];
        const di = dist(image, listener);
        const gain =
          beta("left") ** ix.low * beta("right") ** ix.high *
          beta("back") ** iy.low * beta("front") ** iy.high *
          beta("floor") ** iz.low * beta("ceiling") ** iz.high;
        reflections.push({ time: (di - d0) / SPEED_OF_SOUND, strength: (d0 / di) * gain, order: k, distance: di, image });
      }

  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, rt60));
  // 形式の範囲（時刻は seconds 未満）に入るものから、強い順に maxEarly 本
  const kept = reflections
    .filter((r) => r.time < seconds)
    .sort((p, q) => q.strength - p.strength || p.time - q.time)
    .slice(0, maxEarly)
    .sort((p, q) => p.time - q.time || q.strength - p.strength);

  // 臨界距離 rc = √(A / 16π)（無指向の音源）。残響の割合は 距離² ÷ (距離² + rc²)
  const criticalDistance = Math.sqrt(absorption / (16 * Math.PI));
  const wet = (d0 * d0) / (d0 * d0 + criticalDistance * criticalDistance);

  return {
    volume,
    area,
    absorption,
    rt60,
    criticalDistance,
    distance: d0,
    placement: placement(source, listener, room.facing ?? 0, ref),
    reflections: kept,
    reverb: {
      seconds,
      decay: REVERB_DECAY,
      wet,
      early: kept.map((r) => [r.time, r.strength]),
    },
  };
}

/** 距離による音量・遅れと、左右の向き（水平面での角度の sin） */
export function placement(source: Vec3, listener: Vec3, facing = 0, refDistance = 1): Placement {
  const d = dist(source, listener);
  const dx = source[0] - listener[0];
  const dy = source[1] - listener[1];
  // 聞く人の右手の向き：facing = 0 で (1, 0)、正面は (0, 1)
  const [s, c] = sincos(rad(facing));
  const right = dx * c - dy * s;
  const front = dx * s + dy * c;
  const h = Math.hypot(right, front);
  return {
    gain: Math.min(1, refDistance / d),
    pan: h === 0 ? 0 : right / h,
    delay: d / SPEED_OF_SOUND,
  };
}

// 物理から作る（M5c・M5d）：シーンを録音し、M4.5 の変換（convert）で層にする。
// 基準は M2 のバンクの discard（残響を外した乾いた音）。物理の録音も乾いた音なので、同じ条件で比べる
import type { Signal } from "@sfx-atelier/analysis";
import type { Bank, Score } from "@sfx-atelier/format";
import { DISCARD_SCENE, DISCARD_SOUND, encodeWav, normalize, record, removeSilence, vary, type Scene } from "@sfx-atelier/physics";
import { RATE } from "./analyze";

export interface PhysicsParams {
  /** 牌の底の高さ（m） */
  height: number;
  /** 揺らぎの種（0 は揺らさない） */
  variant: number;
}

export const PHYSICS_DEFAULT: PhysicsParams = { height: 0.06, variant: 0 };

/** 揺らぎの幅（位置 ±5mm・速さ ±20%・向き ±20 度・回転 ±60 度/秒） */
const SPREAD = { pos: 0.005, vel: 0.2, yaw: 20, spin: 60 };

/** 題材のシーン（discard）に高さと揺らぎを当てる */
export function discardScene(p: PhysicsParams): Scene {
  const tile = DISCARD_SCENE.bodies[0]!;
  const half = tile.shape === "box" ? tile.size[2] / 2 : 0;
  const scene: Scene = { ...DISCARD_SCENE, bodies: [{ ...tile, pos: [tile.pos[0], tile.pos[1], p.height + half] }] };
  return p.variant ? vary(scene, p.variant, SPREAD) : scene;
}

export interface PhysicsRecording {
  signal: Signal;
  /** 接触の回数 */
  contacts: number;
}

/** 録音する：前後の無音を除き、山を -1dB に揃える */
export function recordDiscard(p: PhysicsParams): PhysicsRecording {
  const r = record(discardScene(p), { ...DISCARD_SOUND, seed: 1, sampleRate: RATE });
  return { signal: normalize(removeSilence(r.signal), -1), contacts: r.events.length };
}

export const wavBytes = (signal: Signal) => encodeWav(signal, 16);

/** M2 のバンクの 1 音 → 残響を外した単体の score（使っている楽器だけ） */
export function dryFromBank(bank: Bank, name: string): Score | null {
  const sound = bank.sounds[name];
  if (!sound) return null;
  const used = new Set(sound.tracks.map((t) => t.instrument));
  return {
    format: "sfx-score/1",
    ...sound,
    instruments: Object.fromEntries(Object.entries(bank.instruments ?? {}).filter(([k]) => used.has(k))),
    tracks: sound.tracks.map(({ send: _s, ...t }) => t),
  };
}

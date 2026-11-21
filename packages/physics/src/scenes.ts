// 題材のシーン。最初の題材は「牌が卓に落ちる音」（いまの discard）
import type { Scene } from "./engine";

/**
 * 牌（26 × 35 × 20mm、12g の樹脂）を、フェルトを張った木の卓に 6cm の高さから少し斜めに落とす。
 * 卓は平面。音は「布を張った木の卓」（低いモード約 120Hz、早く消える）で、布の柔らかさは接触の時間に効く
 */
export const DISCARD_SCENE: Scene = {
  duration: 0.6,
  materials: { tablecloth: { restitution: 0.25, friction: 0.6 } },
  planes: [{ id: "table", shape: "plane", material: "tablecloth", normal: [0, 0, 1], offset: 0 }],
  bodies: [
    { id: "tile", shape: "box", size: [0.026, 0.035, 0.02], mass: 0.012, material: "resin", pos: [0, 0, 0.07], vel: [0.15, 0.05, -0.3], yaw: 8, spin: 40 },
  ],
};

/** discard の当たりの音：卓の布は、フェルトの柔らかさと木の響きを混ぜる */
export const DISCARD_SOUND = {
  materials: {
    tablecloth: { base: 600, modes: [[1, 1], [2.3, 0.5]] as [number, number][], loss: 0.15, contact: 4e-4, noise: { gain: 0.6, decay: 0.025, q: 0.9 } },
  },
  planeSize: 0.15,
  planeMass: 3,
};

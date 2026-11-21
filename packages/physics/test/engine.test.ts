import { describe, expect, it } from "vitest";
import { simulate, vary, type BodySpec, type ContactEvent, type PlaneSpec, type Scene } from "../src/engine";

// 期待値は力学の式（自由落下・反発係数・運動量保存・クーロンの摩擦）から手で出す。
// 固定の刻み幅で解くので、時刻は刻み幅の数個分、速さは 1〜2% の誤差を許す
const floor: PlaneSpec = { id: "floor", shape: "plane", material: "test", normal: [0, 0, 1], offset: 0 };
const mat = (restitution: number, friction = 0) => ({ test: { restitution, friction } });
const g = 9.8;
const dt = 1 / 1000;

function ball(over: Partial<BodySpec> = {}): BodySpec {
  return { id: "ball", shape: "sphere", radius: 0.1, mass: 0.2, material: "test", pos: [0, 0, 1.325], ...over } as BodySpec;
}

const impacts = (events: ContactEvent[], a: string, b: string) => events.filter((e) => e.a === a && e.b === b);

describe("自由落下と反発", () => {
  // 高さ 1.225m 落ちる：t = √(2h/g) = 0.5 秒、v = g·t = 4.9 m/s
  it("床に当たる時刻と速さ", () => {
    const r = simulate({ duration: 0.6, bodies: [ball()], planes: [floor], materials: mat(0.5) });
    const first = impacts(r.events, "ball", "floor")[0]!;
    expect(Math.abs(first.t - 0.5)).toBeLessThanOrEqual(2 * dt);
    expect(first.speed).toBeGreaterThan(4.9 * 0.99);
    expect(first.speed).toBeLessThan(4.9 * 1.01);
    expect(first.materials).toEqual(["test", "test"]);
    expect(first.normal).toEqual([0, 0, 1]);
    expect(first.point[2]).toBeCloseTo(0, 2);
  });

  it("力積 = m(1 + e)v", () => {
    const r = simulate({ duration: 0.6, bodies: [ball()], planes: [floor], materials: mat(0.5) });
    const first = impacts(r.events, "ball", "floor")[0]!;
    const expected = 0.2 * 1.5 * first.speed;
    expect(Math.abs(first.impulse - expected) / expected).toBeLessThan(0.01);
  });

  it("跳ねるたびに速さは e 倍、次に当たるまでの間隔は 2ev/g", () => {
    const e = 0.6;
    const r = simulate({ duration: 2, bodies: [ball()], planes: [floor], materials: mat(e) });
    const hits = impacts(r.events, "ball", "floor");
    expect(hits.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < 4; i++) {
      const ratio = hits[i]!.speed / hits[i - 1]!.speed;
      expect(Math.abs(ratio - e)).toBeLessThan(0.02);
      const gap = hits[i]!.t - hits[i - 1]!.t;
      const expected = (2 * e * hits[i - 1]!.speed) / g;
      expect(Math.abs(gap - expected)).toBeLessThan(3 * dt);
    }
  });

  it("最後は床の上で止まり、出来事は有限（置いたものは跳ね続けない）", () => {
    const r = simulate({ duration: 3, bodies: [ball()], planes: [floor], materials: mat(0.5) });
    const last = r.events.at(-1)!;
    expect(last.t).toBeLessThan(2);
    const b = r.bodies[0]!;
    expect(b.pos[2]).toBeCloseTo(0.1, 3);
    expect(Math.abs(b.vel[2])).toBeLessThan(0.02);
  });

  it("e = 0 なら 1 回で止まる", () => {
    const r = simulate({ duration: 1, bodies: [ball()], planes: [floor], materials: mat(0) });
    expect(impacts(r.events, "ball", "floor")).toHaveLength(1);
  });
});

describe("正面衝突（重力なし）", () => {
  // m1 = 1, m2 = 3, v1 = 2, v2 = 0
  const scene = (e: number): Scene => ({
    duration: 0.5,
    gravity: 0,
    materials: mat(e),
    bodies: [
      { id: "a", shape: "sphere", radius: 0.1, mass: 1, material: "test", pos: [0, 0, 0], vel: [2, 0, 0] },
      { id: "b", shape: "sphere", radius: 0.1, mass: 3, material: "test", pos: [0.5, 0, 0] },
    ],
  });

  it("完全弾性（e = 1）：v1' = (m1 − m2)/(m1 + m2)·v1 = −1、v2' = 2m1/(m1 + m2)·v1 = 1。運動量と運動エネルギーが保存", () => {
    const r = simulate(scene(1));
    const [a, b] = r.bodies;
    expect(a!.vel[0]).toBeCloseTo(-1, 9);
    expect(b!.vel[0]).toBeCloseTo(1, 9);
    expect(1 * a!.vel[0] + 3 * b!.vel[0]).toBeCloseTo(2, 12);
    expect(0.5 * 1 * a!.vel[0] ** 2 + 0.5 * 3 * b!.vel[0] ** 2).toBeCloseTo(2, 9);
    expect(r.events).toHaveLength(1);
    // 力積 = m1·|Δv1| = 3
    expect(r.events[0]!.impulse).toBeCloseTo(3, 9);
  });

  it("e = 0.5：v1' = (m1v1 − m2·e·v1)/(m1 + m2) = −0.25、v2' = (m1v1 + m1·e·v1)/(m1 + m2) = 0.75", () => {
    const r = simulate(scene(0.5));
    expect(r.bodies[0]!.vel[0]).toBeCloseTo(-0.25, 9);
    expect(r.bodies[1]!.vel[0]).toBeCloseTo(0.75, 9);
  });

  it("壁で跳ね返る（e = 1 で速さはそのまま、向きが逆）", () => {
    const wall: PlaneSpec = { id: "wall", shape: "plane", material: "test", normal: [-1, 0, 0], offset: -1 };
    const r = simulate({
      duration: 1,
      gravity: 0,
      materials: mat(1),
      planes: [wall],
      bodies: [{ id: "a", shape: "sphere", radius: 0.1, mass: 1, material: "test", pos: [0, 0, 0], vel: [2, 0, 0] }],
    });
    expect(r.bodies[0]!.vel[0]).toBeCloseTo(-2, 9);
    // 中心が x = 0.9 に届くのは 0.45 秒
    expect(Math.abs(r.events[0]!.t - 0.45)).toBeLessThanOrEqual(2 * dt);
  });
});

describe("摩擦", () => {
  // 床の上の箱を v0 = 2 m/s で滑らせる。μ = 0.5：止まるまで v0/(μg) ≒ 0.408 秒、距離 v0²/(2μg) ≒ 0.408m
  const scene: Scene = {
    duration: 1,
    materials: mat(0, 0.5),
    planes: [floor],
    bodies: [{ id: "box", shape: "box", size: [0.2, 0.2, 0.1], mass: 1, material: "test", pos: [0, 0, 0.05], vel: [2, 0, 0] }],
  };

  it("止まる距離", () => {
    const r = simulate(scene);
    const b = r.bodies[0]!;
    expect(Math.abs(b.pos[0] - 4 / (2 * 0.5 * g))).toBeLessThan(0.005);
    expect(b.vel[0]).toBeCloseTo(0, 9);
    expect(b.pos[2]).toBeCloseTo(0.05, 4);
  });

  it("止まる時刻", () => {
    const r = simulate({ ...scene, duration: 2 / (0.5 * g) - 0.01 });
    expect(r.bodies[0]!.vel[0]).toBeGreaterThan(0);
    const r2 = simulate({ ...scene, duration: 2 / (0.5 * g) + 0.01 });
    expect(r2.bodies[0]!.vel[0]).toBeCloseTo(0, 9);
  });

  it("置いて滑らせるだけなら、衝撃の出来事は出ない", () => {
    expect(simulate(scene).events).toEqual([]);
  });

  it("床の上で回る箱は、ねじりの摩擦で止まる", () => {
    const r = simulate({ ...scene, bodies: [{ ...scene.bodies[0]!, vel: [0, 0, 0], spin: 720 }] });
    expect(r.bodies[0]!.spin).toBeCloseTo(0, 6);
  });

  it("摩擦なし（μ = 0）なら滑り続ける", () => {
    const r = simulate({ ...scene, materials: mat(0, 0) });
    expect(r.bodies[0]!.vel[0]).toBeCloseTo(2, 9);
  });
});

describe("箱", () => {
  it("箱が床に平らに落ちる：法線は真上、接触点は底の真ん中", () => {
    const r = simulate({
      duration: 0.5,
      materials: mat(0.3),
      planes: [floor],
      bodies: [{ id: "tile", shape: "box", size: [0.026, 0.035, 0.02], mass: 0.012, material: "test", pos: [0.1, 0.2, 0.3], yaw: 30 }],
    });
    const first = r.events[0]!;
    // 底が 0.29m 落ちる：v = √(2 × 9.8 × 0.29) ≒ 2.384
    expect(Math.abs(first.speed - Math.sqrt(2 * g * 0.29)) / Math.sqrt(2 * g * 0.29)).toBeLessThan(0.01);
    expect(first.point[0]).toBeCloseTo(0.1, 9);
    expect(first.point[1]).toBeCloseTo(0.2, 9);
    expect(r.bodies[0]!.yaw).toBeCloseTo(30, 9);
  });

  it("箱を箱の上に落とすと積み重なる（下の箱の上面 0.1m ＋ 半分の高さ 0.05m）", () => {
    const r = simulate({
      duration: 1.5,
      materials: mat(0.3, 0.5),
      planes: [floor],
      bodies: [
        { id: "low", shape: "box", size: [0.3, 0.3, 0.1], mass: 2, material: "test", pos: [0, 0, 0.05] },
        { id: "top", shape: "box", size: [0.1, 0.1, 0.1], mass: 0.5, material: "test", pos: [0.05, 0, 0.4], yaw: 20 },
      ],
    });
    expect(impacts(r.events, "low", "top").length).toBeGreaterThan(0);
    const top = r.bodies[1]!;
    expect(top.pos[2]).toBeCloseTo(0.15, 3);
    expect(r.bodies[0]!.pos[2]).toBeCloseTo(0.05, 3);
  });

  it("斜めの箱の角が壁に当たると回り出す。接触点まわりの角運動量は保存する", () => {
    const wall: PlaneSpec = { id: "wall", shape: "plane", material: "test", normal: [-1, 0, 0], offset: -1 };
    const m = 1;
    const size: [number, number, number] = [0.4, 0.2, 0.1];
    const I = (m * (0.4 ** 2 + 0.2 ** 2)) / 12;
    const before = { vx: 2, vy: 0, w: 0 };
    const r = simulate({
      duration: 0.6,
      gravity: 0,
      materials: mat(0.5, 0),
      planes: [wall],
      bodies: [{ id: "box", shape: "box", size, mass: m, material: "test", pos: [0, 0, 0], vel: [before.vx, before.vy, 0], yaw: 30 }],
    });
    const hits = impacts(r.events, "box", "wall");
    expect(hits).toHaveLength(1);
    const p = hits[0]!.point;
    const b = r.bodies[0]!;
    expect(Math.abs(b.spin)).toBeGreaterThan(1);
    // 衝突後も等速で動くので、衝突の時刻の位置に戻して比べる
    const tAfter = 0.6 - hits[0]!.t;
    // 衝突の時刻の中心（衝撃は一瞬なので、直前と直後で同じ位置とみなす）
    const x = b.pos[0] - b.vel[0] * tAfter;
    const y = b.pos[1] - b.vel[1] * tAfter;
    const L = (cx: number, cy: number, vx: number, vy: number, w: number) => m * ((cx - p[0]) * vy - (cy - p[1]) * vx) + I * w;
    const lBefore = L(x, y, before.vx, before.vy, 0);
    const lAfter = L(x, y, b.vel[0], b.vel[1], (b.spin * Math.PI) / 180);
    expect(lAfter).toBeCloseTo(lBefore, 6);
  });
});

describe("球と箱", () => {
  it("固定の箱（台）の上に球を落とす", () => {
    const r = simulate({
      duration: 1,
      materials: mat(0.5),
      bodies: [
        { id: "table", shape: "box", size: [1, 1, 0.1], fixed: true, material: "test", pos: [0, 0, 0.7] },
        { id: "ball", shape: "sphere", radius: 0.05, mass: 0.1, material: "test", pos: [0.2, -0.1, 1.2] },
      ],
    });
    // 台の上面 0.75m。球の底は 1.15m から 0.4m 落ちる
    const first = r.events[0]!;
    expect(first.a).toBe("ball");
    expect(first.b).toBe("table");
    expect(Math.abs(first.speed - Math.sqrt(2 * g * 0.4)) / Math.sqrt(2 * g * 0.4)).toBeLessThan(0.01);
    expect(first.normal[2]).toBeCloseTo(1, 9);
  });
});

describe("決定論と揺らぎ", () => {
  const scene: Scene = {
    duration: 1.5,
    materials: { felt: { restitution: 0.2, friction: 0.6 } },
    planes: [
      { ...floor, material: "felt" },
      { id: "wall", shape: "plane", material: "wood", normal: [0, -1, 0], offset: -0.3 },
    ],
    bodies: [
      { id: "tile", shape: "box", size: [0.026, 0.035, 0.02], mass: 0.012, material: "resin", pos: [0, 0, 0.2], vel: [0.3, 0.8, 0], yaw: 17, spin: 200 },
      { id: "tile2", shape: "box", size: [0.026, 0.035, 0.02], mass: 0.012, material: "resin", pos: [0.05, 0.15, 0.01] },
      { id: "die", shape: "sphere", radius: 0.008, mass: 0.003, material: "resin", pos: [0.02, 0.1, 0.3], vel: [0, 0.2, 0] },
    ],
  };

  it("同じシーンからは同じ出来事の列", () => {
    const a = simulate(scene);
    const b = simulate(scene);
    expect(a.events.length).toBeGreaterThan(2);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("vary：同じ種なら同じシーン、違う種なら違うシーン。固定のものと平面は変えない", () => {
    const spread = { pos: 0.01, vel: 0.1, yaw: 10, spin: 50 };
    expect(vary(scene, 7, spread)).toEqual(vary(scene, 7, spread));
    expect(vary(scene, 7, spread)).not.toEqual(vary(scene, 8, spread));
    expect(vary(scene, 7, spread).planes).toBe(scene.planes);
    const v = vary(scene, 7, spread).bodies[0]!;
    expect(Math.abs(v.pos[0] - 0)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(v.yaw! - 17)).toBeLessThanOrEqual(10);
    expect(JSON.stringify(simulate(vary(scene, 7, spread)))).toBe(JSON.stringify(simulate(vary(scene, 7, spread))));
  });

  it("揺らぎ 0 なら元と同じ結果", () => {
    expect(JSON.stringify(simulate(vary(scene, 3, {})))).toBe(JSON.stringify(simulate(scene)));
  });
});

describe("入力の検査", () => {
  const ok: Scene = { duration: 0.1, bodies: [ball()], planes: [floor], materials: mat(0.5) };
  it.each([
    ["知らない材質", { ...ok, materials: {} }],
    ["質量 0", { ...ok, bodies: [ball({ mass: 0 })] }],
    ["斜めの平面", { ...ok, planes: [{ ...floor, normal: [0, 1, 1] }] }],
    ["id の重なり", { ...ok, bodies: [ball(), ball()] }],
    ["長すぎる", { ...ok, duration: 31 }],
    ["刻み幅が大きすぎる", { ...ok, dt: 0.1 }],
  ] as [string, Scene][])("%s は投げる", (_, s) => {
    expect(() => simulate(s)).toThrow();
  });
});

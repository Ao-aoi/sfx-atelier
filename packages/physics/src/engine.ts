// 2.5D の剛体の物理エンジン（提案書 5.2、計画 M5a）。
// - 物体：球と箱（動く・固定）、平面（床・壁。動かない）
// - 2.5D：位置と速度は 3 次元だが、回転は鉛直軸まわり（向き＝yaw）だけ。箱は傾かず、球は転がらない（滑るだけ）
// - 固定の刻み幅、逐次インパルス法（反発と、クーロンの摩擦）
// - 出力は接触の出来事（時刻・衝撃の強さ・相対速度・材質）。音はここから作る（5b）
// 決定論：足し算・掛け算・割り算・sqrt だけで計算し（Math.sin などは使わない）、物体の順序も入力の順に固定する。
// 同じシーンからは、ブラウザでも Node でも同じ出来事の列になる。
import { rad, sincos } from "./trig";

export type Vec3 = [number, number, number];

export interface Material {
  /** 反発係数（0〜1） */
  restitution: number;
  /** 摩擦係数（0 以上） */
  friction: number;
}

/** 材質の目安。2 つの材質の組は、それぞれの相乗平均を使う */
export const MATERIALS: Record<string, Material> = {
  wood: { restitution: 0.5, friction: 0.4 },
  resin: { restitution: 0.6, friction: 0.35 },
  metal: { restitution: 0.55, friction: 0.3 },
  glass: { restitution: 0.65, friction: 0.25 },
  stone: { restitution: 0.5, friction: 0.5 },
  felt: { restitution: 0.15, friction: 0.6 },
  rubber: { restitution: 0.8, friction: 0.9 },
};

interface BodyBase {
  id: string;
  /** 材質の名前（MATERIALS か scene.materials のキー） */
  material: string;
  /** 中心の位置（m）。z が高さ */
  pos: Vec3;
  /** kg。fixed のときは使わない */
  mass?: number;
  /** 動かない（台など） */
  fixed?: boolean;
  /** m/s */
  vel?: Vec3;
  /** 向き（度、鉛直軸まわり） */
  yaw?: number;
  /** 回転の速さ（度/秒、鉛直軸まわり） */
  spin?: number;
}

export interface SphereSpec extends BodyBase {
  shape: "sphere";
  radius: number;
}

export interface BoxSpec extends BodyBase {
  shape: "box";
  /** [幅 x, 奥行き y, 高さ z]（m、yaw = 0 のとき） */
  size: Vec3;
}

export type BodySpec = SphereSpec | BoxSpec;

/** 平面。n·p ≥ offset の側が空間。法線は真上 [0, 0, 1] か水平（z = 0）だけ（2.5D） */
export interface PlaneSpec {
  id: string;
  shape: "plane";
  material: string;
  normal: Vec3;
  offset: number;
}

export interface Scene {
  /** 計算する長さ（秒、30 秒まで） */
  duration: number;
  bodies: BodySpec[];
  planes?: PlaneSpec[];
  /** 重力加速度（m/s²、既定 9.8） */
  gravity?: number;
  /** 刻み幅（秒、既定 1/1000） */
  dt?: number;
  /** 1 刻みの反復の回数（既定 10） */
  iterations?: number;
  /** この速さ（m/s）以上で近づいた接触だけを出来事にし、反発させる（既定 0.05） */
  minSpeed?: number;
  /** 材質の追加・上書き */
  materials?: Record<string, Material>;
}

/** 接触の出来事 */
export interface ContactEvent {
  /** 秒 */
  t: number;
  a: string;
  b: string;
  /** [a の材質, b の材質] */
  materials: [string, string];
  /** 法線方向の力積（N·s）＝ 衝撃の強さ */
  impulse: number;
  /** 法線方向に近づく速さ（m/s、接触の直前） */
  speed: number;
  /** 接線方向の滑りの速さ（m/s、接触の直前） */
  slide: number;
  /** 接触点（m） */
  point: Vec3;
  /** b から a への向き */
  normal: Vec3;
}

export interface BodyState {
  id: string;
  pos: Vec3;
  vel: Vec3;
  /** 度 */
  yaw: number;
  /** 度/秒 */
  spin: number;
}

export interface SimResult {
  events: ContactEvent[];
  /** 終わったときの状態 */
  bodies: BodyState[];
  steps: number;
}

// ---- 内部の状態 ----

interface Body {
  id: string;
  material: string;
  mat: Material;
  sphere: boolean;
  /** 球の半径 */
  r: number;
  /** 箱の半分の大きさ */
  h: Vec3;
  invMass: number;
  /** 鉛直軸まわりの慣性モーメントの逆数 */
  invI: number;
  p: Vec3;
  v: Vec3;
  /** 向きの [cos, sin]（長さ 1 に保つ） */
  c: number;
  s: number;
  /** 回転の速さ（rad/s） */
  w: number;
}

interface Plane {
  id: string;
  material: string;
  mat: Material;
  n: Vec3;
  offset: number;
}

interface Contact {
  a: Body;
  /** 相手が平面なら null */
  b: Body | null;
  bId: string;
  bMaterial: string;
  /** b から a への向き（a を押し出す向き） */
  n: Vec3;
  point: Vec3;
  depth: number;
  /** 中心から接触点まで */
  ra: Vec3;
  rb: Vec3;
  e: number;
  mu: number;
  /** ねじりの摩擦の腕（m）。面で接する箱だけ */
  twist: number;
  t1: Vec3;
  t2: Vec3;
  kn: number;
  k1: number;
  k2: number;
  /** 解く前の法線方向の相対速度（負が近づく） */
  vn0: number;
  slide0: number;
  target: number;
  jn: number;
  jt1: number;
  jt2: number;
  jw: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
/** (r × n) の z 成分。鉛直軸まわりのトルクの腕 */
const crossZ = (r: Vec3, n: Vec3) => r[0] * n[1] - r[1] * n[0];

function materialOf(scene: Scene, name: string): Material {
  const m = scene.materials?.[name] ?? MATERIALS[name];
  if (!m) throw new Error(`知らない材質です: ${name}`);
  if (!(m.restitution >= 0 && m.restitution <= 1) || !(m.friction >= 0)) throw new Error(`材質の値が範囲外です: ${name}`);
  return m;
}

function finite(v: Vec3 | undefined, what: string) {
  if (v && !(v.length === 3 && v.every(Number.isFinite))) throw new Error(`${what} は 3 つの数にしてください`);
}

function makeBody(scene: Scene, spec: BodySpec): Body {
  finite(spec.pos, `${spec.id} の pos`);
  finite(spec.vel, `${spec.id} の vel`);
  const fixed = spec.fixed === true;
  const mass = spec.mass ?? 0;
  if (!fixed && !(mass > 0)) throw new Error(`${spec.id} の mass は 0 より大きくしてください`);
  const sphere = spec.shape === "sphere";
  let r = 0;
  let h: Vec3 = [0, 0, 0];
  let inertia: number;
  if (sphere) {
    if (!(spec.radius > 0)) throw new Error(`${spec.id} の radius は 0 より大きくしてください`);
    r = spec.radius;
    inertia = 0.4 * mass * r * r;
  } else if (spec.shape === "box") {
    if (!(spec.size.length === 3 && spec.size.every((x) => x > 0))) throw new Error(`${spec.id} の size は 0 より大きい 3 つの数にしてください`);
    h = [spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2];
    inertia = (mass * (spec.size[0] ** 2 + spec.size[1] ** 2)) / 12;
  } else throw new Error(`知らない形です: ${(spec as { shape: unknown }).shape}`);
  const [s, c] = sincos(rad(spec.yaw ?? 0));
  return {
    id: spec.id,
    material: spec.material,
    mat: materialOf(scene, spec.material),
    sphere,
    r,
    h,
    invMass: fixed ? 0 : 1 / mass,
    invI: fixed ? 0 : 1 / inertia,
    p: [...spec.pos],
    v: fixed ? [0, 0, 0] : [...(spec.vel ?? [0, 0, 0])],
    c,
    s,
    w: fixed ? 0 : rad(spec.spin ?? 0),
  };
}

function makePlane(scene: Scene, spec: PlaneSpec): Plane {
  finite(spec.normal, `${spec.id} の normal`);
  const [x, y, z] = spec.normal;
  const up = x === 0 && y === 0 && z > 0;
  if (!up && z !== 0) throw new Error(`${spec.id} の normal は真上か水平にしてください（2.5D）`);
  const l = Math.sqrt(x * x + y * y + z * z);
  if (!(l > 0)) throw new Error(`${spec.id} の normal が 0 です`);
  return { id: spec.id, material: spec.material, mat: materialOf(scene, spec.material), n: [x / l, y / l, z / l], offset: spec.offset };
}

/** 箱の 8 つの角（入力の順に固定） */
function corners(b: Body): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const lx = sx * b.h[0];
        const ly = sy * b.h[1];
        out.push([b.p[0] + lx * b.c - ly * b.s, b.p[1] + lx * b.s + ly * b.c, b.p[2] + sz * b.h[2]]);
      }
  return out;
}

/** 箱の、向き d にいちばん出ている点。同じ深さの角が複数あれば平均（面や辺で接するとき回転が偏らないように） */
function support(b: Body, d: Vec3): { point: Vec3; value: number } {
  const cs = corners(b);
  let best = -Infinity;
  for (const p of cs) best = Math.max(best, dot(p, d));
  const eps = 1e-9 * (1 + Math.abs(best));
  const sum: Vec3 = [0, 0, 0];
  let n = 0;
  for (const p of cs)
    if (dot(p, d) >= best - eps) {
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      n++;
    }
  return { point: [sum[0] / n, sum[1] / n, sum[2] / n], value: best };
}

type Raw = { n: Vec3; point: Vec3; depth: number; twist: number };

function spherePlane(a: Body, pl: Plane): Raw | null {
  const depth = a.r - (dot(pl.n, a.p) - pl.offset);
  if (depth <= 0) return null;
  return { n: pl.n, point: [a.p[0] - pl.n[0] * a.r, a.p[1] - pl.n[1] * a.r, a.p[2] - pl.n[2] * a.r], depth, twist: 0 };
}

function boxPlane(a: Body, pl: Plane): Raw | null {
  const neg: Vec3 = [-pl.n[0], -pl.n[1], -pl.n[2]];
  const sp = support(a, neg);
  const depth = pl.offset + sp.value;
  if (depth <= 0) return null;
  // 床に面で接する箱は、ねじりの摩擦を持つ（長方形の面の平均の腕の目安：半分の大きさの和の 1/3）
  const twist = pl.n[2] > 0 ? (a.h[0] + a.h[1]) / 3 : 0;
  return { n: pl.n, point: sp.point, depth, twist };
}

function sphereSphere(a: Body, b: Body): Raw | null {
  const d = sub(a.p, b.p);
  const l = len(d);
  const depth = a.r + b.r - l;
  if (depth <= 0) return null;
  const n: Vec3 = l > 0 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 1];
  return { n, point: [b.p[0] + n[0] * b.r, b.p[1] + n[1] * b.r, b.p[2] + n[2] * b.r], depth, twist: 0 };
}

/** 球 a と箱 b。n は箱から球へ */
function sphereBox(a: Body, b: Body): Raw | null {
  const dx = a.p[0] - b.p[0];
  const dy = a.p[1] - b.p[1];
  // 箱の座標へ（-yaw だけ回す）
  const local: Vec3 = [dx * b.c + dy * b.s, -dx * b.s + dy * b.c, a.p[2] - b.p[2]];
  const q: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) q[i] = Math.min(b.h[i]!, Math.max(-b.h[i]!, local[i]!));
  const diff = sub(local, q);
  const l = len(diff);
  let nl: Vec3;
  let depth: number;
  let pl: Vec3;
  if (l > 0) {
    depth = a.r - l;
    if (depth <= 0) return null;
    nl = [diff[0] / l, diff[1] / l, diff[2] / l];
    pl = q;
  } else {
    // 中心が箱の中：いちばん近い面から出す
    let axis = 0;
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const f = b.h[i]! - Math.abs(local[i]!);
      if (f < best) {
        best = f;
        axis = i;
      }
    }
    const sign = local[axis]! >= 0 ? 1 : -1;
    nl = [0, 0, 0];
    nl[axis] = sign;
    depth = a.r + best;
    pl = [...local];
    pl[axis] = sign * b.h[axis]!;
  }
  const toWorld = (v: Vec3, base: Vec3 | null): Vec3 => {
    const x = v[0] * b.c - v[1] * b.s;
    const y = v[0] * b.s + v[1] * b.c;
    return base ? [base[0] + x, base[1] + y, base[2] + v[2]] : [x, y, v[2]];
  };
  return { n: toWorld(nl, null), point: toWorld(pl, b.p), depth, twist: 0 };
}

/** 箱どうし。水平の 4 軸と鉛直の分離軸で、重なりのいちばん浅い軸を法線にする。n は b から a へ */
function boxBox(a: Body, b: Body): Raw | null {
  const axes: Vec3[] = [
    [a.c, a.s, 0],
    [-a.s, a.c, 0],
    [b.c, b.s, 0],
    [-b.s, b.c, 0],
  ];
  const radius = (x: Body, L: Vec3) => x.h[0] * Math.abs(x.c * L[0] + x.s * L[1]) + x.h[1] * Math.abs(-x.s * L[0] + x.c * L[1]);
  const d = sub(b.p, a.p);
  let best = Infinity;
  let bestAxis = -1;
  let bestSign = 1;
  for (let i = 0; i < 4; i++) {
    const L = axes[i]!;
    const dl = dot(d, L);
    const overlap = radius(a, L) + radius(b, L) - Math.abs(dl);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      bestAxis = i;
      bestSign = dl >= 0 ? -1 : 1;
    }
  }
  const oz = a.h[2] + b.h[2] - Math.abs(d[2]);
  if (oz <= 0) return null;
  const zLow = Math.max(a.p[2] - a.h[2], b.p[2] - b.h[2]);
  const zHigh = Math.min(a.p[2] + a.h[2], b.p[2] + b.h[2]);
  if (oz <= best) {
    // 上下に重なる：接触点は 2 つの中心の真ん中の真下・真上（面の接触）
    const up = d[2] < 0;
    const z = up ? a.p[2] - a.h[2] : a.p[2] + a.h[2];
    return {
      n: [0, 0, up ? 1 : -1],
      point: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, z],
      depth: oz,
      twist: (Math.min(a.h[0], b.h[0]) + Math.min(a.h[1], b.h[1])) / 3,
    };
  }
  const L = axes[bestAxis]!;
  const n: Vec3 = [L[0] * bestSign, L[1] * bestSign, 0];
  // 法線が a の面なら、b の角が a に刺さっている。b の面なら a の角
  const point = bestAxis < 2 ? support(b, n).point : support(a, [-n[0], -n[1], 0]).point;
  point[2] = (zLow + zHigh) / 2;
  return { n, point, depth: best, twist: 0 };
}

/** n に垂直な 2 本の向き */
function tangents(n: Vec3): [Vec3, Vec3] {
  if (n[2] !== 0 && n[0] === 0 && n[1] === 0) return [[1, 0, 0], [0, 1, 0]];
  // 水平の法線：水平の接線と鉛直
  const h = Math.sqrt(n[0] * n[0] + n[1] * n[1]);
  if (h === 0) return [[1, 0, 0], [0, 1, 0]];
  const t1: Vec3 = [-n[1] / h, n[0] / h, 0];
  // t2 = n × t1
  const t2: Vec3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  const l = len(t2);
  return [t1, [t2[0] / l, t2[1] / l, t2[2] / l]];
}

/** 接触点での a の b に対する速度 */
function relVel(c: Contact): Vec3 {
  const a = c.a;
  const v: Vec3 = [a.v[0] - a.w * c.ra[1], a.v[1] + a.w * c.ra[0], a.v[2]];
  const b = c.b;
  if (b) {
    v[0] -= b.v[0] - b.w * c.rb[1];
    v[1] -= b.v[1] + b.w * c.rb[0];
    v[2] -= b.v[2];
  }
  return v;
}

function effMass(c: Contact, d: Vec3): number {
  const ca = crossZ(c.ra, d);
  let k = c.a.invMass + c.a.invI * ca * ca;
  if (c.b) {
    const cb = crossZ(c.rb, d);
    k += c.b.invMass + c.b.invI * cb * cb;
  }
  return k;
}

function applyImpulse(c: Contact, d: Vec3, j: number) {
  const a = c.a;
  a.v[0] += d[0] * j * a.invMass;
  a.v[1] += d[1] * j * a.invMass;
  a.v[2] += d[2] * j * a.invMass;
  a.w += a.invI * crossZ(c.ra, d) * j;
  const b = c.b;
  if (b) {
    b.v[0] -= d[0] * j * b.invMass;
    b.v[1] -= d[1] * j * b.invMass;
    b.v[2] -= d[2] * j * b.invMass;
    b.w -= b.invI * crossZ(c.rb, d) * j;
  }
}

function applyTwist(c: Contact, j: number) {
  c.a.w += c.a.invI * j;
  if (c.b) c.b.w -= c.b.invI * j;
}

/** シーンを計算する */
export function simulate(scene: Scene): SimResult {
  const g = scene.gravity ?? 9.8;
  const dt = scene.dt ?? 1 / 1000;
  const iterations = scene.iterations ?? 10;
  const minSpeed = scene.minSpeed ?? 0.05;
  if (!(dt > 0 && dt <= 0.01)) throw new Error("dt は 0 より大きく 0.01 以下にしてください");
  if (!(scene.duration >= 0 && scene.duration <= 30)) throw new Error("duration は 0〜30 秒にしてください");
  const ids = new Set<string>();
  for (const x of [...scene.bodies, ...(scene.planes ?? [])]) {
    if (ids.has(x.id)) throw new Error(`id が重なっています: ${x.id}`);
    ids.add(x.id);
  }
  const bodies = scene.bodies.map((s) => makeBody(scene, s));
  const planes = (scene.planes ?? []).map((s) => makePlane(scene, s));
  const steps = Math.round(scene.duration / dt);
  const events: ContactEvent[] = [];

  for (let step = 1; step <= steps; step++) {
    const t = step * dt;
    // 1. 重力と位置・向きの更新
    for (const b of bodies) {
      if (b.invMass === 0) continue;
      b.v[2] -= g * dt;
      b.p[0] += b.v[0] * dt;
      b.p[1] += b.v[1] * dt;
      b.p[2] += b.v[2] * dt;
      if (b.w !== 0) {
        // 小さい角 w·dt だけ回して長さ 1 に戻す（sin・cos を使わない）
        const a = b.w * dt;
        const c = b.c - b.s * a;
        const s = b.s + b.c * a;
        const l = Math.sqrt(c * c + s * s);
        b.c = c / l;
        b.s = s / l;
      }
    }

    // 2. 接触を集める（入力の順）
    const contacts: Contact[] = [];
    const add = (a: Body, b: Body | null, bId: string, bMat: string, mat: Material, raw: Raw | null) => {
      if (!raw) return;
      const ra = sub(raw.point, a.p);
      const rb: Vec3 = b ? sub(raw.point, b.p) : [0, 0, 0];
      const [t1, t2] = tangents(raw.n);
      const c: Contact = {
        a, b, bId, bMaterial: bMat, n: raw.n, point: raw.point, depth: raw.depth, ra, rb,
        e: Math.sqrt(a.mat.restitution * mat.restitution),
        mu: Math.sqrt(a.mat.friction * mat.friction),
        twist: raw.twist, t1, t2, kn: 0, k1: 0, k2: 0, vn0: 0, slide0: 0, target: 0, jn: 0, jt1: 0, jt2: 0, jw: 0,
      };
      c.kn = effMass(c, c.n);
      c.k1 = effMass(c, t1);
      c.k2 = effMass(c, t2);
      if (c.kn === 0) return;
      const rv = relVel(c);
      c.vn0 = dot(rv, c.n);
      const tv = [rv[0] - c.n[0] * c.vn0, rv[1] - c.n[1] * c.vn0, rv[2] - c.n[2] * c.vn0] as Vec3;
      c.slide0 = len(tv);
      // 遅い接触は反発させない（置いたものが跳ね続けないように）
      c.target = c.vn0 < -minSpeed ? -c.e * c.vn0 : 0;
      contacts.push(c);
    };
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (const pl of planes) {
        if (a.invMass === 0) continue;
        add(a, null, pl.id, pl.material, pl.mat, a.sphere ? spherePlane(a, pl) : boxPlane(a, pl));
      }
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (a.invMass === 0 && b.invMass === 0) continue;
        if (a.sphere && b.sphere) add(a, b, b.id, b.material, b.mat, sphereSphere(a, b));
        else if (a.sphere) add(a, b, b.id, b.material, b.mat, sphereBox(a, b));
        else if (b.sphere) add(b, a, a.id, a.material, a.mat, sphereBox(b, a));
        else add(a, b, b.id, b.material, b.mat, boxBox(a, b));
      }
    }

    // 3. 速度を解く（逐次インパルス、力積を貯めて範囲に収める）
    for (let it = 0; it < iterations; it++) {
      for (const c of contacts) {
        // 法線
        let rv = relVel(c);
        const vn = dot(rv, c.n);
        const jn = Math.max(0, c.jn + (c.target - vn) / c.kn);
        applyImpulse(c, c.n, jn - c.jn);
        c.jn = jn;
        // 摩擦（接線 2 本をまとめて、μ × 法線の力積の円に収める）
        rv = relVel(c);
        let j1 = c.jt1 - dot(rv, c.t1) / c.k1;
        let j2 = c.jt2 - dot(rv, c.t2) / c.k2;
        const lim = c.mu * c.jn;
        const m = Math.sqrt(j1 * j1 + j2 * j2);
        if (m > lim) {
          j1 = (j1 * lim) / m;
          j2 = (j2 * lim) / m;
        }
        applyImpulse(c, c.t1, j1 - c.jt1);
        applyImpulse(c, c.t2, j2 - c.jt2);
        c.jt1 = j1;
        c.jt2 = j2;
        // ねじりの摩擦（面で接する箱の回転を止める）
        if (c.twist > 0) {
          const kw = c.a.invI + (c.b ? c.b.invI : 0);
          if (kw > 0) {
            const dw = c.a.w - (c.b ? c.b.w : 0);
            const wl = c.mu * c.jn * c.twist;
            const jw = Math.min(wl, Math.max(-wl, c.jw - dw / kw));
            applyTwist(c, jw - c.jw);
            c.jw = jw;
          }
        }
      }
    }

    // 4. めり込みを戻す（質量の逆数の比で分ける）
    for (const c of contacts) {
      const ia = c.a.invMass;
      const ib = c.b ? c.b.invMass : 0;
      const k = c.depth / (ia + ib);
      for (let i = 0; i < 3; i++) {
        c.a.p[i]! += c.n[i]! * k * ia;
        if (c.b) c.b.p[i]! -= c.n[i]! * k * ib;
      }
    }

    // 5. 出来事
    for (const c of contacts) {
      if (c.vn0 >= -minSpeed) continue;
      events.push({
        t,
        a: c.a.id,
        b: c.bId,
        materials: [c.a.material, c.bMaterial],
        impulse: c.jn,
        speed: -c.vn0,
        slide: c.slide0,
        point: c.point,
        normal: c.n,
      });
    }
  }

  return {
    events,
    steps,
    bodies: bodies.map((b) => ({
      id: b.id,
      pos: [...b.p],
      vel: [...b.v],
      yaw: (Math.atan2(b.s, b.c) * 180) / Math.PI,
      spin: (b.w * 180) / Math.PI,
    })),
  };
}

// ---- 揺らぎ（同じ音のバリエーションを作る。提案書 P7） ----

export interface Spread {
  /** 位置の揺れ（m、±） */
  pos?: number;
  /** 速さの揺れ（割合、±。0.1 なら ±10%） */
  vel?: number;
  /** 向きの揺れ（度、±） */
  yaw?: number;
  /** 回転の揺れ（度/秒、±） */
  spin?: number;
}

/** 種つきの乱数（mulberry32）。0 以上 1 未満 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 動く物体の初期値を、種に従って少しずつ変えたシーンを返す（固定の物体と平面はそのまま） */
export function vary(scene: Scene, seed: number, spread: Spread): Scene {
  const random = seeded(seed);
  const pm = (amount: number | undefined) => (amount ? (random() * 2 - 1) * amount : 0);
  const bodies = scene.bodies.map((b): BodySpec => {
    if (b.fixed) return b;
    const k = 1 + pm(spread.vel);
    const vel = b.vel ?? [0, 0, 0];
    return {
      ...b,
      pos: [b.pos[0] + pm(spread.pos), b.pos[1] + pm(spread.pos), b.pos[2] + pm(spread.pos)],
      vel: [vel[0] * k, vel[1] * k, vel[2] * k],
      yaw: (b.yaw ?? 0) + pm(spread.yaw),
      spin: (b.spin ?? 0) + pm(spread.spin),
    };
  });
  return { ...scene, bodies };
}

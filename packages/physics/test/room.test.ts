import { describe, expect, it } from "vitest";
import { validateBank } from "@sfx-atelier/format";
import { placement, REVERB_DECAY, roomAcoustics, sabine, type Room } from "../src/room";

// 期待値は手計算（セービンの式・鏡像の幾何・臨界距離の式）から書く
// 部屋：幅 5m・奥行き 4m・高さ 3m、全面の吸音率 0.2。音源 (1, 2, 1.5)、聞く位置 (4, 2, 1.5)
const room: Room = { size: [5, 4, 3], all: 0.2, source: [1, 2, 1.5], listener: [4, 2, 1.5] };
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("セービンの式", () => {
  it("5×4×3m・吸音率 0.2：体積 60、表面積 94、吸音 18.8、RT60 ≒ 0.514 秒", () => {
    const s = sabine(room);
    near(s.volume, 60);
    near(s.area, 94);
    near(s.absorption, 18.8);
    near(s.rt60, (0.161 * 60) / 18.8);
    expect(s.rt60).toBeCloseTo(0.5138, 4);
  });

  it("面ごとの材質：床だけ 0.3 にすると、吸音は 5×4×(0.3 − 0.2) = 2 増える", () => {
    const s = sabine({ ...room, surfaces: { floor: 0.3 } });
    near(s.absorption, 20.8);
  });

  it("材質の名前は表の吸音率になる（全面 carpet 0.3 → 94 × 0.3 = 28.2）", () => {
    near(sabine({ ...room, all: "carpet" }).absorption, 28.2);
  });

  it("知らない材質・範囲外の吸音率は投げる", () => {
    expect(() => sabine({ ...room, all: "marshmallow" })).toThrow();
    expect(() => sabine({ ...room, all: 0 })).toThrow();
    expect(() => sabine({ ...room, all: 1.2 })).toThrow();
  });
});

describe("鏡像法", () => {
  const r = roomAcoustics(room);
  const find = (x: number, y: number, z: number) =>
    r.reflections.find((e) => near0(e.image[0] - x) && near0(e.image[1] - y) && near0(e.image[2] - z));
  const near0 = (v: number) => Math.abs(v) < 1e-9;
  const beta = Math.sqrt(0.8);

  it("直接音の距離は 3m", () => near(r.distance, 3));

  it("2 次までの鏡像は 24 個（1 次 6・2 次 18）", () => {
    expect(r.reflections).toHaveLength(24);
    expect(r.reflections.filter((e) => e.order === 1)).toHaveLength(6);
    expect(r.reflections.filter((e) => e.order === 2)).toHaveLength(18);
  });

  it("左の壁（x = 0）の鏡像 (-1, 2, 1.5)：経路 5m、遅れ 2m ÷ 343、強さ 3/5 × √0.8", () => {
    const e = find(-1, 2, 1.5)!;
    expect(e.order).toBe(1);
    near(e.distance, 5);
    near(e.time, 2 / 343);
    near(e.strength, (3 / 5) * beta);
  });

  it("右の壁（x = 5）の鏡像 (9, 2, 1.5)：経路 5m", () => {
    const e = find(9, 2, 1.5)!;
    expect(e.order).toBe(1);
    near(e.distance, 5);
  });

  it("床（z = 0）の鏡像 (1, 2, -1.5)：経路 √(3² + 3²)", () => {
    const e = find(1, 2, -1.5)!;
    near(e.distance, Math.sqrt(18));
    near(e.strength, (3 / Math.sqrt(18)) * beta);
  });

  it("左右の壁で 1 回ずつ（2 次）の鏡像 (11, 2, 1.5)：経路 7m、強さ 3/7 × 0.8", () => {
    const e = find(11, 2, 1.5)!;
    expect(e.order).toBe(2);
    near(e.distance, 7);
    near(e.strength, (3 / 7) * 0.8);
  });

  it("左の壁と床（2 次）の鏡像 (-1, 2, -1.5)：経路 √(5² + 3²)", () => {
    const e = find(-1, 2, -1.5)!;
    expect(e.order).toBe(2);
    near(e.distance, Math.sqrt(34));
  });

  it("時刻の順に並ぶ", () => {
    for (let i = 1; i < r.reflections.length; i++) expect(r.reflections[i]!.time).toBeGreaterThanOrEqual(r.reflections[i - 1]!.time);
  });

  it("本数を絞ると強い順に残る（6 本なら 1 次の 6 つ）", () => {
    const six = roomAcoustics(room, { maxEarly: 6 }).reflections;
    expect(six.map((e) => e.order)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("面ごとの吸音率は、その面で反射した回数だけ効く（左の壁だけ 0.5）", () => {
    const r2 = roomAcoustics({ ...room, surfaces: { left: 0.5 } });
    const left = r2.reflections.find((e) => near0(e.image[0] + 1) && near0(e.image[1] - 2) && near0(e.image[2] - 1.5))!;
    near(left.strength, (3 / 5) * Math.sqrt(0.5));
    const right = r2.reflections.find((e) => near0(e.image[0] - 9) && near0(e.image[1] - 2) && near0(e.image[2] - 1.5))!;
    near(right.strength, (3 / 5) * beta);
  });
});

describe("reverb の設定", () => {
  const r = roomAcoustics(room);

  it("seconds は RT60、decay は T の半分で -30dB になる値", () => {
    near(r.reverb.seconds, (0.161 * 60) / 18.8);
    // (1/2)^decay = 10^(-30/20)
    near(Math.pow(0.5, REVERB_DECAY), Math.pow(10, -1.5));
    expect(r.reverb.decay).toBe(REVERB_DECAY);
  });

  it("wet は 距離² ÷ (距離² + 臨界距離²)。臨界距離 = √(18.8 ÷ 16π) ≒ 0.612m", () => {
    near(r.criticalDistance, Math.sqrt(18.8 / (16 * Math.PI)));
    expect(r.criticalDistance).toBeCloseTo(0.6116, 4);
    near(r.reverb.wet!, 9 / (9 + 18.8 / (16 * Math.PI)));
  });

  it("早期反射は [時刻, 強さ] になり、形式の検査を通る", () => {
    expect(r.reverb.early).toHaveLength(24);
    expect(r.reverb.early![0]).toEqual([r.reflections[0]!.time, r.reflections[0]!.strength]);
    const res = validateBank({ format: "sfx-bank/1", reverb: { room: r.reverb }, sounds: {} });
    expect(res).toMatchObject({ ok: true });
  });

  it("とても吸う小さい部屋でも seconds は形式の範囲（0.05 秒以上）に入る", () => {
    const tiny = roomAcoustics({ size: [1, 1, 1], all: 1, source: [0.2, 0.5, 0.5], listener: [0.8, 0.5, 0.5] });
    near(tiny.rt60, 0.161 / 6);
    expect(tiny.reverb.seconds).toBe(0.05);
    for (const [t] of tiny.reverb.early!) expect(t).toBeLessThan(0.05);
  });

  it("音源・聞く位置が部屋の外なら投げる", () => {
    expect(() => roomAcoustics({ ...room, source: [6, 2, 1.5] })).toThrow();
  });
});

describe("距離と向き", () => {
  it("3m 先：音量 1/3、遅れ 3 ÷ 343 秒", () => {
    const p = placement([1, 2, 1.5], [4, 2, 1.5]);
    near(p.gain, 1 / 3);
    near(p.delay, 3 / 343);
  });

  it("1m より近くても音量は 1 で止まる", () => {
    expect(placement([0, 0.5, 0], [0, 0, 0]).gain).toBe(1);
  });

  it("正面（+y）を向いて、真左は -1、真右は 1、右斜め前 45 度は 1/√2", () => {
    near(placement([-3, 0, 0], [0, 0, 0]).pan, -1);
    near(placement([3, 0, 0], [0, 0, 0]).pan, 1);
    near(placement([1, 1, 0], [0, 0, 0]).pan, Math.SQRT1_2);
  });

  it("向きを変える：+x を向く（facing 90）と、+y の音は左（-1）", () => {
    near(placement([0, 2, 0], [0, 0, 0], 90).pan, -1);
    near(placement([2, 0, 0], [0, 0, 0], 90).pan, 0);
  });

  it("真上の音は真ん中", () => {
    expect(placement([0, 0, 2], [0, 0, 0]).pan).toBe(0);
  });
});

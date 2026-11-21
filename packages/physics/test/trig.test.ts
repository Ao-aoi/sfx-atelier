import { describe, expect, it } from "vitest";
import { sincos } from "../src/trig";

// 期待値は三角関数の定義（特別な角の値）と、Math.sin・Math.cos（誤差 1 ulp 程度）から
describe("sincos", () => {
  it("特別な角", () => {
    const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-15);
    const [s30, c30] = sincos(Math.PI / 6);
    close(s30, 0.5);
    close(c30, Math.sqrt(3) / 2);
    const [s90, c90] = sincos(Math.PI / 2);
    close(s90, 1);
    close(c90, 0);
    const [s180, c180] = sincos(Math.PI);
    close(s180, 0);
    close(c180, -1);
    const [s45n, c45n] = sincos(-Math.PI / 4);
    close(s45n, -Math.SQRT1_2);
    close(c45n, Math.SQRT1_2);
  });

  it("広い範囲で Math.sin・Math.cos と 1e-14 以内", () => {
    for (let x = -40; x <= 40; x += 0.0137) {
      const [s, c] = sincos(x);
      expect(Math.abs(s - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(c - Math.cos(x))).toBeLessThan(1e-14);
    }
  });
});

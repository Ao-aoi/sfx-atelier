import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "../src/wav";

// 期待値は WAVE の仕様（RIFF の見出し 44 バイト、リトルエンディアン、16bit は -32768〜32767）から
const sig = (...chs: number[][]) => ({ sampleRate: 48000, channels: chs.map((c) => Float32Array.from(c)) });
const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint16(at, true);
const i16 = (b: Uint8Array, at: number) => new DataView(b.buffer).getInt16(at, true);

describe("encodeWav", () => {
  it("16bit モノラル 3 サンプル：44 + 6 バイト、見出しの値", () => {
    const b = encodeWav(sig([0, 0.5, -1]));
    expect(b.length).toBe(50);
    expect([ascii(b, 0), ascii(b, 8), ascii(b, 12), ascii(b, 36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(u32(b, 4)).toBe(42);
    expect(u16(b, 20)).toBe(1);
    expect(u16(b, 22)).toBe(1);
    expect(u32(b, 24)).toBe(48000);
    expect(u32(b, 28)).toBe(96000);
    expect(u16(b, 32)).toBe(2);
    expect(u16(b, 34)).toBe(16);
    expect(u32(b, 40)).toBe(6);
    // 0.5 × 32768 = 16384、-1 → -32768
    expect([i16(b, 44), i16(b, 46), i16(b, 48)]).toEqual([0, 16384, -32768]);
  });

  it("範囲外は切る（1 も 32767 まで）", () => {
    const b = encodeWav(sig([2, -3, 1]));
    expect([i16(b, 44), i16(b, 46), i16(b, 48)]).toEqual([32767, -32768, 32767]);
  });

  it("ステレオは左右を交互に並べる", () => {
    const b = encodeWav(sig([1, 0], [0, -1]));
    expect(u16(b, 22)).toBe(2);
    expect(u16(b, 32)).toBe(4);
    expect([i16(b, 44), i16(b, 46), i16(b, 48), i16(b, 50)]).toEqual([32767, 0, 0, -32768]);
  });

  it("32bit は浮動小数（format 3）", () => {
    const b = encodeWav(sig([0.25]), 32);
    expect(u16(b, 20)).toBe(3);
    expect(new DataView(b.buffer).getFloat32(44, true)).toBe(0.25);
  });
});

describe("decodeWav", () => {
  it("書いて読むと戻る（16bit は 0.5/32768 以内、32bit は一致）", () => {
    const x = sig([0, 0.1, -0.7, 0.999], [0.5, -0.5, 0.25, 0]);
    const r16 = decodeWav(encodeWav(x));
    expect(r16.sampleRate).toBe(48000);
    for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++) expect(Math.abs(r16.channels[c]![i]! - x.channels[c]![i]!)).toBeLessThanOrEqual(0.5 / 32768 + 1e-9);
    const r32 = decodeWav(encodeWav(x, 32));
    expect(r32.channels).toEqual(x.channels);
  });

  it("知らない塊（LIST）を読み飛ばす・24bit を読む", () => {
    // 手で組んだ 24bit モノラル、LIST 塊つき：サンプルは 0x400000（= 0.5）と 0xC00000（= -0.5）
    const parts = [
      ..."RIFF".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0,
      ..."WAVE".split("").map((c) => c.charCodeAt(0)),
      ..."LIST".split("").map((c) => c.charCodeAt(0)), 3, 0, 0, 0, 1, 2, 3, 0,
      ..."fmt ".split("").map((c) => c.charCodeAt(0)), 16, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 3, 0, 24, 0,
      ..."data".split("").map((c) => c.charCodeAt(0)), 6, 0, 0, 0, 0, 0, 0x40, 0, 0, 0xc0,
    ];
    const r = decodeWav(Uint8Array.from(parts));
    expect(r.sampleRate).toBe(44100);
    expect(Array.from(r.channels[0]!)).toEqual([0.5, -0.5]);
  });

  it("wav でなければ投げる", () => {
    expect(() => decodeWav(new Uint8Array(16))).toThrow();
  });
});

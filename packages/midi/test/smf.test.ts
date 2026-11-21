import { describe, expect, it } from "vitest";
import { MidiError, readSmf, tickClock, writeSmf, type Smf } from "../src";

const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const header = (format: number, ntrks: number, div: number) => [...str("MThd"), ...u32(6), 0, format, 0, ntrks, div >> 8, div & 0xff];
const track = (body: number[]) => [...str("MTrk"), ...u32(body.length), ...body];
const END = [0x00, 0xff, 0x2f, 0x00];

describe("readSmf", () => {
  it("形式 0：テンポ・拍子・ランニングステータス・ベロシティ 0 のノートオン", () => {
    // 分解能 96。C4 を 0〜96、E4 を 96〜480。2 つ目以降はランニングステータス
    const bytes = new Uint8Array([
      ...header(0, 1, 96),
      ...track([
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 500000 µs = 120 BPM
        0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
        0x00, 0x90, 0x3c, 0x64,
        0x60, 0x3c, 0x00, // Δ96、ベロシティ 0 = 止める
        0x00, 0x40, 0x50,
        0x83, 0x00, 0x80, 0x40, 0x40, // Δ384（0x83 0x00）
        ...END,
      ]),
    ]);
    const smf = readSmf(bytes);
    expect(smf.format).toBe(0);
    expect(smf.ppq).toBe(96);
    expect(smf.tracks[0]!.events).toEqual([
      { tick: 0, type: "tempo", usPerBeat: 500000 },
      { tick: 0, type: "timeSig", num: 3, den: 4 },
      { tick: 0, type: "noteOn", ch: 0, key: 60, vel: 100 },
      { tick: 96, type: "noteOff", ch: 0, key: 60, vel: 0 },
      { tick: 96, type: "noteOn", ch: 0, key: 64, vel: 80 },
      { tick: 480, type: "noteOff", ch: 0, key: 64, vel: 64 },
    ]);
  });

  it("知らない塊は読み飛ばし、ピッチベンド・SysEx は種類だけ残す", () => {
    const bytes = new Uint8Array([
      ...header(0, 1, 480),
      ...str("XFIH"), ...u32(3), 1, 2, 3,
      ...track([0x00, 0xe0, 0x00, 0x40, 0x00, 0xf0, 0x02, 0x7e, 0xf7, 0x00, 0xd0, 0x10, ...END]),
    ]);
    const kinds = readSmf(bytes).tracks[0]!.events.map((e) => (e.type === "other" ? e.kind : e.type));
    expect(kinds).toEqual(["pitchBend", "sysex", "aftertouch"]);
  });

  it("壊れた入力を拒む", () => {
    expect(() => readSmf(new Uint8Array(str("RIFF0000000000")))).toThrow(MidiError);
    // トラックが宣言より短い
    expect(() => readSmf(new Uint8Array([...header(0, 1, 96), ...str("MTrk"), ...u32(10), 0x00, 0x90]))).toThrow(MidiError);
    // トラックの中でノートオンのデータが切れている
    expect(() => readSmf(new Uint8Array([...header(0, 1, 96), ...track([0x00, 0x90, 0x3c])]))).toThrow(MidiError);
    // 最初の出来事にステータスが無い
    expect(() => readSmf(new Uint8Array([...header(0, 1, 96), ...track([0x00, 0x3c, 0x40, ...END])]))).toThrow(MidiError);
    // トラックが足りない
    expect(() => readSmf(new Uint8Array([...header(1, 2, 96), ...track(END)]))).toThrow(MidiError);
  });

  it("SMPTE の分解能：25 fps × 40 tick は 1 秒 1000 tick", () => {
    // 上位バイト -25 = 0xE7
    const smf = readSmf(new Uint8Array([...header(0, 1, 0xe728), ...track(END)]));
    expect(smf.ppq).toBeNull();
    expect(smf.smpte).toEqual({ fps: 25, ticksPerFrame: 40 });
    expect(tickClock(smf)(1500)).toBeCloseTo(1.5, 12);
  });
});

describe("tickClock", () => {
  it("テンポの変わり目をまたぐ：120 BPM で 2 拍 = 1 秒、その後 60 BPM で 1 拍 = 1 秒", () => {
    const smf: Smf = {
      format: 1,
      ppq: 480,
      tracks: [{ events: [{ tick: 0, type: "tempo", usPerBeat: 500000 }, { tick: 960, type: "tempo", usPerBeat: 1000000 }] }],
    };
    const c = tickClock(smf);
    expect(c(480)).toBeCloseTo(0.5, 12);
    expect(c(960)).toBeCloseTo(1, 12);
    expect(c(1440)).toBeCloseTo(2, 12);
  });

  it("テンポが無ければ 120 BPM", () => {
    expect(tickClock({ format: 0, ppq: 480, tracks: [{ events: [] }] })(480)).toBeCloseTo(0.5, 12);
  });
});

describe("writeSmf", () => {
  it("可変長の数（SMF の仕様書の例：0x80 → 81 00、0x3FFF → FF 7F、0x4000 → 81 80 00、0x0FFFFFFF → FF FF FF 7F）", () => {
    const ticks = [0x80, 0x3fff, 0x4000, 0x0fffffff];
    const want = [[0x81, 0x00], [0xff, 0x7f], [0x81, 0x80, 0x00], [0xff, 0xff, 0xff, 0x7f]];
    ticks.forEach((tick, i) => {
      const out = writeSmf({ format: 0, ppq: 96, tracks: [{ events: [{ tick, type: "program", ch: 0, program: 5 }] }] });
      // ヘッダ 14 + "MTrk" と長さ 8 の後が差分の時間
      expect([...out.subarray(22, 22 + want[i]!.length)]).toEqual(want[i]);
      expect(readSmf(out).tracks[0]!.events[0]!.tick).toBe(tick);
    });
  });

  it("同じ tick では止める音を出す音より先に書き、ヘッダの分解能を書く", () => {
    const out = writeSmf({
      format: 0,
      ppq: 480,
      tracks: [
        {
          events: [
            { tick: 480, type: "noteOn", ch: 1, key: 60, vel: 90 },
            { tick: 0, type: "noteOn", ch: 1, key: 60, vel: 90 },
            { tick: 480, type: "noteOff", ch: 1, key: 60, vel: 0 },
          ],
        },
      ],
    });
    expect([...out.subarray(12, 14)]).toEqual([0x01, 0xe0]);
    expect(readSmf(out).tracks[0]!.events.map((e) => [e.tick, e.type])).toEqual([
      [0, "noteOn"],
      [480, "noteOff"],
      [480, "noteOn"],
    ]);
  });

  it("書いて読むと同じ（テンポ・拍子・トラック名・コントロール）", () => {
    const smf: Smf = {
      format: 1,
      ppq: 960,
      tracks: [
        { events: [{ tick: 0, type: "trackName", text: "テンポ" }, { tick: 0, type: "tempo", usPerBeat: 428571 }, { tick: 0, type: "timeSig", num: 6, den: 8 }] },
        { events: [{ tick: 0, type: "control", ch: 3, cc: 7, value: 100 }, { tick: 10, type: "noteOn", ch: 3, key: 72, vel: 1 }, { tick: 20000, type: "noteOff", ch: 3, key: 72, vel: 0 }] },
      ],
    };
    expect(readSmf(writeSmf(smf))).toEqual(smf);
  });
});

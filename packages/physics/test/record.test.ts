import { describe, expect, it } from "vitest";
import { record } from "../src/record";
import { DISCARD_SCENE, DISCARD_SOUND } from "../src/scenes";
import { decodeWav, encodeWav } from "../src/wav";
import { vary } from "../src/engine";

describe("録音", () => {
  it("discard：牌が卓に落ち、最初の音は最初の接触の時刻から鳴る", () => {
    const r = record(DISCARD_SCENE, { ...DISCARD_SOUND, seed: 1 });
    expect(r.events.length).toBeGreaterThan(0);
    const x = r.signal.channels[0]!;
    const first = Math.round(r.events[0]!.t * 48000);
    expect(x.subarray(0, first).every((v) => v === 0)).toBe(true);
    expect(Math.max(...x.subarray(first, first + 480).map(Math.abs))).toBeGreaterThan(0);
  });

  it("同じシーン・種なら同じ wav（バイト単位で一致）", () => {
    const a = encodeWav(record(DISCARD_SCENE, { ...DISCARD_SOUND, seed: 1 }).signal);
    const b = encodeWav(record(DISCARD_SCENE, { ...DISCARD_SOUND, seed: 1 }).signal);
    expect(b).toEqual(a);
    expect(decodeWav(a).channels[0]!.length).toBe((a.length - 44) / 2);
  });

  it("揺らしたシーンは違う音になる", () => {
    const a = record(DISCARD_SCENE, { ...DISCARD_SOUND, seed: 1 }).signal.channels[0]!;
    const b = record(vary(DISCARD_SCENE, 2, { pos: 0.01, vel: 0.2, yaw: 20 }), { ...DISCARD_SOUND, seed: 1 }).signal.channels[0]!;
    expect(b).not.toEqual(a);
  });
});

import { describe, expect, it } from "vitest";
import type { Bank } from "@sfx-atelier/format/types";
import example from "../../format/test/fixtures/proposal-example.sfxbank.json";
import { seeded } from "../src/compile";
import { createSfx } from "../src/sfx";

const bank = example as Bank;
const RATE = 48000;

const offline = (seconds: number) => new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);

function peak(buf: AudioBuffer, from = 0, to = buf.duration) {
  let m = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = Math.floor(from * RATE); i < Math.min(d.length, to * RATE); i++) m = Math.max(m, Math.abs(d[i]!));
  }
  return m;
}

/** 16bit モノラルの wav を作る（録音の読み込みのテスト用） */
function wav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.round(x * 32767), true));
  return new Blob([buf], { type: "audio/wav" });
}

describe("createSfx", () => {
  it("名前で鳴らす。delay の分だけ遅れて鳴る", async () => {
    const ctx = offline(1.5);
    const sfx = createSfx(bank, { context: ctx, random: seeded(1) });
    await sfx.ready;
    expect(sfx.play("discard", { delay: 0.5 })).not.toBeNull();
    const buf = await ctx.startRendering();
    expect(peak(buf, 0, 0.5)).toBe(0);
    expect(peak(buf, 0.5, 0.7)).toBeGreaterThan(0.05);
  });

  it("知らない名前は null", () => {
    const sfx = createSfx(bank, { context: offline(0.1) });
    expect(sfx.play("nothing")).toBeNull();
  });

  it("同時発音数の上限：kan（20 声）を 3 回鳴らすと、上限 48 を超える分の古い音から止める", async () => {
    const ctx = offline(0.1);
    const sfx = createSfx(bank, { context: ctx, random: seeded(1) });
    sfx.play("kan");
    sfx.play("kan");
    expect(sfx.voices).toBe(40);
    sfx.play("kan");
    expect(sfx.voices).toBe(40);
    sfx.stopAll();
    expect(sfx.voices).toBe(0);
  });

  it("setMasterGain(0) で無音（15ms の時定数でなめらかに下げるので、少し後に鳴らして確かめる）", async () => {
    const ctx = offline(1.5);
    const sfx = createSfx(bank, { context: ctx, random: seeded(1) });
    sfx.setMasterGain(0);
    sfx.play("discard", { delay: 0.3 });
    // 0.3 秒は時定数の 20 倍：e^-20 ≒ 2e-9
    expect(peak(await ctx.startRendering())).toBeLessThan(1e-6);
  });

  it("playScore：score の楽器・残響で鳴らす", async () => {
    const ctx = offline(1);
    const sfx = createSfx({ format: "sfx-bank/1", sounds: {} }, { context: ctx, random: seeded(1) });
    sfx.playScore({
      format: "sfx-score/1",
      reverb: { small: { seconds: 0.3, decay: 3, wet: 0.3 } },
      instruments: { beep: { layers: [{ osc: "sine", freq: 880, gain: 0.3, env: { a: 0.005, d: 0.2 } }] } },
      tracks: [{ instrument: "beep", send: { small: 1 }, notes: [{ t: 0 }] }],
    });
    const buf = await ctx.startRendering();
    expect(peak(buf)).toBeGreaterThan(0.1);
    expect(peak(buf)).toBeLessThan(1);
  });

  it("録音を url から読み込み、ready の後に鳴らす", async () => {
    const tone = new Float32Array(RATE / 4).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    const url = URL.createObjectURL(wav(tone, RATE));
    const b: Bank = {
      format: "sfx-bank/1",
      samples: { tone: { url } },
      instruments: { tone: { layers: [{ sample: "tone" }] } },
      sounds: { tone: { tracks: [{ instrument: "tone", notes: [{ t: 0 }] }] } },
    };
    const ctx = offline(0.5);
    const sfx = createSfx(b, { context: ctx });
    await sfx.ready;
    sfx.play("tone");
    const buf = await ctx.startRendering();
    // 0.25 秒の録音：鳴っている間は振幅 0.5 付近、0.3 秒以降は無音
    expect(peak(buf, 0, 0.25)).toBeCloseTo(0.5, 1);
    expect(peak(buf, 0.3)).toBeLessThan(1e-3);
  });

  it("読めない録音は ready が失敗する", async () => {
    const b: Bank = { format: "sfx-bank/1", samples: { x: { url: "data:audio/wav;base64,AAAA" } }, sounds: {} };
    const sfx = createSfx(b, { context: offline(0.1) });
    await expect(sfx.ready).rejects.toBeTruthy();
  });
});

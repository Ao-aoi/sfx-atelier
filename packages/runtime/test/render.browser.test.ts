import { describe, expect, it } from "vitest";
import type { Bank, Sound } from "@sfx-atelier/format/types";
import example from "../../format/test/fixtures/proposal-example.sfxbank.json";
import { renderOffline } from "../src/offline";

// 描画はブラウザの実装に依るので、完全一致は求めず許容差つきで確かめる（CLAUDE.md）
const bank = example as Bank;
const parts = { instruments: bank.instruments, reverb: bank.reverb, master: bank.master };
const RATE = 48000;

function stats(buf: AudioBuffer) {
  let peak = 0;
  let sumSq = 0;
  let nan = false;
  let lastLoud = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i]!;
      if (!Number.isFinite(x)) nan = true;
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 1e-3) lastLoud = Math.max(lastLoud, i);
      sumSq += x * x;
    }
  }
  return { peak, rms: Math.sqrt(sumSq / (buf.length * buf.numberOfChannels)), nan, lastLoud: lastLoud / buf.sampleRate };
}

describe("提案書 4.1 の 3 音を描画する", () => {
  for (const [name, minSec, maxSec] of [
    ["discard", 0.7, 1.0],
    ["kan", 0.9, 1.1],
    ["win", 1.9, 2.1],
  ] as const) {
    it(`${name}：長さ・音が出ている・NaN が無い・割れていない`, async () => {
      const buf = await renderOffline(bank.sounds[name]!, parts, { seed: 1, sampleRate: RATE });
      const s = stats(buf);
      // 長さ = 最後の声の停止 + 残響 0.7 秒 + 余白 0.05 秒
      expect(buf.duration).toBeGreaterThan(minSec);
      expect(buf.duration).toBeLessThan(maxSec);
      expect(s.nan).toBe(false);
      expect(s.peak).toBeGreaterThan(0.05);
      expect(s.peak).toBeLessThan(1);
      expect(s.rms).toBeGreaterThan(1e-4);
    });
  }

  it("同じ種なら同じ波形、違う種なら違う", async () => {
    const a = await renderOffline(bank.sounds.discard!, parts, { seed: 7, sampleRate: RATE });
    const b = await renderOffline(bank.sounds.discard!, parts, { seed: 7, sampleRate: RATE });
    const c = await renderOffline(bank.sounds.discard!, parts, { seed: 8, sampleRate: RATE });
    // 畳み込みの計算順で 1e-15 程度の差が出ることがあるので、完全一致ではなく差の最大で見る
    const maxDiff = (x: AudioBuffer, y: AudioBuffer) => {
      const p = x.getChannelData(0);
      const q = y.getChannelData(0);
      let m = 0;
      for (let i = 0; i < Math.min(p.length, q.length); i++) m = Math.max(m, Math.abs(p[i]! - q[i]!));
      return m;
    };
    expect(maxDiff(a, b)).toBeLessThan(1e-6);
    expect(maxDiff(a, c)).toBeGreaterThan(1e-3);
  });
});

describe("既知の信号", () => {
  it("1000Hz の正弦波：ゼロ交差がおよそ 1 秒あたり 2000 回", async () => {
    const sound: Sound = { tracks: [{ instrument: "x", notes: [{ t: 0, dur: 0.5 }] }] };
    const buf = await renderOffline(
      sound,
      { instruments: { x: { layers: [{ osc: "sine", freq: 1000, gain: 0.5, env: { a: 0, d: 0, s: 1, r: 0 } }] } } },
      { sampleRate: RATE },
    );
    const d = buf.getChannelData(0);
    // 0.1〜0.4 秒の 0.3 秒間で数える：1000Hz なら 600 回
    let crossings = 0;
    for (let i = Math.floor(0.1 * RATE); i < 0.4 * RATE; i++) if ((d[i - 1]! < 0) !== (d[i]! < 0)) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(598);
    expect(crossings).toBeLessThanOrEqual(602);
    // 振幅 0.5、pan 0 の StereoPanner を通さないので左右とも 0.5 付近
    expect(stats(buf).peak).toBeCloseTo(0.5, 2);
  });

  it("tune: 1200 で 1 オクターブ上（ゼロ交差が 2 倍）", async () => {
    const ins = { x: { layers: [{ osc: "sine" as const, freq: 500, env: { a: 0, d: 0, s: 1, r: 0 } }] } };
    const count = async (tune: number) => {
      const buf = await renderOffline({ tracks: [{ instrument: "x", notes: [{ t: 0, dur: 0.5, tune }] }] }, { instruments: ins }, { sampleRate: RATE });
      const d = buf.getChannelData(0);
      let c = 0;
      for (let i = Math.floor(0.1 * RATE); i < 0.4 * RATE; i++) if ((d[i - 1]! < 0) !== (d[i]! < 0)) c++;
      return c;
    };
    const base = await count(0);
    const up = await count(1200);
    expect(up / base).toBeCloseTo(2, 1);
  });

  it("exp の AD 型：a + d の後は -60dB より小さい（残響なし）", async () => {
    const buf = await renderOffline(
      { tracks: [{ instrument: "x", notes: [{ t: 0 }] }] },
      { instruments: { x: { layers: [{ osc: "sine", freq: 440, env: { a: 0.005, d: 0.1 } }] } } },
      { sampleRate: RATE },
    );
    expect(stats(buf).lastLoud).toBeLessThan(0.105 + 0.01);
  });

  it("録音の層：既定のエンベロープで最後まで鳴り、ratio 2 で半分の長さで終わる", async () => {
    const len = RATE / 2;
    const ctx = new OfflineAudioContext(1, len, RATE);
    const drop = ctx.createBuffer(1, len, RATE);
    drop.getChannelData(0).fill(0.25);
    const sound: Sound = { tracks: [{ instrument: "x", notes: [{ t: 0 }] }] };
    const buf = await renderOffline(
      sound,
      { instruments: { x: { layers: [{ sample: "drop", ratio: 2 }] } } },
      { sampleRate: RATE, samples: { drop } },
    );
    const d = buf.getChannelData(0);
    expect(d[Math.floor(0.1 * RATE)]).toBeCloseTo(0.25, 3);
    // 0.5 秒の録音を 2 倍速で 0.25 秒。0.3 秒には鳴っていない
    expect(Math.abs(d[Math.floor(0.3 * RATE)]!)).toBeLessThan(1e-3);
  });
});

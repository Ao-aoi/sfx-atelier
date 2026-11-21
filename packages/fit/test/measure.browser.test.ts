// M4.5 の 5 番：discard・sticks・win を変換し、元と変換後の大きさ・声の数・距離を表にする。
// 残響は外して（乾いた音で）比べる。変換後の score にも、使うときに元と同じ send を付ける想定。
// 表は `npm run measure -w @sfx-atelier/fit` で出る（docs/m4.5-measure.md に写す）。
import { describe, expect, it } from "vitest";
import { distance, toMono } from "@sfx-atelier/analysis";
import { shrinkScore } from "@sfx-atelier/format";
import type { Bank, Score, Sound } from "@sfx-atelier/format/types";
import mahjong5 from "../../runtime/test/fixtures/mahjong-5.sfxbank.json";
import sticks from "./fixtures/sticks.sfxscore.json";
import { fit } from "../src/fit";
import { gzipBytes, RATE, renderScore } from "./browser";

const bank = mahjong5 as Bank;

/** バンクの 1 音 → 残響を外した単体の score（使っている楽器だけ） */
function dry(sound: Sound, instruments: Bank["instruments"]): Score {
  const used = new Set(sound.tracks.map((t) => t.instrument));
  return {
    format: "sfx-score/1",
    ...sound,
    instruments: Object.fromEntries(Object.entries(instruments ?? {}).filter(([k]) => used.has(k))),
    tracks: sound.tracks.map(({ send: _s, ...t }) => t),
  };
}

const voices = (s: Score) => s.tracks.reduce((n, t) => n + t.notes.length * (s.instruments?.[t.instrument]?.layers.length ?? 0), 0);

const cases: [string, Score][] = [
  ["discard", dry(bank.sounds.discard!, bank.instruments)],
  ["sticks", sticks as Score],
  ["win", dry(bank.sounds.win!, bank.instruments)],
];

describe("3 音の測定", () => {
  const rows: string[] = [];
  for (const [name, score] of cases) {
    it(name, async () => {
      const src = await renderScore(score);
      // 基準：同じ score を別の乱数で鳴らしたときの差（雑音は毎回違うので、これより小さくはならない）
      const again = distance(toMono(src), toMono(await renderScore(score, 4)), RATE);
      const before = JSON.stringify(shrinkScore(score));
      for (const layers of [24, 8, 4]) {
        const r = fit(src, { budget: { layers } });
        const out = await renderScore(r.score);
        const d = distance(toMono(src), toMono(out), RATE);
        const after = JSON.stringify(r.score);
        const gz = [await gzipBytes(before), await gzipBytes(after)];
        rows.push(
          `| ${name} | ${layers} | ${before.length} → ${after.length} | ${gz[0]} → ${gz[1]} | ${voices(score)} → ${voices(r.score)} | ` +
            `${d.spectral.toFixed(1)}（${again.spectral.toFixed(1)}） | ${d.peak.toFixed(1)} | ${(d.attack * 1000).toFixed(0)} | ${(d.length * 1000).toFixed(0)} |`,
        );
        if (layers === 24) console.log(`${name} の変換結果: ${after}`);
        expect(gz[1]).toBeLessThanOrEqual(3072);
        expect(voices(r.score)).toBeLessThanOrEqual(layers);
        expect(Number.isFinite(d.spectral)).toBe(true);
      }
    });
  }
  it("表", () => {
    console.log(
      [
        "| 音 | 層の上限 | JSON（バイト） | gzip 後 | 声の数 | スペクトル差 dB（別の乱数どうし） | 山の差 dB | 立ち上がりの差 ms | 長さの差 ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  });
});

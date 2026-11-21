// 16 音を 基準（sfx.ts）と新しい形式で描画し、差を表にして出す（npm run report -w @sfx-atelier/compare -- --reporter=verbose）。
import { describe, expect, it } from "vitest";
import type { Bank } from "@sfx-atelier/format/types";
import { validateBank } from "@sfx-atelier/format";
import mahjong from "../../../bank/mahjong.sfxbank.json";
import { diff, measure, type Diff } from "../src/measure";
import { REFERENCE_NAMES } from "../src/reference";
import { renderBank, renderReference } from "../src/render";

const bank = mahjong as Bank;
const SEEDS = [1, 2, 3, 4, 5];

describe("mahjong の 16 音：基準との差", () => {
  it("バンクが検証を通り、16 音そろっている", () => {
    const r = validateBank(bank);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(Object.keys(bank.sounds).sort()).toEqual([...REFERENCE_NAMES].sort());
  });

  it("表", async () => {
    const rows: string[] = [];
    const all: Record<string, Diff> = {};
    for (const name of REFERENCE_NAMES) {
      const acc = { length: 0, centroid: 0, peakDb: 0, envelopeDb: 0 };
      let refLen = 0;
      let refCentroid = 0;
      for (const seed of SEEDS) {
        const a = measure(await renderReference(name, seed));
        const b = measure(await renderBank(bank, name, seed));
        const d = diff(a, b);
        for (const k of Object.keys(acc) as (keyof Diff)[]) acc[k] += d[k] / SEEDS.length;
        refLen += a.length / SEEDS.length;
        refCentroid += a.centroid / SEEDS.length;
      }
      all[name] = acc;
      rows.push(
        `| ${name} | ${refLen.toFixed(3)} | ${(acc.length * 1000).toFixed(1)} | ${refCentroid.toFixed(0)} | ${(acc.centroid * 100).toFixed(1)} | ${acc.peakDb.toFixed(2)} | ${acc.envelopeDb.toFixed(2)} |`,
      );
    }
    console.log(
      [
        "| 音 | 基準の長さ（秒） | 長さの差（ms） | 基準の重心（Hz） | 重心の差（%） | 最大音量の差（dB） | 音量の推移の差（dB、平均） |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows,
      ].join("\n"),
    );
    // 許容差（目安）：音量の推移 1dB、重心 3%、長さ 10ms、最大音量 0.5dB。最後は耳で決める
    for (const [name, d] of Object.entries(all)) {
      expect.soft(d.envelopeDb, `${name} の音量の推移`).toBeLessThan(1);
      expect.soft(Math.abs(d.centroid), `${name} の重心`).toBeLessThan(0.03);
      expect.soft(Math.abs(d.length), `${name} の長さ`).toBeLessThan(0.01);
      expect.soft(Math.abs(d.peakDb), `${name} の最大音量`).toBeLessThan(0.5);
    }
  }, 120_000);
});

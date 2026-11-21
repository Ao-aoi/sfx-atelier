// M1 の確かめ：mahjong-sensei の 16 音のうち 5 音（discard・kan・win・riichi・rise）を形式で書き、
// 検証を通り、描画でき、縮めた JSON が小さいことを確かめる（音が同じかの聞き比べは M2）。
import { describe, expect, it } from "vitest";
import { normalizeBank, shrinkBank, validateBank } from "@sfx-atelier/format";
import type { Bank } from "@sfx-atelier/format/types";
import mahjong5 from "./fixtures/mahjong-5.sfxbank.json";
import { renderOffline } from "../src/offline";

const bank = mahjong5 as Bank;

describe("mahjong の 5 音", () => {
  it("検証を通る", () => {
    const r = validateBank(bank);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("縮めた JSON（5 音・楽器 6 つ）が 3KB 以下", () => {
    const size = JSON.stringify(shrinkBank(normalizeBank(bank))).length;
    expect(size).toBeLessThan(3 * 1024);
  });

  for (const name of ["discard", "kan", "win", "riichi", "rise"]) {
    it(`${name}：音が出ている・NaN が無い・割れていない`, async () => {
      const buf = await renderOffline(bank.sounds[name]!, bank, { seed: 3 });
      let peak = 0;
      let nan = false;
      for (let ch = 0; ch < 2; ch++) {
        for (const x of buf.getChannelData(ch)) {
          if (!Number.isFinite(x)) nan = true;
          peak = Math.max(peak, Math.abs(x));
        }
      }
      expect(nan).toBe(false);
      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThan(1);
    });
  }
});
